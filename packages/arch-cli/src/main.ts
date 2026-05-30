#!/usr/bin/env node
import { runInit } from "./commands/init.js";
import { runParse } from "./commands/parse.js";
import { runPlan } from "./commands/plan.js";
import { runApply } from "./commands/apply.js";
import { runCheck } from "./commands/check.js";
import { runRepair } from "./commands/repair.js";

type CommandHandler = (argv: string[]) => Promise<number>;

const COMMANDS: Record<string, CommandHandler> = {
  init: runInit,
  parse: runParse,
  plan: runPlan,
  apply: runApply,
  check: runCheck,
  repair: runRepair,
};

function printHelp(): void {
  process.stdout.write(
    [
      "arch — spec-to-code synchronization CLI",
      "",
      "Usage: arch <command> [options]",
      "",
      "Commands:",
      "  init      Initialize an Arch project (writes backend.arch and .arch/)",
      "  parse     Parse backend.arch and report diagnostics",
      "  plan      Compute typed diff and produce a sync plan",
      "  apply     Apply a sync plan with verification gating",
      "  check     Check drift and metadata health",
      "  repair    Run a bounded repair attempt against the last failed plan",
      "",
      "Run `arch <command> --help` for command-specific options.",
      "",
    ].join("\n")
  );
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`unknown command: ${command}\n`);
    printHelp();
    return 64;
  }
  return handler(rest);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(70);
  }
);
