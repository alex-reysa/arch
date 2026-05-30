// Oracle: an additive change (archived) lands AND the human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";
import { archiveTag } from "../../../src/custom/InvoiceArchive.js";

describe("archived + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults archived to false", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.archived).toBe(false);
  });

  it("preserves the human-owned custom helper", () => {
    expect(archiveTag("INV-7")).toBe("archived/INV-7");
  });
});
