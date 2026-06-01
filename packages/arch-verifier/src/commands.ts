export interface VerificationCommand {
  readonly name: string;
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /**
   * Per-command wall-clock budget in milliseconds. When exceeded the child is
   * SIGKILLed and the step resolves as failed (never hangs `verify()`).
   * Defaults to {@link DEFAULT_COMMAND_TIMEOUT_MS}.
   */
  readonly timeoutMs?: number;
}

export const TYPECHECK: VerificationCommand = {
  name: "typecheck",
  bin: "pnpm",
  args: ["exec", "tsc", "-p", "tsconfig.json", "--noEmit"],
};

export const TESTS: VerificationCommand = {
  name: "tests",
  bin: "pnpm",
  args: ["exec", "vitest", "run"],
};

export const PRISMA_VALIDATE: VerificationCommand = {
  name: "prisma-validate",
  bin: "pnpm",
  args: ["exec", "prisma", "validate"],
};
