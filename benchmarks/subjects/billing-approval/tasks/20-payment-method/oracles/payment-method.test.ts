// Oracle: `paymentMethod: enum["ach","wire","check"] default: "ach"` must default
// to ach AND accept a declared enum value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.paymentMethod oracle", () => {
  beforeEach(() => resetDb());

  it("defaults paymentMethod to 'ach'", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.paymentMethod).toBe("ach");
  });

  it("persists an explicit enum value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", paymentMethod: "wire" });
    expect(invoice.paymentMethod).toBe("wire");
  });
});
