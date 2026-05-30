// Oracle: `notes: string default: ""` migration adds the column with its
// declared default and accepts an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.notes migration oracle", () => {
  beforeEach(() => resetDb());

  it("defaults notes to empty string", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.notes).toBe("");
  });

  it("accepts explicit notes", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", notes: "fragile" });
    expect(item.notes).toBe("fragile");
  });
});
