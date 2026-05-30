// Oracle: the new `barcode: string default: ""` field (also added as a workflow
// `validate barcode` step) must default to "" and accept an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Item.barcode oracle", () => {
  beforeEach(() => resetDb());

  it("defaults barcode to empty string", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.barcode).toBe("");
  });

  it("accepts an explicit barcode", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-2", barcode: "0123456789012" });
    expect(item.barcode).toBe("0123456789012");
  });
});
