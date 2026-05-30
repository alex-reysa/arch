// Oracle: `severity: enum["low","medium","high"] default: "low"` must default to
// "low" AND accept declared enum values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.severity oracle", () => {
  beforeEach(() => resetDb());

  it("defaults severity to 'low' when omitted", async () => {
    const task = await createTask({ title: "minor" });
    expect(task.severity).toBe("low");
  });

  it("persists an explicit enum value", async () => {
    const task = await createTask({ title: "urgent", severity: "high" });
    expect(task.severity).toBe("high");
  });
});
