// Oracle: `approvedFlag: boolean default: false` defaults to false and accepts true.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.approvedFlag oracle", () => {
  beforeEach(() => resetDb());

  it("defaults approvedFlag to false", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.approvedFlag).toBe(false);
  });

  it("accepts approvedFlag=true", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", approvedFlag: true });
    expect(invoice.approvedFlag).toBe(true);
  });
});
