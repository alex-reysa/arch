import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface ProjectRoot {
  readonly root: string;
  readonly archFile: string;
  readonly metadataDir: string;
}

export function findProjectRoot(start: string = process.cwd()): ProjectRoot {
  let cur = resolve(start);
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
      throw new Error("backend.arch not found in any ancestor directory");
    }
    cur = parent;
  }
}
