// Oracle: `archived: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.archived oracle", () => {
  beforeEach(() => resetDb());

  it("defaults archived to false", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.archived).toBe(false);
  });

  it("accepts archived=true", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", archived: true });
    expect(item.archived).toBe(true);
  });
});
