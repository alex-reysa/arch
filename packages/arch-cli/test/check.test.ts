/**
 * `arch check` integration test — exercises the CLI command end-to-end
 * against a synthetic project root.
 *
 * Acceptance: when an arch-owned generated file is modified outside arch,
 *  - the command exits non-zero,
 *  - it writes `.arch/drift.json` with a `generated_file_modified` entry,
 *  - the report carries the artifact_id and the entity_ids of the source
 *    spec entity.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCheck } from "../src/commands/check.js";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function ensureWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

describe("arch check", () => {
  it("reports drift with artifact_id and entity_ids when a generated file is hand-edited", async () => {
    const tmp = await mkdtemp(resolve(tmpdir(), "arch-cli-check-"));
    const projectRoot = resolve(tmp, "project");
    const metaDir = resolve(projectRoot, ".arch");
    await mkdir(metaDir, { recursive: true });

    const original = "// generated\n";
    const expected = sha256(original);
    const onDisk = "// human edit\n";

    await ensureWrite(
      resolve(projectRoot, "src/generated/models/post.ts"),
      onDisk,
    );
    await writeFile(
      resolve(metaDir, "artifact-map.json"),
      JSON.stringify({
        entries: [
          {
            artifact_id: "artifact:src/generated/models/post.ts",
            path: "src/generated/models/post.ts",
            entity_ids: ["model:Post"],
          },
        ],
      }),
    );
    await writeFile(
      resolve(metaDir, "ownership.json"),
      JSON.stringify({
        entries: [
          {
            artifact_id: "artifact:src/generated/models/post.ts",
            ownership_kind: "generated_file",
            write_scope: "whole_file",
            content_hash: expected,
          },
        ],
      }),
    );

    // Capture stdout/stderr to keep the test runner output clean.
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let code: number;
    try {
      code = await runCheck(["--cwd", projectRoot, "--metadata-dir", metaDir]);
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }

    expect(code).toBe(1);
    const driftJson = JSON.parse(
      await readFile(resolve(metaDir, "drift.json"), "utf8"),
    );
    expect(driftJson.schema_version).toBe("arch.drift.v1");
    expect(driftJson.entries.length).toBe(1);
    const e = driftJson.entries[0];
    expect(e.kind).toBe("generated_file_modified");
    expect(e.artifact_id).toBe("artifact:src/generated/models/post.ts");
    expect(e.entity_ids).toEqual(["model:Post"]);
  });

  it("detects a guarantee_static_pattern violation when a workflow drops its try/catch", async () => {
    const tmp = await mkdtemp(resolve(tmpdir(), "arch-cli-guarantee-"));
    const projectRoot = resolve(tmp, "project");
    const metaDir = resolve(projectRoot, ".arch");
    await mkdir(metaDir, { recursive: true });

    // A spec whose workflow declares the non-rollback guarantee.
    const spec = [
      "target ts.node.fastify.postgres.prisma cache: redis",
      "",
      "model Post {",
      "  id: id",
      "  body: string",
      "}",
      "",
      "integration PushNotifier {",
      "  kind: webhook",
      "  failure: best_effort",
      "}",
      "",
      "workflow CreatePost {",
      "  trigger api POST /posts auth: none",
      "  step validate body",
      "  step insert Post",
      "  step call PushNotifier.send",
      "  guarantee notification_failure_does_not_rollback_post",
      "}",
      "",
    ].join("\n");
    await writeFile(resolve(projectRoot, "backend.arch"), spec, "utf8");

    // A hand-edited workflow that awaits the notification with no try/catch.
    const badWorkflow = [
      "export async function runCreatePost(input: unknown) {",
      "  const inserted = await createPost(input);",
      "  await PushNotifier.send(inserted);",
      "  return { ok: true, value: inserted };",
      "}",
      "",
    ].join("\n");
    await ensureWrite(resolve(projectRoot, "src/workflows/CreatePost.ts"), badWorkflow);

    await writeFile(
      resolve(metaDir, "artifact-map.json"),
      JSON.stringify({
        schema_version: "arch.artifact-map.v1",
        entries: [
          {
            artifact_id: "tmpl.workflow.CreatePost",
            path: "src/workflows/CreatePost.ts",
            entity_ids: ["workflow:CreatePost"],
          },
        ],
      }),
    );
    await writeFile(
      resolve(metaDir, "ownership.json"),
      JSON.stringify({
        entries: [
          {
            artifact_id: "tmpl.workflow.CreatePost",
            ownership_kind: "generated_file",
            write_scope: "whole_file",
            content_hash: sha256(badWorkflow),
          },
        ],
      }),
    );

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let code: number;
    try {
      code = await runCheck(["--cwd", projectRoot, "--metadata-dir", metaDir]);
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }

    expect(code).toBe(1);
    const drift = JSON.parse(await readFile(resolve(metaDir, "drift.json"), "utf8"));
    expect(typeof drift.checked_ir_hash).toBe("string");
    const stat = drift.entries.find((e: { kind: string }) => e.kind === "guarantee_static_pattern");
    expect(stat).toBeTruthy();
    expect(stat.path).toBe("src/workflows/CreatePost.ts");
    expect(stat.message).toMatch(/notification_failure_does_not_rollback_post/);
    // source-map.json was refreshed from the compiled IR.
    expect(existsSync(resolve(metaDir, "source-map.json"))).toBe(true);
  });

  it("exits 0 when there is no drift", async () => {
    const tmp = await mkdtemp(resolve(tmpdir(), "arch-cli-check-clean-"));
    const projectRoot = resolve(tmp, "project");
    const metaDir = resolve(projectRoot, ".arch");
    await mkdir(metaDir, { recursive: true });

    await writeFile(
      resolve(metaDir, "artifact-map.json"),
      JSON.stringify({ entries: [] }),
    );
    await writeFile(
      resolve(metaDir, "ownership.json"),
      JSON.stringify({ entries: [] }),
    );

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let code: number;
    try {
      code = await runCheck(["--cwd", projectRoot, "--metadata-dir", metaDir]);
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
    expect(code).toBe(0);
  });

  it("exits 2 when required metadata is missing", async () => {
    const tmp = await mkdtemp(resolve(tmpdir(), "arch-cli-check-missing-"));
    const projectRoot = resolve(tmp, "project");
    const metaDir = resolve(projectRoot, ".arch");
    await mkdir(metaDir, { recursive: true });

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let code: number;
    try {
      code = await runCheck(["--cwd", projectRoot, "--metadata-dir", metaDir]);
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
    expect(code).toBe(2);
  });

  it("exits 2 when metadata JSON is corrupt", async () => {
    const tmp = await mkdtemp(resolve(tmpdir(), "arch-cli-check-corrupt-"));
    const projectRoot = resolve(tmp, "project");
    const metaDir = resolve(projectRoot, ".arch");
    await mkdir(metaDir, { recursive: true });

    await writeFile(resolve(metaDir, "artifact-map.json"), "{not-json", "utf8");
    await writeFile(
      resolve(metaDir, "ownership.json"),
      JSON.stringify({ entries: [] }),
      "utf8",
    );

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    let code: number;
    try {
      code = await runCheck(["--cwd", projectRoot, "--metadata-dir", metaDir]);
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
    expect(code).toBe(2);
  });
});
