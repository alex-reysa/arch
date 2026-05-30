import type {
  ApiTriggerAst,
  ArchFileAst,
  CustomDeclAst,
  DeclarationAst,
  FieldDeclAst,
  FieldModifierAst,
  GeneratedTestAst,
  GuaranteeDeclAst,
  IntegrationDeclAst,
  LongGuaranteeAst,
  ModelDeclAst,
  PolicyDeclAst,
  PropertyValueAst,
  RelationReferenceAst,
  ReservedIndexDeclAst,
  ReservedManualTriggerAst,
  ReservedScheduleTriggerAst,
  ReservedSyntaxAst,
  SystemDeclAst,
  TargetDeclAst,
  TriggerAst,
  WorkflowDeclAst,
  WorkflowStepAst,
  WorkflowTestAst,
} from "./ast.js";
import { DiagnosticBag, type Diagnostic } from "./diagnostics.js";
import { lex, type Token } from "./lexer.js";
import type { SourcePosition, SourceSpan } from "./source-map.js";

/**
 * Recursive-descent parser for the V1 `.arch` grammar.
 *
 * Surface mirrors the actual fixtures in `examples/social-feed/**` (a flatter
 * shape than the LANGUAGE_SPEC's nested `system { ... }` form). Reserved
 * syntax — named/composite indexes, schedule triggers, manual triggers,
 * `custom kind: test_generator` — is recognized and recorded under a typed
 * reserved-syntax aggregate so the semantic validator can reject each form
 * with a precise diagnostic in the next phase.
 */
export interface ParseResult {
  readonly ast: ArchFileAst | null;
  readonly diagnostics: DiagnosticBag;
}

export const PARSER_DIAGNOSTIC_CODES = {
  unexpectedToken: "language.parse.unexpected_token",
  expectedToken: "language.parse.expected_token",
  expectedColon: "language.parse.expected_colon",
  expectedLBrace: "language.parse.expected_lbrace",
  expectedRBrace: "language.parse.expected_rbrace",
  expectedLParen: "language.parse.expected_lparen",
  expectedRParen: "language.parse.expected_rparen",
  expectedRBracket: "language.parse.expected_rbracket",
  expectedIdentifier: "language.parse.expected_identifier",
  unclosedBlock: "language.parse.unclosed_block",
  duplicateTarget: "language.parse.duplicate_target",
  duplicateSystem: "language.parse.duplicate_system",
  duplicateTrigger: "language.parse.duplicate_trigger",
  invalidValue: "language.parse.invalid_value",
} as const;

const RESERVED_CUSTOM_KINDS: ReadonlySet<string> = new Set(["test_generator"]);

const HTTP_METHODS = new Set<ApiTriggerAst["method"]>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Top-level parser entry point. Produces an `ArchFileAst` even when the source
 * contains errors — the AST may be partial, and the caller must consult
 * `diagnostics.hasErrors()` before treating the AST as authoritative.
 */
export function parse(source: string, file: string): ParseResult {
  const diagnostics = new DiagnosticBag();
  const lexResult = lex(source, file);
  for (const d of lexResult.diagnostics) diagnostics.add(d);
  const parser = new Parser(lexResult.tokens, file, diagnostics);
  const ast = parser.parseFile();
  return { ast, diagnostics };
}

class Parser {
  private cursor = 0;
  private readonly reserved: ReservedSyntaxAst[] = [];

  constructor(
    private readonly tokens: readonly Token[],
    private readonly file: string,
    private readonly bag: DiagnosticBag,
  ) {}

  // ------------------------------------------------------------------
  // Token cursor
  // ------------------------------------------------------------------

  private peek(offset = 0): Token {
    const i = this.cursor + offset;
    if (i >= this.tokens.length) {
      const last = this.tokens[this.tokens.length - 1];
      if (last) return last;
      const zero: SourcePosition = { offset: 0, line: 1, column: 1 };
      return {
        kind: "eof",
        text: "",
        span: { file: this.file, start: zero, end: zero },
      };
    }
    return this.tokens[i] as Token;
  }

  private advance(): Token {
    const t = this.peek();
    if (this.cursor < this.tokens.length - 1) this.cursor += 1;
    return t;
  }

  private isAtEnd(): boolean {
    return this.peek().kind === "eof";
  }

  private check(kind: Token["kind"], text?: string): boolean {
    const t = this.peek();
    if (t.kind !== kind) return false;
    if (text !== undefined && t.text !== text) return false;
    return true;
  }

  private match(kind: Token["kind"], text?: string): boolean {
    if (this.check(kind, text)) {
      this.advance();
      return true;
    }
    return false;
  }

  private prevSpan(): SourceSpan {
    if (this.cursor === 0) return this.peek().span;
    const t = this.tokens[this.cursor - 1];
    return t ? t.span : this.peek().span;
  }

  private spanFromStart(start: SourcePosition): SourceSpan {
    const end = this.prevSpan().end;
    return { file: this.file, start, end };
  }

  private addDiag(
    code: string,
    message: string,
    span: SourceSpan,
    hint?: string,
  ): void {
    const base: Diagnostic = { code, message, severity: "error", span };
    this.bag.add(hint === undefined ? base : { ...base, hint });
  }

  private expectPunct(text: string, code: string): Token | null {
    if (this.check("punctuation", text)) return this.advance();
    const t = this.peek();
    this.addDiag(
      code,
      `Expected '${text}' but found ${describeToken(t)}`,
      t.span,
    );
    return null;
  }

