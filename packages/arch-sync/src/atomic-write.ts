import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, path);
}

export async function atomicWriteText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}
