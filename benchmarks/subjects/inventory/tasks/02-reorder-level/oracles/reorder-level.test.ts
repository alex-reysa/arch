// Oracle: `reorderLevel: int default: 0` must default to 0 and accept a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.reorderLevel oracle", () => {
  beforeEach(() => resetDb());

  it("defaults reorderLevel to 0", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.reorderLevel).toBe(0);
  });

  it("accepts an explicit reorderLevel", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", reorderLevel: 25 });
    expect(item.reorderLevel).toBe(25);
  });
});
