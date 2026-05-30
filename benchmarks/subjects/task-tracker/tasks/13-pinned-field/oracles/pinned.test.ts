// Oracle: `pinned: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.pinned oracle", () => {
  beforeEach(() => resetDb());

  it("defaults pinned to false", async () => {
    const task = await createTask({ title: "normal" });
    expect(task.pinned).toBe(false);
  });

  it("accepts pinned=true", async () => {
    const task = await createTask({ title: "sticky", pinned: true });
    expect(task.pinned).toBe(true);
  });
});
