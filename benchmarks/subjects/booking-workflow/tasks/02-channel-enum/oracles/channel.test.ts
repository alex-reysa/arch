// Oracle: `channel: enum[...] default: "web"` must default to web AND accept a declared value.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.channel oracle", () => {
  beforeEach(() => resetDb());

  it("defaults channel to 'web' when omitted", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.channel).toBe("web");
  });

  it("persists an explicit enum value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", channel: "phone" });
    expect(booking.channel).toBe("phone");
  });
});
