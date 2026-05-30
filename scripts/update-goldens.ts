#!/usr/bin/env tsx
/**
 * Regenerate the committed golden snapshots (AST / IR / diff / generated-output
 * `toMatchSnapshot` fixtures) by running the workspace test suites in vitest's
 * snapshot-update mode.
 *
 * Run `pnpm update-goldens` whenever a determinism-affecting change lands
 * (templates, canonicalize, hash, diff, planner). The updated `.snap` files are
 * committed so CI's plain `pnpm test` fails if generated output drifts
 * unexpectedly.
 *
 * Non-snapshot assertions still run during the update pass; if one fails the
 * update does not mask it — fix the code, not the golden.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

function run(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: "inherit" });
    child.on("close", (code) => resolveRun(code ?? 1));
    child.on("error", () => resolveRun(1));
  });
}

async function main(): Promise<number> {
  process.stdout.write("update-goldens: regenerating vitest snapshots across packages…\n");
  // `vitest run -u` updates snapshots in place; run it in every workspace
  // package that has tests.
  const code = await run("pnpm", [
    "-r",
    "--filter",
    "./packages/*",
    "exec",
    "vitest",
    "run",
    "-u",
  ]);
  if (code === 0) {
    process.stdout.write("update-goldens: done — review and commit any changed *.snap files\n");
  } else {
    process.stderr.write("update-goldens: a test failed during the update pass (not a snapshot issue)\n");
  }
  return code;
}

main().then((code) => process.exit(code));
