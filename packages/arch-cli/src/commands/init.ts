import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * `arch init` scaffolds a new Arch project: it writes a starter
 * `backend.arch` for the requested template and creates the `.arch/`
 * metadata layout (`plans/`, `runs/`, `repair-history/`, `locks/`,
 * `tmp/`). It NEVER overwrites an existing `backend.arch` — re-running
 * init in a populated directory is a safe no-op for that file.
 */
export async function runInit(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const cwd = args.cwd ?? process.cwd();
  return await initProject({
    cwd,
    template: args.template ?? "social-feed",
  });
}

export interface InitOptions {
  readonly cwd: string;
  readonly template: string;
}

export interface InitResult {
  readonly archFileWritten: boolean;
  readonly metadataDirsCreated: readonly string[];
}

export async function initProject(options: InitOptions): Promise<number> {
  const archFile = resolve(options.cwd, "backend.arch");
  const metadataDir = resolve(options.cwd, ".arch");
  const customReadme = resolve(options.cwd, "src", "custom", "README.md");
  const subdirs = ["plans", "runs", "repair-history", "locks", "tmp"];

  let archFileWritten = false;
  if (!existsSync(archFile)) {
    await mkdir(options.cwd, { recursive: true });
    await writeFile(archFile, starterTemplate(options.template), "utf8");
    archFileWritten = true;
  }

  const created: string[] = [];
  for (const sub of subdirs) {
    const target = resolve(metadataDir, sub);
    if (!existsSync(target)) {
      await mkdir(target, { recursive: true });
      created.push(target);
    }
  }

  let customReadmeWritten = false;
  if (!existsSync(customReadme)) {
    await mkdir(resolve(options.cwd, "src", "custom"), { recursive: true });
    await writeFile(customReadme, CUSTOM_README, "utf8");
    customReadmeWritten = true;
  }

  process.stdout.write(`arch init: ${archFileWritten ? "wrote backend.arch" : "kept existing backend.arch"}\n`);
  process.stdout.write(`arch init: created ${created.length} metadata directories\n`);
  process.stdout.write(`arch init: ${customReadmeWritten ? "wrote src/custom/README.md" : "kept existing src/custom/README.md"}\n`);
  return 0;
}

interface CliArgs {
  readonly help: boolean;
  readonly template: string | undefined;
  readonly cwd: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let help = false;
  let template: string | undefined;
  let cwd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--template") template = argv[++i];
    else if (a === "--cwd") cwd = argv[++i];
  }
  return { help, template, cwd };
}

const HELP = [
  "Usage: arch init [--template <name>] [--cwd <dir>]",
  "",
  "Scaffolds backend.arch (if absent) and the .arch/ metadata layout.",
  "",
].join("\n");

const SOCIAL_FEED_STARTER = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model User {",
  "  id: id",
  "  email: string indexed",
  "  createdAt: timestamp default: now",
  "}",
  "",
  "model Post {",
  "  id: id",
  "  authorId: User",
  "  body: string",
  "  createdAt: timestamp default: now indexed",
  "}",
  "",
  "integration FeedCache {",
  "  kind: redis",
  "  failure: best_effort",
  "}",
  "",
  "integration PushNotifier {",
  "  kind: webhook",
  "  failure: best_effort",
  "}",
  "",
  "policy sanitizeHtml {",
  '  body: "strip script tags and on* attributes from inputs"',
  "}",
  "",
  "workflow CreatePost {",
  "  trigger api POST /posts auth: none",
  "  step validate body",
  "  step sanitize body using sanitizeHtml",
  "  step insert Post",
  "  step call FeedCache.update",
  "  step call PushNotifier.send",
  "  guarantee no_unsanitized_html_persisted",
  "  guarantee notification_failure_does_not_rollback_post",
  "  guarantee post_creation_p95_latency <= 250",
  "}",
  "",
].join("\n");

const MINIMAL_STARTER = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model Note {",
  "  id: id",
  "  body: string",
  "  createdAt: timestamp default: now",
  "}",
  "",
  "workflow CreateNote {",
  "  trigger api POST /notes auth: none",
  "  step validate body",
  "  step insert Note",
  "}",
  "",
].join("\n");

function starterTemplate(template: string): string {
  if (template === "social-feed") return SOCIAL_FEED_STARTER;
  return MINIMAL_STARTER;
}

const CUSTOM_README = [
  "# Custom Code",
  "",
  "Files in this directory are owned by you.",
  "Arch may create stubs here, but it does not overwrite existing custom files.",
  "",
].join("\n");
