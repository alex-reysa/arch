import { describe, expect, it } from "vitest";
import {
  DIFF_CAPABILITY_MATRIX,
  MIGRATION_CAPABILITY_MATRIX,
  capabilityMatrixJson,
  renderCapabilityMatrixMarkdown,
  renderMigrationCapabilityMatrixMarkdown,
} from "../src/external/capability.js";

describe("capability matrices", () => {
  it("every diff entry has a support level and a structured reason", () => {
    expect(DIFF_CAPABILITY_MATRIX.length).toBeGreaterThan(0);
    for (const e of DIFF_CAPABILITY_MATRIX) {
      expect(["supported", "partial", "blocked", "unsupported"]).toContain(e.support);
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });

  it("covers the roadmap's seven migration change classes", () => {
    expect(MIGRATION_CAPABILITY_MATRIX).toHaveLength(7);
    for (const e of MIGRATION_CAPABILITY_MATRIX) {
      expect(["supported", "partial", "blocked", "unsupported"]).toContain(e.support);
      expect(["yes", "no", "conditional", "n/a"]).toContain(e.dataPreserving);
      expect(e.reason.length).toBeGreaterThan(0);
    }
  });

  it("classifies additive-required-with-default as supported + data-preserving (the proven case)", () => {
    const additive = MIGRATION_CAPABILITY_MATRIX.find((e) => /required with default/i.test(e.change));
    expect(additive).toMatchObject({ support: "supported", dataPreserving: "yes" });
  });

  it("classifies relation change and rename as unsupported capability gaps", () => {
    expect(MIGRATION_CAPABILITY_MATRIX.find((e) => /relation change/i.test(e.change))?.support).toBe("unsupported");
    expect(MIGRATION_CAPABILITY_MATRIX.find((e) => /rename/i.test(e.change))?.support).toBe("unsupported");
  });

  it("renders deterministic markdown with both tables", () => {
    const md = renderCapabilityMatrixMarkdown();
    expect(md).toBe(renderCapabilityMatrixMarkdown());
    expect(md).toContain("Diff capability matrix");
    expect(md).toContain("Migration capability matrix");
    expect(renderMigrationCapabilityMatrixMarkdown()).toContain("Data-preserving");
  });

  it("emits a JSON form with both matrices", () => {
    const json = capabilityMatrixJson();
    expect(json.diff).toBe(DIFF_CAPABILITY_MATRIX);
    expect(json.migration).toBe(MIGRATION_CAPABILITY_MATRIX);
    expect(JSON.parse(JSON.stringify(json)).migration).toHaveLength(7);
  });
});
