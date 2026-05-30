// Oracle: `dueDate: timestamp default: now` must default to a Date instance.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.dueDate oracle", () => {
  beforeEach(() => resetDb());

  it("defaults dueDate to a Date", async () => {
    const task = await createTask({ title: "scheduled" });
    expect(task.dueDate).toBeInstanceOf(Date);
  });
});
