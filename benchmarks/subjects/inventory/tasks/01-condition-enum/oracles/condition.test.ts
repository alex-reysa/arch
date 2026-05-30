// Oracle: adding `condition: enum[...] default: "new"` to Item must give a
// working default AND accept the declared enum values — behavior, not structure.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.condition oracle", () => {
  beforeEach(() => resetDb());

  it("defaults condition to 'new' when omitted", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.condition).toBe("new");
  });

  it("persists an explicit enum value", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", condition: "refurbished" });
    expect(item.condition).toBe("refurbished");
  });
});
