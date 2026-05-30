/**
 * Structural validation for a {@link BenchManifest}. Pure — operates on an
 * already-parsed object and performs no filesystem I/O, so it is fast and
 * unit-testable. On-disk existence of referenced spec/oracle files is the
 * loader's concern (see `load.ts`).
 */

import {
  BASELINE_IDS,
  BENCH_MANIFEST_SCHEMA_VERSION,
  EXPECTED_OUTCOMES,
  TASK_KINDS,
  type BaselineId,
  type BenchManifest,
  type ExpectedOutcome,
  type TaskKind,
} from "./schema.js";

export interface ManifestValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateManifest(manifest: BenchManifest): ManifestValidation {
  const errors: string[] = [];

  if (manifest.schema_version !== BENCH_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be "${BENCH_MANIFEST_SCHEMA_VERSION}", got ${JSON.stringify(manifest.schema_version)}`,
    );
  }

  // Baselines must all be known.
  const baselineSet = new Set<string>(BASELINE_IDS);
  for (const b of manifest.baselines ?? []) {
    if (!baselineSet.has(b)) errors.push(`unknown baseline: ${JSON.stringify(b as BaselineId)}`);
  }
  if (!manifest.baselines || manifest.baselines.length === 0) {
    errors.push("manifest declares no baselines");
  }

  // Subjects.
  const subjectIds = new Set<string>();
  for (const s of manifest.subjects ?? []) {
    if (!s.id) errors.push("subject is missing an id");
    if (subjectIds.has(s.id)) errors.push(`duplicate subject id: ${s.id}`);
    subjectIds.add(s.id);
    if (!s.baseSpec) errors.push(`subject ${s.id} is missing baseSpec`);
  }

  // Tasks.
  const taskIds = new Set<string>();
  const kindSet = new Set<TaskKind>(TASK_KINDS);
  const outcomeSet = new Set<ExpectedOutcome>(EXPECTED_OUTCOMES);
  const ordersBySubject = new Map<string, number[]>();

  for (const t of manifest.tasks ?? []) {
    const where = t.id ? `task ${t.id}` : "task (missing id)";
    if (!t.id) errors.push("task is missing an id");
    else if (taskIds.has(t.id)) errors.push(`duplicate task id: ${t.id}`);
    taskIds.add(t.id);

    if (!t.subject) errors.push(`${where} is missing subject`);
    else if (!subjectIds.has(t.subject)) errors.push(`${where} references unknown subject: ${t.subject}`);

    if (!kindSet.has(t.kind)) errors.push(`${where} has unknown kind: ${JSON.stringify(t.kind)}`);
    if (!outcomeSet.has(t.expectedOutcome)) {
      errors.push(`${where} has unknown expectedOutcome: ${JSON.stringify(t.expectedOutcome)}`);
    }

    if (!t.fromSpec) errors.push(`${where} is missing fromSpec`);
    if (!t.toSpec) errors.push(`${where} is missing toSpec`);

    if (typeof t.order !== "number" || !Number.isInteger(t.order) || t.order < 1) {
      errors.push(`${where} has invalid order: ${JSON.stringify(t.order)}`);
    } else if (t.subject) {
      const list = ordersBySubject.get(t.subject) ?? [];
      list.push(t.order);
      ordersBySubject.set(t.subject, list);
    }

    // human_owned_edit tasks that declare a seed must give it a path + content.
    if (t.humanOwnedSeed && (!t.humanOwnedSeed.path || typeof t.humanOwnedSeed.content !== "string")) {
      errors.push(`${where} humanOwnedSeed must have a path and string content`);
    }
  }

  // Per-subject ordering must be a contiguous 1..N with no duplicates.
  for (const [subject, orders] of ordersBySubject) {
    const sorted = [...orders].sort((a, b) => a - b);
    const seen = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      const value = sorted[i]!;
      if (seen.has(value)) {
        errors.push(`subject ${subject} has duplicate task order: ${value}`);
      }
      seen.add(value);
      if (value !== i + 1) {
        errors.push(`subject ${subject} task order is not contiguous from 1; expected ${i + 1}, found ${value}`);
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
