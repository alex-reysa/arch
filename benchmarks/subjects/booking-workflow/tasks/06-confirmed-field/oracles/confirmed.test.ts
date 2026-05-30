// Oracle: `confirmed: boolean default: false` must default to false and accept true.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.confirmed oracle", () => {
  beforeEach(() => resetDb());

  it("defaults confirmed to false", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.confirmed).toBe(false);
  });

  it("accepts confirmed=true", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", confirmed: true });
    expect(booking.confirmed).toBe(true);
  });
});
