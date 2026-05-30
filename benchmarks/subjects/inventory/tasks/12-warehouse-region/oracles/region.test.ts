// Oracle: `region: string default: ""` added to Warehouse must default to "" and
// accept an explicit value.
import { beforeEach, describe, expect, it } from "vitest";
import { createWarehouse } from "../../../src/models/Warehouse.js";
import { resetDb } from "../../../src/runtime/db.js";

describe("Warehouse.region oracle", () => {
  beforeEach(() => resetDb());

  it("defaults region to empty string", async () => {
    const wh = await createWarehouse({ name: "Main" });
    expect(wh.region).toBe("");
  });

  it("accepts an explicit region", async () => {
    const wh = await createWarehouse({ name: "West", region: "us-west-2" });
    expect(wh.region).toBe("us-west-2");
  });
});
