// Oracle: `currency: enum["usd","eur","gbp"] default: "usd"` must default to usd
// AND accept a declared enum value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.currency oracle", () => {
  beforeEach(() => resetDb());

  it("defaults currency to 'usd'", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.currency).toBe("usd");
  });

  it("persists an explicit enum value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", currency: "eur" });
    expect(invoice.currency).toBe("eur");
  });
});
