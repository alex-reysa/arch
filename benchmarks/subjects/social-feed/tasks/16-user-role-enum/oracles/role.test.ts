// Oracle: `role: enum[...] default: "member"` on User defaults to "member" and accepts a declared value.
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../../../src/models/User.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("User.role oracle", () => {
  beforeEach(() => resetDb());

  it("defaults role to 'member'", async () => {
    const user = await createUser({ email: "a@example.com" });
    expect(user.role).toBe("member");
  });

  it("persists an explicit enum value", async () => {
    const user = await createUser({ email: "b@example.com", role: "admin" });
    expect(user.role).toBe("admin");
  });
});
