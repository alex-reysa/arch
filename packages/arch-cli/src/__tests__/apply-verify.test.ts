/**
 * Happy-path integration test for `arch apply` (ac-4c8e-002).
 *
 * Copies `examples/social-feed/v1/backend.arch` into a fresh temp directory,
 * then walks the canonical user transcript: `arch init` → `arch parse` →
 * `arch apply`. The test asserts that `runApply` exits 0 and that the run
 * report records `typecheck=pass` and `tests=pass` inside the generated
 * project (i.e. the verifier ran the generated code in-place).
 *
 * SLOW TEST. Expected wall-clock runtime: **~60–120 seconds** end-to-end on a
 * warm pnpm cache. Roughly:
 *   - generator + write phase: < 1 s
 *   - `pnpm install` inside the generated project: 30–90 s (network / cache)
 *   - `pnpm typecheck` + `pnpm test`: 15–30 s
 *
 * Slow-test affordances:
 *   - The `it` block is invoked with a 240_000 ms timeout option so vitest's
 *     default 5 s timeout doesn't fire mid-install.
 *   - Gated behind `ARCH_RUN_INTEGRATION=1` via `it.skipIf` so the default
 *     `pnpm --filter @arch/cli test` invocation stays fast and the existing
 *     unit tests remain the fast feedback loop. CI sets the env var to
 *     exercise the happy path.
 *   - Network access is required for `pnpm install` against the public
 *     registry; behind an offline mirror, ensure pnpm is configured to use
 *     it before setting `ARCH_RUN_INTEGRATION=1`.
 */

import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runApply } from "../commands/apply.js";
import { runInit } from "../commands/init.js";
import { runParse } from "../commands/parse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/arch-cli/src/__tests__/<file>  →  repo root is four levels up.
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const FIXTURE_BACKEND_ARCH = resolve(
  REPO_ROOT,
  "examples",
  "social-feed",
  "v1",
  "backend.arch",
);

const SHOULD_RUN = process.env.ARCH_RUN_INTEGRATION === "1";

describe("arch apply — SocialFeed v1 happy path (integration)", () => {
  it.skipIf(!SHOULD_RUN)(
    "init → parse → apply with verify exits 0 and reports typecheck=pass + tests=pass",
    { timeout: 240_000 },
    async () => {
      const projectRoot = mkdtempSync(
        resolve(tmpdir(), "arch-cli-apply-verify-"),
      );
      try {
        // 1. Copy the SocialFeed v1 spec into the temp project root.
        copyFileSync(
          FIXTURE_BACKEND_ARCH,
          resolve(projectRoot, "backend.arch"),
        );

        // 2. arch init — scaffolds .arch/ metadata layout. Existing
        //    backend.arch is preserved (init only writes when absent).
        const initCode = await runInit([
          "--cwd",
          projectRoot,
          "--template",
          "social-feed",
        ]);
        expect(initCode).toBe(0);

        // 3. arch parse --emit-ir — writes .arch/ir.current.json.
        const metadataDir = resolve(projectRoot, ".arch");
        const parseCode = await runParse([
          resolve(projectRoot, "backend.arch"),
          "--emit-ir",
          "--metadata-dir",
          metadataDir,
        ]);
        expect(parseCode).toBe(0);

        // 4. arch apply — generates files, installs deps, runs verify.
        const applyCode = await runApply([
          "--cwd",
          projectRoot,
          "--metadata-dir",
          metadataDir,
        ]);
        expect(applyCode).toBe(0);

        // 5. Inspect the verifier's run report. There is exactly one runs/
        //    entry on a clean project; load it and assert per-step pass.
        const runsDir = resolve(metadataDir, "runs");
        const runIds = readRunIds(runsDir);
        expect(runIds.length).toBeGreaterThan(0);
        const reportPath = resolve(runsDir, runIds[0]!, "report.json");
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
          passed: boolean;
          failure_reason: string | null;
          steps: { name: string; passed: boolean }[];
        };
        expect(report.passed).toBe(true);
        expect(report.failure_reason).toBeNull();
        const byName = new Map(report.steps.map((s) => [s.name, s.passed]));
        expect(byName.get("typecheck")).toBe(true);
        expect(byName.get("tests")).toBe(true);
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );
});

function readRunIds(runsDir: string): string[] {
  return readdirSync(runsDir).filter((name) => {
    try {
      return statSync(resolve(runsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}
