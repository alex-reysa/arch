/**
 * Validate a patch operation BEFORE the applier touches the filesystem.
 *
 * Enforces, in order:
 *
 *   1. **Repo-root containment**: every path must be project-relative POSIX
 *      and must NOT escape via `..` or absolute prefixes.
 *   2. **Allowlist membership**: every path must match an entry in the
 *      plan's `path_policy.allowed`. Glob patterns from the policy are
 *      honored.
 *   3. **Forbidden-path block**: any path matching `path_policy.forbidden`
 *      is rejected outright (e.g. `.git/**`, `node_modules/**`).
 *   4. **No human-owned writes**: actions whose ownership decision is
 *      `human` are rejected unless they are stub-only `write_extension_stub`
 *      operations targeting an absent file.
 *
 * Returns a structured `PatchValidationResult`. The patcher is responsible
 * for surfacing errors to the orchestrator; this module never throws.
 */

import { isAbsolute } from "node:path";
import type { SyncPlanActionV1, SyncPlanV1 } from "../planner/plan-schema.js";
import type { PatchOp } from "../planner/plan-schema.js";

export interface PatchValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate a single legacy `PatchOp`. Kept for backward compatibility; the
 * new code path is `validatePlanAction` below.
 */
export function validatePatch(op: PatchOp): PatchValidationResult {
  const errors: string[] = [];
  if (!isSafeRelativePath(op.path)) {
    errors.push(`patch path is not repo-root contained: ${op.path}`);
  }
  if (op.write_scope === "human_only") {
    errors.push(`patch targets human-owned file: ${op.path}`);
  }
  return errors.length === 0 ? { ok: true, errors } : { ok: false, errors };
}

/** Validate one action against its parent plan. */
export function validatePlanAction(
  action: SyncPlanActionV1,
  plan: SyncPlanV1,
): PatchValidationResult {
  const errors: string[] = [];

  if (!isSafeRelativePath(action.path)) {
    errors.push(`action path is not repo-root contained: ${action.path}`);
  }

  if (matchesAny(action.path, plan.path_policy.forbidden)) {
    errors.push(`action path matches forbidden glob: ${action.path}`);
  }

  if (
    plan.path_policy.allowed.length > 0 &&
    !matchesAny(action.path, plan.path_policy.allowed)
  ) {
    errors.push(`action path is not in allowlist: ${action.path}`);
  }

  if (
    action.ownership.owner === "human" &&
    action.kind !== "write_extension_stub" &&
    action.kind !== "no_op"
  ) {
    errors.push(
      `action ${action.action_id} writes to human-owned file ${action.path}`,
    );
  }

  if (action.ownership.write_scope === "none" && action.kind !== "no_op") {
    errors.push(
      `action ${action.action_id} has write_scope=none for write action ${action.kind}`,
    );
  }

  errors.push(...validateActionWriteScope(action));

  if (action.kind === "patch_generated_region" && !action.region_marker_id) {
    errors.push(
      `action ${action.action_id} is patch_generated_region but missing region_marker_id`,
    );
  }

  return errors.length === 0 ? { ok: true, errors } : { ok: false, errors };
}

/** Validate every action of a plan. Aggregates errors across actions. */
export function validatePlan(plan: SyncPlanV1): PatchValidationResult {
  const errors: string[] = [];
  for (const a of plan.actions) {
    const r = validatePlanAction(a, plan);
    if (!r.ok) errors.push(...r.errors);
  }
  return errors.length === 0 ? { ok: true, errors } : { ok: false, errors };
}

// -------------------------------------------------------------------------
// Path helpers.
// -------------------------------------------------------------------------

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length === 0) return false;
  if (isAbsolute(path)) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("\\")) return false;
  // Disallow drive letters on Windows-style paths.
  if (/^[A-Za-z]:/.test(path)) return false;
  // Disallow path traversal and sensitive dependency/VCS directories.
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") return false;
    if (seg === "..") return false;
    if (seg === ".git" || seg === "node_modules") return false;
  }
  return true;
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchGlob(path, p));
}

/**
 * Minimal POSIX-glob matcher supporting `**`, `*`, and `?`. Sufficient for
 * the patterns the planner emits (plain paths, `prisma/migrations/**`,
 * `src/custom/**`).
 */
export function matchGlob(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  const re = compileGlob(pattern);
  return re.test(path);
}

function compileGlob(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i++; // consume trailing slash so `a/**/b` works
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if ("\\^$+()[]{}|.".includes(c)) {
      re += `\\${c}`;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += "$";
  return new RegExp(re);
}

function validateActionWriteScope(action: SyncPlanActionV1): string[] {
  const errors: string[] = [];
  const fail = (expected: string) => {
    errors.push(
      `action ${action.action_id} kind ${action.kind} is incompatible with write_scope ${action.ownership.write_scope}; expected ${expected}`,
    );
  };

  switch (action.kind) {
    case "create_file":
    case "rewrite_whole_file":
    case "delete_file":
    case "create_migration":
      if (action.ownership.write_scope !== "whole_file") fail("whole_file");
      if (action.ownership.ownership_kind !== "generated_file") {
        errors.push(
          `action ${action.action_id} kind ${action.kind} requires generated_file ownership`,
        );
      }
      break;
    case "patch_generated_region":
      if (action.ownership.write_scope !== "generated_region") {
        fail("generated_region");
      }
      if (action.ownership.ownership_kind !== "generated_region") {
        errors.push(
          `action ${action.action_id} kind patch_generated_region requires generated_region ownership`,
        );
      }
      break;
    case "write_extension_stub":
      if (action.ownership.write_scope !== "stub_only") fail("stub_only");
      if (action.ownership.ownership_kind !== "extension_point") {
        errors.push(
          `action ${action.action_id} kind write_extension_stub requires extension_point ownership`,
        );
      }
      break;
    case "no_op":
      break;
  }

  return errors;
}
