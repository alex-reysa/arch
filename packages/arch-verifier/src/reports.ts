import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VerificationRunResult } from "./result.js";

export function reportPathFor(metadataDir: string, runId: string): string {
  return `${metadataDir}/runs/${runId}/report.json`;
}

export function summarize(result: VerificationRunResult): string {
  const status = result.passed ? "PASS" : "FAIL";
  const lines = [`Run ${result.run_id} — ${status}`];
  for (const s of result.steps) {
    lines.push(`  ${s.passed ? "ok" : "fail"} ${s.name} (${s.durationMs}ms)`);
  }
  if (!result.passed && result.failure_reason) lines.push(`reason: ${result.failure_reason}`);
  return lines.join("\n");
}

/**
 * Write JSON + Markdown reports for a verification run into `runDir`. The
 * JSON report is the structured record used by the orchestrator and by
 * `arch repair`; the Markdown report is for human consumption.
 */
export async function writeReports(runDir: string, result: VerificationRunResult): Promise<void> {
  await mkdir(runDir, { recursive: true });
  const json = {
    schema: "arch.verification-report.v1",
    run_id: result.run_id,
    passed: result.passed,
    failure_reason: result.failure_reason ?? null,
    steps: result.steps.map((s) => ({
      name: s.name,
      passed: s.passed,
      duration_ms: s.durationMs,
      stdout_tail: tail(s.stdout, 4096),
      stderr_tail: tail(s.stderr, 4096),
    })),
  };
  const jsonText = JSON.stringify(json, null, 2) + "\n";
  const markdown = renderMarkdown(result);
  await writeFile(resolve(runDir, "report.json"), jsonText, "utf8");
  await writeFile(resolve(runDir, "verification-report.json"), jsonText, "utf8");
  await writeFile(resolve(runDir, "report.md"), markdown, "utf8");
  await writeFile(resolve(runDir, "verification-report.md"), markdown, "utf8");
}

function renderMarkdown(result: VerificationRunResult): string {
  const lines = [
    `# Verification run ${result.run_id}`,
    "",
    `Status: **${result.passed ? "PASS" : "FAIL"}**`,
    "",
  ];
  if (!result.passed && result.failure_reason) {
    lines.push(`Failure reason: \`${result.failure_reason}\``, "");
  }
  lines.push("## Steps", "");
  for (const s of result.steps) {
    lines.push(`### ${s.passed ? "✅" : "❌"} ${s.name} (${s.durationMs}ms)`, "");
    if (s.stderr && s.stderr.trim().length) {
      lines.push("```text", tail(s.stderr, 4096), "```", "");
    } else if (s.stdout && s.stdout.trim().length) {
      lines.push("```text", tail(s.stdout, 4096), "```", "");
    }
  }
  return lines.join("\n");
}

function tail(text: string | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `…\n${text.slice(-max)}`;
}
