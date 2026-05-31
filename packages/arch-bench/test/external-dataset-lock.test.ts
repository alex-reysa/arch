import { describe, expect, it } from "vitest";
import {
  buildDatasetLock,
  computeDatasetHash,
  diffDatasetLock,
  type DatasetContent,
} from "../src/external/dataset-lock.js";

function content(over: Partial<DatasetContent> = {}): DatasetContent {
  return {
    datasetVersion: "v1",
    files: {
      "manifest.json": '{"a":1}',
      "services/x/base.arch": "model X { id: id }",
    },
    ...over,
  };
}

describe("computeDatasetHash", () => {
  it("is deterministic and order-independent in the files map", () => {
    const a = computeDatasetHash(content());
    const b = computeDatasetHash({
      datasetVersion: "v1",
      files: { "services/x/base.arch": "model X { id: id }", "manifest.json": '{"a":1}' },
    });
    expect(a.hash).toBe(b.hash);
    expect(a.fileHashes).toEqual(b.fileHashes);
  });

  it("changes the overall hash when any file content changes", () => {
    const a = computeDatasetHash(content());
    const b = computeDatasetHash(content({ files: { "manifest.json": '{"a":2}', "services/x/base.arch": "model X { id: id }" } }));
    expect(a.hash).not.toBe(b.hash);
  });

  it("changes the overall hash when only the dataset version changes", () => {
    const a = computeDatasetHash(content({ datasetVersion: "v1" }));
    const b = computeDatasetHash(content({ datasetVersion: "v2" }));
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("diffDatasetLock", () => {
  it("reports a clean match against its own lock", () => {
    const lock = buildDatasetLock(content(), "2026-05-31T00:00:00.000Z");
    const diff = diffDatasetLock(lock, content());
    expect(diff.changed).toBe(false);
    expect(diff.unversionedChange).toBe(false);
    expect(diff.modifiedFiles).toEqual([]);
  });

  it("flags an unversioned content change (policy violation)", () => {
    const lock = buildDatasetLock(content(), "2026-05-31T00:00:00.000Z");
    const edited = content({ files: { "manifest.json": '{"a":2}', "services/x/base.arch": "model X { id: id }" } });
    const diff = diffDatasetLock(lock, edited);
    expect(diff.changed).toBe(true);
    expect(diff.versionChanged).toBe(false);
    expect(diff.unversionedChange).toBe(true);
    expect(diff.modifiedFiles).toEqual(["manifest.json"]);
  });

  it("treats a content change WITH a version bump as a disclosed new version", () => {
    const lock = buildDatasetLock(content({ datasetVersion: "v1" }), "2026-05-31T00:00:00.000Z");
    const edited = content({
      datasetVersion: "v2",
      files: { "manifest.json": '{"a":2}', "services/x/base.arch": "model X { id: id }" },
    });
    const diff = diffDatasetLock(lock, edited);
    expect(diff.changed).toBe(true);
    expect(diff.versionChanged).toBe(true);
    expect(diff.unversionedChange).toBe(false);
  });

  it("detects added and removed files", () => {
    const lock = buildDatasetLock(content(), "2026-05-31T00:00:00.000Z");
    const edited: DatasetContent = {
      datasetVersion: "v2",
      files: { "manifest.json": '{"a":1}', "services/x/new.arch": "model Y { id: id }" },
    };
    const diff = diffDatasetLock(lock, edited);
    expect(diff.addedFiles).toEqual(["services/x/new.arch"]);
    expect(diff.removedFiles).toEqual(["services/x/base.arch"]);
  });
});
