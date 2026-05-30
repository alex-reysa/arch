// Oracle: an additive change (confirmationCode) lands AND the human-owned custom
// helper seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";
import { formatCode } from "../../../src/custom/BookingCode.js";

describe("confirmationCode + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults confirmationCode to empty string", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.confirmationCode).toBe("");
  });

  it("preserves the human-owned custom helper", () => {
    expect(formatCode("abc")).toBe("ABC");
  });
});
