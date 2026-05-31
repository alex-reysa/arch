export interface EntityIdContext {
  readonly modelName?: string;
  readonly workflowName?: string;
}

export function modelId(name: string): string {
  return `model:${name}`;
}

export function fieldId(modelName: string, fieldName: string): string {
  return `field:${modelName}.${fieldName}`;
}

export function workflowId(name: string): string {
  return `workflow:${name}`;
}

export function workflowStepId(workflowName: string, index: number, op: string): string {
  return `step:${workflowName}.${index}.${op}`;
}

/**
 * Stable entity id for a named workflow step (`step <name>: <kind> ...`).
 * Independent of the step's position, so insertion/reorder does not change it.
 */
export function namedWorkflowStepId(workflowName: string, name: string): string {
  return `step:${workflowName}.${name}`;
}

export function integrationId(name: string): string {
  return `integration:${name}`;
}

export function policyId(name: string): string {
  return `policy:${name}`;
}

export function customId(name: string): string {
  return `custom:${name}`;
}

export function guaranteeId(workflowName: string, name: string): string {
  return `guarantee:${workflowName}.${name}`;
}
