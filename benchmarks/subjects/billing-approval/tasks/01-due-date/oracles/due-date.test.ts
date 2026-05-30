// Oracle: `dueDate: timestamp default: now` defaults to a Date.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.dueDate oracle", () => {
  beforeEach(() => resetDb());

  it("defaults dueDate to a Date", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.dueDate).toBeInstanceOf(Date);
  });

  it("defaults status to draft and amountCents to 0", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.status).toBe("draft");
    expect(invoice.amountCents).toBe(0);
  });
});
