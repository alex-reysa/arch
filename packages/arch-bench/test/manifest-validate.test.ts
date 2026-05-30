import { describe, it, expect } from "vitest";
import { validateManifest } from "../src/manifest/validate.js";
import { isLiveBaseline, type BenchManifest, type BenchTask } from "../src/manifest/schema.js";

function task(over: Partial<BenchTask> = {}): BenchTask {
  return {
    id: "social-feed-01",
    subject: "social-feed",
    order: 1,
    kind: "additive_field",
    fromSpec: "subjects/social-feed/v00/backend.arch",
    toSpec: "subjects/social-feed/tasks/01/backend.arch",
    intent: "add a field",
    expectedDiffTypes: ["model_field_added"],
    expectedAffectedPaths: ["src/models/Post.ts"],
    expectedOutcome: "apply_passes",
    oracleTests: [],
    driftScripts: [],
    ...over,
  };
}

function manifest(over: Partial<BenchManifest> = {}): BenchManifest {
  return {
    schema_version: "arch.bench.manifest.v1",
    baselines: ["arch-typed-sync", "full-regeneration"],
    subjects: [{ id: "social-feed", title: "Social Feed", baseSpec: "subjects/social-feed/v00/backend.arch" }],
    tasks: [task()],
    ...over,
  };
}

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateManifest(manifest());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a wrong schema_version", () => {
    const result = validateManifest({ ...manifest(), schema_version: "nope" as never });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/schema_version/);
  });

  it("rejects an unknown baseline", () => {
    const result = validateManifest({ ...manifest(), baselines: ["arch-typed-sync", "totally-fake" as never] });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/baseline/i);
    expect(result.errors.join("\n")).toMatch(/totally-fake/);
  });

  it("accepts the multi-model live baselines and marks them live", () => {
    const baselines = [
      "arch-typed-sync",
      "full-regeneration",
      "claude-direct-edit",
      "claude-broad-constrained",
      "grok-direct-edit",
      "grok-broad-constrained",
      "composer-direct-edit",
      "composer-broad-constrained",
    ] as const;
    const result = validateManifest({ ...manifest(), baselines });
    expect(result.ok).toBe(true);
    expect(isLiveBaseline("claude-direct-edit")).toBe(true);
    expect(isLiveBaseline("grok-direct-edit")).toBe(true);
    expect(isLiveBaseline("composer-broad-constrained")).toBe(true);
    expect(isLiveBaseline("full-regeneration")).toBe(false);
  });

  it("rejects duplicate task ids", () => {
    const t = task();
    const result = validateManifest(manifest({ tasks: [t, { ...task({ order: 2 }), id: t.id }] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/duplicate task id/i);
  });

  it("rejects a missing fromSpec or toSpec", () => {
    const result = validateManifest(manifest({ tasks: [task({ fromSpec: "" })] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/fromSpec/);
  });

  it("rejects a task referencing an unknown subject", () => {
    const result = validateManifest(manifest({ tasks: [task({ subject: "ghost-subject" })] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/ghost-subject/);
  });

  it("rejects an unknown task kind", () => {
    const result = validateManifest(manifest({ tasks: [task({ kind: "frobnicate" as never })] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/kind/);
  });

  it("rejects non-contiguous task ordering within a subject", () => {
    const tasks = [task({ id: "social-feed-01", order: 1 }), task({ id: "social-feed-03", order: 3 })];
    const result = validateManifest(manifest({ tasks }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/order/i);
  });

  it("rejects duplicate orders within a subject", () => {
    const tasks = [task({ id: "social-feed-01", order: 1 }), task({ id: "social-feed-02", order: 1 })];
    const result = validateManifest(manifest({ tasks }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/order/i);
  });

  it("accepts a contiguous multi-task subject ordering", () => {
    const tasks = [
      task({ id: "social-feed-01", order: 1 }),
      task({ id: "social-feed-02", order: 2 }),
      task({ id: "social-feed-03", order: 3 }),
    ];
    const result = validateManifest(manifest({ tasks }));
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown expectedOutcome", () => {
    const result = validateManifest(manifest({ tasks: [task({ expectedOutcome: "explode" as never })] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/expectedOutcome/);
  });
});
