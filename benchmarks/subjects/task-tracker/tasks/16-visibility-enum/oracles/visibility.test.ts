// Oracle: `visibility: enum["private","team","public"] default: "private"` must
// default to "private" AND accept declared enum values.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.visibility oracle", () => {
  beforeEach(() => resetDb());

  it("defaults visibility to 'private' when omitted", async () => {
    const task = await createTask({ title: "secret" });
    expect(task.visibility).toBe("private");
  });

  it("persists an explicit enum value", async () => {
    const task = await createTask({ title: "shared", visibility: "public" });
    expect(task.visibility).toBe("public");
  });
});
