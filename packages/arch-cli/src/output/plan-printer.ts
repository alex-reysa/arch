export interface PlanSummary {
  readonly planId: string;
  readonly planHash: string;
  readonly intentChanges: readonly string[];
  readonly affectedArtifacts: readonly string[];
  readonly verificationObligations: readonly string[];
}

export function printPlan(summary: PlanSummary): void {
  process.stdout.write(`plan ${summary.planId} (${summary.planHash})\n`);
  process.stdout.write(`intent changes (${summary.intentChanges.length}):\n`);
  for (const c of summary.intentChanges) process.stdout.write(`  - ${c}\n`);
  process.stdout.write(`affected artifacts (${summary.affectedArtifacts.length}):\n`);
  for (const a of summary.affectedArtifacts) process.stdout.write(`  - ${a}\n`);
  process.stdout.write(`verification (${summary.verificationObligations.length}):\n`);
  for (const v of summary.verificationObligations) process.stdout.write(`  - ${v}\n`);
}
