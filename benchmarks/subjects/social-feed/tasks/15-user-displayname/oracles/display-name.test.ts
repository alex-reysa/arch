// Oracle: `displayName: string default: ""` on User defaults to "" and accepts a value.
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../../../src/models/User.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("User.displayName oracle", () => {
  beforeEach(() => resetDb());

  it("defaults displayName to ''", async () => {
    const user = await createUser({ email: "a@example.com" });
    expect(user.displayName).toBe("");
  });

  it("persists an explicit displayName", async () => {
    const user = await createUser({ email: "b@example.com", displayName: "Ada" });
    expect(user.displayName).toBe("Ada");
  });
});
