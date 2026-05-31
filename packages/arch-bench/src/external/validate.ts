/**
 * Structural validation for an {@link ExternalManifest}. Pure — no filesystem
 * I/O (the loader checks on-disk spec existence). Validates external metadata:
 * authorship/source/domain/heldOut, dataset version, evolution kinds/ordering,
 * and the integrity of any declared external outcome (an unsupported-capability
 * block must carry a structured diff type + reason).
 */

import {
  EXTERNAL_MANIFEST_SCHEMA_VERSION,
  isExpectedOutcome,
  isExternalOutcome,
  isTaskKind,
  isUnsupportedDiffType,
  type ExternalManifest,
} from "./schema.js";

export interface ExternalValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateExternalManifest(manifest: ExternalManifest): ExternalValidation {
  const errors: string[] = [];

  if (manifest.schema_version !== EXTERNAL_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be "${EXTERNAL_MANIFEST_SCHEMA_VERSION}", got ${JSON.stringify(manifest.schema_version)}`,
    );
  }
  if (!manifest.datasetVersion || typeof manifest.datasetVersion !== "string") {
    errors.push("manifest is missing a datasetVersion string");
  }
  if (typeof manifest.fixture !== "boolean") {
    errors.push("manifest must declare a boolean `fixture` flag");
  }

  // Services.
  const serviceIds = new Set<string>();
  for (const s of manifest.services ?? []) {
    const where = s.id ? `service ${s.id}` : "service (missing id)";
    if (!s.id) errors.push("service is missing an id");
    else if (serviceIds.has(s.id)) errors.push(`duplicate service id: ${s.id}`);
    serviceIds.add(s.id);
    if (!s.title) errors.push(`${where} is missing a title`);
    if (typeof s.fixture !== "boolean") errors.push(`${where} must declare a boolean fixture flag`);
    const a = s.authorship;
    if (!a) errors.push(`${where} is missing authorship metadata`);
    else {
      if (!a.author) errors.push(`${where} authorship.author is required`);
      if (!a.source) errors.push(`${where} authorship.source is required`);
      if (!a.domain) errors.push(`${where} authorship.domain is required`);
      if (typeof a.heldOut !== "boolean") errors.push(`${where} authorship.heldOut must be a boolean`);
    }
    // A fixture dataset must not carry non-fixture entries that could leak into claims.
    if (manifest.fixture && s.fixture === false) {
      errors.push(`${where} is non-fixture inside a fixture manifest`);
    }
  }

  // Evolutions.
  const evolutionIds = new Set<string>();
  const ordersByService = new Map<string, number[]>();
  for (const e of manifest.evolutions ?? []) {
    const where = e.id ? `evolution ${e.id}` : "evolution (missing id)";
    if (!e.id) errors.push("evolution is missing an id");
    else if (evolutionIds.has(e.id)) errors.push(`duplicate evolution id: ${e.id}`);
    evolutionIds.add(e.id);

    if (!e.service) errors.push(`${where} is missing service`);
    else if (!serviceIds.has(e.service)) errors.push(`${where} references unknown service: ${e.service}`);

    if (!e.intent) errors.push(`${where} is missing intent`);
    if (!isTaskKind(e.kind)) errors.push(`${where} has unknown kind: ${JSON.stringify(e.kind)}`);
    if (typeof e.fixture !== "boolean") errors.push(`${where} must declare a boolean fixture flag`);
    if (manifest.fixture && e.fixture === false) {
      errors.push(`${where} is non-fixture inside a fixture manifest`);
    }

    if (typeof e.order !== "number" || !Number.isInteger(e.order) || e.order < 1) {
      errors.push(`${where} has invalid order: ${JSON.stringify(e.order)}`);
    } else if (e.service) {
      const list = ordersByService.get(e.service) ?? [];
      list.push(e.order);
      ordersByService.set(e.service, list);
    }

    if (e.expectedOutcome !== undefined && !isExpectedOutcome(e.expectedOutcome)) {
      errors.push(`${where} has unknown expectedOutcome: ${JSON.stringify(e.expectedOutcome)}`);
    }
    if (e.externalOutcome !== undefined && !isExternalOutcome(e.externalOutcome)) {
      errors.push(`${where} has unknown externalOutcome: ${JSON.stringify(e.externalOutcome)}`);
    }
    // An unsupported-capability block is a first-class result: it must say why.
    if (e.externalOutcome === "blocked_unsupported_capability") {
      if (!e.unsupportedReason) {
        errors.push(`${where} is blocked_unsupported_capability but has no unsupportedReason`);
      } else if (!isUnsupportedDiffType(e.unsupportedReason.code)) {
        errors.push(`${where} unsupportedReason.code is not a known unsupported diff type`);
      }
    }
    if (e.unsupportedDiffType !== undefined && !isUnsupportedDiffType(e.unsupportedDiffType)) {
      errors.push(`${where} has unknown unsupportedDiffType: ${JSON.stringify(e.unsupportedDiffType)}`);
    }
  }

  // Per-service ordering must be a contiguous 1..N with no duplicates.
  for (const [service, orders] of ordersByService) {
    const sorted = [...orders].sort((a, b) => a - b);
    const seen = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      const value = sorted[i]!;
      if (seen.has(value)) errors.push(`service ${service} has duplicate evolution order: ${value}`);
      seen.add(value);
      if (value !== i + 1) {
        errors.push(`service ${service} evolution order is not contiguous from 1; expected ${i + 1}, found ${value}`);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
