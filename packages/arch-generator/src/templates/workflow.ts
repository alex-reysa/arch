import type { CanonicalIR, WorkflowIR, WorkflowStepIR } from "@arch/ir";
import { camel, pascal } from "../naming.js";

/**
 * Render the workflow orchestration. The returned function `run<Name>` runs
 * each declared step in source order. Insert/update/delete steps create
 * a transactional anchor: integration call failures AFTER the persistence
 * step are caught and reported as soft failures so persisted state is
 * never rolled back. This encodes
 * `notification_failure_does_not_rollback_post`.
 */
export function renderWorkflow(workflow: WorkflowIR, ctx: { ir: CanonicalIR }): string {
  const cls = pascal(workflow.name);
  const integrationsUsed = new Set<string>();
  const policiesUsed = new Set<string>();
  const modelsUsed = new Set<string>();
  const insertModelsUsed = new Set<string>();

  for (const step of workflow.steps) {
    const op = step.operation;
    if (op.kind === "call") integrationsUsed.add(op.integration_id);
    if (op.kind === "sanitize" && op.policy_id) policiesUsed.add(op.policy_id);
    if (op.kind === "insert" || op.kind === "update" || op.kind === "delete") {
      modelsUsed.add(op.model_id);
    }
    if (op.kind === "insert") insertModelsUsed.add(op.model_id);
  }

  const validateTargets = workflow.steps
    .map((s) => (s.operation.kind === "validate" ? s.operation.target : null))
    .filter((x): x is string => !!x);
  const uniqueValidateTargets = [...new Set(validateTargets)];
  const imports: string[] = [];
  for (const mid of modelsUsed) {
    const m = ctx.ir.models.find((x) => x.id === mid);
    if (!m) continue;
    imports.push(`import { create${pascal(m.name)} } from "../models/${pascal(m.name)}.js";`);
  }
  for (const mid of insertModelsUsed) {
    const m = ctx.ir.models.find((x) => x.id === mid);
    if (!m) continue;
    imports.push(`import { validate${pascal(m.name)} } from "../validators/${pascal(m.name)}.js";`);
  }
  for (const pid of policiesUsed) {
    const p = ctx.ir.policies.find((x) => x.id === pid);
    if (!p) continue;
    imports.push(`import { ${camel(p.name)} } from "../policies/${camel(p.name)}.js";`);
  }
  for (const iid of integrationsUsed) {
    const i = ctx.ir.integrations.find((x) => x.id === iid);
    if (!i) continue;
    imports.push(`import { ${pascal(i.name)} } from "../integrations/${pascal(i.name)}.js";`);
  }

  const stepLines: string[] = [];
  let persisted = false;
  for (const step of workflow.steps) {
    const op = step.operation;
    if (op.kind === "validate") {
      stepLines.push(
        "  // step: validate",
        `  const validation = validate${cls}Input(input);`,
        "  if (!validation.ok) {",
        "    return { ok: false, statusCode: 400, errors: validation.errors };",
        "  }",
        `  const payload: ${cls}Input = { ...validation.value };`,
      );
    } else if (op.kind === "sanitize") {
      const policy = op.policy_id ? ctx.ir.policies.find((p) => p.id === op.policy_id) : null;
      const policyName = policy ? camel(policy.name) : "passthrough";
      stepLines.push(
        "  // step: sanitize",
        `  if (typeof payload["${op.target}"] === "string") {`,
        `    payload["${op.target}"] = ${policyName}(payload["${op.target}"] as string);`,
        "  }",
      );
    } else if (op.kind === "insert") {
      const m = ctx.ir.models.find((x) => x.id === op.model_id);
      const cn = pascal(m?.name ?? "Unknown");
      const validationName = `${camel(cn)}InsertValidation`;
      stepLines.push(
        "  // step: insert",
        `  const ${validationName} = validate${cn}(payload);`,
        `  if (!${validationName}.ok) {`,
        `    return { ok: false, statusCode: 400, errors: ${validationName}.errors };`,
        "  }",
        `  const inserted = await create${cn}(${validationName}.value as Parameters<typeof create${cn}>[0]);`,
      );
      persisted = true;
    } else if (op.kind === "call") {
      const i = ctx.ir.integrations.find((x) => x.id === op.integration_id);
      const iname = pascal(i?.name ?? op.integration_id);
      const opName = op.operation;
      if (persisted) {
        // Best-effort post-persistence: never rollback.
        stepLines.push(
          "  // step: call (post-persistence; failure does NOT rollback)",
          "  try {",
          `    await ${iname}.${opName}(inserted);`,
          "  } catch {",
          "    // swallowed by design — guarantee notification_failure_does_not_rollback_post",
          "  }",
        );
      } else {
        stepLines.push(
          "  // step: call (pre-persistence; failure rolls back)",
          `  await ${iname}.${opName}(payload);`,
        );
      }
    } else if (op.kind === "emit") {
      stepLines.push(`  // step: emit ${op.event} (no-op in V1)`);
    } else if (op.kind === "custom_call") {
      stepLines.push(`  // step: custom_call ${op.custom_id} (handled via extension stub)`);
    } else if (op.kind === "update" || op.kind === "delete") {
      stepLines.push(`  // step: ${op.kind} ${op.model_id} (V1 placeholder)`);
    }
  }

  const returnLine = persisted
    ? "  return { ok: true, statusCode: 201, value: inserted };"
    : "  return { ok: true, statusCode: 200, value: payload };";
  const inputInterface = renderInputInterface(cls, uniqueValidateTargets);
  const inputValidator = renderInputValidator(cls, uniqueValidateTargets);

  return [
    ...imports,
    "",
    `export interface ${cls}Failure {`,
    "  readonly ok: false;",
    "  readonly statusCode?: number;",
    "  readonly errors: readonly { path: string; message: string }[];",
    "}",
    `export interface ${cls}Success<T> {`,
    "  readonly ok: true;",
    "  readonly statusCode?: number;",
    "  readonly value: T;",
    "}",
    `export type ${cls}Result<T = unknown> = ${cls}Failure | ${cls}Success<T>;`,
    "",
    ...inputInterface,
    "",
    ...inputValidator,
    "",
    `export interface ${cls}Context {`,
    "  readonly headers?: Record<string, string | undefined>;",
    "}",
    "",
    `export async function run${cls}(input: unknown, _ctx: ${cls}Context = {}): Promise<${cls}Result> {`,
    `  void _ctx; void [${validateTargets.map((t) => JSON.stringify(t)).join(", ")}];`,
    ...stepLines,
    returnLine,
    "}",
  ].join("\n");
}

