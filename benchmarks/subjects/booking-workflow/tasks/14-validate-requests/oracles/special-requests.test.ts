// Oracle: `specialRequests: string default: ""` (also validated by the workflow) must
// default to empty string and accept an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.specialRequests oracle", () => {
  beforeEach(() => resetDb());

  it("defaults specialRequests to empty string", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.specialRequests).toBe("");
  });

  it("persists an explicit specialRequests value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", specialRequests: "crib needed" });
    expect(booking.specialRequests).toBe("crib needed");
  });
});
