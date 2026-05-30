import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { atomicWriteJson } from "./atomic-write.js";

export interface SnapshotPaths {
  readonly previous: string;
  readonly current: string;
}

export function snapshotPaths(metadataDir: string): SnapshotPaths {
  return {
    previous: resolve(metadataDir, "ir.previous.json"),
    current: resolve(metadataDir, "ir.current.json"),
  };
}

export async function readPrevious(metadataDir: string): Promise<CanonicalIR | null> {
  const { previous } = snapshotPaths(metadataDir);
  try {
    const text = await readFile(previous, "utf8");
    return JSON.parse(text) as CanonicalIR;
  } catch {
    return null;
  }
}

export async function writeCurrent(metadataDir: string, ir: CanonicalIR): Promise<void> {
  const { current } = snapshotPaths(metadataDir);
  await atomicWriteJson(current, ir);
}

/**
 * Promote `ir.current.json` to `ir.previous.json`. Only call after a
 * successful verification run.
 */
export async function promoteCurrent(metadataDir: string): Promise<void> {
  const { current, previous } = snapshotPaths(metadataDir);
  const text = await readFile(current, "utf8");
  await atomicWriteJson(previous, JSON.parse(text));
}
