// Oracle: an additive change (updatedAt) lands AND the human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";
import { describeItem } from "../../../src/custom/ItemReporter.js";

describe("updatedAt + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults updatedAt to a Date", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it("preserves the human-owned custom helper", () => {
    expect(describeItem("widget")).toBe("item:widget");
  });
});
