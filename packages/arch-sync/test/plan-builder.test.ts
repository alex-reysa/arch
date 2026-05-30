/**
 * Plan builder tests — `SYNC_ENGINE_SPEC.md` §13.
 *
 * Acceptance criterion: `arch plan` (and therefore `buildPlanV1`) MUST
 *  - produce a deterministic, content-addressed `plan_id` and `plan_hash`;
 *  - produce a `path_policy.allowed` list containing the generator-canonical
 *    files for the SocialFeed V2 visibility scenario;
 *  - emit verification obligations including typecheck, tests, migrations,
 *    prisma_validate (because schema diffs are present) and drift_check.
 */

import { describe, expect, it } from "vitest";
import { diffIRV1 } from "../src/diff/diff-engine.js";
import { buildPlanV1 } from "../src/planner/plan-builder.js";
import { socialFeedV1, socialFeedV2 } from "./fixtures.js";

function buildPlan() {
  const previous = socialFeedV1();
  const current = socialFeedV2();
  const { envelope } = diffIRV1(previous, current);
  return buildPlanV1({ previous, current, diff: envelope });
}

describe("plan builder — V2 visibility plan", () => {
  it("produces a content-addressed, deterministic plan_id/plan_hash", () => {
    const a = buildPlan();
    const b = buildPlan();
    expect(a.plan_id).toBe(b.plan_id);
    expect(a.plan_hash).toBe(b.plan_hash);
    expect(a.plan_id.startsWith("plan.")).toBe(true);
    // 16-hex-char id slice
    expect(a.plan_id.length).toBe("plan.".length + 16);
    // plan_hash is a full SHA-256 hex digest.
    expect(a.plan_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("path_policy.allowed contains every spec-required file", () => {
    const plan = buildPlan();
    const allowed = plan.path_policy.allowed;
    expect(allowed).toContain("prisma/schema.prisma");
    expect(allowed.filter((p) => /^prisma\/migrations\/.*\/migration\.sql$/.test(p))).toHaveLength(2);
    expect(allowed).toContain("src/runtime/db.ts");
    expect(allowed).toContain("src/models/Post.ts");
    expect(allowed).toContain("src/validators/Post.ts");
    expect(allowed).toContain("src/routes/CreatePost.ts");
    expect(allowed).toContain("src/workflows/CreatePost.ts");
    expect(allowed).toContain("tests/models/Post.test.ts");
    expect(allowed).toContain("tests/workflows/CreatePost.test.ts");
    expect(allowed).toContain("tests/guarantees/post_creation_p95_latency.CreatePost.test.ts");
    expect(allowed).toContain(".arch/artifact-map.json");
    expect(allowed).toContain(".arch/ownership.json");
  });

  it("path_policy.allowed is sorted and dedupe-d", () => {
    const plan = buildPlan();
    const allowed = plan.path_policy.allowed;
    const sorted = [...allowed].sort();
    expect(allowed).toEqual(sorted);
    expect(new Set(allowed).size).toBe(allowed.length);
  });

  it("path_policy.forbidden blocks dependency and VCS directories", () => {
    const plan = buildPlan();
    expect(plan.path_policy.forbidden).toContain("node_modules/**");
    expect(plan.path_policy.forbidden).toContain("**/node_modules/**");
    expect(plan.path_policy.forbidden).toContain(".git/**");
    expect(plan.path_policy.forbidden).toContain("**/.git/**");
  });

  it("emits verification obligations for typecheck, tests, migrations, prisma_validate, drift_check", () => {
    const plan = buildPlan();
    const kinds = plan.verification.map((v) => v.kind);
    expect(kinds).toContain("typecheck");
    expect(kinds).toContain("tests");
    expect(kinds).toContain("migrations");
    expect(kinds).toContain("prisma_validate");
    expect(kinds).toContain("drift_check");
  });

  it("groups actions deterministically (schema, migration, model, validator, route, workflow, tests, runtime, metadata)", () => {
    const plan = buildPlan();
    const groupKinds = plan.action_groups.map((g) => g.kind);
    // The order in plan-builder is fixed; subset check accommodates only-emitted groups.
    const idx = (k: string) => groupKinds.indexOf(k);
    expect(idx("schema")).toBeGreaterThanOrEqual(0);
    expect(idx("migration")).toBeGreaterThan(idx("schema"));
    expect(idx("model")).toBeGreaterThan(idx("migration"));
    expect(idx("validator")).toBeGreaterThan(idx("model"));
    expect(idx("route")).toBeGreaterThan(idx("validator"));
    expect(idx("workflow")).toBeGreaterThan(idx("route"));
    expect(idx("model_test")).toBeGreaterThan(idx("workflow"));
    expect(idx("workflow_test")).toBeGreaterThan(idx("model_test"));
    expect(idx("guarantee_test")).toBeGreaterThan(idx("workflow_test"));
    expect(idx("runtime")).toBeGreaterThan(idx("guarantee_test"));
    expect(idx("metadata")).toBeGreaterThan(idx("runtime"));
  });

  it("marks the plan non-destructive for an additive-only diff", () => {
    const plan = buildPlan();
    expect(plan.destructive).toBe(false);
    expect(plan.confirmations_required).toEqual([]);
  });

  it("preserves IR hashes from the diff envelope", () => {
    const plan = buildPlan();
    expect(plan.base_ir_hash).toBe("v1-test-hash");
    expect(plan.target_ir_hash).toBe("v2-test-hash");
  });
});
