import { describe, it, expect } from "vitest";
import { compileSpec } from "../src/runner/compile.js";

const VALID = `target ts.node.fastify.postgres.prisma cache: none

model Task {
  id: id
  title: string
  done: boolean default: false
  createdAt: timestamp default: now indexed
}

workflow CreateTask {
  trigger api POST /tasks auth: none
  step validate title
  step insert Task
}
`;

describe("compileSpec", () => {
  it("compiles a valid spec to canonical IR with a stable hash", () => {
    const a = compileSpec(VALID, "backend.arch");
    const b = compileSpec(VALID, "backend.arch");
    expect(a.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.ir.canonical_hash).toMatch(/[0-9a-f]{16,}/);
      expect(a.ir.canonical_hash).toBe(b.ir.canonical_hash);
      expect(a.ir.models.length).toBe(1);
      expect(a.ir.workflows.length).toBe(1);
    }
  });

  it("reports diagnostics for an invalid spec", () => {
    const result = compileSpec("model {{{ broken", "backend.arch");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
