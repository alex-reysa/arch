import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { describe, expect, it, vi } from "vitest";
import { runPlan } from "../src/commands/plan.js";
import { parseArchSource } from "../src/commands/parse.js";

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

// A workflow trigger surface change compiles on both sides but the diff
// engine flags it as unsupported in V1 → planning is blocked.
const SPEC_UNSUPPORTED_TARGET_CHANGE = SPEC_V1.replace(
  "  trigger api POST /notes auth: none",
  "  trigger api PUT /notes auth: none",
);

function parseIR(source: string, file: string): CanonicalIR {
  const parsed = parseArchSource(source, file);
  if (!parsed.ok) throw new Error(parsed.diagnostics.map((d) => d.message).join("\n"));
  return parsed.ir;
}

async function runPlanQuiet(argv: string[]): Promise<number> {
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  try {
    return await runPlan(argv);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

describe("arch plan", () => {
  it("does not write plan files when diffIRV1 reports blocking diagnostics", async () => {
    const projectRoot = await mkdtemp(resolve(tmpdir(), "arch-cli-plan-"));
    const metadataDir = resolve(projectRoot, ".arch");
    await mkdir(metadataDir, { recursive: true });
    await writeFile(resolve(projectRoot, "backend.arch"), SPEC_UNSUPPORTED_TARGET_CHANGE, "utf8");
    await writeFile(
      resolve(metadataDir, "ir.previous.json"),
      JSON.stringify(parseIR(SPEC_V1, "previous.arch"), null, 2) + "\n",
      "utf8",
    );

    const code = await runPlanQuiet(["--cwd", projectRoot, "--metadata-dir", metadataDir]);

    expect(code).toBe(1);
    expect(existsSync(resolve(metadataDir, "ir.current.json"))).toBe(true);
    expect(existsSync(resolve(metadataDir, "plans"))).toBe(false);
    expect(existsSync(resolve(metadataDir, "plans/latest.plan.json"))).toBe(false);
  });

  it("does not overwrite an existing latest plan when diagnostics block planning", async () => {
    const projectRoot = await mkdtemp(resolve(tmpdir(), "arch-cli-plan-stale-"));
    const metadataDir = resolve(projectRoot, ".arch");
    const plansDir = resolve(metadataDir, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(resolve(projectRoot, "backend.arch"), SPEC_UNSUPPORTED_TARGET_CHANGE, "utf8");
    await writeFile(resolve(plansDir, "latest.plan.json"), "stale-plan\n", "utf8");
    await writeFile(
      resolve(metadataDir, "ir.previous.json"),
      JSON.stringify(parseIR(SPEC_V1, "previous.arch"), null, 2) + "\n",
      "utf8",
    );

    const code = await runPlanQuiet(["--cwd", projectRoot, "--metadata-dir", metadataDir]);

    expect(code).toBe(1);
    await expect(readFile(resolve(plansDir, "latest.plan.json"), "utf8")).resolves.toBe(
      "stale-plan\n",
    );
  });
});
