import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { canonicalStringify } from "@arch/sync";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifierMocks = vi.hoisted(() => ({
  runInstall: vi.fn(),
  verify: vi.fn(),
  writeReports: vi.fn(),
}));

vi.mock("@arch/verifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@arch/verifier")>();
  return {
    ...actual,
    runInstall: verifierMocks.runInstall,
    verify: verifierMocks.verify,
    writeReports: verifierMocks.writeReports,
  };
});

import { runApply } from "../src/commands/apply.js";
import { parseArchSource } from "../src/commands/parse.js";
import { runPlan } from "../src/commands/plan.js";
import { detectDrift } from "@arch/verifier";
import {
  PlannedContentProvider,
  type AgentProvider,
  type AgentTaskOutput,
  type AgentTaskSpec,
} from "@arch/agents";

const SPEC_V1 = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model Note {",
  "  id: id",
  "  body: string",
  "}",
  "",
  "workflow CreateNote {",
  "  trigger api POST /notes auth: none",
  "  step validate body",
  "  step insert Note",
  "}",
  "",
].join("\n");

const SPEC_V2_SAFE_FIELD = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model Note {",
  "  id: id",
  "  body: string",
  "  title: string default: \"untitled\"",
  "}",
  "",
  "workflow CreateNote {",
  "  trigger api POST /notes auth: none",
  "  step validate body",
  "  step insert Note",
  "}",
  "",
].join("\n");

const SPEC_V3_SAFE_FIELD = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model Note {",
  "  id: id",
  "  body: string",
  "  title: string default: \"untitled\"",
  "  archived: boolean default: false",
  "}",
  "",
  "workflow CreateNote {",
  "  trigger api POST /notes auth: none",
  "  step validate body",
  "  step insert Note",
  "}",
  "",
].join("\n");

const SPEC_DESTRUCTIVE_FIELD = SPEC_V1.replace(
  "  body: string\n}",
  "  body: string\n  title: string\n}",
);

const SPEC_CONFIRMATION_REQUIRED = SPEC_V1.replace(
  "target ts.node.fastify.postgres.prisma cache: redis",
  "target ts.node.fastify.postgres.prisma cache: none",
);

beforeEach(() => {
  verifierMocks.runInstall.mockReset();
  verifierMocks.verify.mockReset();
  verifierMocks.writeReports.mockReset();

  verifierMocks.runInstall.mockResolvedValue({
    passed: true,
    exitCode: 0,
    durationMs: 1,
    stderr: "",
  });
  verifierMocks.verify.mockResolvedValue({
    run_id: "verifier-random",
    passed: true,
    steps: [{ name: "typecheck", passed: true, durationMs: 1 }],
  });
  verifierMocks.writeReports.mockResolvedValue(undefined);
});

