// Oracle: the validated `summary: string default: ""` defaults to "" and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.summary oracle", () => {
  beforeEach(() => resetDb());

  it("defaults summary to ''", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.summary).toBe("");
  });

  it("persists an explicit summary", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", summary: "tldr" });
    expect(post.summary).toBe("tldr");
  });
});
