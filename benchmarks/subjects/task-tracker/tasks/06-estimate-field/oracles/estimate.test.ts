// Oracle: `estimateHours: int default: 0` must default to 0 and accept explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.estimateHours oracle", () => {
  beforeEach(() => resetDb());

  it("defaults estimateHours to 0", async () => {
    const task = await createTask({ title: "quick" });
    expect(task.estimateHours).toBe(0);
  });

  it("persists an explicit estimate", async () => {
    const task = await createTask({ title: "big", estimateHours: 8 });
    expect(task.estimateHours).toBe(8);
  });
});
