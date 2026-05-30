// Oracle: `updatedAt: timestamp default: now` must default to a Date.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.updatedAt oracle", () => {
  beforeEach(() => resetDb());

  it("defaults updatedAt to a Date", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.updatedAt).toBeInstanceOf(Date);
  });
});
