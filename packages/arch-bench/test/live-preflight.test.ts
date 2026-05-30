import { describe, expect, it } from "vitest";
import { preflightLiveProviders, type LivePreflightSpawn } from "../src/llm/preflight.js";

const config = {
  bins: {
    "claude-code": "claude",
    "grok-build": "grok",
    "cursor-composer": "cursor-agent",
  },
  models: {
    "claude-code": "sonnet",
    "grok-build": "grok-build",
    "cursor-composer": "composer-2.5",
  },
} as const;

describe("preflightLiveProviders", () => {
  it("accepts selected authenticated providers", () => {
    const spawn: LivePreflightSpawn = (bin) => {
      if (bin === "claude") return { status: 0, stdout: "2.1.156", stderr: "" };
      if (bin === "grok") return { status: 0, stdout: "Available models:\n  * grok-build", stderr: "" };
      return { status: 0, stdout: "composer-2.5\ncomposer-2.5-fast", stderr: "" };
    };
    expect(preflightLiveProviders(["claude-code", "grok-build", "cursor-composer"], config, spawn)).toEqual({
      ok: true,
    });
  });

  it("reports unauthenticated Grok clearly", () => {
    const spawn: LivePreflightSpawn = () => ({ status: 0, stdout: "You are not authenticated.", stderr: "" });
    const result = preflightLiveProviders(["grok-build"], config, spawn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("grok login");
  });

  it("reports missing Composer model clearly", () => {
    const spawn: LivePreflightSpawn = () => ({ status: 0, stdout: "composer-2.5-fast", stderr: "" });
    const result = preflightLiveProviders(["cursor-composer"], config, spawn);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("composer-2.5");
  });
});
