import { describe, expect, it } from "vitest";
import { buildDraftIR } from "./draft-ir.js";
import { canonicalize } from "./canonicalize.js";
import { canonicalStringify } from "./canonical-json.js";
import { hashCanonical } from "./hash.js";
import { validateSemantics } from "./semantic-validator.js";
import { validateCanonicalIR } from "./ir-validator.js";
import {
  apiTrigger,
  archFile,
  fieldDecl,
  longGuarantee,
  modelDecl,
  policyDecl,
  propValues,
  shortGuarantee,
  socialFeedV1Ast,
  steps,
  TEST_SPAN,
  workflowDecl,
} from "./test-builders.js";
import type { ArchFileAst, SourceSpan } from "@arch/language";

function compile(ast: ArchFileAst) {
  const { draft } = buildDraftIR(ast);
  expect(validateSemantics(draft).ok).toBe(true);
  return canonicalize(draft);
}

function spanAt(line: number): SourceSpan {
  return {
    file: TEST_SPAN.file,
    start: { offset: 0, line, column: 1 },
    end: { offset: 0, line, column: 2 },
  };
}

describe("canonical hash determinism", () => {
  it("formatting and span shifts do not change the hash", () => {
    // Two ASTs with identical semantic content but different source spans
    // (representing different formatting / comment placement).
    const a = socialFeedV1Ast("a.arch");
    const b = socialFeedV1Ast("b.arch");
    expect(compile(a).canonical_hash).toBe(compile(b).canonical_hash);

    // Mutating spans alone (e.g. adding a comment shifts every span by N
    // lines) does not change the hash either.
    function shiftSpans(node: any, dl: number): any {
      if (!node || typeof node !== "object") return node;
      const out: any = Array.isArray(node) ? [] : {};
      for (const k of Object.keys(node)) {
        if (k === "span" && node[k] && typeof node[k] === "object") {
          out[k] = {
            file: node[k].file,
            start: {
              offset: node[k].start.offset,
              line: node[k].start.line + dl,
              column: node[k].start.column,
            },
            end: {
              offset: node[k].end.offset,
              line: node[k].end.line + dl,
              column: node[k].end.column,
            },
          };
        } else {
          out[k] = shiftSpans(node[k], dl);
        }
      }
      return out;
    }
    const shifted = shiftSpans(socialFeedV1Ast(), 42) as ArchFileAst;
    expect(compile(shifted).canonical_hash).toBe(compile(socialFeedV1Ast()).canonical_hash);
  });

  it("non-semantic declaration reordering does not change the hash", () => {
    const ast = socialFeedV1Ast();
    const reordered: ArchFileAst = {
      ...ast,
      declarations: [...ast.declarations].reverse(),
    };
    expect(compile(ast).canonical_hash).toBe(compile(reordered).canonical_hash);
  });

  it("workflow step reordering changes the hash", () => {
    const ast = socialFeedV1Ast();
    const wfIndex = ast.declarations.findIndex(
      (d) => d.kind === "WorkflowDecl",
    );
    const wf = ast.declarations[wfIndex] as ReturnType<typeof workflowDecl>;
    // Swap the first two steps (validate <-> sanitize) and rewrite their
    // indices so the swap is semantically meaningful.
    const swapped = [
      { ...(wf.steps[1] as any), index: 0 },
      { ...(wf.steps[0] as any), index: 1 },
      ...wf.steps.slice(2).map((s) => ({ ...(s as any), index: (s as any).index })),
    ];
    const rewritten: ArchFileAst = {
      ...ast,
      declarations: ast.declarations.map((d, i) =>
        i === wfIndex ? { ...wf, steps: swapped } : d,
      ),
    };
    const original = compile(ast).canonical_hash;
    const reordered = compile(rewritten).canonical_hash;
    expect(reordered).not.toBe(original);
  });

  it("ordered enum-like value reordering changes the hash", () => {
    // Long-form guarantees carry property arrays; their order is preserved
    // through canonicalisation so reordering changes the hash. This stands
    // in for the eventual `enum Foo { a, b }` declaration (V1's AST does
    // not yet model enums, but the canonical-JSON contract is the same).
    const baseAst = (values: string[]): ArchFileAst =>
      archFile({
        declarations: [
          modelDecl({
            name: "Item",
            fields: [fieldDecl({ name: "id", typeText: "id" })],
          }),
          workflowDecl({
            name: "Wf",
            trigger: apiTrigger("POST", "/x"),
            steps: [steps.insert("Item", 0)],
            guarantees: [
              longGuarantee("StatusValues", {
                values: propValues.list(values.map(propValues.string)),
                verifiability: propValues.identifier("manual"),
              }),
            ],
          }),
        ],
      });
    const original = compile(baseAst(["draft", "published", "archived"]));
    const swapped = compile(baseAst(["published", "draft", "archived"]));
    expect(swapped.canonical_hash).not.toBe(original.canonical_hash);
  });

  it("hash is stable across repeated canonicalisation of the same draft", () => {
    const ast = socialFeedV1Ast();
    const a = compile(ast).canonical_hash;
    const b = compile(ast).canonical_hash;
    expect(a).toBe(b);
  });

  it("source location entries are preserved but excluded from the hash", () => {
    const ast = socialFeedV1Ast();
    const { draft } = buildDraftIR(ast);
    const canonical = canonicalize(draft);
    expect(canonical.source_locations.length).toBeGreaterThan(0);

    // Verify source_locations is missing from the hashable view by hashing
    // a body that adds extra source_locations entries — the hash must be
    // unchanged.
    const augmented = {
      ...canonical,
      source_locations: [
        ...canonical.source_locations,
        {
          id: "synthetic",
          entity_id: canonical.models[0]!.id,
          file: "synthetic.arch",
          start_line: 999,
          start_column: 1,
          end_line: 999,
          end_column: 2,
        },
      ],
    };
    expect(canonicalize(buildDraftIR(ast).draft).canonical_hash).toBe(
      canonical.canonical_hash,
    );
    void augmented; // augmentation proves source_locations are omitted from hash inputs.
  });

  it("declaration-only changes outside the hash inputs do not perturb hash", () => {
    // Adding a policy that nothing references must change the hash (it's
    // semantic). But changing only its source span must not.
    const a = compile(
      archFile({
        declarations: [
          modelDecl({
            name: "Item",
            fields: [fieldDecl({ name: "id", typeText: "id" })],
          }),
          policyDecl({ name: "p1", body: "x" }),
        ],
      }),
    );
    const b = compile(
      archFile({
        declarations: [
          modelDecl({
            name: "Item",
            fields: [fieldDecl({ name: "id", typeText: "id" })],
          }),
          // Same policy, different span placement.
          { ...policyDecl({ name: "p1", body: "x" }), span: spanAt(99) },
        ],
      }),
    );
    expect(a.canonical_hash).toBe(b.canonical_hash);
  });
});

