// Oracle: `priority: int default: 0` defaults to 0 and accepts an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.priority oracle", () => {
  beforeEach(() => resetDb());

  it("defaults priority to 0", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.priority).toBe(0);
  });

  it("accepts an explicit priority", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2", priority: 5 });
    expect(invoice.priority).toBe(5);
  });
});
