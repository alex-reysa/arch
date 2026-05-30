// Oracle: `costCenter: string default: ""` defaults to empty and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.costCenter oracle", () => {
  beforeEach(() => resetDb());

  it("defaults costCenter to empty string", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.costCenter).toBe("");
  });

  it("persists an explicit costCenter value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", costCenter: "CC-7" });
    expect(invoice.costCenter).toBe("CC-7");
  });
});
