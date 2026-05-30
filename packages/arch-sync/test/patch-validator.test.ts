/**
 * Patch validator tests — the validator stops the patcher from touching
 * disallowed files.
 *
 * Acceptance criterion (AC3): `arch apply` MUST refuse to write outside the
 * plan's allowlist. The validator is the gate that enforces that — these
 * tests cover the gate itself; an integration test in CLI exercises the
 * call site.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyPlan } from "../src/patcher/patch-applier.js";
import {
  isSafeRelativePath,
  matchGlob,
  validatePlan,
  validatePlanAction,
} from "../src/patcher/patch-validator.js";
import type {
  SyncPlanActionV1,
  SyncPlanV1,
} from "../src/planner/plan-schema.js";

function action(over: Partial<SyncPlanActionV1>): SyncPlanActionV1 {
  return {
    action_id: "action.test",
    kind: "rewrite_whole_file",
    artifact_id: "artifact:test",
    path: "src/generated/models/post.ts",
    entity_ids: ["model:Post"],
    diff_ids: [],
    generation: {
      mode: "full_file",
      generator_id: "arch.generator.v1",
      template_id: "ts.model",
      ir_fragment_hash: "0".repeat(64),
    },
    ownership: {
      ownership_id: "own.test",
      ownership_kind: "generated_file",
      write_scope: "whole_file",
      owner: "arch",
    },
    destructive: false,
    requires_confirmation: false,
    ...over,
  };
}

function plan(
  actions: SyncPlanActionV1[],
  allowed: string[],
  forbidden: string[] = ["node_modules/**", "**/node_modules/**", ".git/**", "**/.git/**"],
): SyncPlanV1 {
  return {
    schema_version: "arch.plan.v1",
    plan_id: "plan.test",
    plan_hash: "0".repeat(64),
    base_ir_hash: null,
    target_ir_hash: "h",
    created_at: "1970-01-01T00:00:00.000Z",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    diff: { schema_version: "arch.diff.v1", diffs: [], previous_ir_hash: null, current_ir_hash: "h", initial_generation: false } as any,
    diff_index: [],
    action_groups: [],
    actions,
    path_policy: { allowed, forbidden },
    verification: [],
    confirmations_required: [],
    destructive: false,
  };
}

describe("isSafeRelativePath", () => {
  it("accepts nested project-relative POSIX paths", () => {
    expect(isSafeRelativePath("src/generated/models/post.ts")).toBe(true);
    expect(isSafeRelativePath("prisma/schema.prisma")).toBe(true);
    expect(isSafeRelativePath(".arch/artifact-map.json")).toBe(true);
  });
  it("rejects absolute paths", () => {
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("/tmp/x")).toBe(false);
  });
  it("rejects parent-escape segments", () => {
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("src/../../etc/passwd")).toBe(false);
  });
  it("rejects writes inside .git", () => {
    expect(isSafeRelativePath(".git")).toBe(false);
    expect(isSafeRelativePath(".git/config")).toBe(false);
    expect(isSafeRelativePath(".git/hooks/pre-commit")).toBe(false);
    expect(isSafeRelativePath("src/.git/config")).toBe(false);
  });
  it("rejects node_modules segments and backslashes", () => {
    expect(isSafeRelativePath("node_modules/pkg/index.js")).toBe(false);
    expect(isSafeRelativePath("src/node_modules/pkg/index.js")).toBe(false);
    expect(isSafeRelativePath("src\\models\\Post.ts")).toBe(false);
  });
  it("rejects empty paths and Windows drive letters", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("C:/oops")).toBe(false);
  });
});

describe("matchGlob", () => {
  it("matches plain paths exactly", () => {
    expect(matchGlob("a/b/c.ts", "a/b/c.ts")).toBe(true);
    expect(matchGlob("a/b/c.ts", "a/b/c.tsx")).toBe(false);
  });
  it("supports `*` within a single segment", () => {
    expect(matchGlob("src/foo.ts", "src/*.ts")).toBe(true);
    expect(matchGlob("src/sub/foo.ts", "src/*.ts")).toBe(false);
  });
  it("supports `**` across segments", () => {
    expect(matchGlob("src/custom/x/y.ts", "src/custom/**")).toBe(true);
    expect(matchGlob("src/integrations/a.ts", "src/integrations/**")).toBe(true);
    expect(matchGlob("src/generated/models/post.ts", "src/custom/**")).toBe(false);
  });
});

describe("validatePlanAction", () => {
  it("accepts an arch-owned generated path that matches the allowlist", () => {
    const a = action({});
    const p = plan([a], ["src/generated/models/post.ts"]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a write outside the allowlist", () => {
    const a = action({ path: "src/random/foo.ts" });
    const p = plan([a], ["src/generated/**"]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("not in allowlist"))).toBe(true);
  });

  it("rejects a write that matches a forbidden glob, even if allowlisted", () => {
    const a = action({ path: "src/custom/handlers/foo.ts" });
    const p = plan([a], ["src/custom/handlers/foo.ts"], ["src/custom/**"]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("forbidden"))).toBe(true);
  });

  it("rejects a non-stub write to a human-owned file", () => {
    const a = action({
      ownership: {
        ownership_id: "own.h",
        ownership_kind: "extension_point",
        write_scope: "stub_only",
        owner: "human",
      },
      kind: "rewrite_whole_file",
    });
    const p = plan([a], [a.path]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("human-owned"))).toBe(true);
  });

  it("permits a write_extension_stub even when owner=human", () => {
    const a = action({
      kind: "write_extension_stub",
      path: "src/integrations/email-stub.ts",
      ownership: {
        ownership_id: "own.h",
        ownership_kind: "extension_point",
        write_scope: "stub_only",
        owner: "human",
      },
    });
    // Allowlist must contain it AND forbidden must not block; for this test
    // we drop the default forbidden globs.
    const p = plan([a], [a.path], []);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(true);
  });

  it("flags a `patch_generated_region` action that is missing region_marker_id", () => {
    const a = action({ kind: "patch_generated_region" });
    const p = plan([a], [a.path]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("region_marker_id"))).toBe(true);
  });

  it("rejects write actions with write_scope=none", () => {
    const a = action({
      ownership: {
        ownership_id: "own.none",
        ownership_kind: "human_file",
        write_scope: "none",
        owner: "human",
      },
    });
    const p = plan([a], [a.path]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("write_scope=none"))).toBe(true);
  });

  it("rejects wrong action/write_scope combinations", () => {
    const a = action({
      kind: "rewrite_whole_file",
      ownership: {
        ownership_id: "own.region",
        ownership_kind: "generated_region",
        write_scope: "generated_region",
        owner: "arch",
      },
    });
    const p = plan([a], [a.path]);
    const r = validatePlanAction(a, p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("incompatible with write_scope"))).toBe(true);
  });
});

describe("validatePlan", () => {
  it("aggregates errors across actions and reports ok=false if any fail", () => {
    const ok = action({ path: "src/generated/models/post.ts" });
    const bad = action({
      action_id: "action.bad",
      path: "src/custom/x.ts",
    });
    const p = plan([ok, bad], [ok.path, bad.path], ["src/custom/**"]);
    const r = validatePlan(p);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("returns ok=true for an all-clean plan", () => {
    const a = action({});
    const p = plan([a], [a.path]);
    const r = validatePlan(p);
    expect(r.ok).toBe(true);
  });
});

describe("applyPlan", () => {
  it("validates the whole plan before writing any file", async () => {
    const root = await mkdtemp(join(tmpdir(), "arch-sync-"));
    try {
      const ok = action({ path: "src/generated/models/post.ts" });
      const bad = action({
        action_id: "action.bad",
        path: "src/custom/x.ts",
      });
      const p = plan([ok, bad], [ok.path, bad.path], ["src/custom/**"]);
      const result = await applyPlan({
        projectRoot: root,
        plan: p,
        contentProvider: {
          contentFor: () => "written",
        },
      });

      expect(result.applied).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(existsSync(join(root, ok.path))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes files when the full plan validates", async () => {
    const root = await mkdtemp(join(tmpdir(), "arch-sync-"));
    try {
      const a = action({ path: "src/generated/models/post.ts" });
      const p = plan([a], [a.path]);
      const result = await applyPlan({
        projectRoot: root,
        plan: p,
        contentProvider: {
          contentFor: () => "written",
        },
      });

      expect(result.errors).toEqual([]);
      expect(result.applied).toEqual([a.path]);
      await expect(readFile(join(root, a.path), "utf8")).resolves.toBe("written");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
