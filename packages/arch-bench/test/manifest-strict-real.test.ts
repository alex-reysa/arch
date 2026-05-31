import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadManifest } from "../src/manifest/load.js";
import { validateManifestStrict } from "../src/manifest/validate.js";

// The committed benchmark manifest must pass STRICT validation: every
// apply_passes task has an oracle (or dbCheck for migration tasks) and every
// guarantee_change task has a behavioral oracle or a verifier-backed
// guaranteeAssertion. This is the disk-level mirror of
// `arch-bench validate --strict` exiting 0.
describe("real benchmarks manifest", () => {
  it("passes strict validation (oracles/assertions wired for every claimed task)", async () => {
    const manifestPath = fileURLToPath(new URL("../../../benchmarks/manifest.json", import.meta.url));
    const loaded = await loadManifest(manifestPath);
    const res = validateManifestStrict(loaded.manifest);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});
