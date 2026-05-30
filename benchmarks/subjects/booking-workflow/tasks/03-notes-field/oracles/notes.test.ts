// Oracle: `notes: string default: ""` must default to empty string and accept a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.notes oracle", () => {
  beforeEach(() => resetDb());

  it("defaults notes to empty string", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.notes).toBe("");
  });

  it("persists an explicit notes value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", notes: "late arrival" });
    expect(booking.notes).toBe("late arrival");
  });
});
