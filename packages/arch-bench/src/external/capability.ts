/**
 * Capability matrices: what spec diffs and migration changes Arch can currently
 * synchronize, with structured supported/blocked reasons and suggested next
 * steps (roadmap Phase 3). This is an honest capability MAP, not a claim of
 * completeness — entries are grounded in the IR shape (`@arch/ir`) and the
 * roadmap's "external failure → product response" table. Real external
 * validation will refine which gaps matter; until then this documents the
 * current boundary.
 */

export type CapabilitySupport = "supported" | "partial" | "blocked" | "unsupported";

export interface CapabilityEntry {
  /** The spec-level diff family. */
  readonly diff: string;
  readonly support: CapabilitySupport;
  /** Structured reason for the support level. */
  readonly reason: string;
  readonly suggestedNextSteps?: readonly string[];
}

/**
 * - `supported`   : Arch syncs it under a typed, bounded diff today.
 * - `partial`     : works in a constrained form; caveats below.
 * - `blocked`     : Arch refuses by design (correct, explicit), e.g. destructive.
 * - `unsupported` : a genuine capability gap — not expressible/handled yet.
 */
export const DIFF_CAPABILITY_MATRIX: readonly CapabilityEntry[] = [
  {
    diff: "model_field_added (required, with default)",
    support: "supported",
    reason:
      "Additive field with a default regenerates model/validator/migration; existing rows backfill from the default. Proven by the additive-migration dbCheck.",
  },
  {
    diff: "model_field_added (nullable / optional)",
    support: "unsupported",
    reason:
      "The surface grammar has no nullable/optional modifier — every field is required. (The IR carries `nullable`, but the parser cannot express it.)",
    suggestedNextSteps: ["add nullable/optional grammar + parser support", "generate a null-default migration path"],
  },
  {
    diff: "enum field added / enum value added (default + indexed)",
    support: "supported",
    reason: "Enums are first-class; adding an enum field or value regenerates validators and an additive migration.",
  },
  {
    diff: "model_index_added / model_index_removed (field `indexed`)",
    support: "supported",
    reason: "A field-level `indexed` modifier produces a model index; add/drop regenerates Prisma schema + a non-destructive migration.",
  },
  {
    diff: "relation_added (model-ref field)",
    support: "partial",
    reason:
      "A model-ref field generates the FK relation + migration; safe when the FK is defaulted/backfillable, but a required FK over existing rows is not data-preserving.",
    suggestedNextSteps: ["model relation additions as additive + backfill", "require an explicit backfill for required FKs"],
  },
  {
    diff: "relation_cardinality_change (e.g. one_to_many ↔ many_to_one)",
    support: "unsupported",
    reason: "Changing relation cardinality requires data-migration semantics that are not implemented.",
    suggestedNextSteps: ["add a migration capability for cardinality change", "split into additive relation + backfill + deprecation"],
  },
  {
    diff: "field_rename",
    support: "unsupported",
    reason: "No `renamedFrom` metadata, so a rename is seen as drop + add (destructive) rather than a rename migration.",
    suggestedNextSteps: ["add `renamedFrom` metadata to the grammar/IR", "emit a rename migration instead of drop+add"],
  },
  {
    diff: "field type narrowing / widening",
    support: "unsupported",
    reason: "Type changes are not modeled as a safe migration; narrowing risks truncation/data loss and widening has no migration path.",
    suggestedNextSteps: ["add a typed migration capability for widening", "block narrowing unless an explicit cast/backfill is provided"],
  },
  {
    diff: "model_field_removed (destructive)",
    support: "blocked",
    reason: "Destructive and data-losing; correctly refused without explicit confirmation or a migration plan.",
    suggestedNextSteps: ["require explicit confirmation + a deprecation/backfill plan to allow removal"],
  },
  {
    diff: "workflow_step_added / reordered (named steps)",
    support: "supported",
    reason: "Named-step identity (`step:<Workflow>.<name>`) makes insertion/reorder a bounded, stable diff.",
  },
  {
    diff: "workflow_step_added (positional / unnamed into a validating workflow)",
    support: "partial",
    reason:
      "Positional step ids reindex and the generator can emit a duplicate `const validation` block; use named steps for stable insertion.",
    suggestedNextSteps: ["author workflow edits with named steps", "uniquify generated step locals for unnamed steps"],
  },
  {
    diff: "guarantee_added (behavioral, oracle-backed)",
    support: "supported",
    reason: "Declared in the IR and covered by an independent behavioral oracle.",
  },
  {
    diff: "guarantee_added (latency / p95)",
    support: "partial",
    reason:
      "Declared in the IR with a traceable scaffold, but there is no behavioral/load oracle; classified `declared_but_not_behaviorally_verified` and excluded from correctness claims.",
    suggestedNextSteps: ["add a real load/benchmark oracle if latency is to become a behavioral claim"],
  },
  {
    diff: "custom behavior (policy/hook/integration with implemented_by)",
    support: "partial",
    reason: "`src/custom/**` is preserved (ownership `none`), but typed extension-point contracts/stubs are not yet generated.",
    suggestedNextSteps: ["generate typed extension-point interfaces/stubs", "verify human implementations compile + are imported"],
  },
  {
    diff: "query / read endpoint",
    support: "unsupported",
    reason: "V1 scope is command workflows; query endpoints are not modeled.",
    suggestedNextSteps: ["decide whether V1 scope expands to query endpoints or blocks them honestly"],
  },
  {
    diff: "target stack / cache change",
    support: "unsupported",
    reason: "Only the default `ts.node.fastify.postgres.prisma` stack (redis/none cache) is supported; alternate stacks are out of scope.",
    suggestedNextSteps: ["decide whether additional stacks are in product scope"],
  },
];

