// Oracle: `notes: string default: ""` defaults to an empty string and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.notes oracle", () => {
  beforeEach(() => resetDb());

  it("defaults notes to empty string", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.notes).toBe("");
  });

  it("persists an explicit notes value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", notes: "rush" });
    expect(invoice.notes).toBe("rush");
  });
});
