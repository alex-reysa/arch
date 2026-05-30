import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadManifest, buildTaskIndex } from "../src/manifest/load.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MANIFEST = resolve(REPO_ROOT, "benchmarks", "manifest.json");

describe("the committed benchmark manifest", () => {
  it("exists, validates structurally, and all referenced files exist on disk", async () => {
    expect(existsSync(MANIFEST)).toBe(true);
    // loadManifest throws if structurally invalid OR any referenced file is missing.
    const loaded = await loadManifest(MANIFEST);
    expect(loaded.manifest.subjects.length).toBeGreaterThan(0);
    expect(loaded.manifest.tasks.length).toBeGreaterThan(0);
  });

  it("maps every task to a known subject in the task index", async () => {
    const loaded = await loadManifest(MANIFEST);
    const index = buildTaskIndex(loaded.manifest);
    const subjectIds = new Set(loaded.manifest.subjects.map((s) => s.id));
    for (const task of loaded.manifest.tasks) {
      expect(index[task.id]?.subject).toBe(task.subject);
      expect(subjectIds.has(task.subject)).toBe(true);
    }
  });
});
