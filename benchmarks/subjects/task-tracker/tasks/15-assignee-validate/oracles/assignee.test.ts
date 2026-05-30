// Oracle: a NEW string field `assignee` (default: "") lands with its default AND
// the workflow now sanitizes it via a policy. Clean text passes through unchanged.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.assignee oracle", () => {
  beforeEach(() => resetDb());

  it("defaults assignee to empty string", async () => {
    const task = await createTask({ title: "unassigned" });
    expect(task.assignee).toBe("");
  });

  it("persists an explicit assignee", async () => {
    const task = await createTask({ title: "owned", assignee: "alice" });
    expect(task.assignee).toBe("alice");
  });
});
