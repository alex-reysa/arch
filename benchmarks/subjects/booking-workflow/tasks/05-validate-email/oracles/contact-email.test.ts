// Oracle: `contactEmail: string default: ""` (also validated by the workflow) must
// default to empty string and accept an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.contactEmail oracle", () => {
  beforeEach(() => resetDb());

  it("defaults contactEmail to empty string", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.contactEmail).toBe("");
  });

  it("persists an explicit contactEmail value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", contactEmail: "ada@example.com" });
    expect(booking.contactEmail).toBe("ada@example.com");
  });
});