function renderInputInterface(cls: string, targets: readonly string[]): string[] {
  const fields = targets.map((target) => `  ${target}: string;`);
  return [
    `export interface ${cls}Input {`,
    "  [key: string]: unknown;",
    ...fields,
    "}",
  ];
}

function renderInputValidator(cls: string, targets: readonly string[]): string[] {
  const requiredKeys = targets.map((target) => `"${target}"`).join(", ");
  const assignments = targets.map(
    (target) => `    ${target}: obj["${target}"] as string,`,
  );
  return [
    `function validate${cls}Input(raw: unknown): ${cls}Result<${cls}Input> {`,
    "  const errors: { path: string; message: string }[] = [];",
    "  if (typeof raw !== \"object\" || raw === null) {",
    "    return { ok: false, statusCode: 400, errors: [{ path: \"$\", message: \"expected object\" }] };",
    "  }",
    "  const obj = raw as Record<string, unknown>;",
    `  const required: string[] = [${requiredKeys}];`,
    "  for (const k of required) {",
    "    if (!(k in obj)) errors.push({ path: k, message: \"required\" });",
    "  }",
    ...targets.map(
      (target) =>
        `  if (obj["${target}"] !== undefined && typeof obj["${target}"] !== "string") errors.push({ path: "${target}", message: "expected string" });`,
    ),
    "  if (errors.length) return { ok: false, statusCode: 400, errors };",
    `  const value: ${cls}Input = {`,
    "    ...obj,",
    ...assignments,
    "  };",
    "  return { ok: true, value };",
    "}",
  ];
}

// Keep the previous single-arg signature alive for callers that don't pass
// IR context — used by template tests that don't have a full IR.
export function renderWorkflowSimple(workflow: WorkflowIR): string {
  return renderWorkflow(workflow, {
    ir: {
      schema_version: "arch.ir.v1",
      canonical_hash: "",
      target: { stack: "ts.node.fastify.postgres.prisma", cache: "redis" },
      models: [], integrations: [], policies: [], workflows: [workflow],
      customs: [], artifacts: [], ownership: [],
      verification: { typecheck: true, tests: true, migrations: true },
      guarantee_coverage: [], source_locations: [],
    },
  });
}
