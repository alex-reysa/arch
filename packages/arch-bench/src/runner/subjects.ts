import type { BenchManifest, BenchSubject } from "../manifest/schema.js";

/** Resolve the subjects to run, optionally filtered to an explicit subset. */
export function loadManifestSubjects(
  manifest: BenchManifest,
  subjectIds?: readonly string[],
): BenchSubject[] {
  if (!subjectIds || subjectIds.length === 0) return [...manifest.subjects];
  const wanted = new Set(subjectIds);
  return manifest.subjects.filter((s) => wanted.has(s.id));
}