describe("arch apply lifecycle", () => {
  it("does not promote snapshots or metadata when --skip-verify is used", async () => {
    const { projectRoot, metadataDir } = await createProject(SPEC_V1, "arch-apply-skip-");

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir, "--skip-verify"]),
    );

    expect(result.value).toBe(0);
    expect(existsSync(resolve(projectRoot, "src/models/Note.ts"))).toBe(true);
    expect(existsSync(resolve(metadataDir, "artifact-map.json"))).toBe(false);
    expect(existsSync(resolve(metadataDir, "ownership.json"))).toBe(false);
    expect(existsSync(resolve(metadataDir, "ir.previous.json"))).toBe(false);
    expect(result.stdout).toContain("not promoted");
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
    expect(verifierMocks.verify).not.toHaveBeenCalled();
    expect(verifierMocks.writeReports).not.toHaveBeenCalled();
  });

  it("rejects incremental apply without a latest plan and avoids full regeneration", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-no-plan-",
    );
    const previous = await writePreviousIR(metadataDir, SPEC_V1);
    const baseline = await writeBaselineMetadata(metadataDir);

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("requires .arch/plans/latest.plan.json");
    expect(existsSync(resolve(projectRoot, "src/models/Note.ts"))).toBe(false);
    await expect(readFile(resolve(metadataDir, "ir.previous.json"), "utf8")).resolves.toBe(
      JSON.stringify(previous, null, 2) + "\n",
    );
    await expect(readFile(resolve(metadataDir, "artifact-map.json"), "utf8")).resolves.toBe(
      baseline.artifactMap,
    );
    await expect(readFile(resolve(metadataDir, "ownership.json"), "utf8")).resolves.toBe(
      baseline.ownership,
    );
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });

  it("leaves baseline metadata untouched when install fails", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-install-fail-",
    );
    const previous = await writePreviousIR(metadataDir, SPEC_V1);
    const baseline = await writeBaselineMetadata(metadataDir);
    await writeLatestPlan(projectRoot, metadataDir);
    verifierMocks.runInstall.mockResolvedValue({
      passed: false,
      exitCode: 1,
      durationMs: 5,
      stderr: "install failed",
      failure_reason: "install",
    });

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(verifierMocks.verify).not.toHaveBeenCalled();
    await expect(readFile(resolve(metadataDir, "ir.previous.json"), "utf8")).resolves.toBe(
      JSON.stringify(previous, null, 2) + "\n",
    );
    await expect(readFile(resolve(metadataDir, "artifact-map.json"), "utf8")).resolves.toBe(
      baseline.artifactMap,
    );
    await expect(readFile(resolve(metadataDir, "ownership.json"), "utf8")).resolves.toBe(
      baseline.ownership,
    );
    expectReportRunIdMatchesRunDir();
  });

  it("leaves baseline metadata untouched when verification fails and normalizes run id", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-verify-fail-",
    );
    const previous = await writePreviousIR(metadataDir, SPEC_V1);
    const baseline = await writeBaselineMetadata(metadataDir);
    await writeLatestPlan(projectRoot, metadataDir);
    verifierMocks.verify.mockResolvedValue({
      run_id: "verifier-random",
      passed: false,
      steps: [{ name: "typecheck", passed: false, durationMs: 3 }],
      failure_reason: "typecheck",
    });

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    await expect(readFile(resolve(metadataDir, "ir.previous.json"), "utf8")).resolves.toBe(
      JSON.stringify(previous, null, 2) + "\n",
    );
    await expect(readFile(resolve(metadataDir, "artifact-map.json"), "utf8")).resolves.toBe(
      baseline.artifactMap,
    );
    await expect(readFile(resolve(metadataDir, "ownership.json"), "utf8")).resolves.toBe(
      baseline.ownership,
    );
    expectReportRunIdMatchesRunDir();
  });

  it("promotes metadata and ir.previous after install and verification pass", async () => {
    const { projectRoot, metadataDir } = await createProject(SPEC_V1, "arch-apply-pass-");

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(0);
    expect(existsSync(resolve(metadataDir, "artifact-map.json"))).toBe(true);
    expect(existsSync(resolve(metadataDir, "ownership.json"))).toBe(true);
    // Initial generation writes an inspectable initial migration scaffold.
    const initMigration = resolve(
      projectRoot,
      "prisma/migrations/00000000000000_init/migration.sql",
    );
    expect(existsSync(initMigration)).toBe(true);
    expect(await readFile(initMigration, "utf8")).toContain('CREATE TABLE "Note"');
    const previous = JSON.parse(
      await readFile(resolve(metadataDir, "ir.previous.json"), "utf8"),
    ) as CanonicalIR;
    const current = JSON.parse(
      await readFile(resolve(metadataDir, "ir.current.json"), "utf8"),
    ) as CanonicalIR;
    expect(previous.canonical_hash).toBe(current.canonical_hash);
    expectReportRunIdMatchesRunDir();
  });

  it("writes spec-compliant artifact-map + ownership that the drift detector round-trips", async () => {
    const { projectRoot, metadataDir } = await createProject(SPEC_V1, "arch-apply-metadata-");

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );
    expect(result.value).toBe(0);

    // artifact-map.json carries the §15.3 contract fields.
    const artifactMap = JSON.parse(
      await readFile(resolve(metadataDir, "artifact-map.json"), "utf8"),
    ) as { schema_version: string; ir_hash: string; generator_version: string; entries: unknown[] };
    expect(artifactMap.schema_version).toBe("arch.artifact-map.v1");
    expect(typeof artifactMap.generator_version).toBe("string");
    const current = JSON.parse(
      await readFile(resolve(metadataDir, "ir.current.json"), "utf8"),
    ) as CanonicalIR;
    expect(artifactMap.ir_hash).toBe(current.canonical_hash);

    // ownership.json uses spec-compliant vocabulary.
    const ownership = JSON.parse(
      await readFile(resolve(metadataDir, "ownership.json"), "utf8"),
    ) as { entries: { ownership_kind: string; write_scope: string }[] };
    expect(ownership.entries.length).toBeGreaterThan(0);
    for (const e of ownership.entries) {
      expect(["generated_file", "extension_point"]).toContain(e.ownership_kind);
      expect(["whole_file", "stub_only"]).toContain(e.write_scope);
    }

    // Round-trip: a freshly applied project has no drift...
    const clean = await detectDrift(metadataDir, projectRoot);
    expect(clean.entries).toEqual([]);

    // ...and hand-editing a generated file is detected with artifact + entity ids.
    const modelPath = resolve(projectRoot, "src/models/Note.ts");
    await writeFile(modelPath, (await readFile(modelPath, "utf8")) + "\n// hand edit\n", "utf8");
    const drifted = await detectDrift(metadataDir, projectRoot);
    const mod = drifted.entries.find((e) => e.path === "src/models/Note.ts");
    expect(mod?.kind).toBe("generated_file_modified");
    expect((mod?.entity_ids.length ?? 0)).toBeGreaterThan(0);
  });

  it("writes an incremental migration scaffold for an added field (no silent skip)", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-migration-",
    );
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );
    expect(result.value).toBe(0);

    // A migration directory was created and carries the ADD COLUMN scaffold —
    // the migration is no longer silently dropped.
    const migrationsRoot = resolve(projectRoot, "prisma/migrations");
    const dirs = await readdir(migrationsRoot);
    expect(dirs.length).toBeGreaterThan(0);
    const sqls = await Promise.all(
      dirs.map((d) => readFile(resolve(migrationsRoot, d, "migration.sql"), "utf8")),
    );
    const combined = sqls.join("\n");
    expect(combined).toContain('ALTER TABLE "Note" ADD COLUMN "title" TEXT');
  });

  it("rejects latest plans whose base hash does not match ir.previous", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-base-mismatch-",
    );
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);
    await mutateLatestPlan(
      metadataDir,
      (plan) => ({ ...plan, base_ir_hash: "wrong" }),
      { refreshPlanHash: true },
    );

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("base_ir_hash");
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });

  it("rejects latest plans whose target hash does not match current IR", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-target-mismatch-",
    );
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);
    await mutateLatestPlan(
      metadataDir,
      (plan) => ({ ...plan, target_ir_hash: "wrong" }),
      { refreshPlanHash: true },
    );

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("target_ir_hash");
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });

  it("rejects latest plans whose content no longer matches plan_hash", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_V2_SAFE_FIELD,
      "arch-apply-plan-hash-mismatch-",
    );
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);
    await mutateLatestPlan(metadataDir, (plan) => ({ ...plan, actions: [] }));

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("plan_hash");
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });

  it("supports repeated spec edit -> plan -> apply cycles, promoting metadata and staying drift-free", async () => {
    const { projectRoot, metadataDir } = await createProject(SPEC_V1, "arch-apply-cycles-");
    const backendArch = resolve(projectRoot, "backend.arch");
    const modelPath = resolve(projectRoot, "src/models/Note.ts");

    // Cycle 1 — initial full generation.
    expect(
      (await captureOutput(() => runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]))).value,
    ).toBe(0);
    await expectPromotedHash(metadataDir, parseIR(SPEC_V1, "v1.arch").canonical_hash);
    expect((await detectDrift(metadataDir, projectRoot)).entries).toEqual([]);

    // Cycle 2 — add `title` (safe additive field), re-plan, re-apply.
    await writeFile(backendArch, SPEC_V2_SAFE_FIELD, "utf8");
    await writeLatestPlan(projectRoot, metadataDir);
    expect(
      (await captureOutput(() => runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]))).value,
    ).toBe(0);
    await expectPromotedHash(metadataDir, parseIR(SPEC_V2_SAFE_FIELD, "v2.arch").canonical_hash);
    expect(await readFile(modelPath, "utf8")).toContain("title");
    expect((await detectDrift(metadataDir, projectRoot)).entries).toEqual([]);

    // Cycle 3 — add `archived`, re-plan, re-apply. Metadata must keep promoting
    // cleanly with no drift accumulating across cycles.
    await writeFile(backendArch, SPEC_V3_SAFE_FIELD, "utf8");
    await writeLatestPlan(projectRoot, metadataDir);
    expect(
      (await captureOutput(() => runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]))).value,
    ).toBe(0);
    await expectPromotedHash(metadataDir, parseIR(SPEC_V3_SAFE_FIELD, "v3.arch").canonical_hash);
    expect(await readFile(modelPath, "utf8")).toContain("archived");
    expect((await detectDrift(metadataDir, projectRoot)).entries).toEqual([]);
  });

  it("routes incremental apply through the constrained agent and promotes, writing run records", async () => {
    const { projectRoot, metadataDir } = await createProject(SPEC_V2_SAFE_FIELD, "arch-apply-agent-ok-");
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir], {
        agentProvider: new PlannedContentProvider(),
      }),
    );

    expect(result.value).toBe(0);
    expect(result.stdout).toContain("agent provider planned-content produced");
    // Metadata promoted to v2.
    await expectPromotedHash(metadataDir, parseIR(SPEC_V2_SAFE_FIELD, "v2.arch").canonical_hash);
    // The agent's content was written and carries the new field.
    expect(await readFile(resolve(projectRoot, "src/models/Note.ts"), "utf8")).toContain("title");
    // Run records are persisted and reviewable.
    const runs = await readAgentRuns(metadataDir);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]!.provider_id).toBe("planned-content");
    expect(runs[0]!.records.length).toBeGreaterThan(0);
    for (const rec of runs[0]!.records) {
      expect(rec.outcome).toBe("ok");
      expect(rec.task_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rec.output_validation.ok).toBe(true);
    }
  });

  it("aborts apply with no write or promotion when the agent proposes an out-of-allowlist patch", async () => {
    const { projectRoot, metadataDir } = await createProject(SPEC_V2_SAFE_FIELD, "arch-apply-agent-evil-");
    const previous = await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);

    const malicious: AgentProvider = {
      id: "evil",
      model_id: "evil-1",
      enabled: true,
      run: async (spec: AgentTaskSpec): Promise<AgentTaskOutput> => ({
        schema_version: "arch.agent.output.v1",
        task_id: spec.task_id,
        action_id: spec.action_id,
        artifact_id: spec.artifact_id,
        patches: [{ kind: "rewrite_whole_file", path: "node_modules/evil.ts", content: "pwned" }],
        satisfied_criteria: [],
      }),
    };

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir], { agentProvider: malicious }),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("agent task rejected");
    // No generated file was written, and nothing under node_modules.
    expect(existsSync(resolve(projectRoot, "src/models/Note.ts"))).toBe(false);
    expect(existsSync(resolve(projectRoot, "node_modules/evil.ts"))).toBe(false);
    // Baseline NOT promoted: ir.previous is still v1.
    const prev = JSON.parse(await readFile(resolve(metadataDir, "ir.previous.json"), "utf8")) as CanonicalIR;
    expect(prev.canonical_hash).toBe(previous.canonical_hash);
    // The rejection is recorded for review.
    const runs = await readAgentRuns(metadataDir);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((r) => r.records.some((rec) => rec.outcome === "validation_failed"))).toBe(true);
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });

  it("rejects destructive plans by default", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_DESTRUCTIVE_FIELD,
      "arch-apply-destructive-",
    );
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("destructive or confirmation-required");
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });

  it("rejects confirmation-required plans by default", async () => {
    const { projectRoot, metadataDir } = await createProject(
      SPEC_CONFIRMATION_REQUIRED,
      "arch-apply-confirmation-",
    );
    await writePreviousIR(metadataDir, SPEC_V1);
    await writeLatestPlan(projectRoot, metadataDir);

    const result = await captureOutput(() =>
      runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
    );

    expect(result.value).toBe(70);
    expect(result.stderr).toContain("destructive or confirmation-required");
    expect(verifierMocks.runInstall).not.toHaveBeenCalled();
  });
});

