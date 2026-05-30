// Oracle: adding `approvalState: enum[...] default: "pending"` must give a
// working default AND accept the declared enum values.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.approvalState oracle", () => {
  beforeEach(() => resetDb());

  it("defaults approvalState to 'pending'", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.approvalState).toBe("pending");
  });

  it("persists an explicit enum value", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", approvalState: "approved" });
    expect(invoice.approvalState).toBe("approved");
  });
});
