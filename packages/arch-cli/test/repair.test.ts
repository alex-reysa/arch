/**
 * `arch repair` — bounded, allowlisted, verification-gated repair (M14).
 *
 * Each test builds a real generated baseline with `arch apply` (verifier
 * mocked to pass), then perturbs the project and runs `arch repair`. The
 * drift detector runs for real; only install/verify/writeReports are mocked.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
import { runRepair } from "../src/commands/repair.js";

const SPEC = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model Post {",
  "  id: id",
  "  body: string",
  "}",
  "",
  "integration PushNotifier {",
  "  kind: webhook",
  "  failure: best_effort",
  "}",
  "",
  "workflow CreatePost {",
  "  trigger api POST /posts auth: none",
  "  step validate body",
  "  step insert Post",
  "  step call PushNotifier.send",
  "  guarantee notification_failure_does_not_rollback_post",
  "}",
  "",
].join("\n");

function passInstall() {
  verifierMocks.runInstall.mockResolvedValue({ passed: true, exitCode: 0, durationMs: 1, stderr: "" });
}
function passVerify() {
  verifierMocks.verify.mockResolvedValue({
    run_id: "v",
    passed: true,
    steps: [{ name: "typecheck", passed: true, durationMs: 1 }],
  });
}
function failVerify() {
  verifierMocks.verify.mockResolvedValue({
    run_id: "v",
    passed: false,
    steps: [{ name: "typecheck", passed: false, durationMs: 1 }],
    failure_reason: "typecheck",
  });
}

beforeEach(() => {
  verifierMocks.runInstall.mockReset();
  verifierMocks.verify.mockReset();
  verifierMocks.writeReports.mockReset();
  passInstall();
  passVerify();
  verifierMocks.writeReports.mockResolvedValue(undefined);
});

async function applied(prefix: string): Promise<{ projectRoot: string; metadataDir: string }> {
  const projectRoot = await mkdtemp(resolve(tmpdir(), prefix));
  const metadataDir = resolve(projectRoot, ".arch");
  await mkdir(metadataDir, { recursive: true });
  await writeFile(resolve(projectRoot, "backend.arch"), SPEC, "utf8");
  const code = await capture(() => runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir]));
  expect(code).toBe(0);
  return { projectRoot, metadataDir };
}

describe("arch repair (M14 bounded loop)", () => {
  it("prints help and exits 0 with --help", async () => {
    const out = await captureOut(() => runRepair(["--help"]));
    expect(out.value).toBe(0);
    expect(out.stdout).toMatch(/Usage: arch repair/);
  });

  it("regenerates a deleted generated test and exits 0 when verification passes", async () => {
    const { projectRoot, metadataDir } = await applied("arch-repair-missing-");
    const dir = resolve(projectRoot, "tests/guarantees");
    const before = await readdir(dir);
    const testFile = before.find((f) => f.endsWith(".test.ts"))!;
    const full = resolve(dir, testFile);
    const { rm } = await import("node:fs/promises");
    await rm(full);
    expect(existsSync(full)).toBe(false);

    const code = await capture(() => runRepair(["--cwd", projectRoot, "--metadata-dir", metadataDir]));
    expect(code).toBe(0);
    expect(existsSync(full)).toBe(true); // regenerated
  });

  it("restores a hand-edited generated file to its generated content", async () => {
    const { projectRoot, metadataDir } = await applied("arch-repair-edited-");
    const modelPath = resolve(projectRoot, "src/models/Post.ts");
    const original = await readFile(modelPath, "utf8");
    await writeFile(modelPath, original + "\n// HUMAN EDIT that broke things\n", "utf8");

    const code = await capture(() => runRepair(["--cwd", projectRoot, "--metadata-dir", metadataDir]));
    expect(code).toBe(0);
    expect(await readFile(modelPath, "utf8")).toBe(original); // restored byte-for-byte
  });

  it("never touches human-owned src/custom files", async () => {
    const { projectRoot, metadataDir } = await applied("arch-repair-custom-");
    // Perturb both a generated file (repairable) and a human extension point.
    const modelPath = resolve(projectRoot, "src/models/Post.ts");
    await writeFile(modelPath, (await readFile(modelPath, "utf8")) + "\n// edit\n", "utf8");
    const customReadme = resolve(projectRoot, "src/custom/README.md");
    const humanContent = "# My own notes — do not regenerate\n";
    await writeFile(customReadme, humanContent, "utf8");

    const code = await capture(() => runRepair(["--cwd", projectRoot, "--metadata-dir", metadataDir]));
    expect(code).toBe(0);
    // The human file is left exactly as the human wrote it.
    expect(await readFile(customReadme, "utf8")).toBe(humanContent);
  });

  it("stops after max attempts and exits non-zero when verification keeps failing", async () => {
    const { projectRoot, metadataDir } = await applied("arch-repair-maxattempts-");
    const modelPath = resolve(projectRoot, "src/models/Post.ts");
    await writeFile(modelPath, (await readFile(modelPath, "utf8")) + "\n// edit\n", "utf8");
    verifierMocks.verify.mockClear(); // ignore the baseline apply's verify call
    failVerify();

    const code = await capture(() => runRepair(["--cwd", projectRoot, "--metadata-dir", metadataDir]));
    expect(code).toBe(70);
    // verify attempted exactly max-attempts (3) times.
    expect(verifierMocks.verify).toHaveBeenCalledTimes(3);
    // an unresolved repair-history record was preserved.
    const hist = await readdir(resolve(metadataDir, "repair-history"));
    expect(hist.length).toBeGreaterThan(0);
  });

  it("reports nothing to repair when the project is clean", async () => {
    const { projectRoot, metadataDir } = await applied("arch-repair-clean-");
    verifierMocks.verify.mockClear(); // ignore the baseline apply's verify call
    const out = await captureOut(() => runRepair(["--cwd", projectRoot, "--metadata-dir", metadataDir]));
    expect(out.value).toBe(0);
    expect(out.stdout).toMatch(/no repairable/);
    expect(verifierMocks.verify).not.toHaveBeenCalled();
  });
});

async function capture<T>(fn: () => Promise<T>): Promise<T> {
  const o = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const e = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    return await fn();
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

async function captureOut<T>(fn: () => Promise<T>): Promise<{ value: T; stdout: string }> {
  let stdout = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
    stdout += String(c);
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    return { value: await fn(), stdout };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}
