// Oracle: `submittedBy: string default: ""` defaults to empty and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.submittedBy oracle", () => {
  beforeEach(() => resetDb());

  it("defaults submittedBy to empty string", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.submittedBy).toBe("");
  });

  it("persists an explicit submittedBy value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", submittedBy: "ada" });
    expect(invoice.submittedBy).toBe("ada");
  });
});
