import { describe, it, expect } from "vitest";
import { diffSnapshots, collectChurn, snapshotOf } from "../src/metrics/churn.js";

describe("diffSnapshots", () => {
  it("classifies added, modified, and deleted files", () => {
    const before = snapshotOf({ "a.ts": "x\n", "b.ts": "1\n2\n" });
    const after = snapshotOf({ "a.ts": "x\n", "b.ts": "1\n2 changed\n", "c.ts": "new\n" });
    const changes = diffSnapshots(before, after);
    const byPath = new Map(changes.map((c) => [c.path, c]));
    expect(byPath.has("a.ts")).toBe(false); // unchanged → not a change
    expect(byPath.get("b.ts")?.type).toBe("modified");
    expect(byPath.get("c.ts")?.type).toBe("added");
  });

  it("counts deleted files", () => {
    const before = snapshotOf({ "gone.ts": "1\n2\n3\n" });
    const after = snapshotOf({});
    const changes = diffSnapshots(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.type).toBe("deleted");
    expect(changes[0]?.linesRemoved).toBe(3);
    expect(changes[0]?.linesAdded).toBe(0);
  });

  it("computes git-style added/removed LOC for a modified file", () => {
    // before: [a,b,c] ; after: [a,X,c,d] — LCS = [a,c] (len 2)
    const before = snapshotOf({ "f.ts": "a\nb\nc\n" });
    const after = snapshotOf({ "f.ts": "a\nX\nc\nd\n" });
    const changes = diffSnapshots(before, after);
    const f = changes.find((c) => c.path === "f.ts")!;
    expect(f.linesRemoved).toBe(1); // b removed
    expect(f.linesAdded).toBe(2); // X and d added
  });

  it("honors the ignore predicate", () => {
    const before = snapshotOf({ "src/a.ts": "1\n" });
    const after = snapshotOf({ "src/a.ts": "2\n", "node_modules/dep/index.js": "junk\n" });
    const changes = diffSnapshots(before, after, (p) => p.startsWith("node_modules/"));
    expect(changes.map((c) => c.path)).toEqual(["src/a.ts"]);
  });
});

describe("collectChurn", () => {
  it("counts touched files and total changed LOC", () => {
    const before = snapshotOf({ "src/models/Post.ts": "a\nb\n" });
    const after = snapshotOf({ "src/models/Post.ts": "a\nb\nc\n", "src/routes/CreatePost.ts": "new\n" });
    const churn = collectChurn(diffSnapshots(before, after), { expectedPaths: ["src/models/Post.ts"] });
    expect(churn.filesTouched).toBe(2);
    expect(churn.changedLoc).toBe(2); // +c (1) and the new route file (1 line)
  });

  it("separates expected from off-scope touched files", () => {
    const before = snapshotOf({ "src/models/Post.ts": "a\n", "src/runtime/db.ts": "x\n" });
    const after = snapshotOf({ "src/models/Post.ts": "a2\n", "src/runtime/db.ts": "x2\n", "src/server.ts": "s\n" });
    const churn = collectChurn(diffSnapshots(before, after), {
      expectedPaths: ["src/models/Post.ts"],
    });
    expect(churn.expectedFilesTouched).toBe(1);
    expect(churn.offScopeFilesTouched).toBe(2);
    expect(churn.offScopePaths.sort()).toEqual(["src/runtime/db.ts", "src/server.ts"]);
  });

  it("treats an expected directory prefix (ending in /) as in-scope", () => {
    const before = snapshotOf({ "src/models/Post.ts": "a\n" });
    const after = snapshotOf({
      "src/models/Post.ts": "a2\n",
      "tests/models/Post.test.ts": "expect(1).toBe(1)\n",
      "prisma/migrations/20260101_x/migration.sql": "ALTER TABLE;\n",
    });
    const churn = collectChurn(diffSnapshots(before, after), {
      expectedPaths: ["src/models/Post.ts", "tests/", "prisma/"],
    });
    expect(churn.expectedFilesTouched).toBe(3);
    expect(churn.offScopeFilesTouched).toBe(0);
  });

  it("flags human-owned violations when a seeded src/custom file is modified or deleted", () => {
    const before = snapshotOf({ "src/custom/MyHandler.ts": "human code\n", "src/custom/Other.ts": "keep\n" });
    const after = snapshotOf({ "src/custom/MyHandler.ts": "CLOBBERED\n" }); // Other.ts deleted, MyHandler modified
    const churn = collectChurn(diffSnapshots(before, after), { expectedPaths: [] });
    expect(churn.humanOwnedViolations).toBe(2);
  });

  it("does not flag a human-owned violation when src/custom is untouched", () => {
    const before = snapshotOf({ "src/custom/MyHandler.ts": "human code\n", "src/models/Post.ts": "a\n" });
    const after = snapshotOf({ "src/custom/MyHandler.ts": "human code\n", "src/models/Post.ts": "a2\n" });
    const churn = collectChurn(diffSnapshots(before, after), { expectedPaths: ["src/models/Post.ts"] });
    expect(churn.humanOwnedViolations).toBe(0);
  });

  it("detects a deleted generated test", () => {
    const before = snapshotOf({ "tests/models/Post.test.ts": "expect(1).toBe(1)\n" });
    const after = snapshotOf({});
    const churn = collectChurn(diffSnapshots(before, after), { expectedPaths: [] });
    expect(churn.generatedTestDeletedOrWeakened).toBe(true);
  });

  it("detects a weakened generated test (fewer assertions)", () => {
    const before = snapshotOf({
      "tests/models/Post.test.ts": "expect(a).toBe(1)\nexpect(b).toBe(2)\nexpect(c).toBe(3)\n",
    });
    const after = snapshotOf({ "tests/models/Post.test.ts": "expect(a).toBe(1)\n" });
    const churn = collectChurn(diffSnapshots(before, after), { expectedPaths: [] });
    expect(churn.generatedTestDeletedOrWeakened).toBe(true);
  });

  it("does not flag a test that gained assertions", () => {
    const before = snapshotOf({ "tests/models/Post.test.ts": "expect(a).toBe(1)\n" });
    const after = snapshotOf({ "tests/models/Post.test.ts": "expect(a).toBe(1)\nexpect(b).toBe(2)\n" });
    const churn = collectChurn(diffSnapshots(before, after), { expectedPaths: ["tests/models/Post.test.ts"] });
    expect(churn.generatedTestDeletedOrWeakened).toBe(false);
  });
});
