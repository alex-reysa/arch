import { describe, expect, it } from "vitest";

import {
  isThrowawayDatabaseUrl,
  parseDbCheckResult,
  resolveDatabaseUrl,
  runDbCheck,
  withDatabaseCheckLock,
} from "../src/runner/db-check.js";

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

describe("isThrowawayDatabaseUrl", () => {
  it("accepts databases whose name carries a bench/test token", () => {
    for (const url of [
      "postgres://arch:arch@localhost:55432/arch_bench",
      "postgres://localhost/bench",
      "postgres://localhost/app_test",
      "postgres://localhost/test_db",
      "postgres://u:p@h:5432/arch_bench?schema=public",
    ]) {
      expect(isThrowawayDatabaseUrl(url, {}), url).toBe(true);
    }
  });

  it("rejects non-throwaway, empty, and unparseable database names", () => {
    for (const url of [
      "postgres://localhost/prod",
      "postgres://localhost/app",
      "postgres://localhost/main",
      "postgres://localhost/postgres",
      "postgres://localhost/", // empty name
      "not a url",
    ]) {
      expect(isThrowawayDatabaseUrl(url, {}), url).toBe(false);
    }
  });

  it("accepts any database when ARCH_BENCH_DB_ALLOW_ANY=1 is set", () => {
    expect(isThrowawayDatabaseUrl("postgres://localhost/prod", { ARCH_BENCH_DB_ALLOW_ANY: "1" })).toBe(true);
  });
});

describe("runDbCheck URL resolution and guard", () => {
  it("short-circuits to skipped (no spawn) when neither env nor override has a URL", async () => {
    const res = await runDbCheck({ scriptPath: "/nonexistent/db-check.ts", projectDir: "/tmp", env: {} });
    expect(res.status).toBe("skipped");
    expect(res.reason).toMatch(/no DATABASE_URL/i);
  });

  it("refuses a non-throwaway database before spawning (fails, not skipped)", async () => {
    const res = await runDbCheck({
      scriptPath: "/nonexistent/db-check.ts",
      projectDir: "/tmp",
      env: {},
      databaseUrl: "postgres://example/prod_db",
    });
    expect(res.status).toBe("failed");
    expect(res.reason).toMatch(/throwaway/i);
  });
});

describe("withDatabaseCheckLock", () => {
  it("serializes concurrent checks for the same database URL", async () => {
    const url = `postgres://example/arch_bench_${Date.now()}`;
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      [1, 2, 3].map(() =>
        withDatabaseCheckLock(url, async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active--;
        }),
      ),
    );

    expect(maxActive).toBe(1);
  });
});
