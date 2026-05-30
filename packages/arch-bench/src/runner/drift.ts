/**
 * Drift-injection support. A drift script is a tsx module that takes the
 * project directory as its single argument and corrupts a known artifact
 * (deletes a generated test, hand-edits a generated file, breaks a guarantee's
 * static pattern). After injection we measure whether `arch check` reports the
 * expected drift kind, then whether `arch repair` restores the project.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runCommand } from "./command.js";
import type { ArchCli } from "./arch-cli.js";
import type { Workspace } from "./workspace.js";
import type { DriftRecall } from "../report/results.js";

export async function applyDriftScripts(
  repoRoot: string,
  ws: Workspace,
  scriptPaths: readonly string[],
): Promise<{ code: number; logs: string }> {
  let logs = "";
  let code = 0;
  for (const script of scriptPaths) {
    const r = await runCommand("pnpm", ["exec", "tsx", script, ws.dir], {
      cwd: repoRoot,
      env: ws.env,
      timeoutMs: 60_000,
    });
    logs += `\n=== drift ${script} (exit ${r.code}) ===\n${r.stdout}\n${r.stderr}\n`;
    if (r.code !== 0) code = r.code;
  }
  return { code, logs };
}

async function readDriftKinds(dir: string): Promise<string[]> {
  const driftPath = resolve(dir, ".arch", "drift.json");
  if (!existsSync(driftPath)) return [];
  try {
    const report = JSON.parse(await readFile(driftPath, "utf8")) as { entries?: { kind?: string }[] };
    return (report.entries ?? []).map((e) => e.kind ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

export interface ArchDriftMeasurement {
  readonly recall: DriftRecall;
  readonly detectedKinds: readonly string[];
  readonly repairSucceeded: boolean;
  readonly logs: string;
}

/**
 * For the `arch-typed-sync` baseline on a drift task: run `arch check` (detect),
 * `arch repair` (fix), and `arch check` again (confirm clean).
 */
export async function measureAndRepairArchDrift(
  archCli: ArchCli,
  ws: Workspace,
  expectedKinds: readonly string[],
): Promise<ArchDriftMeasurement> {
  const dir = ws.dir;
  let logs = "";

  const check = await archCli(["check", "--cwd", dir]);
  logs += `\n=== check (exit ${check.code}) ===\n${check.stdout}\n${check.stderr}\n`;
  const detectedKinds = await readDriftKinds(dir);
  const detected =
    check.code === 1 &&
    (expectedKinds.length === 0 ? detectedKinds.length > 0 : detectedKinds.some((k) => expectedKinds.includes(k)));
  const recall: DriftRecall = detected ? "detected" : "missed";

  const repair = await archCli(["repair", "--cwd", dir]);
  logs += `\n=== repair (exit ${repair.code}) ===\n${repair.stdout}\n${repair.stderr}\n`;

  const recheck = await archCli(["check", "--cwd", dir]);
  logs += `\n=== recheck (exit ${recheck.code}) ===\n${recheck.stdout}\n${recheck.stderr}\n`;
  const repairSucceeded = repair.code === 0 && recheck.code === 0;

  return { recall, detectedKinds, repairSucceeded, logs };
}
