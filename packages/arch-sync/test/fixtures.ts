/**
 * Hand-built `CanonicalIR` fixtures used by the diff/plan/patcher tests.
 *
 * These are the SocialFeed V1 (no `visibility` field) and V2-visibility
 * (adds `Post.visibility` indexed string with default `"public"`) IRs.
 * They are intentionally typed against the upstream `CanonicalIR` shape
 * so any drift in the IR schema fails fast at the test boundary.
 */

import type { CanonicalIR } from "@arch/ir";

export function socialFeedV1(): CanonicalIR {
  return {
    schema_version: "arch.ir.v1",
    canonical_hash: "v1-test-hash",
    target: { stack: "ts.node.fastify.postgres.prisma", cache: "redis" },
    models: [
      {
        id: "model:Post",
        kind: "model",
        name: "Post",
        fields: [
          {
            id: "field:Post.id",
            kind: "field",
            name: "id",
            model_id: "model:Post",
            type: { kind: "id" },
            nullable: false,
            indexed: false,
          },
          {
            id: "field:Post.authorId",
            kind: "field",
            name: "authorId",
            model_id: "model:Post",
            type: { kind: "model_ref", target_model_id: "model:User" },
            nullable: false,
            indexed: false,
          },
          {
            id: "field:Post.body",
            kind: "field",
            name: "body",
            model_id: "model:Post",
            type: { kind: "primitive", name: "string" },
            nullable: false,
            indexed: false,
          },
          {
            id: "field:Post.createdAt",
            kind: "field",
            name: "createdAt",
            model_id: "model:Post",
            type: { kind: "primitive", name: "timestamp" },
            nullable: false,
            indexed: true,
            default: "now",
          },
        ],
        indexes: [
          {
            id: "model_index:Post.createdAt",
            kind: "model_index",
            name: "Post.createdAt",
            model_id: "model:Post",
            fields: ["createdAt"],
            source: "field_modifier",
            unique: true,
          },
        ],
      },
      {
        id: "model:User",
        kind: "model",
        name: "User",
        fields: [
          {
            id: "field:User.id",
            kind: "field",
            name: "id",
            model_id: "model:User",
            type: { kind: "id" },
            nullable: false,
            indexed: false,
          },
          {
            id: "field:User.email",
            kind: "field",
            name: "email",
            model_id: "model:User",
            type: { kind: "primitive", name: "string" },
            nullable: false,
            indexed: true,
          },
          {
            id: "field:User.createdAt",
            kind: "field",
            name: "createdAt",
            model_id: "model:User",
            type: { kind: "primitive", name: "timestamp" },
            nullable: false,
            indexed: false,
            default: "now",
          },
        ],
        indexes: [
          {
            id: "model_index:User.email",
            kind: "model_index",
            name: "User.email",
            model_id: "model:User",
            fields: ["email"],
            source: "field_modifier",
            unique: true,
          },
        ],
      },
    ],
    integrations: [],
    policies: [],
    workflows: [
      {
        id: "workflow:CreatePost",
        kind: "workflow",
        name: "CreatePost",
        trigger: {
          kind: "api",
          method: "POST",
          path: "/posts",
          auth: "none",
        },
        steps: [
          {
            id: "step:CreatePost.0.validate",
            kind: "workflow_step",
            name: "CreatePost.0.validate",
            workflow_id: "workflow:CreatePost",
            order: 0,
            operation: { kind: "validate", target: "body" },
          },
          {
            id: "step:CreatePost.1.insert",
            kind: "workflow_step",
            name: "CreatePost.1.insert",
            workflow_id: "workflow:CreatePost",
            order: 1,
            operation: { kind: "insert", model_id: "model:Post" },
          },
        ],
        guarantees: [
          {
            id: "guarantee:CreatePost.post_creation_p95_latency",
            kind: "guarantee",
            name: "post_creation_p95_latency",
            workflow_id: "workflow:CreatePost",
            form: "short",
            arguments: { limit_ms: 250 },
          },
        ],
      },
    ],
    customs: [],
    artifacts: [],
    ownership: [],
    verification: { typecheck: true, tests: true, migrations: true },
    guarantee_coverage: [],
    source_locations: [],
  };
}

/** SocialFeed V2: adds `Post.visibility: string default "public" indexed`. */
export function socialFeedV2(): CanonicalIR {
  const v1 = socialFeedV1();
  const post = v1.models.find((m) => m.id === "model:Post")!;
  const newFields = [
    ...post.fields,
    {
      id: "field:Post.visibility",
      kind: "field" as const,
      name: "visibility",
      model_id: "model:Post",
      type: { kind: "primitive" as const, name: "string" as const },
      nullable: false,
      indexed: true,
      default: "public",
    },
  ];
  const newIndexes = [
    ...post.indexes,
    {
      id: "model_index:Post.visibility",
      kind: "model_index" as const,
      name: "Post.visibility",
      model_id: "model:Post",
      fields: ["visibility"],
      source: "field_modifier" as const,
      unique: true,
    },
  ];
  return {
    ...v1,
    canonical_hash: "v2-test-hash",
    models: v1.models.map((m) =>
      m.id === "model:Post"
        ? { ...m, fields: newFields, indexes: newIndexes }
        : m,
    ),
  };
}

/** A version of V1 with non-semantic re-ordering — should produce no diffs. */
export function socialFeedV1ReorderedFields(): CanonicalIR {
  const v1 = socialFeedV1();
  return {
    ...v1,
    // reordering models in the array — semantics unchanged, indexed by id.
    models: [...v1.models].reverse(),
  };
}
