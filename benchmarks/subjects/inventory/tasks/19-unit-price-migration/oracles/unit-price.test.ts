// Oracle: `unitPrice: int default: 0` migration adds the column with its declared
// default and accepts an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.unitPrice migration oracle", () => {
  beforeEach(() => resetDb());

  it("defaults unitPrice to 0", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.unitPrice).toBe(0);
  });

  it("accepts an explicit unitPrice", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", unitPrice: 4999 });
    expect(item.unitPrice).toBe(4999);
  });
});
