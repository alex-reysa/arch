// Oracle: the new `binLocation: string default: ""` field (also added as a
// workflow `validate binLocation` step) must default to "" and accept a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.binLocation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults binLocation to empty string", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.binLocation).toBe("");
  });

  it("accepts an explicit binLocation", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", binLocation: "A-12-3" });
    expect(item.binLocation).toBe("A-12-3");
  });
});
