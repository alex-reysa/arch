// Oracle: `active: boolean default: true` must default to true and accept false.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.active oracle", () => {
  beforeEach(() => resetDb());

  it("defaults active to true", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.active).toBe(true);
  });

  it("accepts active=false", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", active: false });
    expect(item.active).toBe(false);
  });
});
