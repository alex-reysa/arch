// Oracle: adding `status: enum[...] default: "open"` to Task must default to
// "open" AND accept declared enum values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.status oracle", () => {
  beforeEach(() => resetDb());

  it("defaults status to 'open' when omitted", async () => {
    const task = await createTask({ title: "ship it" });
    expect(task.status).toBe("open");
  });

  it("persists an explicit enum value", async () => {
    const task = await createTask({ title: "wip", status: "in_progress" });
    expect(task.status).toBe("in_progress");
  });
});
