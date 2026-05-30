// Oracle: `nights: int default: 1` must default to 1 and accept explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.nights oracle", () => {
  beforeEach(() => resetDb());

  it("defaults nights to 1", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.nights).toBe(1);
  });

  it("persists an explicit nights value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", nights: 3 });
    expect(booking.nights).toBe(3);
  });
});
