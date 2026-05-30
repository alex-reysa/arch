// Oracle: `weightGrams: int default: 0` must default to 0 and accept a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.weightGrams oracle", () => {
  beforeEach(() => resetDb());

  it("defaults weightGrams to 0", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.weightGrams).toBe(0);
  });

  it("accepts an explicit weightGrams", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", weightGrams: 1500 });
    expect(item.weightGrams).toBe(1500);
  });
});
