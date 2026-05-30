// Oracle: `glCode: string default: ""` defaults to empty and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.glCode oracle", () => {
  beforeEach(() => resetDb());

  it("defaults glCode to empty string", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.glCode).toBe("");
  });

  it("persists an explicit glCode value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", glCode: "6000-10" });
    expect(invoice.glCode).toBe("6000-10");
  });
});
