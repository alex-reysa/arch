// Oracle: `active: boolean default: true` on Resource must default to true and accept false.
import { beforeEach, describe, expect, it } from "vitest";
import { createResource } from "../../../src/models/Resource.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Resource.active oracle", () => {
  beforeEach(() => resetDb());

  it("defaults active to true", async () => {
    const resource = await createResource({ name: "Suite A" });
    expect(resource.active).toBe(true);
  });

  it("accepts active=false", async () => {
    const resource = await createResource({ name: "Suite B", active: false });
    expect(resource.active).toBe(false);
  });
});
