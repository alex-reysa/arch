#!/usr/bin/env tsx
/**
 * Drift injection: delete a generated model test. `arch check` must report the
 * missing artifact; `arch repair` must regenerate it byte-for-byte.
 *
 * Usage: tsx delete-vendor-model-test.ts <projectDir>
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: delete-vendor-model-test.ts <projectDir>\n");
  process.exit(2);
}
const target = resolve(dir, "tests/models/Vendor.test.ts");
rmSync(target, { force: true });
process.stdout.write(`drift: deleted ${target}\n`);