async function createProject(
  source: string,
  prefix: string,
): Promise<{ projectRoot: string; metadataDir: string }> {
  const projectRoot = await mkdtemp(resolve(tmpdir(), prefix));
  const metadataDir = resolve(projectRoot, ".arch");
  await mkdir(metadataDir, { recursive: true });
  await writeFile(resolve(projectRoot, "backend.arch"), source, "utf8");
  return { projectRoot, metadataDir };
}

interface AgentRunsFile {
  readonly provider_id: string;
  readonly records: { outcome: string; task_hash: string; output_validation: { ok: boolean } }[];
}

async function readAgentRuns(metadataDir: string): Promise<AgentRunsFile[]> {
  const dir = resolve(metadataDir, "agent-runs");
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const out: AgentRunsFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    out.push(JSON.parse(await readFile(resolve(dir, name), "utf8")) as AgentRunsFile);
  }
  return out;
}

async function expectPromotedHash(metadataDir: string, expectedHash: string): Promise<void> {
  const prev = JSON.parse(
    await readFile(resolve(metadataDir, "ir.previous.json"), "utf8"),
  ) as CanonicalIR;
  expect(prev.canonical_hash).toBe(expectedHash);
}

async function writePreviousIR(metadataDir: string, source: string): Promise<CanonicalIR> {
  const ir = parseIR(source, "previous.arch");
  await mkdir(metadataDir, { recursive: true });
  await writeFile(
    resolve(metadataDir, "ir.previous.json"),
    JSON.stringify(ir, null, 2) + "\n",
    "utf8",
  );
  return ir;
}

