/**
 * Golden tests for the V1 diff engine — `SYNC_ENGINE_SPEC.md` §7.7.
 *
 * The headline scenario (acceptance criterion d2d3e4f5...): diffing the
 * SocialFeed V1 vs V2 IR pair MUST emit exactly:
 *
 *   1. `model_field_added` for `field:Post.visibility`
 *   2. `model_index_added` for `model_index:Post.visibility`
 *
 * with deterministic risk/severity, deterministic ordering,
 * and a stable diff_id so plan IDs reproduce. Formatting-only changes
 * must produce no diffs.
 */

import { describe, expect, it } from "vitest";
import { diffIRV1 } from "../src/diff/diff-engine.js";
import { severityOfDiffV1, classifyDiffV1 } from "../src/diff/classification.js";
import { socialFeedV1, socialFeedV2, socialFeedV1ReorderedFields } from "./fixtures.js";

describe("diff engine — V1 ↔ V2 visibility", () => {
  it("emits exactly one model_field_added(Post.visibility) + one model_index_added", () => {
    const { envelope, diagnostics } = diffIRV1(socialFeedV1(), socialFeedV2());

    expect(diagnostics).toEqual([]);
    expect(envelope.schema_version).toBe("arch.diff.v1");
    expect(envelope.initial_generation).toBe(false);

    const types = envelope.diffs.map((d) => d.type);
    expect(types).toEqual(["model_field_added", "model_index_added"]);

    const [fieldDiff, indexDiff] = envelope.diffs;

    expect(fieldDiff!.type).toBe("model_field_added");
    if (fieldDiff!.type === "model_field_added") {
      expect(fieldDiff!.model_id).toBe("model:Post");
      expect(fieldDiff!.field_id).toBe("field:Post.visibility");
    }

    expect(indexDiff!.type).toBe("model_index_added");
    if (indexDiff!.type === "model_index_added") {
      expect(indexDiff!.model_id).toBe("model:Post");
      expect(indexDiff!.index_id).toBe("model_index:Post.visibility");
    }
  });

  it("classifies the visibility add as additive + medium severity", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV2());
    for (const d of envelope.diffs) {
      expect(classifyDiffV1(d)).toBe("additive");
      expect(severityOfDiffV1(d)).toBe("medium");
    }
  });

  it("orders diffs deterministically across runs", () => {
    const a = diffIRV1(socialFeedV1(), socialFeedV2()).envelope.diffs.map((d) => d.diff_id);
    const b = diffIRV1(socialFeedV1(), socialFeedV2()).envelope.diffs.map((d) => d.diff_id);
    expect(a).toEqual(b);
    // Order is sorted by `(type, primary_entity_id)` — `model_field_added`
    // sorts before `model_index_added`.
    expect(a).toEqual([
      "diff.model_field_added.model_Post.field_Post_visibility",
      "diff.model_index_added.model_Post.model_index_Post_visibility",
    ]);
  });

  it("does not collide diff_ids for multiple fields under the same model", () => {
    const base = socialFeedV1();
    const post = base.models.find((m) => m.id === "model:Post")!;
    const current = {
      ...base,
      canonical_hash: "v2-two-fields",
      models: base.models.map((m) =>
        m.id === "model:Post"
          ? {
              ...m,
              fields: [
                ...post.fields,
                {
                  id: "field:Post.visibility",
                  kind: "field" as const,
                  name: "visibility",
                  model_id: "model:Post",
                  type: { kind: "primitive" as const, name: "string" as const },
                  nullable: true,
                  indexed: false,
                },
                {
                  id: "field:Post.slug",
                  kind: "field" as const,
                  name: "slug",
                  model_id: "model:Post",
                  type: { kind: "primitive" as const, name: "string" as const },
                  nullable: true,
                  indexed: false,
                },
              ],
            }
          : m,
      ),
    };
    const { envelope } = diffIRV1(base, current);
    const fieldDiffIds = envelope.diffs
      .filter((d) => d.type === "model_field_added")
      .map((d) => d.diff_id);
    expect(fieldDiffIds).toEqual([
      "diff.model_field_added.model_Post.field_Post_slug",
      "diff.model_field_added.model_Post.field_Post_visibility",
    ]);
    expect(new Set(fieldDiffIds).size).toBe(fieldDiffIds.length);
  });

  it("produces no diffs for non-semantic reordering of model arrays", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV1ReorderedFields());
    expect(envelope.diffs).toEqual([]);
  });

  it("sets requires_confirmation=false and an empty confirmation_kinds list", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV2());
    for (const d of envelope.diffs) {
      expect(d.requires_confirmation).toBe(false);
      expect(d.confirmation_kinds).toEqual([]);
    }
  });

  it("preserves IR hashes on the envelope", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV2());
    expect(envelope.previous_ir_hash).toBe("v1-test-hash");
    expect(envelope.current_ir_hash).toBe("v2-test-hash");
  });
});

describe("diff engine — initial generation", () => {
  it("emits a single `initial_generation` diff when previous is null", () => {
    const { envelope } = diffIRV1(null, socialFeedV1());
    expect(envelope.initial_generation).toBe(true);
    expect(envelope.diffs.length).toBe(1);
    expect(envelope.diffs[0]!.type).toBe("initial_generation");
    expect(envelope.previous_ir_hash).toBeNull();
  });
});

