import { DiagnosticBag } from "@arch/language";
import type { Diagnostic, SourceSpan } from "@arch/language";
import type { DraftIR } from "./draft-ir.js";
import { classifyShortGuarantee, RESERVED_CUSTOM_KINDS } from "./draft-ir.js";

export interface SemanticValidationResult {
  readonly diagnostics: DiagnosticBag;
  readonly ok: boolean;
}

/**
 * Stable diagnostic codes emitted by `validateSemantics`. Tests pin against
 * these codes; renaming them is a contract break for downstream consumers.
 */
export const SEM_CODES = {
  MISSING_PRIMARY_KEY: "ARCH-SEM-001",
  UNDECLARED_MODEL: "ARCH-SEM-002",
  UNDECLARED_INTEGRATION: "ARCH-SEM-003",
  UNDECLARED_CUSTOM: "ARCH-SEM-004",
  UNSUPPORTED_MANY_TO_MANY: "ARCH-SEM-005",
  SCHEDULE_TRIGGER: "ARCH-SEM-006",
  MANUAL_TRIGGER: "ARCH-SEM-007",
  UNKNOWN_TRIGGER: "ARCH-SEM-008",
  UNSUPPORTED_STEP: "ARCH-SEM-009",
  UNKNOWN_SHORT_GUARANTEE: "ARCH-SEM-010",
  UNSUPPORTED_LONG_GUARANTEE: "ARCH-SEM-011",
  RESERVED_CUSTOM_KIND: "ARCH-SEM-012",
  NAMED_INDEX: "ARCH-SEM-013",
  COMPOSITE_INDEX: "ARCH-SEM-014",
  INVALID_DEFAULT: "ARCH-SEM-015",
  RESERVED_DECLARATION: "ARCH-SEM-016",
  UNDECLARED_POLICY: "ARCH-SEM-017",
  UNKNOWN_FIELD_MODIFIER: "ARCH-SEM-018",
  RESERVED_FIELD_MODIFIER: "ARCH-SEM-019",
  UNSUPPORTED_TARGET_STACK: "ARCH-SEM-020",
  UNSUPPORTED_TARGET_CACHE: "ARCH-SEM-021",
  DUPLICATE_STEP_NAME: "ARCH-SEM-022",
} as const;

/**
 * Rejects unsupported V1 constructs before canonical IR is emitted.
 *
 * Error severity codes block normal apply.
 */
export function validateSemantics(draft: DraftIR): SemanticValidationResult {
  const diagnostics = new DiagnosticBag();

  validateTarget(draft, diagnostics);
  validateModels(draft, diagnostics);
  validateFieldModifiers(draft, diagnostics);
  validateReservedSyntax(draft, diagnostics);
  validateTriggers(draft, diagnostics);
  validateSteps(draft, diagnostics);
  validateUnresolvedReferences(draft, diagnostics);
  validateCustoms(draft, diagnostics);
  validateGuarantees(draft, diagnostics);
  validateDefaults(draft, diagnostics);

  return { diagnostics, ok: !diagnostics.hasErrors() };
}

// -------------------------------------------------------------------------
// Validators
// -------------------------------------------------------------------------

function validateTarget(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const issue of draft._targetIssues) {
    if (issue.kind === "unsupported_stack") {
      diagnostics.add(
        err(
          SEM_CODES.UNSUPPORTED_TARGET_STACK,
          `unsupported target stack \`${issue.value}\``,
          issue.span,
          "V1 supports only `ts.node.fastify.postgres.prisma`",
        ),
      );
    } else {
      diagnostics.add(
        err(
          SEM_CODES.UNSUPPORTED_TARGET_CACHE,
          `unsupported target cache \`${issue.value}\``,
          issue.span,
          "V1 supports only `cache: redis` or `cache: none`; omitted cache defaults to redis",
        ),
      );
    }
  }
}