async function writeBaselineMetadata(
  metadataDir: string,
): Promise<{ artifactMap: string; ownership: string }> {
  const artifactMap = JSON.stringify({ entries: [], marker: "artifact-baseline" }, null, 2) + "\n";
  const ownership = JSON.stringify({ entries: [], marker: "ownership-baseline" }, null, 2) + "\n";
  await writeFile(resolve(metadataDir, "artifact-map.json"), artifactMap, "utf8");
  await writeFile(resolve(metadataDir, "ownership.json"), ownership, "utf8");
  return { artifactMap, ownership };
}

async function writeLatestPlan(projectRoot: string, metadataDir: string): Promise<void> {
  const result = await captureOutput(() =>
    runPlan(["--cwd", projectRoot, "--metadata-dir", metadataDir]),
  );
  expect(result.value).toBe(0);
}

async function mutateLatestPlan(
  metadataDir: string,
  mutate: (plan: Record<string, unknown>) => Record<string, unknown>,
  options: { readonly refreshPlanHash?: boolean } = {},
): Promise<void> {
  const planPath = resolve(metadataDir, "plans/latest.plan.json");
  const plan = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>;
  let next = mutate(plan);
  if (options.refreshPlanHash) {
    const planHash = computePlanHash(next);
    next = {
      ...next,
      plan_hash: planHash,
      plan_id: `plan.${planHash.slice(0, 16)}`,
    };
  }
  await writeFile(planPath, JSON.stringify(next, null, 2) + "\n", "utf8");
}

function parseIR(source: string, file: string): CanonicalIR {
  const parsed = parseArchSource(source, file);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join("\n"));
  return parsed.ir;
}

async function captureOutput<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    });
  try {
    return { value: await fn(), stdout, stderr };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

function expectReportRunIdMatchesRunDir(): void {
  expect(verifierMocks.writeReports).toHaveBeenCalledTimes(1);
  const [runDir, report] = verifierMocks.writeReports.mock.calls[0]!;
  expect(report.run_id).toBe(basename(runDir));
  expect(report.run_id).not.toBe("verifier-random");
}

function computePlanHash(plan: Record<string, unknown>): string {
  const planBody = {
    schema_version: plan.schema_version,
    base_ir_hash: plan.base_ir_hash,
    target_ir_hash: plan.target_ir_hash,
    diff: plan.diff,
    diff_index: plan.diff_index,
    action_groups: plan.action_groups,
    actions: plan.actions,
    path_policy: plan.path_policy,
    verification: plan.verification,
    confirmations_required: plan.confirmations_required,
    destructive: plan.destructive,
  };
  return createHash("sha256").update(canonicalStringify(planBody)).digest("hex");
}
