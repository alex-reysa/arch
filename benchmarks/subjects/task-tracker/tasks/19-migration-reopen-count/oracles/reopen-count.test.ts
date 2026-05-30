// Oracle: `reopenCount: int default: 0` (a data-preserving additive migration)
// must default to 0 and accept explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.reopenCount oracle", () => {
  beforeEach(() => resetDb());

  it("defaults reopenCount to 0", async () => {
    const task = await createTask({ title: "stable" });
    expect(task.reopenCount).toBe(0);
  });

  it("persists an explicit reopenCount", async () => {
    const task = await createTask({ title: "flappy", reopenCount: 2 });
    expect(task.reopenCount).toBe(2);
  });
});
