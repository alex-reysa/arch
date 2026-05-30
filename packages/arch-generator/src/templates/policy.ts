import type { PolicyIR } from "@arch/ir";
import { camel } from "../naming.js";

/**
 * Emit a typed policy module. V1 supports the well-known `sanitizeHtml`
 * policy specially (because the generated guarantee tests assert script
 * tags and `on*` attributes are stripped). Any other policy gets a
 * pass-through implementation that the human can replace.
 */
export function renderPolicy(policy: PolicyIR): string {
  const name = camel(policy.name);
  if (policy.name.toLowerCase().includes("sanitize") || policy.name.toLowerCase().includes("html")) {
    return [
      `/** Strip <script>...</script> blocks and on* event-handler attributes from input. */`,
      `export function ${name}(input: string): string {`,
      "  let out = input;",
      "  out = out.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, \"\");",
      "  out = out.replace(/<script\\b[^>]*\\/>/gi, \"\");",
      "  out = out.replace(/\\son[a-z]+\\s*=\\s*\"[^\"]*\"/gi, \"\");",
      "  out = out.replace(/\\son[a-z]+\\s*=\\s*'[^']*'/gi, \"\");",
      "  out = out.replace(/\\son[a-z]+\\s*=\\s*[^\\s>]+/gi, \"\");",
      "  out = out.replace(/javascript:/gi, \"\");",
      "  return out;",
      "}",
    ].join("\n");
  }
  return [
    "/** Default policy: identity transform. Replace this body with a real implementation. */",
    `export function ${name}<T>(input: T): T {`,
    "  return input;",
    "}",
  ].join("\n");
}
