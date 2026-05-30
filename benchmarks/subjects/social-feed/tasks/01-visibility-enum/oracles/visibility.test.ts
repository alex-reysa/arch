// Oracle: adding `visibility: enum[...] default: "public"` to Post must give a
// working default AND accept the declared enum values — behavior, not structure.
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Post.visibility oracle", () => {
  beforeEach(() => resetDb());

  it("defaults visibility to 'public' when omitted", async () => {
    const post = await createPost({ authorId: "u1", body: "hello" });
    expect(post.visibility).toBe("public");
  });

  it("persists an explicit enum value", async () => {
    const post = await createPost({ authorId: "u1", body: "secret", visibility: "private" });
    expect(post.visibility).toBe("private");
  });
});
