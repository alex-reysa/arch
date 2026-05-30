# Persistence: in-memory default and real Prisma/Postgres

Arch's generated backend runs against an **in-memory store by default** so the
generated test suite is hermetic (no database needed for `pnpm test`), and can
switch to a **real Prisma/Postgres** backend with one environment variable. Both
implement the same `Db` / `Collection<R>` interface, so the calling code
(`src/models/*`, route/workflow handlers, generated tests) is identical either
way.

## The two backends

| Backend | Selected by | File | Used for |
|---|---|---|---|
| In-memory store (Prisma-like API) | default | `src/runtime/db.ts` | hermetic `pnpm test`, fast local dev |
| Prisma/Postgres adapter | `ARCH_DB=prisma` | `src/runtime/db-prisma.ts` | real persistence in production / integration |

The shared contract is `Collection<R>` in `src/runtime/db.ts`:

```ts
export interface Collection<R extends CollectionRow> {
  create(input: Omit<R, "id"> & { id?: string }): Promise<R>;
  findUnique(where: { id: string }): Promise<R | null>;
  findMany(): Promise<R[]>;
  update(where: { id: string }, data: Partial<R>): Promise<R | null>;
  delete(where: { id: string }): Promise<boolean>;
  count(): Promise<number>;
  reset(): void;
}
```

The Prisma adapter (`createPrismaDb`) bridges the small API differences to
`@prisma/client` (e.g. `create(input)` → `create({ data })`,
`findUnique({ id })` → `findUnique({ where: { id } })`, and returning `null`
when a row is absent to match the in-memory contract).

### Why the adapter doesn't import `@prisma/client`

`src/runtime/db-prisma.ts` is decoupled from `@prisma/client` on purpose: it
describes the delegate methods it calls with a structural `PrismaClientLike`
type and never imports the package. That keeps the generated project's
**typecheck hermetic** — it passes without `prisma generate` having run. The
real client is constructed only at startup (`src/server.ts`), behind the
`ARCH_DB=prisma` branch, via a runtime dynamic import.

## Default mode (in-memory)

Nothing to configure. `pnpm test` and `pnpm typecheck` run with no database. The
in-memory store mirrors the Prisma API, and `resetDb()` clears it between tests.

## Real mode (Prisma + Postgres)

The generator emits everything you need:

- `prisma/schema.prisma` — a valid Postgres schema (datasource, enums, models,
  relations, indexes) derived from the IR.
- `prisma/migrations/*` — inspectable migration scaffolds (initial `CREATE TABLE`
  and additive `ALTER TABLE` for field additions).
- `docker-compose.yml` — a Postgres service (and Redis when `cache: redis`).
- `package.json` scripts: `prisma:generate`, `prisma:push`, `prisma:migrate`.

To run the generated backend against a real database:

```sh
# 1. start Postgres (compose, or any Postgres you control)
docker compose up -d postgres
export DATABASE_URL="postgres://arch:arch@localhost:5432/arch_app"

# 2. generate the Prisma client and create the schema
pnpm prisma:generate
pnpm prisma:push          # or: pnpm prisma:migrate  (uses prisma/migrations)

# 3. run the server against Postgres
ARCH_DB=prisma DATABASE_URL="$DATABASE_URL" pnpm start
```

When `ARCH_DB` is unset (or anything other than `prisma`), the server uses the
in-memory store.

> **Migration fidelity caveat.** The emitted `migration.sql` is an inspectable
> scaffold, not the output of `prisma migrate diff`. For production, validate it
> against a real Postgres (`prisma db push` / `prisma migrate`) before relying on
> it. The Prisma **schema** is authoritative; `prisma db push` derives the real
> DDL from it.

## Gated integration test (real Postgres)

A gated test proves create/read through the real adapter end to end:
[`packages/arch-cli/src/__tests__/prisma-postgres.test.ts`](../packages/arch-cli/src/__tests__/prisma-postgres.test.ts).
It generates the SocialFeed project, runs `prisma generate` + `prisma db push`
against a real Postgres, then exercises `createUser → createPost → findPostById`
through `setDb(createPrismaDb(new PrismaClient()))` and asserts the row
round-trips.

It is **skipped unless** both `ARCH_RUN_POSTGRES=1` and `DATABASE_URL` are set:

```sh
docker run --rm -d --name arch-pg \
  -e POSTGRES_USER=arch -e POSTGRES_PASSWORD=arch -e POSTGRES_DB=arch_app \
  -p 5432:5432 postgres:16-alpine

ARCH_RUN_POSTGRES=1 \
DATABASE_URL="postgres://arch:arch@localhost:5432/arch_app" \
pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts
```

A hermetic drop-in proof also runs in the default suite: `db.ts` + `db-prisma.ts`
typecheck together as a valid `Db` with no `@prisma/client`
([`prisma-persistence.test.ts`](../packages/arch-generator/src/templates/__tests__/prisma-persistence.test.ts)).

## What is intentionally not done in V1

- The in-memory store is the **default runtime** so tests stay database-free; the
  real adapter is opt-in, not the default.
- `findMany` has no filtering/pagination, and `reset()` is a no-op on the Prisma
  adapter (clearing tables is a migration/ops concern). These match the narrow V1
  workflow-service target and are documented limitations, not hidden behavior.
