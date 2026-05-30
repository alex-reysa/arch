// Oracle: migration_data_preservation — `taxCents: int default: 0` lands with a
// 0 default (existing rows preserved; new column backfilled).
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.taxCents oracle", () => {
  beforeEach(() => resetDb());

  it("defaults taxCents to 0", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.taxCents).toBe(0);
  });

  it("accepts an explicit taxCents", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", taxCents: 750 });
    expect(invoice.taxCents).toBe(750);
  });
});
