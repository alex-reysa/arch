// Oracle: `archived: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.archived oracle", () => {
  beforeEach(() => resetDb());

  it("defaults archived to false", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.archived).toBe(false);
  });

  it("accepts archived=true", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", archived: true });
    expect(post.archived).toBe(true);
  });
});
