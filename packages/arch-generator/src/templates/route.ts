import type { WorkflowIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit a Fastify route plugin that adapts the HTTP request to the
 * workflow signature and translates failures into HTTP responses.
 */
export function renderRoute(workflow: WorkflowIR): string {
  const cls = pascal(workflow.name);
  const trigger = workflow.trigger;
  const method = trigger.method.toLowerCase();
  return [
    'import type { FastifyInstance } from "fastify";',
    `import { run${cls} } from "../workflows/${cls}.js";`,
    "",
    `export async function register${cls}Route(app: FastifyInstance): Promise<void> {`,
    `  app.${method}("${trigger.path}", async (req, reply) => {`,
    "    const body = req.body ?? {};",
    `    const result = await run${cls}(body, { headers: req.headers as Record<string, string | undefined> });`,
    "    if (!result.ok) {",
    "      reply.code(result.statusCode ?? 400);",
    "      return { ok: false, errors: result.errors };",
    "    }",
    "    reply.code(result.statusCode ?? 201);",
    "    return result.value;",
    "  });",
    "}",
  ].join("\n");
}
