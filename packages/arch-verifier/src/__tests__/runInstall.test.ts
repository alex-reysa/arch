/**
 * Unit tests for `runInstall` (ac-5c8a-002).
 *
 * Three branches are covered:
 *   (a) lockfile present  -> spawns `pnpm install`
 *   (b) lockfile absent   -> spawns `pnpm install --frozen-lockfile=false`
 *   (c) non-zero exit     -> result.passed=false, failure_reason="install"
 *
 * The spawn binary is stubbed via the `spawn` injection seam on
 * `runInstall`, and stderr/stdout sinks are stubbed so the test does not
 * write to the real `process.stderr`.
 */

import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInstall, type SpawnFn } from "../runInstall.js";

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

interface FakeChildPlan {
  readonly exitCode: number;
  readonly stdoutChunks?: readonly string[];
  readonly stderrChunks?: readonly string[];
}

function makeFakeChild(plan: FakeChildPlan): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Defer emission so callers have time to attach listeners.
  setImmediate(() => {
    for (const chunk of plan.stdoutChunks ?? []) {
      child.stdout.emit("data", Buffer.from(chunk));
    }
    for (const chunk of plan.stderrChunks ?? []) {
      child.stderr.emit("data", Buffer.from(chunk));
    }
    child.emit("exit", plan.exitCode);
  });
  return child;
}

interface CapturingSink {
  readonly chunks: string[];
  write(chunk: string | Uint8Array): boolean;
}

function makeSink(): CapturingSink {
  const chunks: string[] = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
  };
}

describe("runInstall", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "arch-runinstall-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("spawns `pnpm install` when pnpm-lock.yaml is present", async () => {
    writeFileSync(resolve(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    const sink = makeSink();
    const spawn = vi.fn<Parameters<SpawnFn>, ReturnType<SpawnFn>>(() =>
      makeFakeChild({ exitCode: 0, stdoutChunks: ["installed\n"] }) as unknown as ReturnType<SpawnFn>,
    );

    const result = await runInstall({
      projectRoot: tmp,
      stderrSink: sink,
      spawn: spawn as unknown as SpawnFn,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawn.mock.calls[0]!;
    expect(bin).toBe("pnpm");
    expect(args).toEqual(["install"]);
    expect(opts).toMatchObject({ cwd: tmp });
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    if (result.passed) {
      // Compile-time discriminator check: the ok branch has no failure_reason.
      // (Accessing it would be a type error.)
      expect((result as { failure_reason?: string }).failure_reason).toBeUndefined();
    }
    expect(typeof result.durationMs).toBe("number");
    // stdout was streamed to the sink.
    expect(sink.chunks.join("")).toContain("installed");
  });

  it("falls back to `pnpm install --frozen-lockfile=false` when no lockfile is present", async () => {
    // No pnpm-lock.yaml in `tmp`.
    const sink = makeSink();
    const spawn = vi.fn<Parameters<SpawnFn>, ReturnType<SpawnFn>>(() =>
      makeFakeChild({ exitCode: 0 }) as unknown as ReturnType<SpawnFn>,
    );

    const result = await runInstall({
      projectRoot: tmp,
      stderrSink: sink,
      spawn: spawn as unknown as SpawnFn,
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawn.mock.calls[0]!;
    expect(bin).toBe("pnpm");
    expect(args).toEqual(["install", "--frozen-lockfile=false"]);
    expect(opts).toMatchObject({ cwd: tmp });
    expect(result.passed).toBe(true);
  });

  it("surfaces failure_reason=\"install\" and the child's stderr on non-zero exit", async () => {
    writeFileSync(resolve(tmp, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
    const sink = makeSink();
    const stderrPayload = "ERR_PNPM_OUTDATED_LOCKFILE missing dep\n";
    const spawn = vi.fn<Parameters<SpawnFn>, ReturnType<SpawnFn>>(() =>
      makeFakeChild({ exitCode: 1, stderrChunks: [stderrPayload] }) as unknown as ReturnType<SpawnFn>,
    );

    const result = await runInstall({
      projectRoot: tmp,
      stderrSink: sink,
      spawn: spawn as unknown as SpawnFn,
    });

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    if (!result.passed) {
      expect(result.failure_reason).toBe("install");
      expect(result.stderr).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
    }
    // stderr was also forwarded to the sink (the parent's stderr).
    expect(sink.chunks.join("")).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
  });
});
