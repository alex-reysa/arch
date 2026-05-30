// Oracle: `pinned: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.pinned oracle", () => {
  beforeEach(() => resetDb());

  it("defaults pinned to false", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.pinned).toBe(false);
  });

  it("accepts pinned=true", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", pinned: true });
    expect(post.pinned).toBe(true);
  });
});
