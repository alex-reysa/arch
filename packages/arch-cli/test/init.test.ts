import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init.js";

async function runInitQuiet(cwd: string): Promise<number> {
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  try {
    return await runInit(["--cwd", cwd]);
  } finally {
    stdoutSpy.mockRestore();
  }
}

describe("arch init", () => {
  it("creates src/custom/README.md", async () => {
    const projectRoot = await mkdtemp(resolve(tmpdir(), "arch-cli-init-"));

    const code = await runInitQuiet(projectRoot);

    expect(code).toBe(0);
    const readme = await readFile(
      resolve(projectRoot, "src/custom/README.md"),
      "utf8",
    );
    expect(readme).toContain("Files in this directory are owned by you.");
  });

  it("does not overwrite an existing src/custom/README.md", async () => {
    const projectRoot = await mkdtemp(resolve(tmpdir(), "arch-cli-init-keep-"));
    const readmePath = resolve(projectRoot, "src/custom/README.md");
    await mkdir(resolve(projectRoot, "src/custom"), { recursive: true });
    await writeFile(readmePath, "keep me\n", "utf8");

    const code = await runInitQuiet(projectRoot);

    expect(code).toBe(0);
    await expect(readFile(readmePath, "utf8")).resolves.toBe("keep me\n");
  });
});
