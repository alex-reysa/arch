// Oracle: a NEW string field `description` (default: "") lands with its default
// AND the workflow now sanitizes it via a policy. Clean text passes through the
// sanitizer unchanged. Behavior, not structure.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.description oracle", () => {
  beforeEach(() => resetDb());

  it("defaults description to empty string", async () => {
    const task = await createTask({ title: "no notes" });
    expect(task.description).toBe("");
  });

  it("persists an explicit description", async () => {
    const task = await createTask({ title: "with notes", description: "details here" });
    expect(task.description).toBe("details here");
  });
});
