import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadExternalManifest, readDatasetContent } from "../src/external/load.js";
import { diffDatasetLock, type DatasetLock } from "../src/external/dataset-lock.js";
import { projectExternalToBenchManifest } from "../src/external/project.js";

const MANIFEST = fileURLToPath(new URL("../../../benchmarks/external/manifest.json", import.meta.url));

describe("committed external demo dataset", () => {
  it("loads, validates, and is clearly marked synthetic/demo", async () => {
    const loaded = await loadExternalManifest(MANIFEST);
    expect(loaded.manifest.fixture).toBe(true);
    expect(loaded.manifest.services.length).toBeGreaterThan(0);
    expect(loaded.manifest.evolutions.length).toBeGreaterThan(0);
    expect(loaded.manifest.services.every((s) => s.fixture)).toBe(true);
    expect(loaded.manifest.evolutions.every((e) => e.fixture)).toBe(true);
  });

  it("is RUNNABLE: every service has a baseSpec and every evolution has from/to specs that exist", async () => {
    const loaded = await loadExternalManifest(MANIFEST);
    for (const s of loaded.manifest.services) {
      expect(s.baseSpec, `${s.id} baseSpec`).toBeTruthy();
      expect(existsSync(resolve(loaded.dir, s.baseSpec!))).toBe(true);
    }
    for (const e of loaded.manifest.evolutions) {
      expect(e.fromSpec, `${e.id} fromSpec`).toBeTruthy();
      expect(e.toSpec, `${e.id} toSpec`).toBeTruthy();
      expect(existsSync(resolve(loaded.dir, e.fromSpec!))).toBe(true);
      expect(existsSync(resolve(loaded.dir, e.toSpec!))).toBe(true);
    }
  });

  it("projects onto the bench runner shape without error (so it can really run)", async () => {
    const loaded = await loadExternalManifest(MANIFEST);
    const projected = projectExternalToBenchManifest(loaded.manifest);
    expect(projected.subjects.length).toBe(loaded.manifest.services.length);
    expect(projected.tasks.length).toBe(loaded.manifest.evolutions.length);
    // The rename evolution documents a real capability gap (drop+add rename).
    const rename = loaded.manifest.evolutions.find((e) => e.unsupportedReason?.code === "field_rename");
    expect(rename, "a field_rename capability-gap evolution is present").toBeDefined();
  });

  it("matches its committed dataset lock (no undisclosed drift)", async () => {
    const lockPath = resolve(dirname(MANIFEST), "dataset.lock.json");
    if (!existsSync(lockPath)) return; // generated via `external lock --write`
    const loaded = await loadExternalManifest(MANIFEST);
    const content = await readDatasetContent(loaded);
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as DatasetLock;
    const diff = diffDatasetLock(lock, content);
    expect(diff.unversionedChange).toBe(false);
    expect(diff.changed).toBe(false);
  });
});
