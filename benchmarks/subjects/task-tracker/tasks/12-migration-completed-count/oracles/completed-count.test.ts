// Oracle: `completedCount: int default: 0` (a data-preserving additive migration)
// must default to 0 and accept explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.completedCount oracle", () => {
  beforeEach(() => resetDb());

  it("defaults completedCount to 0", async () => {
    const task = await createTask({ title: "fresh" });
    expect(task.completedCount).toBe(0);
  });

  it("persists an explicit completedCount", async () => {
    const task = await createTask({ title: "reused", completedCount: 3 });
    expect(task.completedCount).toBe(3);
  });
});
