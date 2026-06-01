/**
 * Unit tests for `runCommand`'s fail-closed contract: a missing binary, a
 * non-zero exit, and a hung child all resolve as a failed step rather than
 * rejecting or hanging. Real (but trivial) `node` child processes are used so
 * the spawn/exit/timeout plumbing is exercised end to end.
 */

import { describe, expect, it } from "vitest";
import { runCommand } from "../command-runner.js";
import type { VerificationCommand } from "../commands.js";

const NODE = process.execPath;
const cmd = (over: Partial<VerificationCommand>): VerificationCommand => ({
  name: "t",
  bin: NODE,
  args: [],
  ...over,
});

describe("runCommand", () => {
  it("passes on a zero exit and captures stdout", async () => {
    const r = await runCommand(cmd({ args: ["-e", "process.stdout.write('hello')"] }), process.cwd());
    expect(r.passed).toBe(true);
    expect(r.stdout).toContain("hello");
    expect(typeof r.durationMs).toBe("number");
  });

  it("fails (does not throw) on a non-zero exit", async () => {
    const r = await runCommand(cmd({ args: ["-e", "process.exit(3)"] }), process.cwd());
    expect(r.passed).toBe(false);
  });

  it("fails closed on a spawn error (missing binary) instead of rejecting", async () => {
    const r = await runCommand(cmd({ bin: "arch-definitely-not-a-real-binary-zzz", args: [] }), process.cwd());
    expect(r.passed).toBe(false);
    expect((r.stderr ?? "").length).toBeGreaterThan(0);
  });

  it("kills and fails a child that exceeds its timeout", async () => {
    const start = Date.now();
    const r = await runCommand(
      cmd({ args: ["-e", "setTimeout(() => {}, 60000)"], timeoutMs: 300 }),
      process.cwd(),
    );
    expect(r.passed).toBe(false);
    expect(r.stderr ?? "").toContain("timed out after 300ms");
    // Resolved promptly (well under the child's 60s sleep), proving the timer fired.
    expect(Date.now() - start).toBeLessThan(10000);
  });
});
