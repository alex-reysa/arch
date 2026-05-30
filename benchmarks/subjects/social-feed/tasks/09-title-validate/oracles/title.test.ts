// Oracle: the validated `title: string default: ""` defaults to "" and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.title oracle", () => {
  beforeEach(() => resetDb());

  it("defaults title to ''", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.title).toBe("");
  });

  it("persists an explicit title", async () => {
    const post = await createPost({ authorId: "u1", body: "hi", title: "Hello" });
    expect(post.title).toBe("Hello");
  });
});
