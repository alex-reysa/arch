import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ProjectRoot {
  readonly root: string;
  readonly archFile: string;
  readonly metadataDir: string;
}

export function findProjectRoot(start: string = process.cwd()): ProjectRoot {
  const resolvedStart = resolve(start);
  let cur = resolvedStart;
  while (true) {
    const archFile = resolve(cur, "backend.arch");
    if (existsSync(archFile)) {
      return {
        root: cur,
        archFile,
        metadataDir: resolve(cur, ".arch"),
      };
    }
    const parent = dirname(cur);
    if (parent === cur) {
      throw new Error(
        `backend.arch not found in ${resolvedStart} or any ancestor directory; ` +
          `run from inside an Arch project or pass --cwd <project-dir>`,
      );
    }
    cur = parent;
  }
}
