// Oracle: an additive change (slug) lands AND a second human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";
import { buildSlug } from "../../../src/custom/SlugBuilder.js";

describe("slug + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults slug to empty string", async () => {
    const task = await createTask({ title: "no-slug" });
    expect(task.slug).toBe("");
  });

  it("preserves the human-owned custom helper", () => {
    expect(buildSlug("Hello World")).toBe("hello-world");
  });
});
