// Oracle: `source: enum[...] default: "direct"` must default to direct AND accept a declared value.
import { beforeEach, describe, expect, it } from "vitest";
import { createBooking } from "../../../src/models/Booking.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Booking.source oracle", () => {
  beforeEach(() => resetDb());

  it("defaults source to 'direct' when omitted", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada" });
    expect(booking.source).toBe("direct");
  });

  it("persists an explicit enum value", async () => {
    const booking = await createBooking({ resourceId: "r1", guestName: "Ada", source: "partner" });
    expect(booking.source).toBe("partner");
  });
});
