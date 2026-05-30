/**
 * Lightweight directed-graph of entity → entity dependencies.
 *
 * Edges run from a depended-on entity toward its dependents: changing a
 * field fans out to its model, the model's routes/validators, and the
 * workflows that reference the model. The graph is intentionally simple —
 * artifact resolution is layered on top in `artifact-resolution.ts`.
 */

export interface DependencyGraph {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface MutableDependencyGraph {
  readonly nodes: Set<string>;
  readonly edges: Map<string, Set<string>>;
}

export function emptyGraph(): DependencyGraph {
  return { nodes: new Set(), edges: new Map() };
}

export function newMutableGraph(): MutableDependencyGraph {
  return { nodes: new Set<string>(), edges: new Map<string, Set<string>>() };
}

export function addNode(g: MutableDependencyGraph, id: string): void {
  g.nodes.add(id);
  if (!g.edges.has(id)) g.edges.set(id, new Set<string>());
}

export function addEdge(
  g: MutableDependencyGraph,
  from: string,
  to: string,
): void {
  addNode(g, from);
  addNode(g, to);
  g.edges.get(from)!.add(to);
}

export function freezeGraph(g: MutableDependencyGraph): DependencyGraph {
  const edges = new Map<string, ReadonlySet<string>>();
  for (const [k, v] of g.edges) edges.set(k, new Set(v));
  return { nodes: new Set(g.nodes), edges };
}

/** Reachable descendants (transitive closure) from `root`. Excludes `root`. */
export function descendants(graph: DependencyGraph, root: string): ReadonlySet<string> {
  const out = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const next = stack.pop()!;
    const edges = graph.edges.get(next);
    if (!edges) continue;
    for (const t of edges) {
      if (out.has(t)) continue;
      out.add(t);
      stack.push(t);
    }
  }
  return out;
}

/** Like `descendants`, but additionally returns the seed itself. */
export function closure(
  graph: DependencyGraph,
  seeds: readonly string[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const s of seeds) {
    out.add(s);
    for (const d of descendants(graph, s)) out.add(d);
  }
  return out;
}
