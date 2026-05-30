// Oracle: `priority: int default: 0` defaults to 0 and accepts explicit values.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.priority oracle", () => {
  beforeEach(() => resetDb());

  it("defaults priority to 0", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.priority).toBe(0);
  });

  it("defaults guests to 1 and status to held", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.guests).toBe(1);
    expect(booking.status).toBe("held");
  });
});
