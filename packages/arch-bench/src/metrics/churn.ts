/**
 * Churn + off-scope metric collectors. These operate on in-memory file
 * snapshots (path → content), so they are pure and unit-testable without git
 * or a real workspace. The runner produces a {@link FileSnapshot} of the
 * generated project before and after a baseline runs (see `workspace.ts`).
 */

/** A flat view of a project: relative POSIX path → file content. */
export interface FileSnapshot {
  readonly files: ReadonlyMap<string, string>;
}

export function snapshotOf(record: Record<string, string>): FileSnapshot {
  return { files: new Map(Object.entries(record)) };
}

export type ChangeType = "added" | "modified" | "deleted";

export interface FileChange {
  readonly path: string;
  readonly type: ChangeType;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly before: string | null;
  readonly after: string | null;
}

/**
 * Default ignore predicate for churn: install + VCS + Arch run-scratch noise
 * that is not part of the "source code the baseline wrote" signal.
 */
export function defaultIgnore(path: string): boolean {
  return (
    path.startsWith("node_modules/") ||
    path.startsWith(".git/") ||
    path === "pnpm-lock.yaml" ||
    path === "package-lock.json" ||
    path === "yarn.lock" ||
    path.startsWith(".arch/runs/") ||
    path.startsWith(".arch/tmp/") ||
    path.startsWith(".arch/locks/") ||
    path.startsWith(".arch/agent-runs/") ||
    path.startsWith(".arch/repair-history/")
  );
}

/** Number of lines in a file's content (trailing newline does not add a line). */
function lineCount(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n");
  // A trailing newline yields a final empty element we don't count as a line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Length of the longest common subsequence of two line arrays. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  // Rolling 1-D DP to keep it O(m) memory.
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) curr[j] = prev[j - 1]! + 1;
      else curr[j] = Math.max(prev[j]!, curr[j - 1]!);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[m]!;
}

/** Git-style added/removed line counts between two versions of a file. */
export function lineDiff(before: string, after: string): { added: number; removed: number } {
  const a = toLines(before);
  const b = toLines(after);
  const common = lcsLength(a, b);
  return { removed: a.length - common, added: b.length - common };
}

export function diffSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
  ignore: (path: string) => boolean = defaultIgnore,
): FileChange[] {
  const changes: FileChange[] = [];
  const paths = new Set<string>([...before.files.keys(), ...after.files.keys()]);
  for (const path of paths) {
    if (ignore(path)) continue;
    const b = before.files.get(path) ?? null;
    const a = after.files.get(path) ?? null;
    if (b === null && a !== null) {
      changes.push({ path, type: "added", linesAdded: lineCount(a), linesRemoved: 0, before: null, after: a });
    } else if (b !== null && a === null) {
      changes.push({ path, type: "deleted", linesAdded: 0, linesRemoved: lineCount(b), before: b, after: null });
    } else if (b !== null && a !== null && b !== a) {
      const { added, removed } = lineDiff(b, a);
      changes.push({ path, type: "modified", linesAdded: added, linesRemoved: removed, before: b, after: a });
    }
  }
  changes.sort((x, y) => (x.path < y.path ? -1 : 1));
  return changes;
}

export interface ChurnMetrics {
  readonly filesTouched: number;
  readonly changedLoc: number;
  readonly expectedFilesTouched: number;
  readonly offScopeFilesTouched: number;
  readonly humanOwnedViolations: number;
  readonly generatedTestDeletedOrWeakened: boolean;
  readonly touchedPaths: readonly string[];
  readonly offScopePaths: readonly string[];
}

export interface CollectChurnOptions {
  readonly expectedPaths: Iterable<string>;
  /** Glob-ish prefix marking human-owned files. Default: `src/custom/`. */
  readonly humanOwnedPrefix?: string;
}

const TEST_FILE_RE = /(^|\/)tests?\/.*\.test\.(t|j)sx?$/;
const ASSERTION_RE = /\bexpect\s*\(|\bassert\b/g;

function countAssertions(content: string): number {
  const m = content.match(ASSERTION_RE);
  return m ? m.length : 0;
}

/**
 * A touched path is "expected" if it exactly matches an expected entry, or if
 * an expected entry is a directory prefix (ends in `/`) of it. Prefixes let a
 * task declare e.g. `prisma/` and `tests/` as in-scope without enumerating
 * timestamped migration dirs or every regenerated test file.
 */
function isExpected(path: string, expected: ReadonlySet<string>): boolean {
  if (expected.has(path)) return true;
  for (const e of expected) {
    if (e.endsWith("/") && path.startsWith(e)) return true;
  }
  return false;
}

export function collectChurn(changes: readonly FileChange[], opts: CollectChurnOptions): ChurnMetrics {
  const expected = new Set(opts.expectedPaths);
  const humanPrefix = opts.humanOwnedPrefix ?? "src/custom/";

  const touchedPaths: string[] = [];
  const offScopePaths: string[] = [];
  let changedLoc = 0;
  let expectedFilesTouched = 0;
  let humanOwnedViolations = 0;
  let testDeletedOrWeakened = false;

  for (const c of changes) {
    touchedPaths.push(c.path);
    changedLoc += c.linesAdded + c.linesRemoved;

    if (isExpected(c.path, expected)) expectedFilesTouched += 1;
    else offScopePaths.push(c.path);

    if (c.path.startsWith(humanPrefix) && (c.type === "modified" || c.type === "deleted")) {
      humanOwnedViolations += 1;
    }

    if (TEST_FILE_RE.test(c.path)) {
      if (c.type === "deleted") {
        testDeletedOrWeakened = true;
      } else if (c.type === "modified" && c.before !== null && c.after !== null) {
        if (countAssertions(c.after) < countAssertions(c.before)) testDeletedOrWeakened = true;
      }
    }
  }

  return {
    filesTouched: changes.length,
    changedLoc,
    expectedFilesTouched,
    offScopeFilesTouched: offScopePaths.length,
    humanOwnedViolations,
    generatedTestDeletedOrWeakened: testDeletedOrWeakened,
    touchedPaths,
    offScopePaths,
  };
}
