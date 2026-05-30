import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { describe, expect, it } from "vitest";
import { generate } from "../../generator.js";

/**
 * Regression test for the validator / workflow template fixes.
 *
 * Materializes the SocialFeed v1 IR (the canonical example from
 * `packages/arch-test-fixtures/fixtures/social-feed-v1/backend.arch`),
 * generates the project, copies the validator + workflow files and
 * the minimal stubs they import into a tmp dir, and asserts that
 * `tsc --noEmit` under `strict` exits 0.
 *
 * Before the fix this failed because:
 *   - `validators/Post.ts` did `obj as PostInput`, which TS rejects as a
 *     "may be a mistake" cast from `Record<string, unknown>` to a struct.
 *   - `workflows/CreatePost.ts` typed `payload` as `Record<string, unknown>`
 *     and called `validateUser(input)` (the wrong validator) because the
 *     `op.target === "body"` shortcut matched the *first* model in the IR.
 */

const require_ = createRequire(import.meta.url);

function socialFeedV1IR(): CanonicalIR {
  return {
    schema_version: "arch.ir.v1",
    canonical_hash: "deadbeef",
    target: { stack: "ts.node.fastify.postgres.prisma", cache: "redis" },
    models: [
      {
        id: "model:User",
        kind: "model",
        name: "User",
        fields: [
          { id: "field:User.id", kind: "field", name: "id", model_id: "model:User", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:User.email", kind: "field", name: "email", model_id: "model:User", type: { kind: "primitive", name: "string" }, nullable: false, indexed: true },
          { id: "field:User.createdAt", kind: "field", name: "createdAt", model_id: "model:User", type: { kind: "primitive", name: "timestamp" }, nullable: false, default: "now", indexed: false },
        ],
        indexes: [],
      },
      {
        id: "model:Post",
        kind: "model",
        name: "Post",
        fields: [
          { id: "field:Post.id", kind: "field", name: "id", model_id: "model:Post", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:Post.authorId", kind: "field", name: "authorId", model_id: "model:Post", type: { kind: "model_ref", target_model_id: "model:User" }, nullable: false, indexed: false },
          { id: "field:Post.body", kind: "field", name: "body", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, indexed: false },
          { id: "field:Post.visibility", kind: "field", name: "visibility", model_id: "model:Post", type: { kind: "enum", values: ["public", "private", "followers"] }, nullable: false, default: "public", indexed: true },
          { id: "field:Post.createdAt", kind: "field", name: "createdAt", model_id: "model:Post", type: { kind: "primitive", name: "timestamp" }, nullable: false, default: "now", indexed: true },
        ],
        indexes: [],
      },
    ],
    integrations: [
      { id: "integration:FeedCache", kind: "integration", name: "FeedCache", properties: { kind: "redis", failure: "best_effort" } },
      { id: "integration:PushNotifier", kind: "integration", name: "PushNotifier", properties: { kind: "webhook", failure: "best_effort" } },
    ],
    policies: [
      { id: "policy:sanitizeHtml", kind: "policy", name: "sanitizeHtml", body: "strip script tags and on* attributes from inputs" },
    ],
    workflows: [
      {
        id: "workflow:CreatePost",
        kind: "workflow",
        name: "CreatePost",
        trigger: { kind: "api", method: "POST", path: "/posts", auth: "none" },
        steps: [
          { id: "step:CreatePost.0.validate", kind: "workflow_step", name: "CreatePost.0.validate", workflow_id: "workflow:CreatePost", order: 0, operation: { kind: "validate", target: "body" } },
          { id: "step:CreatePost.1.sanitize", kind: "workflow_step", name: "CreatePost.1.sanitize", workflow_id: "workflow:CreatePost", order: 1, operation: { kind: "sanitize", target: "body", policy_id: "policy:sanitizeHtml" } },
          { id: "step:CreatePost.2.insert", kind: "workflow_step", name: "CreatePost.2.insert", workflow_id: "workflow:CreatePost", order: 2, operation: { kind: "insert", model_id: "model:Post" } },
          { id: "step:CreatePost.3.call", kind: "workflow_step", name: "CreatePost.3.call", workflow_id: "workflow:CreatePost", order: 3, operation: { kind: "call", integration_id: "integration:FeedCache", operation: "update" } },
          { id: "step:CreatePost.4.call", kind: "workflow_step", name: "CreatePost.4.call", workflow_id: "workflow:CreatePost", order: 4, operation: { kind: "call", integration_id: "integration:PushNotifier", operation: "send" } },
        ],
        guarantees: [
          { id: "guarantee:CreatePost.no_unsanitized_html_persisted", kind: "guarantee", name: "no_unsanitized_html_persisted", workflow_id: "workflow:CreatePost", form: "short", arguments: {} },
          { id: "guarantee:CreatePost.notification_failure_does_not_rollback_post", kind: "guarantee", name: "notification_failure_does_not_rollback_post", workflow_id: "workflow:CreatePost", form: "short", arguments: {} },
          { id: "guarantee:CreatePost.post_creation_p95_latency", kind: "guarantee", name: "post_creation_p95_latency", workflow_id: "workflow:CreatePost", form: "short", arguments: { limit_ms: 250 } },
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

// Hand-rolled stubs that match the *contract* of the generated model /
// integration / policy files. Using stubs (instead of the real generated
// counterparts) keeps the regression scope locked to validator + workflow:
// a typecheck failure here means a fix-target template regressed, not an
// incidentally-changed neighbour template.
const MODEL_POST_STUB = `
export interface Post {
  id: string;
  authorId: string;
  body: string;
  visibility: "public" | "private" | "followers";
  createdAt: Date;
}
export type InsertablePost = {
  authorId: string;
  body: string;
  visibility?: "public" | "private" | "followers";
  createdAt?: Date;
};
export async function createPost(input: InsertablePost): Promise<Post> {
  return { id: "p_1", authorId: input.authorId, body: input.body, visibility: input.visibility ?? "public", createdAt: input.createdAt ?? new Date() };
}
`;

const POLICY_SANITIZE_HTML_STUB = `
export function sanitizeHtml(input: string): string {
  return input;
}
`;

const INTEGRATION_FEED_CACHE_STUB = `
export const FeedCache = {
  async update(_payload: unknown): Promise<void> {},
  async invalidate(_key: string): Promise<void> {},
};
`;

const INTEGRATION_PUSH_NOTIFIER_STUB = `
export const PushNotifier = {
  async send(_payload: unknown): Promise<void> {},
  async update(_payload: unknown): Promise<void> {},
};
`;

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      moduleResolution: "Bundler",
      lib: ["ES2022"],
      strict: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
      noEmit: true,
      isolatedModules: true,
      types: [],
    },
    include: ["src/**/*.ts"],
  },
  null,
  2,
);

describe("generated SocialFeed v1 validator + workflow typecheck (regression)", () => {
  it("validators/Post.ts and workflows/CreatePost.ts compile under strict tsc --noEmit", () => {
    const result = generate(socialFeedV1IR());
    const validator = result.files.find((f) => f.path === "src/validators/Post.ts");
    const workflow = result.files.find((f) => f.path === "src/workflows/CreatePost.ts");
    expect(validator, "expected generator to emit src/validators/Post.ts").toBeTruthy();
    expect(workflow, "expected generator to emit src/workflows/CreatePost.ts").toBeTruthy();

    const dir = mkdtempSync(join(tmpdir(), "arch-generator-typecheck-"));
    try {
      const writeAt = (rel: string, content: string): void => {
        const full = join(dir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      };

      // The two files under test — emitted by the generator.
      writeAt("src/validators/Post.ts", validator!.content);
      writeAt("src/workflows/CreatePost.ts", workflow!.content);

      // Stubs the workflow imports. Their shapes match the real generator
      // output's public contract (see `templates/model.ts`,
      // `templates/policy.ts`, `templates/integration-stub.ts`).
      writeAt("src/models/Post.ts", MODEL_POST_STUB);
      writeAt("src/policies/sanitizeHtml.ts", POLICY_SANITIZE_HTML_STUB);
      writeAt("src/integrations/FeedCache.ts", INTEGRATION_FEED_CACHE_STUB);
      writeAt("src/integrations/PushNotifier.ts", INTEGRATION_PUSH_NOTIFIER_STUB);

      writeAt("tsconfig.json", TSCONFIG);

      const tscBin = require_.resolve("typescript/bin/tsc");
      const proc = spawnSync(process.execPath, [tscBin, "--noEmit", "-p", dir], {
        encoding: "utf8",
      });

      if (proc.status !== 0) {
        const banner = `tsc --noEmit failed (status=${proc.status}) for the generated SocialFeed v1 outputs.`;
        const stdout = proc.stdout?.trim() ?? "";
        const stderr = proc.stderr?.trim() ?? "";
        const validatorBody = validator!.content;
        const workflowBody = workflow!.content;
        throw new Error(
          [
            banner,
            "--- tsc stdout ---",
            stdout || "(empty)",
            "--- tsc stderr ---",
            stderr || "(empty)",
            "--- generated src/validators/Post.ts ---",
            validatorBody,
            "--- generated src/workflows/CreatePost.ts ---",
            workflowBody,
          ].join("\n"),
        );
      }

      expect(proc.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
