import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReports } from "../reports.js";

describe("writeReports", () => {
  it("writes compatibility report names and verification-report aliases", async () => {
    const runDir = await mkdtemp(resolve(tmpdir(), "arch-report-"));

    await writeReports(runDir, {
      run_id: "run-test",
      passed: true,
      steps: [{ name: "typecheck", passed: true, durationMs: 12 }],
    });

    const reportJson = await readFile(resolve(runDir, "report.json"), "utf8");
    const aliasJson = await readFile(
      resolve(runDir, "verification-report.json"),
      "utf8",
    );
    const reportMd = await readFile(resolve(runDir, "report.md"), "utf8");
    const aliasMd = await readFile(
      resolve(runDir, "verification-report.md"),
      "utf8",
    );

    expect(aliasJson).toBe(reportJson);
    expect(aliasMd).toBe(reportMd);
    expect(JSON.parse(reportJson).run_id).toBe("run-test");
  });
});
