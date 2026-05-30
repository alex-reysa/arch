// Oracle: an additive change (tagline) lands AND the human-owned custom helper
// seeded under src/custom/** survives untouched (behavioral preservation).
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";
import { makeTagline } from "../../../src/custom/BookingTagline.js";

describe("tagline + human-owned preservation oracle", () => {
  beforeEach(() => resetDb());

  it("defaults tagline to empty string", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.tagline).toBe("");
  });

  it("preserves the human-owned custom helper", () => {
    expect(makeTagline("stay")).toBe("stay!");
  });
});
