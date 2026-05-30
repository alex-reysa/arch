import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Project-rooted access to the .arch test fixtures.
 *
 * Each fixture directory lives under `fixtures/<name>` and contains at least
 * a `backend.arch` source file. The loader exposes typed accessors so test
 * suites in other packages can open fixtures by symbolic id rather than
 * hand-coded path strings.
 *
 * NEW FIXTURE FILES MUST NOT BE ADDED HERE — only loader exports are
 * extended in foundation tasks. Fixture files are owned by other tasks.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

export const FIXTURES_ROOT = resolve(here, "..", "fixtures");

export function fixturePath(name: string): string {
  return resolve(FIXTURES_ROOT, name);
}

export function fixtureFile(name: string, file: string): string {
  return resolve(FIXTURES_ROOT, name, file);
}

export function archFilePath(name: string): string {
  return fixtureFile(name, "backend.arch");
}

export async function readArchFixture(name: string): Promise<string> {
  return readFile(archFilePath(name), "utf8");
}

export type FixtureName =
  | "social-feed-v1"
  | "social-feed-v2-visibility"
  | "invalid-undeclared-integration"
  | "invalid-many-to-many"
  | "invalid-unknown-guarantee"
  | "drift-notification-transaction";

export interface FixtureDescriptor {
  readonly id: FixtureName;
  readonly category: "valid" | "invalid" | "drift";
  readonly summary: string;
}

/**
 * Static descriptors so a test runner or doc generator can iterate the
 * known fixtures without calling readdir(). Mirrors the on-disk layout.
 */
export const FIXTURE_DESCRIPTORS: readonly FixtureDescriptor[] = [
  {
    id: "social-feed-v1",
    category: "valid",
    summary: "Baseline social-feed backend used by parser/IR/diff tests.",
  },
  {
    id: "social-feed-v2-visibility",
    category: "valid",
    summary: "social-feed v1 with a `visibility` field added to Post.",
  },
  {
    id: "invalid-undeclared-integration",
    category: "invalid",
    summary: "References an integration that was never declared.",
  },
  {
    id: "invalid-many-to-many",
    category: "invalid",
    summary: "Encodes an implicit many-to-many relation that V1 rejects.",
  },
  {
    id: "invalid-unknown-guarantee",
    category: "invalid",
    summary: "Uses a short-form guarantee identifier outside the V1 set.",
  },
  {
    id: "drift-notification-transaction",
    category: "drift",
    summary: "Generated workflow file edited by a human; drift detector target.",
  },
];

export const FIXTURES = {
  socialFeedV1: () => fixturePath("social-feed-v1"),
  socialFeedV2Visibility: () => fixturePath("social-feed-v2-visibility"),
  invalidUndeclaredIntegration: () => fixturePath("invalid-undeclared-integration"),
  invalidManyToMany: () => fixturePath("invalid-many-to-many"),
  invalidUnknownGuarantee: () => fixturePath("invalid-unknown-guarantee"),
  driftNotificationTransaction: () => fixturePath("drift-notification-transaction"),
} as const;

export type FixtureKey = keyof typeof FIXTURES;

export function listFixtures(): readonly FixtureDescriptor[] {
  return FIXTURE_DESCRIPTORS;
}

export function findFixture(id: FixtureName): FixtureDescriptor | undefined {
  return FIXTURE_DESCRIPTORS.find((d) => d.id === id);
}
