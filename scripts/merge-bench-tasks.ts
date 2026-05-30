#!/usr/bin/env tsx
/**
 * Merge per-subject `_tasks.json` files (written by the dataset-authoring
 * workflow) into `benchmarks/manifest.json`, then re-validate the result.
 *
 * For each subject that has a `_tasks.json`, that file REPLACES the subject's
 * tasks in the manifest. Subjects without one keep their existing tasks. After
 * merging, the manifest is structurally validated and every referenced file is
 * existence-checked (via loadManifest), and every spec is compiled.
 *
 *   tsx scripts/merge-bench-tasks.ts [--write]
 *
 * Without --write it is a dry run (prints what would change).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { validateManifest } from "../packages/arch-bench/src/manifest/validate.ts";
import { loadManifest } from "../packages/arch-bench/src/manifest/load.ts";
import { compileSpec } from "../packages/arch-bench/src/runner/compile.ts";
import type { BenchManifest, BenchTask } from "../packages/arch-bench/src/manifest/schema.ts";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const BENCH_DIR = resolve(REPO_ROOT, "benchmarks");
const MANIFEST_PATH = resolve(BENCH_DIR, "manifest.json");
const WRITE = process.argv.includes("--write");

async function main(): Promise<void> {
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as BenchManifest;

const tasksBySubject = new Map<string, BenchTask[]>();
for (const t of manifest.tasks) {
  const list = tasksBySubject.get(t.subject) ?? [];
  list.push(t);
  tasksBySubject.set(t.subject, list);
}

let replaced = 0;
for (const subject of manifest.subjects) {
  const tasksFile = resolve(BENCH_DIR, "subjects", subject.id, "_tasks.json");
  if (!existsSync(tasksFile)) continue;
  const authored = JSON.parse(readFileSync(tasksFile, "utf8")) as BenchTask[];
  if (!Array.isArray(authored) || authored.length === 0) continue;
  tasksBySubject.set(subject.id, authored);
  replaced += 1;
  process.stdout.write(`subject ${subject.id}: ${authored.length} tasks from _tasks.json\n`);
}

const mergedTasks: BenchTask[] = [];
for (const subject of manifest.subjects) {
  const list = (tasksBySubject.get(subject.id) ?? []).slice().sort((a, b) => a.order - b.order);
  mergedTasks.push(...list);
}

const merged: BenchManifest = { ...manifest, tasks: mergedTasks };

// Validate structurally.
const v = validateManifest(merged);
if (!v.ok) {
  process.stderr.write(`manifest invalid after merge:\n  - ${v.errors.join("\n  - ")}\n`);
  process.exit(1);
}

// Compile-check every referenced spec.
let specBad = 0;
const specs = new Set<string>();
for (const s of merged.subjects) specs.add(s.baseSpec);
for (const t of merged.tasks) {
  specs.add(t.fromSpec);
  specs.add(t.toSpec);
}
for (const rel of specs) {
  const abs = resolve(BENCH_DIR, rel);
  if (!existsSync(abs)) {
    process.stderr.write(`MISSING spec: ${rel}\n`);
    specBad += 1;
    continue;
  }
  const r = compileSpec(readFileSync(abs, "utf8"), abs);
  if (!r.ok) {
    process.stderr.write(`SPEC FAILS COMPILE: ${rel}: ${r.diagnostics.map((d) => d.message).join("; ")}\n`);
    specBad += 1;
  }
}

process.stdout.write(
  `\nmerged: ${merged.subjects.length} subjects, ${merged.tasks.length} tasks (${replaced} subjects replaced); spec failures: ${specBad}\n`,
);

if (specBad > 0) {
  process.stderr.write("refusing to write: some specs do not compile\n");
  process.exit(1);
}

if (WRITE) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  // Existence-check everything via the real loader.
  await loadManifest(MANIFEST_PATH);
  process.stdout.write(`wrote ${MANIFEST_PATH} and validated via loadManifest\n`);
} else {
  process.stdout.write("(dry run; pass --write to update manifest.json)\n");
}
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
