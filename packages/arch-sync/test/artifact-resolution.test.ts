/**
 * Resolution coverage for the V1 visibility scenario plus a few sanity
 * checks for adjacent diff types.
 */

import { describe, expect, it } from "vitest";
import { diffIRV1 } from "../src/diff/diff-engine.js";
import { resolveAffectedArtifacts } from "../src/graph/artifact-resolution.js";
import { socialFeedV1, socialFeedV2 } from "./fixtures.js";

describe("artifact resolution — Post.visibility add", () => {
  it("lists exactly the spec-required affected files in stable order", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV2());
    const result = resolveAffectedArtifacts(socialFeedV2(), envelope.diffs);
    const paths = result.artifactIds;
    // The V1 visibility scenario rewrites schema/runtime/model artifacts plus
    // model dependents, and scaffolds one migration per schema diff.
    expect(paths).toContain("prisma/schema.prisma");
    expect(paths.filter((p) => p.startsWith("prisma/migrations/"))).toHaveLength(2);
    expect(paths.find((p) => p.startsWith("prisma/migrations/"))).toMatch(/migration\.sql$/);
    expect(paths).toContain("src/runtime/db.ts");
    expect(paths).toContain("src/models/Post.ts");
    expect(paths).toContain("src/validators/Post.ts");
    expect(paths).toContain("src/routes/CreatePost.ts");
    expect(paths).toContain("src/workflows/CreatePost.ts");
    expect(paths).toContain("tests/models/Post.test.ts");
    expect(paths).toContain("tests/workflows/CreatePost.test.ts");
    expect(paths).toContain("tests/guarantees/post_creation_p95_latency.CreatePost.test.ts");
    expect(paths).toContain(".arch/artifact-map.json");
    expect(paths).toContain(".arch/ownership.json");
  });

  it("never includes integration or custom stub paths for a pure model field add", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV2());
    const { artifactIds } = resolveAffectedArtifacts(socialFeedV2(), envelope.diffs);
    expect(artifactIds.find((p) => p.startsWith("src/integrations/"))).toBeUndefined();
    expect(artifactIds.find((p) => p.startsWith("src/custom/"))).toBeUndefined();
  });

  it("is fully deterministic — repeated runs produce identical paths", () => {
    const { envelope } = diffIRV1(socialFeedV1(), socialFeedV2());
    const a = resolveAffectedArtifacts(socialFeedV2(), envelope.diffs).artifactIds;
    const b = resolveAffectedArtifacts(socialFeedV2(), envelope.diffs).artifactIds;
    expect(a).toEqual(b);
  });
});

describe("artifact resolution — initial generation", () => {
  it("resolves every current generator-canonical project artifact", () => {
    const { envelope } = diffIRV1(null, socialFeedV1());
    const r = resolveAffectedArtifacts(socialFeedV1(), envelope.diffs);
    expect(r.artifactIds).toEqual([
      ".arch/artifact-map.json",
      ".arch/ownership.json",
      "docker-compose.yml",
      "package.json",
      "prisma/schema.prisma",
      "src/app.ts",
      "src/custom/README.md",
      "src/models/Post.ts",
      "src/models/User.ts",
      "src/routes/CreatePost.ts",
      "src/runtime/auth.ts",
      "src/runtime/cache.ts",
      "src/runtime/config.ts",
      "src/runtime/db.ts",
      "src/server.ts",
      "src/validators/Post.ts",
      "src/validators/User.ts",
      "src/workflows/CreatePost.ts",
      "tests/guarantees/post_creation_p95_latency.CreatePost.test.ts",
      "tests/models/Post.test.ts",
      "tests/models/User.test.ts",
      "tests/workflows/CreatePost.test.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
  });
});
