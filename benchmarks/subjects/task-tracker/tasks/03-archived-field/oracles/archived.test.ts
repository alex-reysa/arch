// Oracle: `archived: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../../../src/models/Task.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Task.archived oracle", () => {
  beforeEach(() => resetDb());

  it("defaults archived to false", async () => {
    const task = await createTask({ title: "keep me" });
    expect(task.archived).toBe(false);
  });

  it("accepts archived=true", async () => {
    const task = await createTask({ title: "old", archived: true });
    expect(task.archived).toBe(true);
  });
});
