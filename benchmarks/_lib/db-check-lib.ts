/**
 * Shared migration data-preservation check for `@arch/bench` migration tasks.
 *
 * Contract (per docs/ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md):
 *   tsx db-check.ts <projectDir>
 * with `DATABASE_URL` / `ARCH_BENCH_DATABASE_URL` in the environment. The
 * script emits a single structured result line the runner parses:
 *
 *   ARCH_DBCHECK_RESULT {"status":"passed","dataPreserved":true,"reason":"..."}
 *
 * What it verifies — a real, executed Postgres check:
 *   1. Connect to Postgres (skipped if no URL / `pg` not installed).
 *   2. Apply ALL generated migrations from <projectDir>/prisma/migrations to a
 *      clean `public` schema, proving the generated DDL actually executes.
 *   3. Judge additive-safety from the generated SQL:
 *        - an `ALTER TABLE ... ADD COLUMN` that is nullable or has a DEFAULT,
 *          with no destructive `DROP TABLE`/table recreate in the evolution,
 *          preserves existing rows  → passed (dataPreserved: true).
 *        - a destructive drop/recreate, or a wholesale regeneration with no
 *          incremental migration, would discard existing rows
 *          → failed (dataPreserved: false).
 *   4. Confirm via information_schema that the added column is present and
 *      nullable-or-defaulted.
 *
 * This is deliberately baseline-agnostic: Arch's additive ALTER passes; a
 * regenerate-from-scratch baseline that drops the table fails — which is the
 * property the benchmark is measuring.
 *
 * NOTE: resets the `public` schema of the target database, so point
 * ARCH_BENCH_DATABASE_URL at a throwaway bench database (never production).
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

type Status = "passed" | "failed" | "skipped" | "not_applicable";

interface Result {
  status: Status;
  dataPreserved?: boolean;
  reason?: string;
}

function emit(result: Result): void {
  process.stdout.write(`ARCH_DBCHECK_RESULT ${JSON.stringify(result)}\n`);
}

function databaseUrl(): string | undefined {
  return process.env["ARCH_BENCH_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? undefined;
}

interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

async function readMigrations(projectDir: string): Promise<MigrationFile[]> {
  const dir = join(projectDir, "prisma", "migrations");
  let entries: string[];
  try {
    entries = (await readdir(dir)).sort();
  } catch {
    return [];
  }
  const files: MigrationFile[] = [];
  for (const name of entries) {
    try {
      files.push({ name, sql: await readFile(join(dir, name, "migration.sql"), "utf8") });
    } catch {
      /* directory without a migration.sql — skip */
    }
  }
  return files;
}

interface AddedColumn {
  readonly table: string;
  readonly column: string;
}

/**
 * Parse `ALTER TABLE "T" ... ADD COLUMN "C" ...` across the evolution
 * migrations. Parsed per-statement (split on `;`) so the table is always the
 * one named in the SAME statement as the ADD COLUMN — never carried across a
 * preceding `ALTER TABLE` that drops a constraint, etc.
 */
function findAddedColumns(migrations: readonly MigrationFile[]): AddedColumn[] {
  const out: AddedColumn[] = [];
  // Skip the first (init) migration: its CREATE TABLEs are the base schema.
  for (const m of migrations.slice(1)) {
    for (const statement of m.sql.split(";")) {
      const tableMatch = /ALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?/i.exec(statement);
      if (!tableMatch) continue;
      const table = tableMatch[1]!;
      const colRe = /ADD\s+COLUMN\s+"?([A-Za-z0-9_]+)"?/gi;
      let col: RegExpExecArray | null;
      while ((col = colRe.exec(statement)) !== null) {
        out.push({ table, column: col[1]! });
      }
    }
  }
  return out;
}

/** Detect a destructive drop/recreate in an evolution (non-init) migration. */
function hasDestructiveEvolution(migrations: readonly MigrationFile[]): boolean {
  return migrations.slice(1).some((m) => /DROP\s+TABLE/i.test(m.sql));
}

export async function runMigrationDataCheck(): Promise<void> {
  const projectDir = process.argv[2];
  if (!projectDir) {
    emit({ status: "skipped", reason: "no projectDir argument" });
    return;
  }
  const url = databaseUrl();
  if (!url) {
    emit({ status: "skipped", reason: "no DATABASE_URL / ARCH_BENCH_DATABASE_URL configured" });
    return;
  }

  const migrations = await readMigrations(projectDir);
  if (migrations.length === 0) {
    emit({ status: "failed", dataPreserved: false, reason: "no generated migrations found in prisma/migrations" });
    return;
  }

  // A migration task that regenerated the project wholesale (single init
  // migration, no incremental ALTER) would not preserve existing rows.
  const added = findAddedColumns(migrations);
  if (hasDestructiveEvolution(migrations)) {
    emit({
      status: "failed",
      dataPreserved: false,
      reason: "evolution migration drops/recreates a table, discarding existing rows",
    });
    return;
  }
  if (added.length === 0) {
    emit({
      status: "failed",
      dataPreserved: false,
      reason:
        migrations.length === 1
          ? "schema regenerated with no incremental migration; existing rows would not be preserved"
          : "no additive ALTER ... ADD COLUMN found in the evolution migration",
    });
    return;
  }

  let pg: typeof import("pg");
  try {
    pg = await import("pg");
  } catch {
    emit({ status: "skipped", reason: "pg module not installed (add `pg` to run migration checks)" });
    return;
  }
  const Client = (pg as { default?: { Client: typeof import("pg").Client }; Client?: typeof import("pg").Client })
    .Client ?? (pg as { default: { Client: typeof import("pg").Client } }).default.Client;
  const client = new Client({ connectionString: url });

  try {
    await client.connect();
    // Isolated, idempotent: reset the schema, then apply the real generated DDL.
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    for (const m of migrations) {
      await client.query(m.sql);
    }

    // Confirm each added column is present and preservation-safe.
    for (const { table, column } of added) {
      const res = await client.query(
        "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
        [table, column],
      );
      if (res.rowCount === 0) {
        emit({ status: "failed", dataPreserved: false, reason: `column ${table}.${column} missing after migration` });
        return;
      }
      const row = res.rows[0] as { is_nullable: string; column_default: string | null };
      const safe = row.is_nullable === "YES" || row.column_default != null;
      if (!safe) {
        emit({
          status: "failed",
          dataPreserved: false,
          reason: `column ${table}.${column} is NOT NULL without a default; existing rows would be orphaned`,
        });
        return;
      }
    }

    const cols = added.map((a) => `${a.table}.${a.column}`).join(", ");
    emit({
      status: "passed",
      dataPreserved: true,
      reason: `additive migration preserves data (${cols}); ${migrations.length} migration(s) applied`,
    });
  } catch (err) {
    emit({
      status: "failed",
      dataPreserved: false,
      reason: `db-check error: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}