  // ------------------------------------------------------------------
  // Top-level: ArchFile
  // ------------------------------------------------------------------

  parseFile(): ArchFileAst {
    const start: SourcePosition =
      this.peek().span.start.offset === 0
        ? this.peek().span.start
        : { offset: 0, line: 1, column: 1 };
    let target: TargetDeclAst | undefined;
    let system: SystemDeclAst | undefined;
    const declarations: DeclarationAst[] = [];

    while (!this.isAtEnd()) {
      const t = this.peek();
      if (t.kind !== "keyword") {
        this.addDiag(
          PARSER_DIAGNOSTIC_CODES.unexpectedToken,
          `Unexpected ${describeToken(t)} at top level`,
          t.span,
          "expected one of: target, system, model, integration, policy, workflow, custom",
        );
        this.advance();
        continue;
      }
      switch (t.text) {
        case "target": {
          const decl = this.parseTarget();
          if (decl) {
            if (target) {
              this.addDiag(
                PARSER_DIAGNOSTIC_CODES.duplicateTarget,
                "Duplicate `target` declaration",
                decl.span,
              );
            } else {
              target = decl;
            }
          }
          break;
        }
        case "system": {
          const decl = this.parseSystem();
          if (decl) {
            if (system) {
              this.addDiag(
                PARSER_DIAGNOSTIC_CODES.duplicateSystem,
                "Duplicate `system` declaration",
                decl.span,
              );
            } else {
              system = decl;
            }
          }
          break;
        }
        case "model": {
          const decl = this.parseModel();
          if (decl) declarations.push(decl);
          break;
        }
        case "integration": {
          const decl = this.parseIntegration();
          if (decl) declarations.push(decl);
          break;
        }
        case "policy": {
          const decl = this.parsePolicy();
          if (decl) declarations.push(decl);
          break;
        }
        case "workflow": {
          const decl = this.parseWorkflow();
          if (decl) declarations.push(decl);
          break;
        }
        case "custom": {
          const decl = this.parseCustom();
          if (decl) declarations.push(decl);
          break;
        }
        default: {
          this.addDiag(
            PARSER_DIAGNOSTIC_CODES.unexpectedToken,
            `Unexpected keyword '${t.text}' at top level`,
            t.span,
            "expected one of: target, system, model, integration, policy, workflow, custom",
          );
          this.advance();
          break;
        }
      }
    }

    const fileSpan: SourceSpan = {
      file: this.file,
      start,
      end: this.peek().span.end,
    };
    const ast: ArchFileAst = {
      kind: "ArchFile",
      span: fileSpan,
      file: this.file,
      ...(target ? { target } : {}),
      ...(system ? { system } : {}),
      declarations,
      reservedSyntax: this.reserved,
    };
    return ast;
  }

  // ------------------------------------------------------------------
  // Target
  // ------------------------------------------------------------------