function validateModels(draft: DraftIR, diagnostics: DiagnosticBag): void {
  // Many-to-many: dedup by ordered model pair so we emit one diagnostic per pair.
  const seenPairs = new Set<string>();
  for (const note of draft._modelNotes) {
    if (note.kind === "missing_primary_key") {
      diagnostics.add(
        err(
          SEM_CODES.MISSING_PRIMARY_KEY,
          `model ${note.modelName} has no primary key field of type \`id\``,
          note.span,
          "every model must declare exactly one primary key field of type `id`",
        ),
      );
    } else if (note.kind === "many_to_many") {
      const partner = note.partnerModel ?? "";
      const key = [note.modelName, partner].sort().join("::");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      diagnostics.add(
        err(
          SEM_CODES.UNSUPPORTED_MANY_TO_MANY,
          `unsupported many-to-many relation between ${note.modelName} and ${partner}`,
          note.span,
          "V1 only supports many-to-one relations expressed as direct foreign keys; declare an explicit join model",
        ),
      );
    }
  }
}

function validateFieldModifiers(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const issue of draft._fieldModifierIssues) {
    if (issue.kind === "reserved") {
      diagnostics.add(
        err(
          SEM_CODES.RESERVED_FIELD_MODIFIER,
          `unsupported reserved field modifier \`${issue.modifierText}\` on ${issue.modelName}.${issue.fieldName}`,
          issue.span,
          "V1 supports field-level `indexed`/`index` and `default`; this modifier is reserved for post-V1",
        ),
      );
    } else {
      diagnostics.add(
        err(
          SEM_CODES.UNKNOWN_FIELD_MODIFIER,
          `unknown field modifier \`${issue.modifierText}\` on ${issue.modelName}.${issue.fieldName}`,
          issue.span,
          "remove the modifier or use a supported field modifier",
        ),
      );
    }
  }
}

function validateReservedSyntax(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const node of draft._reservedSyntax) {
    switch (node.kind) {
      case "ReservedIndexDecl": {
        const code =
          node.form === "named" ? SEM_CODES.NAMED_INDEX : SEM_CODES.COMPOSITE_INDEX;
        const message =
          node.form === "named"
            ? `named source index ${node.name ?? "<anonymous>"} is reserved for post-V1`
            : `composite source index over ${node.fields.join(", ")} is reserved for post-V1`;
        diagnostics.add(
          err(
            code,
            message,
            node.span,
            "V1 supports only field-level `indexed` modifiers",
          ),
        );
        break;
      }
      case "ReservedScheduleTrigger": {
        diagnostics.add(
          err(
            SEM_CODES.SCHEDULE_TRIGGER,
            "schedule triggers are reserved for post-V1",
            node.span,
            "V1 supports only `trigger api ...` triggers",
          ),
        );
        break;
      }
      case "ReservedManualTrigger": {
        diagnostics.add(
          err(
            SEM_CODES.MANUAL_TRIGGER,
            "manual triggers are reserved for post-V1",
            node.span,
            "V1 supports only `trigger api ...` triggers",
          ),
        );
        break;
      }
      case "ReservedCustomKind": {
        diagnostics.add(
          err(
            SEM_CODES.RESERVED_CUSTOM_KIND,
            `custom kind \`${node.customKind}\` is reserved for post-V1`,
            node.span,
            "remove the declaration or pick a supported kind",
          ),
        );
        break;
      }
      case "ReservedDeclaration": {
        diagnostics.add(
          err(
            SEM_CODES.RESERVED_DECLARATION,
            `reserved declaration: ${node.text}`,
            node.span,
            "this construct is reserved for post-V1",
          ),
        );
        break;
      }
    }
  }
}

function validateTriggers(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const note of draft._triggerNotes) {
    switch (note.kind) {
      case "schedule":
        diagnostics.add(
          err(
            SEM_CODES.SCHEDULE_TRIGGER,
            "schedule triggers are reserved for post-V1",
            note.span,
            "V1 supports only `trigger api ...` triggers",
          ),
        );
        break;
      case "manual":
        diagnostics.add(
          err(
            SEM_CODES.MANUAL_TRIGGER,
            "manual triggers are reserved for post-V1",
            note.span,
            "V1 supports only `trigger api ...` triggers",
          ),
        );
        break;
      case "unknown":
        diagnostics.add(
          err(
            SEM_CODES.UNKNOWN_TRIGGER,
            `unrecognised trigger: ${note.text ?? ""}`,
            note.span,
            "V1 supports only `trigger api ...` triggers",
          ),
        );
        break;
    }
  }
}

