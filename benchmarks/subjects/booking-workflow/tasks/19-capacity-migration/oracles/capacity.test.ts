// Oracle: `capacity: int default: 0` on Resource must default to 0 and accept explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createResource } from "../../../src/models/Resource.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Resource.capacity oracle", () => {
  beforeEach(() => resetDb());

  it("defaults capacity to 0", async () => {
    const resource = await createResource({ name: "Suite A" });
    expect(resource.capacity).toBe(0);
  });

  it("persists an explicit capacity value", async () => {
    const resource = await createResource({ name: "Suite B", capacity: 4 });
    expect(resource.capacity).toBe(4);
  });
});