describe("diff engine — unsupported diagnostics", () => {
  it("blocks target system changes with a structured diagnostic", () => {
    const v1 = socialFeedV1();
    const altered = {
      ...v1,
      target: { ...v1.target, stack: "py.django.postgres" },
    };
    const { diagnostics, envelope } = diffIRV1(v1, altered);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]!.code).toBe("unsupported_target_system_change");
    // The target_changed diff is NOT emitted when system changes — it's blocked.
    expect(envelope.diffs.find((d) => d.type === "target_changed")).toBeUndefined();
  });

  it("blocks workflow trigger surface changes", () => {
    const v1 = socialFeedV1();
    const wf = v1.workflows[0]!;
    const altered = {
      ...v1,
      workflows: [
        {
          ...wf,
          trigger: { ...wf.trigger, path: "/v2/posts" },
        },
      ],
    };
    const { diagnostics } = diffIRV1(v1, altered);
    expect(diagnostics.find((d) => d.code === "unsupported_trigger_change")).toBeDefined();
  });
});

describe("diff engine — additional supported variants", () => {
  it("emits custom_extension_changed when a custom's properties change", () => {
    const base = socialFeedV1();
    const withCustom = {
      ...base,
      customs: [
        {
          id: "custom:foo",
          kind: "custom" as const,
          name: "foo",
          customKind: "transform",
          properties: { mode: "fast" },
        },
      ],
    };
    const updated = {
      ...withCustom,
      customs: [
        {
          ...withCustom.customs[0]!,
          properties: { mode: "slow" },
        },
      ],
    };
    const { envelope } = diffIRV1(withCustom, updated);
    expect(envelope.diffs.map((d) => d.type)).toEqual([
      "custom_extension_changed",
    ]);
  });

  it("emits workflow_step_reordered without workflow_step_changed when order alone changes", () => {
    const v1 = socialFeedV1();
    const wf = v1.workflows[0]!;
    const reordered = {
      ...v1,
      workflows: [
        {
          ...wf,
          steps: [...wf.steps].reverse().map((s, i) => ({ ...s, order: i })),
        },
      ],
    };
    const { envelope } = diffIRV1(v1, reordered);
    const types = envelope.diffs.map((d) => d.type);
    expect(types).toEqual(["workflow_step_reordered"]);
  });

  it("emits guarantee_added on a new guarantee", () => {
    const v1 = socialFeedV1();
    const wf = v1.workflows[0]!;
    const updated = {
      ...v1,
      workflows: [
        {
          ...wf,
          guarantees: [
            ...wf.guarantees,
            {
              id: "guarantee:CreatePost.no_cross_user_writes",
              kind: "guarantee" as const,
              name: "no_cross_user_writes",
              workflow_id: wf.id,
              form: "short" as const,
              arguments: {},
            },
          ],
        },
      ],
    };
    const { envelope } = diffIRV1(v1, updated);
    expect(envelope.diffs.map((d) => d.type)).toEqual(["guarantee_added"]);
  });

  it("classifies optional field additions as low severity", () => {
    const base = socialFeedV1();
    const post = base.models.find((m) => m.id === "model:Post")!;
    const current = {
      ...base,
      canonical_hash: "v2-optional-field",
      models: base.models.map((m) =>
        m.id === "model:Post"
          ? {
              ...m,
              fields: [
                ...post.fields,
                {
                  id: "field:Post.summary",
                  kind: "field" as const,
                  name: "summary",
                  model_id: "model:Post",
                  type: { kind: "primitive" as const, name: "string" as const },
                  nullable: true,
                  indexed: false,
                },
              ],
            }
          : m,
      ),
    };
    const { envelope } = diffIRV1(base, current);
    expect(envelope.diffs).toHaveLength(1);
    expect(envelope.diffs[0]!.type).toBe("model_field_added");
    expect(envelope.diffs[0]!.risk).toBe("additive");
    expect(severityOfDiffV1(envelope.diffs[0]!)).toBe("low");
  });

  it("classifies required field additions without defaults as destructive/high", () => {
    const base = socialFeedV1();
    const post = base.models.find((m) => m.id === "model:Post")!;
    const current = {
      ...base,
      canonical_hash: "v2-required-field",
      models: base.models.map((m) =>
        m.id === "model:Post"
          ? {
              ...m,
              fields: [
                ...post.fields,
                {
                  id: "field:Post.slug",
                  kind: "field" as const,
                  name: "slug",
                  model_id: "model:Post",
                  type: { kind: "primitive" as const, name: "string" as const },
                  nullable: false,
                  indexed: false,
                },
              ],
            }
          : m,
      ),
    };
    const { envelope } = diffIRV1(base, current);
    expect(envelope.diffs).toHaveLength(1);
    expect(envelope.diffs[0]!.type).toBe("model_field_added");
    expect(envelope.diffs[0]!.risk).toBe("destructive");
    expect(envelope.diffs[0]!.requires_confirmation).toBe(true);
    expect(severityOfDiffV1(envelope.diffs[0]!)).toBe("high");
  });

  it("classifies guarantee weakening as destructive/high", () => {
    const base = socialFeedV1();
    const wf = base.workflows[0]!;
    const current = {
      ...base,
      canonical_hash: "v2-weaker-guarantee",
      workflows: [
        {
          ...wf,
          guarantees: [
            {
              ...wf.guarantees[0]!,
              arguments: { limit_ms: 1000 },
            },
          ],
        },
      ],
    };
    const { envelope } = diffIRV1(base, current);
    expect(envelope.diffs).toHaveLength(1);
    expect(envelope.diffs[0]!.type).toBe("guarantee_changed");
    expect(envelope.diffs[0]!.risk).toBe("destructive");
    expect(envelope.diffs[0]!.confirmation_kinds).toContain("guarantee_weakening");
    expect(severityOfDiffV1(envelope.diffs[0]!)).toBe("high");
  });
});
