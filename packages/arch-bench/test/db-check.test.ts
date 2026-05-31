import { describe, expect, it } from "vitest";

import { parseDbCheckResult, resolveDatabaseUrl } from "../src/runner/db-check.js";

describe("parseDbCheckResult", () => {
  it("parses a passed result with preservation", () => {
    const r = parseDbCheckResult(
      'seeding...\nARCH_DBCHECK_RESULT {"status":"passed","dataPreserved":true,"reason":"3 rows preserved"}\n',
      0,
    );
    expect(r.status).toBe("passed");
    expect(r.dataPreserved).toBe(true);
    expect(r.reason).toContain("preserved");
  });

  it("parses a failed result", () => {
    const r = parseDbCheckResult('ARCH_DBCHECK_RESULT {"status":"failed","dataPreserved":false,"reason":"x"}', 1);
    expect(r.status).toBe("failed");
    expect(r.dataPreserved).toBe(false);
  });

  it("parses a skipped result", () => {
    const r = parseDbCheckResult('ARCH_DBCHECK_RESULT {"status":"skipped","reason":"no DATABASE_URL"}', 0);
    expect(r.status).toBe("skipped");
  });

  it("uses the LAST sentinel line when multiple are present", () => {
    const r = parseDbCheckResult(
      'ARCH_DBCHECK_RESULT {"status":"skipped"}\nARCH_DBCHECK_RESULT {"status":"passed","dataPreserved":true}',
      0,
    );
    expect(r.status).toBe("passed");
  });

  it("treats a non-zero exit with no sentinel as failed", () => {
    expect(parseDbCheckResult("boom\n", 1).status).toBe("failed");
  });

  it("treats a clean exit with no sentinel as skipped", () => {
    expect(parseDbCheckResult("nothing structured\n", 0).status).toBe("skipped");
  });

  it("treats an unparseable sentinel payload as failed", () => {
    expect(parseDbCheckResult("ARCH_DBCHECK_RESULT {not json}", 0).status).toBe("failed");
  });

  it("rejects an unknown status as failed", () => {
    expect(parseDbCheckResult('ARCH_DBCHECK_RESULT {"status":"weird"}', 0).status).toBe("failed");
  });
});

describe("resolveDatabaseUrl", () => {
  it("prefers ARCH_BENCH_DATABASE_URL over DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ ARCH_BENCH_DATABASE_URL: "a", DATABASE_URL: "b" })).toBe("a");
  });
  it("falls back to DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "b" })).toBe("b");
  });
  it("returns undefined when neither is set", () => {
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});
