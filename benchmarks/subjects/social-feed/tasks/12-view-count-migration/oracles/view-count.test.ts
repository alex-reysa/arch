// Oracle: `viewCount: int default: 0` lands as an additive, migration-safe change.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.viewCount oracle", () => {
  beforeEach(() => resetDb());

  it("defaults viewCount to 0", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.viewCount).toBe(0);
  });

  it("persists an explicit viewCount", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", viewCount: 42 });
    expect(post.viewCount).toBe(42);
  });
});
