// Oracle: `likeCount: int default: 0` must default to 0 and accept an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.likeCount oracle", () => {
  beforeEach(() => resetDb());

  it("defaults likeCount to 0", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.likeCount).toBe(0);
  });

  it("persists an explicit likeCount", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", likeCount: 7 });
    expect(post.likeCount).toBe(7);
  });
});
