import { describe, expect, it } from "vitest";
import { canonicalStringify } from "./canonical-json.js";

describe("canonicalStringify", () => {
  it("sorts object keys and preserves array order", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("omits undefined-valued keys (JSON parity) instead of throwing", () => {
    expect(canonicalStringify({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    // Output is byte-identical to the same object without the undefined key.
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  it("renders an undefined array element as null (JSON parity)", () => {
    expect(canonicalStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("still rejects non-finite numbers", () => {
    expect(() => canonicalStringify({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });
});
