// Oracle: an additive change (escalated) lands AND the human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";
import { escalationLabel } from "../../../src/custom/InvoiceEscalation.js";

describe("escalated + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults escalated to false", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.escalated).toBe(false);
  });

  it("preserves the human-owned custom helper", () => {
    expect(escalationLabel("urgent")).toBe("ESCALATED:urgent");
  });
});
