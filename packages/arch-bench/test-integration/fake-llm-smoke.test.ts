/**
 * Fake-LLM integration: drive the `claude-direct-edit` baseline with an
 * injected transport that behaves like a PERFECT agent — it reads the updated
 * backend.arch and regenerates the project (the same content Arch would emit) —
 * and returns a realistic `claude -p` JSON envelope with cost/session metadata.
 *
 * This exercises the entire live-baseline path (prompt build → runClaude →
 * envelope parse → llm metadata capture → verifyProject → oracle) without a
 * real `claude` binary. Gated by ARCH_BENCH_SMOKE=1 (runs a real install).
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generate } from "@arch/generator";
import { loadManifest } from "../src/manifest/load.js";
import { runSuite } from "../src/runner/orchestrator.js";
import { compileSpec } from "../src/runner/compile.js";
import type { LiveAgentTransport } from "../src/llm/agent-runner.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RUN = process.env["ARCH_BENCH_SMOKE"] === "1";
const maybe = RUN ? it : it.skip;

const perfectAgentTransport: LiveAgentTransport = async (_args, opts) => {
  // A perfect agent: read the updated spec and regenerate the project to match.
  const spec = await readFile(resolve(opts.cwd, "backend.arch"), "utf8");
  const compiled = compileSpec(spec, "backend.arch");
  if (compiled.ok) {
    for (const f of generate(compiled.ir).files) {
      const target = resolve(opts.cwd, f.path);
      if (f.stub_only && existsSync(target)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content, "utf8");
    }
  }
  const envelope = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Updated the model and validator to match the new spec.",
    session_id: "fake-session-1",
    total_cost_usd: 0.0123,
    modelUsage: { "fake-model": { inputTokens: 1, outputTokens: 1 } },
  });
  return { code: 0, stdout: envelope, stderr: "" };
};

describe("claude-direct-edit with a fake transport (smoke)", () => {
  maybe(
    "applies, verifies, passes the oracle, and records cost/session metadata",
    async () => {
      const loaded = await loadManifest(resolve(REPO_ROOT, "benchmarks", "manifest.json"));
      const results = await runSuite({
        loaded,
        repoRoot: REPO_ROOT,
        baselines: ["claude-direct-edit"],
        repeats: 1,
        subjects: ["social-feed"],
        maxTasksPerSubject: 1,
        liveTransports: { "claude-code": perfectAgentTransport },
        liveModels: { "claude-code": "fake-model" },
      });

      expect(results).toHaveLength(1);
      const r = results[0]!;
      expect(r.passed, r.note ?? "").toBe(true);
      expect(r.verificationPassed).toBe(true);
      expect(r.oraclePassed).toBe(true);
      expect(r.llm?.provider).toBe("claude-code");
      expect(r.llm?.sessionId).toBe("fake-session-1");
      expect(r.llm?.costUsd).toBeCloseTo(0.0123);
      expect(r.llm?.model).toBe("fake-model");
    },
    600_000,
  );
});

describe("multi-model fake transports (smoke)", () => {
  maybe(
    "runs Grok and Composer direct-edit baselines through the live-agent path",
    async () => {
      const loaded = await loadManifest(resolve(REPO_ROOT, "benchmarks", "manifest.json"));
      const results = await runSuite({
        loaded,
        repoRoot: REPO_ROOT,
        baselines: ["grok-direct-edit", "composer-direct-edit"],
        repeats: 1,
        subjects: ["social-feed"],
        maxTasksPerSubject: 1,
        liveTransports: {
          "grok-build": perfectAgentTransport,
          "cursor-composer": perfectAgentTransport,
        },
        liveModels: {
          "grok-build": "grok-build",
          "cursor-composer": "composer-2.5",
        },
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
      expect(results.map((r) => r.llm?.provider)).toEqual(["grok-build", "cursor-composer"]);
      expect(results.map((r) => r.llm?.billingMode)).toEqual(["subscription", "subscription"]);
    },
    600_000,
  );
});
