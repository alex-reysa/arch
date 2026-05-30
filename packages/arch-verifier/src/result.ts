/**
 * Documented failure-reason literals for `VerificationRunResult.failure_reason`.
 *
 * The shape uses TypeScript's `(string & {})` widening idiom so that the
 * literal set is auto-completed in editors without breaking existing call
 * sites that pass arbitrary step names. Keep this list in sync with the
 * verifier's known failure modes.
 *
 * - `"install"`: emitted by `runInstall` when `pnpm install` exits non-zero.
 * - `"typecheck"`: typecheck step failed.
 * - `"tests"`: test step failed.
 * - `"prisma-validate"`: Prisma schema validation failed.
 * - `"drift"`: drift detector reported entries.
 * - `"unknown"`: a step failed but no name could be attributed.
 */
export type VerificationFailureReason =
  | "install"
  | "typecheck"
  | "tests"
  | "prisma-validate"
  | "drift"
  | "unknown"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export interface VerificationStepResult {
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface VerificationRunResult {
  readonly run_id: string;
  readonly passed: boolean;
  readonly steps: readonly VerificationStepResult[];
  readonly failure_reason?: VerificationFailureReason;
}
