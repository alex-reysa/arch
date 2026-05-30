import { describe, expect, it } from "vitest";

import {
  LEXER_DIAGNOSTIC_CODES,
  lex,
  type Token,
} from "../src/lexer.js";

const FILE = "test.arch";

function kinds(tokens: readonly Token[]): string[] {
  return tokens
    .filter((t) => t.kind !== "eof")
    .map((t) => `${t.kind}:${t.text}`);
}

describe("lexer", () => {
  it("lexes the SocialFeed v1 fixture into stable tokens", () => {
    const src = `target ts.node.fastify.postgres.prisma cache: redis\n\nmodel User {\n  id: id\n}\n`;
    const { tokens, diagnostics } = lex(src, FILE);
    expect(diagnostics).toHaveLength(0);
    expect(tokens.at(-1)?.kind).toBe("eof");
    expect(kinds(tokens)).toEqual([
      "keyword:target",
      "identifier:ts",
      "punctuation:.",
      "identifier:node",
      "punctuation:.",
      "identifier:fastify",
      "punctuation:.",
      "identifier:postgres",
      "punctuation:.",
      "identifier:prisma",
      "identifier:cache",
      "punctuation::",
      "identifier:redis",
      "keyword:model",
      "identifier:User",
      "punctuation:{",
      "identifier:id",
      "punctuation::",
      "identifier:id",
      "punctuation:}",
    ]);
  });

  it("records 1-based line/column on every token", () => {
    const src = "target ts\n  cache: redis";
    const { tokens } = lex(src, FILE);
    const target = tokens[0]!;
    expect(target.text).toBe("target");
    expect(target.span.start.line).toBe(1);
    expect(target.span.start.column).toBe(1);
    expect(target.span.start.offset).toBe(0);
    expect(target.span.end.column).toBe(7);

    const cache = tokens.find((t) => t.text === "cache")!;
    expect(cache.span.start.line).toBe(2);
    expect(cache.span.start.column).toBe(3);
  });

  it("accepts //, #, and /* */ comments anywhere whitespace is allowed", () => {
    const src = `// line 1\n# line 2\n/* multi\n   line */\ntarget /*after*/ /*nested-look*/ x.y // trailing\n#tail`;
    const { tokens, diagnostics } = lex(src, FILE);
    expect(diagnostics).toHaveLength(0);
    expect(kinds(tokens)).toEqual([
      "keyword:target",
      "identifier:x",
      "punctuation:.",
      "identifier:y",
    ]);
  });

  it("decodes string escape sequences via stable token text", () => {
    const src = `"hello \\n \\u0041 \\\"end\\\""`;
    const { tokens, diagnostics } = lex(src, FILE);
    expect(diagnostics).toHaveLength(0);
    expect(tokens[0]?.kind).toBe("string");
    expect(tokens[0]?.text).toBe(src);
  });

  it("emits a stable diagnostic for unterminated strings", () => {
    const src = `policy P { body: "no closing quote\n}\n`;
    const { diagnostics } = lex(src, FILE);
    expect(diagnostics.length).toBeGreaterThan(0);
    const d = diagnostics.find(
      (x) => x.code === LEXER_DIAGNOSTIC_CODES.unterminatedString,
    );
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.span?.file).toBe(FILE);
    expect(d?.span?.start.line).toBe(1);
  });

  it("emits a stable diagnostic for unterminated block comments", () => {
    const src = `target /* never closes`;
    const { diagnostics } = lex(src, FILE);
    expect(
      diagnostics.some(
        (d) => d.code === LEXER_DIAGNOSTIC_CODES.unterminatedBlockComment,
      ),
    ).toBe(true);
  });

  it("emits a stable diagnostic for invalid characters", () => {
    const src = `model X { id: id @ }`;
    const { diagnostics } = lex(src, FILE);
    const d = diagnostics.find(
      (x) => x.code === LEXER_DIAGNOSTIC_CODES.invalidToken,
    );
    expect(d).toBeDefined();
    expect(d?.message).toContain("@");
  });

  it("lexes durations 200ms / 2s as a single number token preserving the unit", () => {
    const { tokens } = lex(`200ms 2s 250 0.5`, FILE);
    const numbers = tokens.filter((t) => t.kind === "number").map((t) => t.text);
    expect(numbers).toEqual(["200ms", "2s", "250", "0.5"]);
  });

  it("does not consume identifier suffixes that look like duration units", () => {
    const { tokens } = lex(`2sec 200msx`, FILE);
    const ts = tokens
      .filter((t) => t.kind !== "eof")
      .map((t) => `${t.kind}:${t.text}`);
    expect(ts).toEqual([
      "number:2",
      "identifier:sec",
      "number:200",
      "identifier:msx",
    ]);
  });

  it("treats spec-listed words as keyword tokens", () => {
    const { tokens } = lex(
      `system target model integration policy workflow custom step trigger`,
      FILE,
    );
    for (const t of tokens.filter((x) => x.kind !== "eof")) {
      expect(t.kind).toBe("keyword");
    }
  });

  it("supports qualified identifiers via dotted segments", () => {
    const { tokens } = lex(`Post.content workflow.CreatePost`, FILE);
    expect(kinds(tokens)).toEqual([
      "identifier:Post",
      "punctuation:.",
      "identifier:content",
      "keyword:workflow",
      "punctuation:.",
      "identifier:CreatePost",
    ]);
  });
});