export type MigrationDataPreserving = "yes" | "no" | "conditional" | "n/a";

export interface MigrationCapabilityEntry {
  /** The migration change class (roadmap Phase 3 list). */
  readonly change: string;
  readonly support: CapabilitySupport;
  readonly dataPreserving: MigrationDataPreserving;
  readonly reason: string;
  readonly suggestedNextSteps?: readonly string[];
}

export const MIGRATION_CAPABILITY_MATRIX: readonly MigrationCapabilityEntry[] = [
  {
    change: "Additive nullable",
    support: "unsupported",
    dataPreserving: "n/a",
    reason: "Not expressible: the surface grammar has no nullable/optional modifier.",
    suggestedNextSteps: ["add nullable/optional grammar"],
  },
  {
    change: "Additive required with default",
    support: "supported",
    dataPreserving: "yes",
    reason: "`ALTER TABLE ... ADD COLUMN ... DEFAULT`; existing rows backfill. Verified by the real Postgres dbCheck.",
  },
  {
    change: "Index add / drop",
    support: "supported",
    dataPreserving: "yes",
    reason: "`CREATE INDEX` / `DROP INDEX`; non-destructive to rows.",
  },
  {
    change: "Rename with explicit metadata",
    support: "unsupported",
    dataPreserving: "n/a",
    reason: "No `renamedFrom` metadata; a rename degrades to drop + add.",
    suggestedNextSteps: ["add `renamedFrom` metadata + rename migration"],
  },
  {
    change: "Destructive removal",
    support: "blocked",
    dataPreserving: "no",
    reason: "Refused without explicit confirmation; would drop a column and its data.",
    suggestedNextSteps: ["require confirmation + deprecation/backfill plan"],
  },
  {
    change: "Relation change",
    support: "unsupported",
    dataPreserving: "n/a",
    reason: "Cardinality / relation evolution requires migration semantics not implemented.",
    suggestedNextSteps: ["add a relation-change migration capability"],
  },
  {
    change: "Type narrowing / widening",
    support: "unsupported",
    dataPreserving: "conditional",
    reason: "No safe type-change migration; narrowing risks truncation, widening lacks a migration path.",
    suggestedNextSteps: ["add a typed widening migration", "block narrowing without an explicit cast/backfill"],
  },
];

export interface CapabilityMatrixJson {
  readonly diff: readonly CapabilityEntry[];
  readonly migration: readonly MigrationCapabilityEntry[];
}

export function capabilityMatrixJson(): CapabilityMatrixJson {
  return { diff: DIFF_CAPABILITY_MATRIX, migration: MIGRATION_CAPABILITY_MATRIX };
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function renderDiffCapabilityMatrixMarkdown(): string {
  const header = "| Diff | Support | Reason | Suggested next steps |";
  const sep = "| --- | --- | --- | --- |";
  const rows = DIFF_CAPABILITY_MATRIX.map((e) =>
    `| ${mdCell(e.diff)} | ${e.support} | ${mdCell(e.reason)} | ${mdCell((e.suggestedNextSteps ?? []).join("; ") || "—")} |`,
  );
  return ["### Diff capability matrix", "", header, sep, ...rows, ""].join("\n");
}

export function renderMigrationCapabilityMatrixMarkdown(): string {
  const header = "| Migration change | Support | Data-preserving | Reason | Suggested next steps |";
  const sep = "| --- | --- | --- | --- | --- |";
  const rows = MIGRATION_CAPABILITY_MATRIX.map((e) =>
    `| ${mdCell(e.change)} | ${e.support} | ${e.dataPreserving} | ${mdCell(e.reason)} | ${mdCell((e.suggestedNextSteps ?? []).join("; ") || "—")} |`,
  );
  return ["### Migration capability matrix", "", header, sep, ...rows, ""].join("\n");
}

export function renderCapabilityMatrixMarkdown(): string {
  return [
    "# Arch capability matrix",
    "",
    "What Arch can currently synchronize, with structured reasons. This is the",
    "current boundary, refined by external validation — not a completeness claim.",
    "",
    renderDiffCapabilityMatrixMarkdown(),
    renderMigrationCapabilityMatrixMarkdown(),
  ].join("\n").replace(/\n+$/, "\n");
}
