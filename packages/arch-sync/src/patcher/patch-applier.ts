/**
 * Apply a `SyncPlanV1` to a project directory.
 *
 * The applier:
 *   1. Validates every action against the plan's `path_policy`.
 *   2. Computes the project-relative path of every action and writes content
 *      atomically (temp file + rename) — but the actual content for each
 *      action is supplied by the caller via the `ContentProvider` interface.
 *      That keeps the applier decoupled from the generator package.
 *   3. Returns a structured result with `applied`, `skipped`, and `errors`.
 *
 * The applier deliberately does NOT touch metadata (`.arch/...`) — that is
 * the job of `metadata-update.ts`, which only runs on verification success.
 *
 * The legacy `applyPatches(ops)` shim returns an empty result so callers
 * that have not yet migrated continue to compile.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWriteText } from "../atomic-write.js";
import {
  isSafeRelativePath,
  validatePlan,
} from "./patch-validator.js";
import type {
  PatchOp,
  SyncPlanActionV1,
  SyncPlanV1,
} from "../planner/plan-schema.js";

export interface ApplyResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  readonly errors: readonly string[];
}

/** Maps an action to the file content the applier should write. */
export interface ContentProvider {
  /**
   * Return the bytes to write for `action`. Return `null` to skip
   * (e.g. stub-only files that already exist).
   */
  contentFor(action: SyncPlanActionV1): Promise<string | null> | string | null;
}

export interface ApplyPlanOptions {
  readonly projectRoot: string;
  readonly plan: SyncPlanV1;
  readonly contentProvider: ContentProvider;
}

export async function applyPlan(options: ApplyPlanOptions): Promise<ApplyResult> {
  const { projectRoot, plan, contentProvider } = options;
  const applied: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const planValidation = validatePlan(plan);
  if (!planValidation.ok) {
    return { applied, skipped, errors: [...planValidation.errors] };
  }

  for (const action of plan.actions) {
    if (!isSafeRelativePath(action.path)) {
      errors.push(`unsafe path: ${action.path}`);
      continue;
    }

    const target = resolve(projectRoot, action.path);
    const content = await Promise.resolve(contentProvider.contentFor(action));

    if (content === null) {
      skipped.push(action.path);
      continue;
    }

    if (action.kind === "delete_file") {
      try {
        const { unlink } = await import("node:fs/promises");
        if (existsSync(target)) {
          await unlink(target);
          applied.push(action.path);
        } else {
          skipped.push(action.path);
        }
      } catch (err) {
        errors.push(`failed to delete ${action.path}: ${describeError(err)}`);
      }
      continue;
    }

    if (action.kind === "write_extension_stub" && existsSync(target)) {
      // Stub-only ownership: never overwrite an existing file.
      skipped.push(action.path);
      continue;
    }

    try {
      await atomicWriteText(target, content);
      applied.push(action.path);
    } catch (err) {
      errors.push(`failed to write ${action.path}: ${describeError(err)}`);
    }
  }

  return { applied, skipped, errors };
}

/** Legacy shim. New code should use `applyPlan`. */
export async function applyPatches(_ops: readonly PatchOp[]): Promise<ApplyResult> {
  return { applied: [], skipped: [], errors: [] };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
