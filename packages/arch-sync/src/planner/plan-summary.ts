/**
 * Render a `SyncPlanV1` (or the legacy `SyncPlan`) as a deterministic
 * Markdown summary. Reviewers and the CLI both consume this surface.
 */

import type { SyncPlan, SyncPlanV1 } from "./plan-schema.js";
import {
  aggregateChangeClass,
  maxSeverity,
} from "../diff/classification.js";

export function summarizePlan(plan: SyncPlan): string {
  const lines: string[] = [];
  lines.push(`# Sync plan ${plan.plan_id}`);
  lines.push(`Plan hash: ${plan.plan_hash}`);
  lines.push("");
  lines.push("## Intent changes");
  for (const c of plan.intent_changes) lines.push(`- ${c.kind}: ${c.description}`);
  lines.push("");
  lines.push("## Affected artifacts");
  for (const a of plan.affected_artifacts) lines.push(`- ${a}`);
  lines.push("");
  lines.push("## Verification obligations");
  for (const v of plan.verification) lines.push(`- ${v.kind}${v.target ? ` (${v.target})` : ""}`);
  if (plan.destructive_changes.length > 0) {
    lines.push("");
    lines.push("## Destructive changes");
    for (const d of plan.destructive_changes) lines.push(`- ${d}`);
  }
  return lines.join("\n") + "\n";
}

export function summarizePlanV1(plan: SyncPlanV1): string {
  const lines: string[] = [];
  lines.push(`# Sync plan ${plan.plan_id}`);
  lines.push("");
  lines.push(`- plan_hash: \`${plan.plan_hash}\``);
  lines.push(`- base_ir_hash: \`${plan.base_ir_hash ?? "<none>"}\``);
  lines.push(`- target_ir_hash: \`${plan.target_ir_hash}\``);
  lines.push(
    `- change_class: \`${aggregateChangeClass(plan.diff.diffs)}\` (severity: \`${maxSeverity(plan.diff.diffs)}\`)`,
  );
  lines.push(`- destructive: ${plan.destructive ? "yes" : "no"}`);
  lines.push(
    `- confirmations_required: ${plan.confirmations_required.length === 0 ? "none" : plan.confirmations_required.join(", ")}`,
  );
  lines.push("");

  lines.push("## Diffs");
  if (plan.diff.diffs.length === 0) {
    lines.push("- (no semantic changes)");
  } else {
    for (const d of plan.diff.diffs) {
      lines.push(
        `- \`${d.type}\` (${d.risk}) — ${d.reason} _[entities: ${d.entity_ids.join(", ") || "—"}]_`,
      );
    }
  }
  lines.push("");

  lines.push("## Affected files");
  for (const a of plan.actions) {
    lines.push(`- ${a.path}`);
  }
  lines.push("");

  lines.push("## Action groups");
  for (const g of plan.action_groups) {
    lines.push(`- **${g.kind}** — ${g.summary}`);
  }
  lines.push("");

  lines.push("## Verification obligations");
  for (const v of plan.verification) {
    lines.push(`- ${v.kind}${v.target ? ` (${v.target})` : ""}`);
  }
  lines.push("");

  lines.push("## Path policy");
  lines.push("### Allowed");
  for (const p of plan.path_policy.allowed) lines.push(`- ${p}`);
  if (plan.path_policy.forbidden.length > 0) {
    lines.push("### Forbidden");
    for (const p of plan.path_policy.forbidden) lines.push(`- ${p}`);
  }
  lines.push("");

  return lines.join("\n");
}
