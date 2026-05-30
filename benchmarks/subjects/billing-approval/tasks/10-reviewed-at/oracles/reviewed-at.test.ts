// Oracle: migration_data_preservation — `reviewedAt: timestamp default: now`
// lands with a Date default (existing rows preserved; new column backfilled).
import { beforeEach, describe, expect, it } from "vitest";
import { createInvoice } from "../../../src/models/Invoice.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Invoice.reviewedAt oracle", () => {
  beforeEach(() => resetDb());

  it("defaults reviewedAt to a Date", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-1" });
    expect(invoice.reviewedAt).toBeInstanceOf(Date);
  });

  it("keeps earlier fields intact", async () => {
    const invoice = await createInvoice({ vendorId: "v1", reference: "INV-2" });
    expect(invoice.currency).toBe("usd");
    expect(invoice.approvalState).toBe("pending");
  });
});
