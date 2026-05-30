// Oracle: adding `category: enum[...] default: "raw"` to Item must give a
// working default AND accept the declared enum values.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.category oracle", () => {
  beforeEach(() => resetDb());

  it("defaults category to 'raw' when omitted", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.category).toBe("raw");
  });

  it("persists an explicit enum value", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", category: "finished" });
    expect(item.category).toBe("finished");
  });
});