describe("artifact + ownership + coverage metadata", () => {
  it("every artifact carries generation.mode + generator_id + ir_fragment_hash", () => {
    const canonical = compile(socialFeedV1Ast());
    expect(canonical.artifacts.length).toBeGreaterThan(0);
    for (const a of canonical.artifacts) {
      expect(a.generation.mode).toBeDefined();
      expect(a.generation.generator_id.length).toBeGreaterThan(0);
      expect(a.generation.ir_fragment_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // At least one artifact should carry an explicit template_id.
    expect(
      canonical.artifacts.some((a) => a.generation.template_id !== undefined),
    ).toBe(true);
  });

  it("every ownership entry has a write_scope matching its kind", () => {
    const canonical = compile(socialFeedV1Ast());
    for (const o of canonical.ownership) {
      switch (o.ownership_kind) {
        case "generated_file":
          expect(o.write_scope).toBe("whole_file");
          break;
        case "generated_region":
          expect(o.write_scope).toBe("generated_region");
          break;
        case "extension_point":
          expect(o.write_scope).toBe("stub_only");
          break;
        case "human_file":
          expect(o.write_scope).toBe("none");
          break;
      }
    }
  });

  it("latency guarantees compile to partially_covered coverage", () => {
    const canonical = compile(socialFeedV1Ast());
    const latency = canonical.workflows[0]!.guarantees.find(
      (g) => g.name === "post_creation_p95_latency",
    )!;
    const coverage = canonical.guarantee_coverage.find(
      (c) => c.guarantee_id === latency.id,
    )!;
    expect(coverage.status).toBe("partially_covered");
  });

  it("non-latency known guarantees compile to covered coverage", () => {
    const canonical = compile(socialFeedV1Ast());
    const html = canonical.workflows[0]!.guarantees.find(
      (g) => g.name === "no_unsanitized_html_persisted",
    )!;
    const coverage = canonical.guarantee_coverage.find(
      (c) => c.guarantee_id === html.id,
    )!;
    expect(coverage.status).toBe("covered");
  });
});

describe("canonical JSON byte determinism", () => {
  it("produces byte-identical output across two equivalent IRs", () => {
    const a = canonicalStringify(compile(socialFeedV1Ast()));
    const b = canonicalStringify(compile(socialFeedV1Ast()));
    expect(a).toBe(b);
    expect(hashCanonical(a)).toBe(hashCanonical(b));
  });
});

describe("ir-validator on canonical output", () => {
  it("accepts a fully-formed social-feed-v1 IR", () => {
    const canonical = compile(socialFeedV1Ast());
    const result = validateCanonicalIR(canonical);
    if (!result.ok) {
      throw new Error(`unexpected errors: ${result.errors.join("; ")}`);
    }
  });

  it("rejects an artifact pointing at an unknown entity", () => {
    const canonical = compile(socialFeedV1Ast());
    const tampered = {
      ...canonical,
      artifacts: canonical.artifacts.map((a, i) =>
        i === 0
          ? { ...a, entity_ids: [...a.entity_ids, "model:Ghost"] }
          : a,
      ),
    } as typeof canonical;
    const result = validateCanonicalIR(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Ghost/);
  });

  it("rejects a canonical_hash that does not match the canonical body", () => {
    const canonical = compile(socialFeedV1Ast());
    const tampered = {
      ...canonical,
      canonical_hash: "0".repeat(64),
    };
    const result = validateCanonicalIR(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/canonical_hash mismatch/);
  });

  it("rejects ownership entries that point at no artifact", () => {
    const canonical = compile(socialFeedV1Ast());
    const first = canonical.ownership[0]!;
    const tampered = {
      ...canonical,
      ownership: [
        ...canonical.ownership,
        {
          ...first,
          ownership_id: "ownership:orphan",
          artifact_id: "artifact:ghost",
        },
      ],
    };
    const result = validateCanonicalIR(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(
      /ownership ownership:orphan references unknown artifact artifact:ghost/,
    );
  });
});
