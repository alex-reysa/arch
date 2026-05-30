// Oracle: adding `priority: int default: 1` to Task must default to 1 and accept
// explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.priority oracle", () => {
  beforeEach(() => resetDb());

  it("defaults priority to 1 when omitted", async () => {
    const task = await createTask({ title: "ship it" });
    expect(task.priority).toBe(1);
  });

  it("persists an explicit priority", async () => {
    const task = await createTask({ title: "urgent", priority: 5 });
    expect(task.priority).toBe(5);
  });
});
