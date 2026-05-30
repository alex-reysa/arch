import type { IntegrationIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit a typed adapter stub for the declared integration. The generated
 * stub exposes a no-op default implementation so workflows compile and
 * tests pass; humans replace these bodies post-generation. Stub-only
 * write_scope is enforced at the apply layer.
 */
export function renderIntegrationStub(integration: IntegrationIR): string {
  const name = pascal(integration.name);
  const failure = (integration.properties["failure"] as string | undefined) ?? "best_effort";
  const kind = (integration.properties["kind"] as string | undefined) ?? "unknown";
  return [
    "/**",
    ` * Integration: ${name}`,
    ` * kind: ${kind}`,
    ` * failure: ${failure}`,
    " *",
    " * Replace these no-op bodies with real adapter calls. The workflow",
    " * orchestrator catches exceptions thrown after persistence so",
    " * failures of `failure: best_effort` integrations never roll back.",
    " */",
    `export const ${name} = {`,
    "  async update(_payload: unknown): Promise<void> {",
    "    // TODO: implement",
    "  },",
    "  async send(_payload: unknown): Promise<void> {",
    "    // TODO: implement",
    "  },",
    "  async invalidate(_key: string): Promise<void> {",
    "    // TODO: implement",
    "  },",
    "};",
    "",
    `export type ${name}Adapter = typeof ${name};`,
  ].join("\n");
}
