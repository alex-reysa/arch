import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import {
  buildDraftIR,
  canonicalize,
  validateCanonicalIR,
  validateSemantics,
} from "@arch/ir";
import { parse, type Diagnostic } from "@arch/language";

/**
 * `arch parse` reads a `.arch` source file, builds canonical IR, and (when
 * `--emit-ir` is passed) writes it to `.arch/ir.current.json`.
 *
 * Compilation goes through the real compiler packages — the recursive-descent
 * parser in `@arch/language` and the draft-IR builder, semantic validator,
 * canonicalizer, and IR schema validator in `@arch/ir`. There is no separate
 * inline parser: `backend.arch` is the single source of truth and the
 * canonical IR is the only compiler boundary.
 */
export async function runParse(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!args.file) {
    process.stderr.write(`arch parse: missing .arch path\n${HELP}`);
    return 64;
  }
  const filePath = isAbsolute(args.file) ? args.file : resolve(process.cwd(), args.file);
  if (!existsSync(filePath)) {
    process.stderr.write(`arch parse: file not found: ${filePath}\n`);
    return 66;
  }

  const source = await readFile(filePath, "utf8");
  const result = parseArchSource(source, filePath);
  if (!result.ok) {
    for (const d of result.diagnostics) {
      process.stderr.write(`${filePath}:${d.line}:${d.column} error ${d.code}: ${d.message}\n`);
    }
    return 65;
  }

  if (!args.emitIr) {
    process.stdout.write(`parsed ${filePath} (${result.ir.canonical_hash})\n`);
    return 0;
  }

  const metadataDir = args.metadataDir ?? resolve(dirname(filePath), ".arch");
  await mkdir(metadataDir, { recursive: true });
  const target = resolve(metadataDir, "ir.current.json");
  await writeFile(target, JSON.stringify(result.ir, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote ${target} (${result.ir.canonical_hash})\n`);
  return 0;
}

interface CliArgs {
  readonly file: string | undefined;
  readonly emitIr: boolean;
  readonly metadataDir: string | undefined;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let file: string | undefined;
  let emitIr = false;
  let metadataDir: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--emit-ir") emitIr = true;
    else if (a === "--metadata-dir") metadataDir = argv[++i];
    else if (!file && !a.startsWith("--")) file = a;
  }
  return { file, emitIr, metadataDir, help };
}

const HELP = [
  "Usage: arch parse [--emit-ir] [--metadata-dir <dir>] <path/to/backend.arch>",
  "",
  "Options:",
  "  --emit-ir                  Write canonical IR to .arch/ir.current.json",
  "  --metadata-dir <dir>       Override the .arch metadata directory",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Real compiler pipeline: parse (@arch/language) -> draft IR + semantic
// validation -> canonical IR -> IR schema validation (@arch/ir). This is the
// single source of truth for `.arch` compilation; the CLI ships no separate
// inline parser. Output is deterministic — repeated runs of equivalent source
// produce the same canonical_hash.
// ---------------------------------------------------------------------------

interface ParseDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

type ParseResult =
  | { readonly ok: true; readonly ir: CanonicalIR }
  | { readonly ok: false; readonly diagnostics: readonly ParseDiagnostic[] };

export function parseArchSource(source: string, file: string): ParseResult {
  const { ast, diagnostics: parseDiags } = parse(source, file);
  const parseErrors = parseDiags.all().filter((d) => d.severity === "error");
  if (parseErrors.length > 0 || !ast) {
    return {
      ok: false,
      diagnostics: (parseErrors.length > 0
        ? parseErrors
        : [{ code: "ARCH-PARSE", message: "no AST produced", severity: "error" as const }]
      ).map(toParseDiagnostic),
    };
  }

  const { draft, diagnostics: draftDiags } = buildDraftIR(ast);
  const sem = validateSemantics(draft);
  const blocking: Diagnostic[] = [
    ...draftDiags.all().filter((d) => d.severity === "error"),
    ...sem.diagnostics.all().filter((d) => d.severity === "error"),
  ];
  if (blocking.length > 0) {
    return { ok: false, diagnostics: blocking.map(toParseDiagnostic) };
  }

  const ir = canonicalize(draft);
  const validation = validateCanonicalIR(ir);
  if (!validation.ok) {
    return {
      ok: false,
      diagnostics: validation.errors.map((message) => ({
        code: "ARCH-IR-INVALID",
        message,
        line: 1,
        column: 1,
      })),
    };
  }

  return { ok: true, ir };
}

function toParseDiagnostic(d: Diagnostic): ParseDiagnostic {
  return {
    code: d.code,
    message: d.message,
    line: d.span?.start.line ?? 1,
    column: d.span?.start.column ?? 1,
  };
}
