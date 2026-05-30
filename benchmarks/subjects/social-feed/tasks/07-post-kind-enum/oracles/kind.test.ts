// Oracle: `kind: enum[...] default: "text"` must default to "text" and accept a declared value.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.kind oracle", () => {
  beforeEach(() => resetDb());

  it("defaults kind to 'text'", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.kind).toBe("text");
  });

  it("persists an explicit enum value", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", kind: "video" });
    expect(post.kind).toBe("video");
  });
});