  private parseTarget(): TargetDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'target'
    const stack = this.readQualifiedIdent();
    let cache: string | undefined;
    const modifiers: Record<string, string> = {};
    while (!this.isAtEnd()) {
      if (this.atTopLevelDecl() || this.check("punctuation", "}")) break;
      const t = this.peek();
      if (
        (t.kind === "keyword" || t.kind === "identifier") &&
        this.peek(1).kind === "punctuation" &&
        this.peek(1).text === ":"
      ) {
        const key = this.advance().text;
        this.advance(); // ':'
        const val = this.readQualifiedIdentOrSkip();
        if (key === "cache") cache = val;
        else modifiers[key] = val;
      } else {
        break;
      }
    }
    return {
      kind: "TargetDecl",
      span: this.spanFromStart(start),
      stack,
      ...(cache !== undefined ? { cache } : {}),
      modifiers,
    };
  }

  // ------------------------------------------------------------------
  // System (key/value body — nested decls are out of scope for V1 fixtures)
  // ------------------------------------------------------------------

  private parseSystem(): SystemDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'system'
    const nameTok = this.expectIdentifierLike();
    if (!this.expectPunct("{", PARSER_DIAGNOSTIC_CODES.expectedLBrace)) {
      return null;
    }
    const properties = this.parsePropertyMap("}");
    this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);
    const description = stringPropertyOrUndefined(properties, "description");
    return {
      kind: "SystemDecl",
      span: this.spanFromStart(start),
      name: nameTok ? nameTok.text : "",
      ...(description !== undefined ? { description } : {}),
      properties,
    };
  }

  // ------------------------------------------------------------------
  // Model
  // ------------------------------------------------------------------

  private parseModel(): ModelDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'model'
    const nameTok = this.expectIdentifierLike();
    if (!this.expectPunct("{", PARSER_DIAGNOSTIC_CODES.expectedLBrace)) {
      return null;
    }
    const fields: FieldDeclAst[] = [];
    const reservedIndexes: ReservedIndexDeclAst[] = [];
    while (!this.isAtEnd() && !this.check("punctuation", "}")) {
      // Recovery: if we run into a top-level decl keyword, the model's `{`
      // was never closed. Stop here so the unclosed_block diagnostic fires
      // and the outer loop can recover by picking up the next decl.
      if (this.atTopLevelDecl()) break;
      const t = this.peek();
      if (t.kind === "keyword" && t.text === "index") {
        const idx = this.parseReservedIndex();
        if (idx) reservedIndexes.push(idx);
        continue;
      }
      if (t.kind === "keyword" && t.text === "relation") {
        // Reserved: `relation Name { ... }` is not modeled in V1 AST.
        this.consumeReservedBlock(t.span.start, "relation");
        continue;
      }
      if (t.kind === "identifier" || (t.kind === "keyword" && this.isPlausibleFieldName(t.text))) {
        const field = this.parseField();
        if (field) fields.push(field);
        else this.advance();
        continue;
      }
      // Skip with a diagnostic and try to recover.
      this.addDiag(
        PARSER_DIAGNOSTIC_CODES.unexpectedToken,
        `Unexpected ${describeToken(t)} in model body`,
        t.span,
      );
      this.advance();
    }
    this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);
    return {
      kind: "ModelDecl",
      span: this.spanFromStart(start),
      name: nameTok ? nameTok.text : "",
      fields,
      reservedIndexes,
    };
  }

  /**
   * Reserved-only: V1 supports field-level `indexed`/`index` modifiers, not
   * top-level `index NAME (a, b)` declarations. We parse the form so the
   * semantic validator can reject it with a precise location.
   */
  private parseReservedIndex(): ReservedIndexDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'index'
    let name: string | undefined;
    if (this.peek().kind === "identifier") {
      name = this.advance().text;
    }
    if (!this.expectPunct("(", PARSER_DIAGNOSTIC_CODES.expectedLParen)) {
      return null;
    }
    const fields: string[] = [];
    while (!this.isAtEnd() && !this.check("punctuation", ")")) {
      const t = this.peek();
      if (t.kind === "identifier" || t.kind === "keyword") {
        fields.push(this.advance().text);
      } else {
        this.addDiag(
          PARSER_DIAGNOSTIC_CODES.expectedIdentifier,
          `Expected field identifier but found ${describeToken(t)}`,
          t.span,
        );
        this.advance();
      }
      if (this.check("punctuation", ",")) {
        this.advance();
      } else {
        break;
      }
    }
    this.expectPunct(")", PARSER_DIAGNOSTIC_CODES.expectedRParen);
    const form: ReservedIndexDeclAst["form"] =
      name !== undefined ? "named" : "composite";
    const decl: ReservedIndexDeclAst = {
      kind: "ReservedIndexDecl",
      span: this.spanFromStart(start),
      form,
      ...(name !== undefined ? { name } : {}),
      fields,
    };
    this.reserved.push(decl);
    return decl;
  }

  /**
   * Heuristic: a token can start a field declaration if its text is a valid
   * identifier and the next token is a `:`. We allow keywords here so a field
   * named `kind` or `default` is still parsed (the parser is permissive — the
   * semantic validator handles style/reservation rules).
   */
  private isPlausibleFieldName(_text: string): boolean {
    return this.peek(1).kind === "punctuation" && this.peek(1).text === ":";
  }

  private parseField(): FieldDeclAst | null {
    const start = this.peek().span.start;
    const nameTok = this.advance();
    if (!this.expectPunct(":", PARSER_DIAGNOSTIC_CODES.expectedColon)) {
      return null;
    }
    const typeStart = this.peek().span.start;
    const typeTok = this.peek();
    if (typeTok.kind !== "identifier" && typeTok.kind !== "keyword") {
      this.addDiag(
        PARSER_DIAGNOSTIC_CODES.expectedIdentifier,
        `Expected type identifier after ':' but found ${describeToken(typeTok)}`,
        typeTok.span,
      );
      return null;
    }
    let typeText = this.advance().text;
    let many = false;
    let enumValues: string[] | undefined;
    if (
      typeText === "enum" &&
      this.check("punctuation", "[") &&
      !(this.peek(1).kind === "punctuation" && this.peek(1).text === "]")
    ) {
      // `enum["a", "b", ...]` — a non-empty bracketed value list. Reuse the
      // generic list-value parser, then project to the string member values.
      const list = this.parseListValue();
      enumValues = [];
      if (list && list.kind === "ListValue") {
        for (const item of list.items) {
          if (item.kind === "StringValue") enumValues.push(item.value);
          else if (item.kind === "IdentifierValue") enumValues.push(item.name);
        }
      }
    } else if (
      this.check("punctuation", "[") &&
      this.peek(1).kind === "punctuation" &&
      this.peek(1).text === "]"
    ) {
      this.advance();
      this.advance();
      many = true;
      typeText += "[]";
    }
    const typeSpan: SourceSpan = {
      file: this.file,
      start: typeStart,
      end: this.prevSpan().end,
    };

    const baseType = many ? typeText.slice(0, -2) : typeText;
    const looksLikeModelRef =
      baseType.length > 0 &&
      /^[A-Z]/.test(baseType) &&
      !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(baseType);
    const relationReference: RelationReferenceAst | undefined = looksLikeModelRef
      ? {
          kind: "RelationReference",
          span: typeSpan,
          targetModelName: baseType,
          many,
        }
      : undefined;

    const modifiers: FieldModifierAst[] = [];
    let defaultValue: PropertyValueAst | undefined;

    while (!this.isAtEnd()) {
      const m = this.peek();
      if (m.kind === "eof") break;
      if (m.kind === "punctuation" && m.text === "}") break;
      if (m.kind === "punctuation" && m.text === ";") {
        this.advance();
        continue;
      }
      // Stop at the start of the next field: `<ident> :` two-token lookahead.
      if (
        (m.kind === "identifier" || m.kind === "keyword") &&
        m.text !== "default" &&
        m.text !== "indexed" &&
        m.text !== "unique" &&
        m.text !== "primary" &&
        m.text !== "required" &&
        m.text !== "optional" &&
        m.text !== "immutable" &&
        m.text !== "max" &&
        m.text !== "min" &&
        this.peek(1).kind === "punctuation" &&
        this.peek(1).text === ":"
      ) {
        break;
      }
      // Stop at top-level decl (recovery from an unclosed brace).
      if (this.atTopLevelDecl()) break;

      const mStart = m.span.start;
      if (m.kind === "keyword" && (m.text === "indexed" || m.text === "unique")) {
        this.advance();
        modifiers.push({
          kind: "FieldIndexModifier",
          span: this.spanFromStart(mStart),
          modifier: m.text,
        });
        continue;
      }
      if (m.kind === "keyword" && m.text === "default") {
        this.advance();
        this.match("punctuation", ":");
        const v = this.parseValue();
        if (v) {
          defaultValue = v;
          modifiers.push({
            kind: "FieldDefaultModifier",
            span: this.spanFromStart(mStart),
            value: v,
          });
        }
        continue;
      }
      if (
        m.kind === "keyword" &&
        (m.text === "primary" ||
          m.text === "required" ||
          m.text === "optional" ||
          m.text === "immutable")
      ) {
        this.advance();
        modifiers.push({
          kind: "FieldUnknownModifier",
          span: this.spanFromStart(mStart),
          text: m.text,
        });
        continue;
      }
      if (m.kind === "keyword" && m.text === "index") {
        // `index` is overloaded: as a field modifier (`field: T index`) it
        // behaves like `indexed`; as a model-level decl it has the form
        // `index NAME (a, b)` or `index (a, b)`, both of which are reserved
        // for post-V1. Disambiguate by lookahead — if we see `(` or
        // `<ident> (` then we're at a model-level form, so we stop the
        // modifier loop and let the model-body loop pick it up.
        const a = this.peek(1);
        const b = this.peek(2);
        const looksLikeModelLevel =
          (a.kind === "punctuation" && a.text === "(") ||
          ((a.kind === "identifier" || a.kind === "keyword") &&
            b.kind === "punctuation" &&
            b.text === "(");
        if (looksLikeModelLevel) break;
        this.advance();
        modifiers.push({
          kind: "FieldIndexModifier",
          span: this.spanFromStart(mStart),
          modifier: "indexed",
        });
        continue;
      }
      if (m.kind === "keyword" && m.text === "relation") {
        // Top-level `relation Name { ... }` is reserved (handled by the model
        // body loop). A field-level `relation` modifier is harder to lex
        // unambiguously, so we stop here and let the model body loop decide.
        break;
      }
      if (m.kind === "keyword" && (m.text === "max" || m.text === "min")) {
        // length modifier: consume keyword and optional integer
        this.advance();
        let unitText = m.text;
        if (this.check("number")) {
          unitText += " " + this.advance().text;
        }
        modifiers.push({
          kind: "FieldUnknownModifier",
          span: this.spanFromStart(mStart),
          text: unitText,
        });
        continue;
      }
      if (m.kind === "identifier" || m.kind === "keyword") {
        this.advance();
        modifiers.push({
          kind: "FieldUnknownModifier",
          span: this.spanFromStart(mStart),
          text: m.text,
        });
        continue;
      }
      // Anything else: stop to avoid runaway consumption.
      break;
    }

    return {
      kind: "FieldDecl",
      span: this.spanFromStart(start),
      name: nameTok.text,
      typeText,
      ...(enumValues !== undefined ? { enumValues } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      modifiers,
      ...(relationReference !== undefined ? { relationReference } : {}),
    };
  }

  // ------------------------------------------------------------------
  // Integration / Policy / Custom (property bag bodies)
  // ------------------------------------------------------------------

  private parseIntegration(): IntegrationDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'integration'
    const nameTok = this.expectIdentifierLike();
    if (!this.expectPunct("{", PARSER_DIAGNOSTIC_CODES.expectedLBrace)) {
      return null;
    }
    const properties = this.parsePropertyMap("}");
    this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);
    return {
      kind: "IntegrationDecl",
      span: this.spanFromStart(start),
      name: nameTok ? nameTok.text : "",
      properties,
    };
  }

  private parsePolicy(): PolicyDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'policy'
    const nameTok = this.expectIdentifierLike();
    if (!this.expectPunct("{", PARSER_DIAGNOSTIC_CODES.expectedLBrace)) {
      return null;
    }
    const properties = this.parsePropertyMap("}");
    this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);
    const body = stringPropertyOrUndefined(properties, "body") ?? "";
    return {
      kind: "PolicyDecl",
      span: this.spanFromStart(start),
      name: nameTok ? nameTok.text : "",
      body,
      properties,
    };
  }

  private parseCustom(): CustomDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'custom'
    const nameTok = this.expectIdentifierLike();
    if (!this.expectPunct("{", PARSER_DIAGNOSTIC_CODES.expectedLBrace)) {
      return null;
    }
    const properties = this.parsePropertyMap("}");
    this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);

    const kindVal = properties["kind"];
    let customKind = "";
    if (kindVal) {
      if (kindVal.kind === "IdentifierValue") customKind = kindVal.name;
      else if (kindVal.kind === "StringValue") customKind = kindVal.value;
    }
    const reserved = customKind !== "" && RESERVED_CUSTOM_KINDS.has(customKind);
    if (reserved && kindVal) {
      this.reserved.push({
        kind: "ReservedCustomKind",
        customKind,
        span: kindVal.span,
      });
    }
    return {
      kind: "CustomDecl",
      span: this.spanFromStart(start),
      name: nameTok ? nameTok.text : "",
      customKind,
      customKindIsReserved: reserved,
      properties,
    };
  }

  // ------------------------------------------------------------------
  // Workflow
  // ------------------------------------------------------------------

  private parseWorkflow(): WorkflowDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'workflow'
    const nameTok = this.expectIdentifierLike();
    if (!this.expectPunct("{", PARSER_DIAGNOSTIC_CODES.expectedLBrace)) {
      return null;
    }
    let trigger: TriggerAst | undefined;
    const steps: WorkflowStepAst[] = [];
    const guarantees: GuaranteeDeclAst[] = [];
    const tests: WorkflowTestAst[] = [];
    const customs: CustomDeclAst[] = [];

    while (!this.isAtEnd() && !this.check("punctuation", "}")) {
      // Recovery on missing `}` — fall back to the file-level loop.
      if (this.atTopLevelDecl()) break;
      const t = this.peek();
      if (t.kind !== "keyword") {
        this.addDiag(
          PARSER_DIAGNOSTIC_CODES.unexpectedToken,
          `Unexpected ${describeToken(t)} in workflow body`,
          t.span,
        );
        this.advance();
        continue;
      }
      switch (t.text) {
        case "trigger": {
          const tr = this.parseTrigger();
          if (tr) {
            if (trigger !== undefined) {
              this.addDiag(
                PARSER_DIAGNOSTIC_CODES.duplicateTrigger,
                "Duplicate `trigger` declaration",
                tr.span,
              );
            } else {
              trigger = tr;
            }
          }
          break;
        }
        case "step": {
          const s = this.parseStep(steps.length);
          if (s) steps.push(s);
          break;
        }
        case "guarantee": {
          const g = this.parseGuarantee();
          if (g) guarantees.push(g);
          break;
        }
        case "tests": {
          const w = this.parseTests();
          if (w) tests.push(w);
          break;
        }
        case "custom": {
          const c = this.parseCustom();
          if (c) customs.push(c);
          break;
        }
        default: {
          this.addDiag(
            PARSER_DIAGNOSTIC_CODES.unexpectedToken,
            `Unexpected keyword '${t.text}' in workflow body`,
            t.span,
          );
          this.advance();
          break;
        }
      }
    }
    this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);

    const triggerOrFallback: TriggerAst =
      trigger ?? {
        kind: "UnknownTrigger",
        text: "<missing>",
        span: this.spanFromStart(start),
      };

    return {
      kind: "WorkflowDecl",
      span: this.spanFromStart(start),
      name: nameTok ? nameTok.text : "",
      trigger: triggerOrFallback,
      steps,
      guarantees,
      tests,
      customs,
    };
  }

  // ------------------------------------------------------------------
  // Trigger
  // ------------------------------------------------------------------

  private parseTrigger(): TriggerAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'trigger'
    this.match("punctuation", ":"); // optional `:` per LANGUAGE_SPEC
    const t = this.peek();
    if (t.kind === "keyword" && t.text === "api") {
      return this.parseApiTrigger(start);
    }
    if (t.kind === "keyword" && t.text === "schedule") {
      return this.parseScheduleTrigger(start);
    }
    if (t.kind === "keyword" && t.text === "manual") {
      return this.parseManualTrigger(start);
    }
    // Unknown form — record a diagnostic and consume a single token.
    this.addDiag(
      PARSER_DIAGNOSTIC_CODES.unexpectedToken,
      `Unrecognized trigger form: ${describeToken(t)}`,
      t.span,
    );
    const text = this.advance().text;
    return {
      kind: "UnknownTrigger",
      span: this.spanFromStart(start),
      text,
    };
  }

  private parseApiTrigger(start: SourcePosition): ApiTriggerAst {
    this.advance(); // 'api'
    this.match("punctuation", ".");
    const methodTok = this.peek();
    let method: ApiTriggerAst["method"] = "GET";
    if (
      methodTok.kind === "keyword" &&
      HTTP_METHODS.has(methodTok.text as ApiTriggerAst["method"])
    ) {
      method = this.advance().text as ApiTriggerAst["method"];
    } else {
      this.addDiag(
        PARSER_DIAGNOSTIC_CODES.unexpectedToken,
        `Expected HTTP method (GET, POST, PUT, PATCH, DELETE) but found ${describeToken(methodTok)}`,
        methodTok.span,
      );
    }
    // Path: either `(STRING)` (LANGUAGE_SPEC form) or `/path/segments` literal.
    let path = "";
    if (this.check("punctuation", "(")) {
      this.advance();
      const s = this.peek();
      if (s.kind === "string") {
        path = parseStringEscapes(this.advance().text);
      }
      this.expectPunct(")", PARSER_DIAGNOSTIC_CODES.expectedRParen);
    } else {
      path = this.readApiPath();
    }
    let auth: ApiTriggerAst["auth"] = "none";
    if (this.check("keyword", "auth")) {
      this.advance();
      this.match("punctuation", ":");
      const a = this.peek();
      if (
        a.kind === "keyword" &&
        (a.text === "none" || a.text === "required" || a.text === "optional")
      ) {
        auth = this.advance().text as ApiTriggerAst["auth"];
      } else {
        this.addDiag(
          PARSER_DIAGNOSTIC_CODES.unexpectedToken,
          `Expected one of: none, required, optional after 'auth:'`,
          a.span,
        );
      }
    }
    return {
      kind: "ApiTrigger",
      span: this.spanFromStart(start),
      method,
      path,
      auth,
    };
  }

  private parseScheduleTrigger(start: SourcePosition): ReservedScheduleTriggerAst {
    this.advance(); // 'schedule'
    this.match("punctuation", ".");
    let cron: string | undefined;
    if (this.check("keyword", "cron")) {
      this.advance();
      if (this.match("punctuation", "(")) {
        const s = this.peek();
        if (s.kind === "string") {
          cron = parseStringEscapes(this.advance().text);
        }
        this.expectPunct(")", PARSER_DIAGNOSTIC_CODES.expectedRParen);
      }
    }
    const node: ReservedScheduleTriggerAst = {
      kind: "ReservedScheduleTrigger",
      span: this.spanFromStart(start),
      ...(cron !== undefined ? { cron } : {}),
    };
    this.reserved.push(node);
    return node;
  }

  private parseManualTrigger(start: SourcePosition): ReservedManualTriggerAst {
    this.advance(); // 'manual'
    let label: string | undefined;
    if (this.match("punctuation", "(")) {
      const s = this.peek();
      if (s.kind === "string") {
        label = parseStringEscapes(this.advance().text);
      }
      this.expectPunct(")", PARSER_DIAGNOSTIC_CODES.expectedRParen);
    }
    const node: ReservedManualTriggerAst = {
      kind: "ReservedManualTrigger",
      span: this.spanFromStart(start),
      ...(label !== undefined ? { label } : {}),
    };
    this.reserved.push(node);
    return node;
  }

  /**
   * Reads a literal API path starting at `/`. Continues across `/`, `:`, `.`,
   * and identifier/keyword/number tokens as long as they are byte-adjacent
   * (no whitespace between). Stops at the first whitespace gap.
   */
  private readApiPath(): string {
    if (!this.check("punctuation", "/")) return "";
    let path = "";
    let prevEnd = -1;
    while (!this.isAtEnd()) {
      const t = this.peek();
      if (prevEnd !== -1 && t.span.start.offset !== prevEnd) break;
      if (
        t.kind === "punctuation" &&
        (t.text === "/" || t.text === "." || t.text === ":" || t.text === "-")
      ) {
        path += t.text;
      } else if (
        t.kind === "identifier" ||
        t.kind === "keyword" ||
        t.kind === "number"
      ) {
        path += t.text;
      } else {
        break;
      }
      prevEnd = t.span.end.offset;
      this.advance();
    }
    return path;
  }

  // ------------------------------------------------------------------
  // Step
  // ------------------------------------------------------------------

  private parseStep(index: number): WorkflowStepAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'step'
    const verbTok = this.peek();
    if (verbTok.kind !== "keyword") {
      this.addDiag(
        PARSER_DIAGNOSTIC_CODES.unexpectedToken,
        `Expected step verb after 'step' but found ${describeToken(verbTok)}`,
        verbTok.span,
      );
      return this.collectUnknownStep(start, index);
    }
    switch (verbTok.text) {
      case "validate": {
        this.advance();
        const target = this.readSimpleNameOrEmpty();
        return {
          kind: "ValidateStep",
          span: this.spanFromStart(start),
          index,
          target,
        };
      }
      case "sanitize": {
        this.advance();
        const target = this.readSimpleNameOrEmpty();
        let policy: string | undefined;
        if (this.check("keyword", "using")) {
          this.advance();
          policy = this.readSimpleNameOrEmpty();
        }
        return {
          kind: "SanitizeStep",
          span: this.spanFromStart(start),
          index,
          target,
          ...(policy !== undefined ? { policy } : {}),
        };
      }
      case "insert": {
        this.advance();
        return {
          kind: "InsertStep",
          span: this.spanFromStart(start),
          index,
          modelName: this.readSimpleNameOrEmpty(),
        };
      }
      case "update": {
        this.advance();
        return {
          kind: "UpdateStep",
          span: this.spanFromStart(start),
          index,
          modelName: this.readSimpleNameOrEmpty(),
        };
      }
      case "delete": {
        this.advance();
        return {
          kind: "DeleteStep",
          span: this.spanFromStart(start),
          index,
          modelName: this.readSimpleNameOrEmpty(),
        };
      }
      case "call": {
        this.advance();
        if (this.check("keyword", "custom")) {
          this.advance();
          const customName = this.readSimpleNameOrEmpty();
          return {
            kind: "CustomStepCall",
            span: this.spanFromStart(start),
            index,
            customName,
          };
        }
        const qid = this.readQualifiedIdent();
        const dot = qid.lastIndexOf(".");
        const integrationName = dot >= 0 ? qid.slice(0, dot) : qid;
        const operation = dot >= 0 ? qid.slice(dot + 1) : "";
        return {
          kind: "CallStep",
          span: this.spanFromStart(start),
          index,
          integrationName,
          operation,
        };
      }
      case "emit":
      case "notify": {
        this.advance();
        const eventName = this.readSimpleNameOrEmpty();
        return {
          kind: "EmitStep",
          span: this.spanFromStart(start),
          index,
          eventName,
        };
      }
      case "custom": {
        this.advance();
        return {
          kind: "CustomStepCall",
          span: this.spanFromStart(start),
          index,
          customName: this.readSimpleNameOrEmpty(),
        };
      }
      default:
        return this.collectUnknownStep(start, index);
    }
  }

  private collectUnknownStep(
    start: SourcePosition,
    index: number,
  ): WorkflowStepAst {
    const parts: string[] = [];
    while (!this.isAtEnd() && !this.check("punctuation", "}")) {
      const t = this.peek();
      if (
        t.kind === "keyword" &&
        (t.text === "step" ||
          t.text === "trigger" ||
          t.text === "guarantee" ||
          t.text === "tests" ||
          t.text === "custom")
      ) {
        break;
      }
      if (this.atTopLevelDecl()) break;
      parts.push(this.advance().text);
    }
    return {
      kind: "UnknownStep",
      span: this.spanFromStart(start),
      index,
      text: parts.join(" "),
    };
  }

  // ------------------------------------------------------------------
  // Guarantee
  // ------------------------------------------------------------------

  private parseGuarantee(): GuaranteeDeclAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'guarantee'
    const idTok = this.peek();
    if (idTok.kind !== "identifier" && idTok.kind !== "keyword") {
      this.addDiag(
        PARSER_DIAGNOSTIC_CODES.expectedIdentifier,
        `Expected guarantee name but found ${describeToken(idTok)}`,
        idTok.span,
      );
      return null;
    }
    this.advance();
    if (this.check("punctuation", "{")) {
      this.advance();
      const properties = this.parsePropertyMap("}");
      this.expectPunct("}", PARSER_DIAGNOSTIC_CODES.unclosedBlock);
      const long: LongGuaranteeAst = {
        kind: "LongGuarantee",
        span: this.spanFromStart(start),
        name: idTok.text,
        properties,
      };
      return long;
    }
    let operator: "<=" | ">=" | "<" | ">" | "==" | undefined;
    let value: PropertyValueAst | undefined;
    const op = this.peek();
    if (
      op.kind === "punctuation" &&
      (op.text === "<=" ||
        op.text === ">=" ||
        op.text === "<" ||
        op.text === ">" ||
        op.text === "==")
    ) {
      operator = op.text;
      this.advance();
      const v = this.parseValue();
      if (v) value = v;
    }
    return {
      kind: "ShortGuarantee",
      span: this.spanFromStart(start),
      id: idTok.text,
      ...(operator !== undefined ? { operator } : {}),
      ...(value !== undefined ? { value } : {}),
    };
  }

  // ------------------------------------------------------------------
  // Tests
  // ------------------------------------------------------------------

  private parseTests(): WorkflowTestAst | null {
    const start = this.peek().span.start;
    this.advance(); // 'tests'
    if (this.check("keyword", "generate")) {
      this.advance();
      const id = this.readSimpleNameOrEmpty();
      const node: GeneratedTestAst = {
        kind: "GeneratedTest",
        span: this.spanFromStart(start),
        id,
      };
      return node;
    }
    if (this.check("keyword", "include")) {
      this.advance();
      this.match("keyword", "custom");
      let path = "";
      if (this.check("string")) {
        path = parseStringEscapes(this.advance().text);
      } else if (this.peek().kind === "identifier" || this.peek().kind === "keyword") {
        path = this.advance().text;
      }
      return {
        kind: "CustomTest",
        span: this.spanFromStart(start),
        path,
      };
    }
    // `tests { ... }` block form is reserved/unsupported in this thin AST.
    this.addDiag(
      PARSER_DIAGNOSTIC_CODES.unexpectedToken,
      `Unsupported tests form: expected 'generate' or 'include'`,
      this.peek().span,
    );
    this.advance();
    return null;
  }

  // ------------------------------------------------------------------
  // Property maps + value parsing
  // ------------------------------------------------------------------

  private parsePropertyMap(stopText: string): Record<string, PropertyValueAst> {
    const props: Record<string, PropertyValueAst> = {};
    while (!this.isAtEnd() && !this.check("punctuation", stopText)) {
      // Recovery on missing `}` — fall back to the file-level loop.
      if (this.atTopLevelDecl()) break;
      const t = this.peek();
      if (t.kind === "punctuation" && t.text === ";") {
        this.advance();
        continue;
      }
      if (
        (t.kind === "identifier" || t.kind === "keyword") &&
        this.peek(1).kind === "punctuation" &&
        this.peek(1).text === ":"
      ) {
        const key = this.advance().text;
        this.advance(); // ':'
        const value = this.parseValue();
        if (value) {
          props[key] = value;
        } else {
          this.addDiag(
            PARSER_DIAGNOSTIC_CODES.invalidValue,
            `Expected a value for '${key}'`,
            this.peek().span,
          );
        }
        continue;
      }
      this.addDiag(
        PARSER_DIAGNOSTIC_CODES.unexpectedToken,
        `Unexpected ${describeToken(t)} in property block`,
        t.span,
      );
      this.advance();
    }
    return props;
  }

  private parseValue(): PropertyValueAst | null {
    const t = this.peek();
    if (t.kind === "string") {
      this.advance();
      return {
        kind: "StringValue",
        value: parseStringEscapes(t.text),
        span: t.span,
      };
    }
    if (t.kind === "number") {
      this.advance();
      const numeric = parseFloat(t.text);
      return {
        kind: "NumberValue",
        value: Number.isFinite(numeric) ? numeric : 0,
        span: t.span,
      };
    }
    if (t.kind === "keyword" && (t.text === "true" || t.text === "false")) {
      this.advance();
      return {
        kind: "BooleanValue",
        value: t.text === "true",
        span: t.span,
      };
    }
    if (t.kind === "punctuation" && t.text === "[") {
      return this.parseListValue();
    }
    if (t.kind === "identifier" || t.kind === "keyword") {
      const start = t.span.start;
      const name = this.readQualifiedIdent();
      return {
        kind: "IdentifierValue",
        name,
        span: { file: this.file, start, end: this.prevSpan().end },
      };
    }
    return null;
  }

  private parseListValue(): PropertyValueAst | null {
    const start = this.advance().span.start; // '['
    const items: PropertyValueAst[] = [];
    while (!this.isAtEnd() && !this.check("punctuation", "]")) {
      const item = this.parseValue();
      if (item) items.push(item);
      if (this.check("punctuation", ",")) this.advance();
      else break;
    }
    if (!this.expectPunct("]", PARSER_DIAGNOSTIC_CODES.expectedRBracket)) {
      return null;
    }
    return {
      kind: "ListValue",
      items,
      span: { file: this.file, start, end: this.prevSpan().end },
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private readQualifiedIdent(): string {
    const t = this.peek();
    if (t.kind !== "identifier" && t.kind !== "keyword") return "";
    let s = this.advance().text;
    while (this.check("punctuation", ".")) {
      const nt = this.peek(1);
      if (nt.kind !== "identifier" && nt.kind !== "keyword") break;
      this.advance(); // '.'
      s += "." + this.advance().text;
    }
    return s;
  }

  private readQualifiedIdentOrSkip(): string {
    if (
      this.peek().kind === "identifier" ||
      this.peek().kind === "keyword"
    ) {
      return this.readQualifiedIdent();
    }
    if (this.peek().kind === "string") {
      return parseStringEscapes(this.advance().text);
    }
    if (this.peek().kind === "number") {
      return this.advance().text;
    }
    return "";
  }

  private readSimpleNameOrEmpty(): string {
    const t = this.peek();
    if (t.kind === "identifier" || t.kind === "keyword") {
      return this.advance().text;
    }
    return "";
  }

  private expectIdentifierLike(): Token | null {
    const t = this.peek();
    if (t.kind === "identifier" || t.kind === "keyword") {
      return this.advance();
    }
    this.addDiag(
      PARSER_DIAGNOSTIC_CODES.expectedIdentifier,
      `Expected identifier but found ${describeToken(t)}`,
      t.span,
    );
    return null;
  }

  private atTopLevelDecl(): boolean {
    const t = this.peek();
    if (t.kind !== "keyword") return false;
    return (
      t.text === "target" ||
      t.text === "system" ||
      t.text === "model" ||
      t.text === "integration" ||
      t.text === "policy" ||
      t.text === "workflow" ||
      t.text === "custom"
    );
  }

  /**
   * Brace-balanced skip used when we encounter reserved syntax we don't model
   * yet (e.g. an explicit `relation { ... }` block inside a model).
   */
  private consumeReservedBlock(start: SourcePosition, label: string): void {
    // Skip the leading keyword + name (if any) until a `{`.
    while (
      !this.isAtEnd() &&
      !this.check("punctuation", "{") &&
      !this.check("punctuation", "}")
    ) {
      const t = this.peek();
      if (this.atTopLevelDecl() && t.span.start.offset !== start.offset) break;
      this.advance();
    }
    if (this.check("punctuation", "{")) {
      this.advance();
      let depth = 1;
      while (!this.isAtEnd() && depth > 0) {
        if (this.check("punctuation", "{")) depth += 1;
        else if (this.check("punctuation", "}")) depth -= 1;
        this.advance();
      }
    }
    this.reserved.push({
      kind: "ReservedDeclaration",
      text: label,
      span: this.spanFromStart(start),
    });
  }
}

// ----------------------------------------------------------------------
// Free helpers
// ----------------------------------------------------------------------

function describeToken(t: Token): string {
  if (t.kind === "eof") return "<end of file>";
  if (t.text.length === 0) return `<${t.kind}>`;
  return `${t.kind} '${t.text}'`;
}

function stringPropertyOrUndefined(
  props: Record<string, PropertyValueAst>,
  key: string,
): string | undefined {
  const v = props[key];
  if (!v) return undefined;
  if (v.kind === "StringValue") return v.value;
  return undefined;
}

/**
 * Decode the V1 escape set for the value of a quoted string. Accepts the raw
 * lexed token (with surrounding `"`s); tolerates a missing closing quote
 * because the lexer still produces a token in that case for downstream
 * recovery.
 */
export function parseStringEscapes(raw: string): string {
  if (raw.length === 0) return "";
  let inner = raw;
  if (inner.startsWith('"')) inner = inner.slice(1);
  if (inner.endsWith('"')) inner = inner.slice(0, -1);
  let result = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      const esc = inner[i + 1] ?? "";
      switch (esc) {
        case "\\":
          result += "\\";
          i += 1;
          break;
        case '"':
          result += '"';
          i += 1;
          break;
        case "n":
          result += "\n";
          i += 1;
          break;
        case "r":
          result += "\r";
          i += 1;
          break;
        case "t":
          result += "\t";
          i += 1;
          break;
        case "u":
          if (i + 5 < inner.length) {
            const hex = inner.slice(i + 2, i + 6);
            const code = parseInt(hex, 16);
            if (Number.isFinite(code)) {
              result += String.fromCodePoint(code);
            }
            i += 5;
          } else {
            result += ch;
          }
          break;
        default:
          // Unknown escape — preserve the raw characters so the lexer's
          // diagnostic remains the single authoritative source of truth.
          result += "\\" + esc;
          i += 1;
          break;
      }
      continue;
    }
    result += ch ?? "";
  }
  return result;
}
