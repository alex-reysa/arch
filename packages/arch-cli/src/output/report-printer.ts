export interface VerificationReport {
  readonly runId: string;
  readonly passed: boolean;
  readonly steps: readonly { name: string; passed: boolean; durationMs: number }[];
  readonly failureReason?: string;
}

export function printReport(report: VerificationReport): void {
  const status = report.passed ? "PASS" : "FAIL";
  process.stdout.write(`run ${report.runId} ${status}\n`);
  for (const s of report.steps) {
    const flag = s.passed ? "ok" : "fail";
    process.stdout.write(`  ${flag} ${s.name} (${s.durationMs}ms)\n`);
  }
  if (!report.passed && report.failureReason) {
    process.stdout.write(`reason: ${report.failureReason}\n`);
  }
}
