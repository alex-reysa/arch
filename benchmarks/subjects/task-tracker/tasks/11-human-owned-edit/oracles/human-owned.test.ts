// Oracle: an additive change (labelColor) lands AND the human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";
import { formatLabel } from "../../../src/custom/TaskFormatter.js";

describe("labelColor + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults labelColor to 'gray'", async () => {
    const task = await createTask({ title: "colored" });
    expect(task.labelColor).toBe("gray");
  });

  it("preserves the human-owned custom helper", () => {
    expect(formatLabel("todo")).toBe("[todo]");
  });
});
