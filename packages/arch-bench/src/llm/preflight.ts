/** Preflight checks for selected live-agent CLI providers. */

import { spawnSync } from "node:child_process";
import type { LiveAgentProvider } from "./agent-runner.js";

export interface LiveCliConfig {
  readonly bins: Record<LiveAgentProvider, string>;
  readonly models: Record<LiveAgentProvider, string>;
}

export interface LivePreflightSpawnResult {
  readonly status: number | null;
  readonly stdout?: string | Buffer | null;
  readonly stderr?: string | Buffer | null;
  readonly error?: Error;
}

export type LivePreflightSpawn = (
  bin: string,
  args: readonly string[],
  opts: { readonly encoding: "utf8" },
) => LivePreflightSpawnResult;

export function preflightLiveProviders(
  providers: readonly LiveAgentProvider[],
  config: LiveCliConfig,
  spawn: LivePreflightSpawn = defaultSpawn,
): { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] } {
  const errors: string[] = [];
  for (const provider of providers) {
    const err = preflightProvider(provider, config, spawn);
    if (err) errors.push(err);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function preflightProvider(
  provider: LiveAgentProvider,
  config: LiveCliConfig,
  spawn: LivePreflightSpawn,
): string | undefined {
  const bin = config.bins[provider];
  const model = config.models[provider];
  if (provider === "claude-code") {
    const r = spawn(bin, ["--version"], { encoding: "utf8" });
    if (r.error || r.status !== 0) return `\`${bin}\` CLI not available; cannot run Claude baselines`;
    return undefined;
  }

  const r = spawn(bin, ["models"], { encoding: "utf8" });
  const output = `${text(r.stdout)}\n${text(r.stderr)}`;
  if (r.error || r.status !== 0) return `\`${bin} models\` failed; authenticate/install before running ${provider}`;
  if (/not authenticated/i.test(output)) {
    return `\`${bin}\` is not authenticated; run ${provider === "grok-build" ? "grok login" : "cursor-agent login"}`;
  }
  if (!modelListed(output, model)) return `\`${bin} models\` did not list required model \`${model}\``;
  return undefined;
}

function defaultSpawn(bin: string, args: readonly string[], opts: { readonly encoding: "utf8" }): LivePreflightSpawnResult {
  const r = spawnSync(bin, [...args], opts);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    ...(r.error ? { error: r.error } : {}),
  };
}

function text(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function modelListed(output: string, model: string): boolean {
  return output.split(/\s+/).some((token) => token.replace(/^[*•-]+/, "") === model);
}
