import { describe, expect, it } from "vitest";
import { validateExternalManifest } from "../src/external/validate.js";
import type { ExternalManifest } from "../src/external/schema.js";

function manifest(over: Partial<ExternalManifest> = {}): ExternalManifest {
  return {
    schema_version: "arch.bench.external.v1",
    datasetVersion: "fixture-1",
    fixture: true,
    services: [
      {
        id: "svc-a",
        title: "Service A",
        fixture: true,
        authorship: { author: "team-a", source: "fixture://a", domain: "crm", heldOut: false },
      },
    ],
    evolutions: [
      { id: "svc-a-01", service: "svc-a", order: 1, kind: "additive_field", intent: "add x", fixture: true, externalOutcome: "passed" },
    ],
    ...over,
  };
}

describe("validateExternalManifest", () => {
  it("accepts a well-formed fixture manifest", () => {
    const res = validateExternalManifest(manifest());
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("rejects a wrong schema_version", () => {
    const res = validateExternalManifest(manifest({ schema_version: "nope" as never }));
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/schema_version/);
  });

  it("requires a datasetVersion", () => {
    const res = validateExternalManifest(manifest({ datasetVersion: "" }));
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/datasetVersion/);
  });

  it("requires authorship author/source/domain/heldOut", () => {
    const res = validateExternalManifest(
      manifest({
        services: [
          {
            id: "svc-a",
            title: "Service A",
            fixture: true,
            authorship: { author: "", source: "", domain: "", heldOut: undefined as never },
          },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    const joined = res.errors.join("\n");
    expect(joined).toMatch(/author/);
    expect(joined).toMatch(/source/);
    expect(joined).toMatch(/domain/);
    expect(joined).toMatch(/heldOut/);
  });

  it("rejects an evolution referencing an unknown service", () => {
    const res = validateExternalManifest(
      manifest({
        evolutions: [
          { id: "x-01", service: "ghost", order: 1, kind: "additive_field", intent: "i", fixture: true },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/ghost/);
  });

  it("rejects an unknown evolution kind", () => {
    const res = validateExternalManifest(
      manifest({
        evolutions: [
          { id: "svc-a-01", service: "svc-a", order: 1, kind: "frobnicate" as never, intent: "i", fixture: true },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/kind/);
  });

  it("rejects non-contiguous evolution ordering within a service", () => {
    const res = validateExternalManifest(
      manifest({
        evolutions: [
          { id: "svc-a-01", service: "svc-a", order: 1, kind: "additive_field", intent: "i", fixture: true },
          { id: "svc-a-03", service: "svc-a", order: 3, kind: "additive_field", intent: "i", fixture: true },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/contiguous/);
  });

  it("requires a structured reason for blocked_unsupported_capability", () => {
    const res = validateExternalManifest(
      manifest({
        evolutions: [
          {
            id: "svc-a-01",
            service: "svc-a",
            order: 1,
            kind: "migration_data_preservation",
            intent: "i",
            fixture: true,
            externalOutcome: "blocked_unsupported_capability",
          },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/unsupportedReason/);
  });

  it("rejects a non-fixture entry inside a fixture manifest", () => {
    const res = validateExternalManifest(
      manifest({
        evolutions: [
          { id: "svc-a-01", service: "svc-a", order: 1, kind: "additive_field", intent: "i", fixture: false },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/non-fixture/);
  });
});
