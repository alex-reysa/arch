/**
 * Project an {@link ExternalManifest} onto the internal {@link BenchManifest}
 * shape so the existing suite orchestrator can *run* externally authored
 * evolutions unchanged. Only evolutions with real `fromSpec`/`toSpec` (and
 * services with a `baseSpec`) are runnable; representation-only fixtures throw a
 * clear error rather than silently producing empty runs.
 */

import {
  BENCH_MANIFEST_SCHEMA_VERSION,
  type BaselineId,
  type BenchManifest,
  type BenchSubject,
  type BenchTask,
} from "../manifest/schema.js";
import type { ExternalManifest, ExternalService } from "./schema.js";

export interface ProjectOptions {
  /** Baselines for the projected manifest (default: deterministic Arch only). */
  readonly baselines?: readonly BaselineId[];
}

export class ExternalNotRunnableError extends Error {}

export function projectExternalToBenchManifest(
  external: ExternalManifest,
  opts: ProjectOptions = {},
): BenchManifest {
  const services = new Map<string, ExternalService>();
  for (const s of external.services) services.set(s.id, s);

  const subjects: BenchSubject[] = external.services.map((s) => {
    if (!s.baseSpec) {
      throw new ExternalNotRunnableError(
        `external service ${s.id} has no baseSpec; it is representation-only and cannot be run`,
      );
    }
    return { id: s.id, title: s.title, baseSpec: s.baseSpec };
  });

  const tasks: BenchTask[] = external.evolutions.map((e) => {
    if (!e.fromSpec || !e.toSpec) {
      throw new ExternalNotRunnableError(
        `external evolution ${e.id} has no fromSpec/toSpec; it is representation-only and cannot be run`,
      );
    }
    return {
      id: e.id,
      subject: e.service,
      order: e.order,
      kind: e.kind,
      fromSpec: e.fromSpec,
      toSpec: e.toSpec,
      intent: e.intent,
      expectedDiffTypes: [],
      expectedAffectedPaths: [],
      expectedOutcome: e.expectedOutcome ?? "apply_passes",
      oracleTests: [],
      driftScripts: [],
    };
  });

  return {
    schema_version: BENCH_MANIFEST_SCHEMA_VERSION,
    baselines: opts.baselines ? [...opts.baselines] : ["arch-typed-sync"],
    subjects,
    tasks,
  };
}
