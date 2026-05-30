import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWriteJson } from "./atomic-write.js";

export interface ArtifactMap {
  readonly entries: readonly { artifact_id: string; path: string; entity_ids: string[] }[];
}

export interface OwnershipFile {
  readonly entries: readonly {
    artifact_id: string;
    ownership_kind: "generated_file" | "generated_region" | "extension_point" | "human_file";
    write_scope: "whole_file" | "generated_region" | "stub_only" | "none";
    content_hash: string;
  }[];
}

export interface DriftFile {
  readonly entries: readonly { artifact_id: string; reason: string }[];
}

export function metadataPaths(metadataDir: string): {
  artifactMap: string;
  ownership: string;
  drift: string;
  sourceMap: string;
  plansDir: string;
  runsDir: string;
} {
  return {
    artifactMap: resolve(metadataDir, "artifact-map.json"),
    ownership: resolve(metadataDir, "ownership.json"),
    drift: resolve(metadataDir, "drift.json"),
    sourceMap: resolve(metadataDir, "source-map.json"),
    plansDir: resolve(metadataDir, "plans"),
    runsDir: resolve(metadataDir, "runs"),
  };
}

export async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWriteJson(path, value);
}
