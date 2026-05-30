// Oracle: an additive change (lastCountedAt) lands AND the human-owned custom
// helper seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../../../src/models/Item.js";
import { resetDb } from "../../../src/runtime/db.js";
import { auditSku } from "../../../src/custom/ItemAuditor.js";

describe("lastCountedAt + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults lastCountedAt to a Date", async () => {
    const item = await createItem({ warehouseId: "w1", sku: "SKU-1" });
    expect(item.lastCountedAt).toBeInstanceOf(Date);
  });

  it("preserves the human-owned custom helper", () => {
    expect(auditSku("abc")).toBe("AUDIT:abc");
  });
});
