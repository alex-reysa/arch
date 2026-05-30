// Oracle: `discontinued: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.discontinued oracle", () => {
  beforeEach(() => resetDb());

  it("defaults discontinued to false", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.discontinued).toBe(false);
  });

  it("accepts discontinued=true", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", discontinued: true });
    expect(item.discontinued).toBe(true);
  });
});
