import { defaultIgnore } from "../metrics/churn.js";

/**
 * Churn ignore for the bench. On top of the install/VCS noise from
 * {@link defaultIgnore}, it excludes:
 *  - `backend.arch` — the task INPUT, changed identically for every baseline.
 *  - `.arch/**` — Arch's private metadata (IR snapshots, plans, run reports),
 *    which only the Arch baselines write, so comparing it across baselines is
 *    apples-to-oranges.
 *  - `.arch-bench-bin/**` — the pnpm shim.
 *  - `tests/oracles/**` — independent oracle tests copied in by the harness,
 *    not written by the baseline.
 *
 * What remains is the actual project code: `src/**`, `tests/**` (generated),
 * `prisma/**`, and config files — the real "what did the baseline write" signal.
 */
export function benchChurnIgnore(path: string): boolean {
  return (
    defaultIgnore(path) ||
    path === "backend.arch" ||
    path === ".arch" ||
    path.startsWith(".arch/") ||
    path.startsWith(".arch-bench-bin/") ||
    path.startsWith("tests/oracles/")
  );
}
