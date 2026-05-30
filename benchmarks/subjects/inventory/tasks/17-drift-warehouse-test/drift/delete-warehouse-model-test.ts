#!/usr/bin/env tsx
/**
 * Drift injection: delete the generated Warehouse model test. `arch check` must
 * report the missing artifact; `arch repair` must regenerate it byte-for-byte.
 *
 * Usage: tsx delete-warehouse-model-test.ts <projectDir>
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: delete-warehouse-model-test.ts <projectDir>\n");
  process.exit(2);
}
const target = resolve(dir, "tests/models/Warehouse.test.ts");
rmSync(target, { force: true });
process.stdout.write(`drift: deleted ${target}\n`);
