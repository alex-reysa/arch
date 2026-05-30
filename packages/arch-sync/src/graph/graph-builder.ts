/**
 * Build the entity dependency graph from a `CanonicalIR`.
 *
 * Edges run from a depended-on entity to its dependents:
 *   - field   → model
 *   - relation→ source model AND target model
 *   - index   → model
 *   - step    → workflow (and to the integration / model the step touches)
 *   - guarantee → workflow
 *   - workflow→ (no parent — it is the root)
 *
 * The graph is intentionally simple. `artifact-resolution.ts` walks it to
 * compute the set of generated files affected by a diff.
 */

import type { CanonicalIR } from "@arch/ir";
import {
  addEdge,
  addNode,
  freezeGraph,
  newMutableGraph,
  type DependencyGraph,
} from "./dependency-graph.js";

export function buildGraph(ir: CanonicalIR): DependencyGraph {
  const g = newMutableGraph();

  for (const m of ir.models) {
    addNode(g, m.id);
    for (const f of m.fields) {
      addEdge(g, f.id, m.id);
      if (f.relation) {
        addEdge(g, f.relation.id, f.relation.source_model_id);
        addEdge(g, f.relation.id, f.relation.target_model_id);
      }
    }
    for (const idx of m.indexes) {
      addEdge(g, idx.id, m.id);
    }
  }

  for (const w of ir.workflows) {
    addNode(g, w.id);
    for (const s of w.steps) {
      addEdge(g, s.id, w.id);
      const op = s.operation;
      if (op.kind === "insert" || op.kind === "update" || op.kind === "delete") {
        addEdge(g, op.model_id, w.id);
      } else if (op.kind === "call") {
        addEdge(g, op.integration_id, w.id);
      } else if (op.kind === "custom_call") {
        addEdge(g, op.custom_id, w.id);
      } else if (op.kind === "sanitize" && op.policy_id) {
        addEdge(g, op.policy_id, w.id);
      }
    }
    for (const guarantee of w.guarantees) {
      addEdge(g, guarantee.id, w.id);
    }
  }

  for (const ig of ir.integrations) addNode(g, ig.id);
  for (const p of ir.policies) addNode(g, p.id);
  for (const c of ir.customs) addNode(g, c.id);

  return freezeGraph(g);
}
