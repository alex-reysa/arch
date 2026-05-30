/**
 * Isolated temp workspace for one (subject, baseline, repeat) chain. Mirrors
 * the pnpm shim from `scripts/run-examples-e2e.ts` so the generated project's
 * `pnpm install` / `pnpm typecheck` / `pnpm test` resolve, and provides
 * directory snapshotting for churn metrics.
 */

import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type FileSnapshot, defaultIgnore } from "../metrics/churn.js";

export interface Workspace {
  readonly dir: string;
  readonly env: NodeJS.ProcessEnv;
}

export async function createWorkspace(prefix: string): Promise<Workspace> {
  const dir = await mkdtemp(resolve(tmpdir(), `arch-bench-${prefix}-`));
  const env = await createPnpmShim(dir);
  return { dir, env };
}

export async function destroyWorkspace(ws: Workspace): Promise<void> {
  await rm(ws.dir, { recursive: true, force: true }).catch(() => {});
}

/** Copy a `.arch` spec into the workspace as `backend.arch`. */
export async function writeBackendSpec(ws: Workspace, source: string): Promise<void> {
  await writeFile(resolve(ws.dir, "backend.arch"), source, "utf8");
}

/**
 * Walk the workspace into a flat path→content snapshot. Ignored directories
 * (node_modules, .git, run scratch) are never descended into, so this stays
 * fast even after `pnpm install`. Files larger than `maxBytes` are recorded
 * with a sentinel so a giant artifact never blows up memory.
 */
export async function readSnapshot(
  dir: string,
  ignore: (path: string) => boolean = defaultIgnore,
  maxBytes = 512 * 1024,
): Promise<FileSnapshot> {
  const files = new Map<string, string>();
  async function walk(absDir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      // Never descend into ignored directories.
      if (e.isDirectory()) {
        if (ignore(`${relPath}/`)) continue;
        await walk(join(absDir, e.name), relPath);
      } else if (e.isFile()) {
        if (ignore(relPath)) continue;
        const abs = join(absDir, e.name);
        try {
          const s = await stat(abs);
          if (s.size > maxBytes) {
            files.set(relPath, `[bench:omitted ${s.size} bytes]`);
          } else {
            files.set(relPath, await readFile(abs, "utf8"));
          }
        } catch {
          /* unreadable file: skip */
        }
      }
    }
  }
  await walk(dir, "");
  return { files };
}

/**
 * Build a `pnpm` shim on PATH that forwards to this repo's pnpm, so generated
 * projects can install + run scripts without a globally installed pnpm.
 * Returns the env (PATH override) to pass to every command run in the
 * workspace.
 */
async function createPnpmShim(projectDir: string): Promise<NodeJS.ProcessEnv> {
  const binDir = resolve(projectDir, ".arch-bench-bin");
  const shimPath = resolve(binDir, "pnpm");
  const pnpmCli = process.env["npm_execpath"];
  const command =
    pnpmCli && existsSync(pnpmCli) ? `${shellQuote(process.execPath)} ${shellQuote(pnpmCli)}` : "corepack pnpm@9.0.0";
  await mkdir(binDir, { recursive: true });
  await writeFile(shimPath, `#!/usr/bin/env sh\nexec ${command} "$@"\n`, "utf8");
  await chmod(shimPath, 0o755);
  return {
    PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
