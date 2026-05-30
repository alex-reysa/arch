import type { Diagnostic } from "./diagnostics.js";
import type { SourcePosition, SourceSpan } from "./source-map.js";

/**
 * Hand-written lexer for the V1 `.arch` grammar.
 *
 * Token kinds are intentionally coarse: keyword | identifier | string | number
 * | punctuation | newline | eof. Durations (`200ms`, `2s`) are folded into
 * `number` tokens whose `text` carries the unit suffix; the parser converts
 * them when constructing AST values.
 *
 * Spans use byte offsets (UTF-16 code unit offsets in the V8 sense) plus 1-based
 * line and 1-based column. Positions are stable across runs which keeps the
 * golden snapshot tests deterministic.
 */
export type TokenKind =
  | "keyword"
  | "identifier"
  | "string"
  | "number"
  | "punctuation"
  | "newline"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: SourceSpan;
}

export interface LexResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * V1 reserved words. Sourced from `LANGUAGE_SPEC.md` §5.6 with the small
 * additions the V1 fixtures rely on (`emit`, `cron`, `auth`, `generate`,
 * `include`, HTTP method names treated as keywords for trigger parsing).
 */
const KEYWORDS: ReadonlySet<string> = new Set([
  // structural
  "system",
  "target",
  "model",
  "field",
  "relation",
  "workflow",
  "trigger",
  "steps",
  "step",
  "integration",
  "policy",
  "policies",
  "guarantee",
  "guarantees",
  "test",
  "tests",
  "custom",
  // metadata
  "input",
  "output",
  "scope",
  "category",
  "assert",
  "verify",
  "verifiability",
  "description",
  "kind",
  "provider",
  // field modifiers
  "required",
  "optional",
  "primary",
  "unique",
  "indexed",
  "index",
  "immutable",
  "default",
  "max",
  "min",
  "via",
  "on_delete",
  "cascade",
  "restrict",
  "set_null",
  "no_action",
  // step verbs
  "validate",
  "sanitize",
  "moderate",
  "insert",
  "update",
  "delete",
  "query",
  "call",
  "notify",
  "enqueue",
  "return",
  "emit",
  // control flow / clauses
  "if",
  "else",
  "using",
  "with",
  "as",
  "for",
  "when",
  "on_error",
  "retry",
  "then",
  "continue",
  "fail",
  "record_error",
  // failure / scheduling / triggers
  "best_effort",
  "fail_workflow",
  "manual",
  "schedule",
  "api",
  "cron",
  "auth",
  // tests block
  "generate",
  "include",
  // values
  "true",
  "false",
  "none",
  "now",
  "uuid",
  // HTTP methods
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const ID_START = /[A-Za-z_]/;
const ID_CONTINUE = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const HEX_DIGIT = /[0-9A-Fa-f]/;

/**
 * Stable diagnostic codes the lexer can emit. Kept on a single union so the
 * parser, downstream tools, and reviewers can grep for every code in one
 * place.
 */
export const LEXER_DIAGNOSTIC_CODES = {
  unterminatedString: "language.lex.unterminated_string",
  unterminatedBlockComment: "language.lex.unterminated_block_comment",
  invalidEscape: "language.lex.invalid_escape",
  invalidToken: "language.lex.invalid_token",
} as const;

class Lexer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private readonly len: number;

  constructor(
    private readonly source: string,
    private readonly file: string,
  ) {
    this.len = source.length;
  }

  lex(): LexResult {
    while (this.pos < this.len) {
      this.skipTrivia();
      if (this.pos >= this.len) break;
      const start = this.position();
      const ch = this.charAt(0);
      if (ID_START.test(ch)) {
        this.lexIdentifier(start);
      } else if (DIGIT.test(ch)) {
        this.lexNumber(start);
      } else if (ch === '"') {
        this.lexString(start);
      } else {
        this.lexPunctuation(start, ch);
      }
    }
    const eofPos = this.position();
    this.tokens.push({
      kind: "eof",
      text: "",
      span: { file: this.file, start: eofPos, end: eofPos },
    });
    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  // ------------------------------------------------------------------
  // Cursor helpers
  // ------------------------------------------------------------------

  private charAt(offset: number): string {
    const i = this.pos + offset;
    if (i < 0 || i >= this.len) return "";
    return this.source[i] ?? "";
  }

  private advance(): string {
    const ch = this.source[this.pos] ?? "";
    this.pos += 1;
    if (ch === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  private position(): SourcePosition {
    return { offset: this.pos, line: this.line, column: this.column };
  }

  private spanFrom(start: SourcePosition): SourceSpan {
    return { file: this.file, start, end: this.position() };
  }

  private addToken(kind: TokenKind, text: string, start: SourcePosition): void {
    this.tokens.push({ kind, text, span: this.spanFrom(start) });
  }

  private addDiagnostic(
    code: string,
    message: string,
    start: SourcePosition,
    hint?: string,
  ): void {
    const base = {
      code,
      message,
      severity: "error" as const,
      span: this.spanFrom(start),
    };
    this.diagnostics.push(hint === undefined ? base : { ...base, hint });
  }

  // ------------------------------------------------------------------
  // Trivia: whitespace + three comment forms
  // ------------------------------------------------------------------

  private skipTrivia(): void {
    while (this.pos < this.len) {
      const ch = this.charAt(0);
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "/" && this.charAt(1) === "/") {
        // `//` line comment
        this.advance();
        this.advance();
        while (this.pos < this.len && this.charAt(0) !== "\n") this.advance();
        continue;
      }
      if (ch === "#") {
        // `#` line comment (shell-style)
        this.advance();
        while (this.pos < this.len && this.charAt(0) !== "\n") this.advance();
        continue;
      }
      if (ch === "/" && this.charAt(1) === "*") {
        const start = this.position();
        this.advance();
        this.advance();
        let closed = false;
        while (this.pos < this.len) {
          if (this.charAt(0) === "*" && this.charAt(1) === "/") {
            this.advance();
            this.advance();
            closed = true;
            break;
          }
          this.advance();
        }
        if (!closed) {
          this.addDiagnostic(
            LEXER_DIAGNOSTIC_CODES.unterminatedBlockComment,
            "Unterminated block comment",
            start,
            "block comments must end with `*/`",
          );
        }
        continue;
      }
      return;
    }
  }

  // ------------------------------------------------------------------
  // Identifier / keyword
  // ------------------------------------------------------------------

  private lexIdentifier(start: SourcePosition): void {
    while (this.pos < this.len && ID_CONTINUE.test(this.charAt(0))) {
      this.advance();
    }
    const text = this.source.slice(start.offset, this.pos);
    const kind: TokenKind = KEYWORDS.has(text) ? "keyword" : "identifier";
    this.addToken(kind, text, start);
  }

  // ------------------------------------------------------------------
  // Numbers and durations
  // ------------------------------------------------------------------

  private lexNumber(start: SourcePosition): void {
    while (this.pos < this.len && DIGIT.test(this.charAt(0))) this.advance();
    if (this.charAt(0) === "." && DIGIT.test(this.charAt(1))) {
      this.advance();
      while (this.pos < this.len && DIGIT.test(this.charAt(0))) this.advance();
    }
    // Optional duration unit (`ms` or `s`) immediately following the number,
    // not part of a longer identifier (so `2sec` stays as `2` + `sec`).
    if (
      this.charAt(0) === "m" &&
      this.charAt(1) === "s" &&
      !ID_CONTINUE.test(this.charAt(2))
    ) {
      this.advance();
      this.advance();
    } else if (
      this.charAt(0) === "s" &&
      !ID_CONTINUE.test(this.charAt(1))
    ) {
      this.advance();
    }
    this.addToken("number", this.source.slice(start.offset, this.pos), start);
  }

  // ------------------------------------------------------------------
  // String literal with V1 escape rules
  // ------------------------------------------------------------------

  private lexString(start: SourcePosition): void {
    this.advance(); // consume opening "
    let escapeReported = false;
    while (this.pos < this.len) {
      const ch = this.charAt(0);
      if (ch === '"') {
        this.advance();
        const text = this.source.slice(start.offset, this.pos);
        this.addToken("string", text, start);
        return;
      }
      if (ch === "\n") {
        // Multiline strings are not supported in V1 — treat as unterminated.
        break;
      }
      if (ch === "\\") {
        this.advance();
        const esc = this.charAt(0);
        if (
          esc === "\\" ||
          esc === '"' ||
          esc === "n" ||
          esc === "r" ||
          esc === "t"
        ) {
          this.advance();
          continue;
        }
        if (esc === "u") {
          this.advance();
          let bad = false;
          for (let i = 0; i < 4; i += 1) {
            const c = this.charAt(0);
            if (!HEX_DIGIT.test(c)) {
              bad = true;
              break;
            }
            this.advance();
          }
          if (bad && !escapeReported) {
            this.addDiagnostic(
              LEXER_DIAGNOSTIC_CODES.invalidEscape,
              "Invalid Unicode escape sequence",
              start,
              "expected `\\uXXXX` with four hex digits",
            );
            escapeReported = true;
          }
          continue;
        }
        if (!escapeReported) {
          this.addDiagnostic(
            LEXER_DIAGNOSTIC_CODES.invalidEscape,
            `Invalid escape sequence \\${esc}`,
            start,
            "supported escapes: \\\\, \\\", \\n, \\r, \\t, \\uXXXX",
          );
          escapeReported = true;
        }
        if (esc.length > 0) this.advance();
        continue;
      }
      this.advance();
    }
    // Fell off the end without a closing quote.
    this.addDiagnostic(
      LEXER_DIAGNOSTIC_CODES.unterminatedString,
      "Unterminated string literal",
      start,
      'string literals must end with a closing `"` on the same line',
    );
    const text = this.source.slice(start.offset, this.pos);
    this.addToken("string", text, start);
  }

  // ------------------------------------------------------------------
  // Punctuation (single and 2-char operators)
  // ------------------------------------------------------------------

  private lexPunctuation(start: SourcePosition, ch: string): void {
    const c2 = this.charAt(1);
    if (ch === "<" && c2 === "=") {
      this.advance();
      this.advance();
      this.addToken("punctuation", "<=", start);
      return;
    }
    if (ch === ">" && c2 === "=") {
      this.advance();
      this.advance();
      this.addToken("punctuation", ">=", start);
      return;
    }
    if (ch === "=" && c2 === "=") {
      this.advance();
      this.advance();
      this.addToken("punctuation", "==", start);
      return;
    }
    if (ch === "!" && c2 === "=") {
      this.advance();
      this.advance();
      this.addToken("punctuation", "!=", start);
      return;
    }
    if (
      ch === "{" ||
      ch === "}" ||
      ch === "(" ||
      ch === ")" ||
      ch === "[" ||
      ch === "]" ||
      ch === "," ||
      ch === ":" ||
      ch === "." ||
      ch === ";" ||
      ch === "<" ||
      ch === ">" ||
      ch === "=" ||
      ch === "/" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "!"
    ) {
      this.advance();
      this.addToken("punctuation", ch, start);
      return;
    }
    // Unknown character — emit a stable diagnostic and skip it so the rest of
    // the file still parses.
    this.advance();
    this.addDiagnostic(
      LEXER_DIAGNOSTIC_CODES.invalidToken,
      `Unexpected character ${JSON.stringify(ch)}`,
      start,
      "remove the character or wrap it in a string literal",
    );
  }
}

export function lex(source: string, file: string): LexResult {
  return new Lexer(source, file).lex();
}

export function pos(
  offset: number,
  line: number,
  column: number,
): SourcePosition {
  return { offset, line, column };
}
