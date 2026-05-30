// Oracle: `depositCents: int default: 0` must default to 0 and accept explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.depositCents oracle", () => {
  beforeEach(() => resetDb());

  it("defaults depositCents to 0", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.depositCents).toBe(0);
  });

  it("persists an explicit depositCents value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", depositCents: 5000 });
    expect(booking.depositCents).toBe(5000);
  });
});