function validateSteps(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const note of draft._stepNotes) {
    if (note.kind === "unknown") {
      diagnostics.add(
        err(
          SEM_CODES.UNSUPPORTED_STEP,
          `unsupported workflow step: ${note.text}`,
          note.span,
          "V1 supports validate, sanitize, insert, update, delete, call, emit, and custom_call steps",
        ),
      );
    } else if (note.kind === "duplicate_name") {
      diagnostics.add(
        err(
          SEM_CODES.DUPLICATE_STEP_NAME,
          `duplicate workflow step name: ${note.text}`,
          note.span,
          "each named step within a workflow must have a unique name so its identity is stable across edits",
        ),
      );
    }
  }
}

function validateUnresolvedReferences(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const ref of draft._unresolvedReferences) {
    switch (ref.kind) {
      case "model":
        diagnostics.add(
          err(
            SEM_CODES.UNDECLARED_MODEL,
            `undeclared model reference \`${ref.name}\` (in ${ref.context})`,
            ref.span,
          ),
        );
        break;
      case "integration":
        diagnostics.add(
          err(
            SEM_CODES.UNDECLARED_INTEGRATION,
            `undeclared integration reference \`${ref.name}\` (in ${ref.context})`,
            ref.span,
          ),
        );
        break;
      case "custom":
        diagnostics.add(
          err(
            SEM_CODES.UNDECLARED_CUSTOM,
            `undeclared custom reference \`${ref.name}\` (in ${ref.context})`,
            ref.span,
          ),
        );
        break;
      case "policy":
        diagnostics.add(
          err(
            SEM_CODES.UNDECLARED_POLICY,
            `undeclared policy reference \`${ref.name}\` (in ${ref.context})`,
            ref.span,
          ),
        );
        break;
    }
  }
}

function validateCustoms(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const note of draft._customNotes) {
    if (note.kind === "reserved" || RESERVED_CUSTOM_KINDS.has(note.customKind)) {
      diagnostics.add(
        err(
          SEM_CODES.RESERVED_CUSTOM_KIND,
          `custom kind \`${note.customKind}\` is reserved for post-V1`,
          note.span,
          "remove the declaration or pick a supported kind",
        ),
      );
    }
  }
}

function validateGuarantees(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const wf of draft.workflows) {
    for (const g of wf.guarantees) {
      if (g.form === "short") {
        const cls = classifyShortGuarantee(g.name);
        if (cls === "unknown") {
          // Find the source location to anchor the diagnostic.
          const sourceLoc = draft.source_locations.find((s) => s.entity_id === g.id);
          const span: SourceSpan | undefined = sourceLoc
            ? {
                file: sourceLoc.file,
                start: {
                  offset: 0,
                  line: sourceLoc.start_line,
                  column: sourceLoc.start_column,
                },
                end: {
                  offset: 0,
                  line: sourceLoc.end_line,
                  column: sourceLoc.end_column,
                },
              }
            : undefined;
          diagnostics.add(
            err(
              SEM_CODES.UNKNOWN_SHORT_GUARANTEE,
              `unknown short-form guarantee \`${g.name}\``,
              span,
              "use a supported guarantee pattern or declare a long-form guarantee",
            ),
          );
        }
      }
    }
  }

  // Long-form guarantees that declare `verifiability: unsupported` cannot
  // produce supported generated coverage, so they block canonicalization.
  for (const note of draft._longFormGuarantees) {
    if (note.verifiability === "unsupported") {
      diagnostics.add(
        err(
          SEM_CODES.UNSUPPORTED_LONG_GUARANTEE,
          `long-form guarantee \`${note.name}\` declares \`verifiability: unsupported\` and will not run`,
          note.span,
          "use a supported verifiability value or remove the guarantee",
        ),
      );
    }
  }
}

function validateDefaults(draft: DraftIR, diagnostics: DiagnosticBag): void {
  for (const issue of draft._fieldDefaultIssues) {
    diagnostics.add(
      err(
        SEM_CODES.INVALID_DEFAULT,
        `invalid default for field ${issue.modelName}.${issue.fieldName}: ${issue.message}`,
        issue.span,
      ),
    );
  }
}

// -------------------------------------------------------------------------
// Diagnostic helpers
// -------------------------------------------------------------------------

function err(
  code: string,
  message: string,
  span?: SourceSpan,
  hint?: string,
): Diagnostic {
  const base: Diagnostic = {
    code,
    message,
    severity: "error",
    ...(span !== undefined ? { span } : {}),
    ...(hint !== undefined ? { hint } : {}),
  };
  return base;
}
