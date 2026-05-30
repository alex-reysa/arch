import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parse } from "../src/parser.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function readFixture(name: string): string {
  return readFileSync(resolve(HERE, "fixtures", name), "utf8");
}

/**
 * Snapshots are stable as long as we serialize the AST through `JSON.stringify`
 * with insertion-order keys and stringify diagnostics in a fixed shape. The
 * parser inserts properties in source order, so each rerun produces the same
 * bytes.
 */
function snapshotPayload(source: string, file: string): string {
  const { ast, diagnostics } = parse(source, file);
  const payload = {
    ast,
    diagnostics: diagnostics.all().map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      span: d.span,
      ...(d.hint !== undefined ? { hint: d.hint } : {}),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

describe("golden AST snapshots", () => {
  it("SocialFeed v1: backend.arch parses with no syntax diagnostics", () => {
    const src = read("examples/social-feed/v1/backend.arch");
    const { diagnostics } = parse(src, "examples/social-feed/v1/backend.arch");
    expect(diagnostics.hasErrors()).toBe(false);
    expect(diagnostics.all()).toHaveLength(0);
  });

  it("SocialFeed v1: AST snapshot is stable", () => {
    const src = read("examples/social-feed/v1/backend.arch");
    const snap = snapshotPayload(src, "examples/social-feed/v1/backend.arch");
    expect(snap).toMatchSnapshot();
  });

  it("SocialFeed v2 visibility: AST snapshot is stable", () => {
    const src = read("examples/social-feed/v2-visibility/backend.arch");
    const snap = snapshotPayload(
      src,
      "examples/social-feed/v2-visibility/backend.arch",
    );
    expect(snap).toMatchSnapshot();
  });

  it("invalid: unterminated string fixture snapshot", () => {
    const src = readFixture("unterminated-string.arch");
    const snap = snapshotPayload(src, "fixtures/unterminated-string.arch");
    expect(snap).toMatchSnapshot();
  });

  it("invalid: unclosed block fixture snapshot", () => {
    const src = readFixture("unclosed-block.arch");
    const snap = snapshotPayload(src, "fixtures/unclosed-block.arch");
    expect(snap).toMatchSnapshot();
  });

  it("invalid: invalid token fixture snapshot", () => {
    const src = readFixture("invalid-token.arch");
    const snap = snapshotPayload(src, "fixtures/invalid-token.arch");
    expect(snap).toMatchSnapshot();
  });

  it("reserved syntax fixture: snapshot exposes every reserved-* node form", () => {
    const src = readFixture("reserved-syntax.arch");
    const snap = snapshotPayload(src, "fixtures/reserved-syntax.arch");
    expect(snap).toMatchSnapshot();
  });
});
