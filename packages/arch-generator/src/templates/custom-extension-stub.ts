import type { CustomExtensionIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit a human-owned extension stub under src/custom/. Arch writes this
 * file ONCE; subsequent re-applies leave the file untouched.
 */
export function renderCustomExtensionStub(custom: CustomExtensionIR): string {
  const name = pascal(custom.name);
  return [
    "/**",
    ` * Custom extension: ${name}`,
    ` * declared kind: ${custom.customKind}`,
    " *",
    " * This file is human-owned. Arch wrote a stub once; replace the body",
    " * with your implementation.",
    " */",
    `export interface ${name}Extension {`,
    "  invoke(input: unknown): Promise<unknown>;",
    "}",
    "",
    `export const ${name}: ${name}Extension = {`,
    "  async invoke(_input) {",
    "    return { ok: true };",
    "  },",
    "};",
  ].join("\n");
}
