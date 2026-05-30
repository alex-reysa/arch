// Oracle: an additive change (editedAt) lands AND the human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createPost } from "../../../src/models/Post.js";
import { resetDb } from "../../../src/runtime/db.js";
import { tagPost } from "../../../src/custom/PostTagger.js";

describe("editedAt + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults editedAt to a Date", async () => {
    const post = await createPost({ authorId: "u1", body: "hi" });
    expect(post.editedAt).toBeInstanceOf(Date);
  });

  it("preserves the human-owned custom helper", () => {
    expect(tagPost("hi")).toBe("HI");
  });
});
