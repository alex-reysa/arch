import type { CanonicalIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit `src/runtime/db-prisma.ts`: a real Prisma/Postgres adapter that
 * implements the SAME `Db`/`Collection<R>` interface as the in-memory store.
 *
 * Design constraints:
 *   - It NEVER imports `@prisma/client` at type-check time. The real client is
 *     injected at startup, so this file compiles without `prisma generate`
 *     having run — keeping the hermetic typecheck path green. The structural
 *     `PrismaClientLike` type captures exactly the delegate methods we call.
 *   - It bridges the small API differences between the in-memory store and
 *     Prisma: `create(input)` → `create({ data })`, `findUnique({ id })` →
 *     `findUnique({ where: { id } })`, `update({ id }, data)` →
 *     `update({ where: { id }, data })` (returning `null` when the row is
 *     absent, matching the in-memory contract), and `delete(...)` → `boolean`.
 */
export function renderRuntimeDbPrisma(ir: CanonicalIR): string {
  const rowTypes = ir.models.map((m) => `${pascal(m.name)}Row`);
  const importList = ["Db", "Collection", "CollectionRow", ...rowTypes].join(", ");

  const delegateFields = ir.models.length
    ? ir.models
        .map((m) => `  ${pascal(m.name).toLowerCase()}: PrismaDelegateLike<${pascal(m.name)}Row>;`)
        .join("\n")
    : "  /* no models */";

  const collectionFields = ir.models.length
    ? ir.models
        .map(
          (m) =>
            `    ${pascal(m.name).toLowerCase()}: prismaCollection<${pascal(m.name)}Row>(client.${pascal(m.name).toLowerCase()}),`,
        )
        .join("\n")
    : "";

  return [
    `import type { ${importList} } from "./db.js";`,
    "",
    "/**",
    " * Structural shape of the Prisma model delegates this adapter calls. The",
    " * real `PrismaClient` is assignable to this; we never import",
    " * `@prisma/client` here so the file typechecks without `prisma generate`.",
    " */",
    "export interface PrismaDelegateLike<R extends CollectionRow> {",
    "  create(args: { data: Omit<R, \"id\"> & { id?: string } }): Promise<R>;",
    "  findUnique(args: { where: { id: string } }): Promise<R | null>;",
    "  findMany(args?: unknown): Promise<R[]>;",
    "  update(args: { where: { id: string }; data: Partial<R> }): Promise<R>;",
    "  delete(args: { where: { id: string } }): Promise<unknown>;",
    "  count(args?: unknown): Promise<number>;",
    "}",
    "",
    "export interface PrismaClientLike {",
    delegateFields,
    "  $disconnect?(): Promise<void>;",
    "}",
    "",
    "function prismaCollection<R extends CollectionRow>(delegate: PrismaDelegateLike<R>): Collection<R> {",
    "  return {",
    "    async create(input) {",
    "      return delegate.create({ data: input });",
    "    },",
    "    async findUnique(where) {",
    "      return delegate.findUnique({ where: { id: where.id } });",
    "    },",
    "    async findMany() {",
    "      return delegate.findMany();",
    "    },",
    "    async update(where, data) {",
    "      try {",
    "        return await delegate.update({ where: { id: where.id }, data });",
    "      } catch {",
    "        // In-memory contract returns null when the row is absent; Prisma throws.",
    "        return null;",
    "      }",
    "    },",
    "    async delete(where) {",
    "      try {",
    "        await delegate.delete({ where: { id: where.id } });",
    "        return true;",
    "      } catch {",
    "        return false;",
    "      }",
    "    },",
    "    async count() {",
    "      return delegate.count();",
    "    },",
    "    reset() {",
    "      // Production tables are managed by Prisma migrations; clearing data is",
    "      // a migration/ops concern, not a runtime one.",
    "    },",
    "  };",
    "}",
    "",
    "/**",
    " * Build a `Db` backed by a Prisma client. Pass `new PrismaClient()` (loaded",
    " * at startup) — its delegates satisfy `PrismaClientLike` structurally.",
    " */",
    "export function createPrismaDb(client: PrismaClientLike): Db {",
    "  return {",
    collectionFields,
    "  };",
    "}",
  ].join("\n");
}
