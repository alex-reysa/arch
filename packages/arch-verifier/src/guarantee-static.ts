/**
 * Static guarantee-pattern detectors.
 *
 * These inspect generated workflow source for the *shape* of a guarantee
 * violation, complementing hash-based drift detection: hash drift says "this
 * file changed", the static detector says "and the change broke the
 * `notification_failure_does_not_rollback_post` guarantee".
 *
 * V1 ships one detector — the one named in the founding plan §7.14.
 */

/**
 * Detect a `notification_failure_does_not_rollback_post` violation.
 *
 * The generated-correct shape wraps every post-persistence integration call in
 * `try { await X.op(...); } catch {}` so a notification failure is swallowed and
 * the persisted record survives. A violation is an awaited integration call
 * (`await Pascal.op(...)`) that occurs AFTER the persistence step but is NOT
 * inside a try block — its rejection would propagate and could roll back the
 * persisted record.
 *
 * Returns a human-readable reason string when a violation is detected, or
 * `null` when the source is safe (or has no persistence step at all).
 */
export function detectNotificationRollbackViolation(source: string): string | null {
  const lines = source.split("\n");

  // Anchor: the persistence step. Generated inserts read `const inserted =
  // await createX(...)`.
  let insertLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/=\s*await\s+create[A-Z]\w*\(/.test(lines[i]!) || /\binserted\s*=\s*await\b/.test(lines[i]!)) {
      insertLine = i;
      break;
    }
  }
  if (insertLine < 0) return null; // no persistence → guarantee not applicable

  // Track try-block nesting with a brace-frame stack. A frame is `true` when it
  // was opened by a `try`.
  const stack: boolean[] = [];
  let pendingTry = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // An awaited integration call is `await Pascal.method(`. Insert calls
    // (`await createPost(`) are lowercase + dotless, so they don't match.
    const isAwaitedIntegrationCall = /await\s+[A-Z]\w*\.\w+\s*\(/.test(line);
    if (i > insertLine && isAwaitedIntegrationCall && !stack.some(Boolean)) {
      return `awaited integration call after persistence is not wrapped in try/catch (line ${i + 1}); a notification failure would propagate and could roll back the persisted record`;
    }

    if (/\btry\b/.test(line)) pendingTry = true;
    for (const ch of line) {
      if (ch === "{") {
        stack.push(pendingTry);
        pendingTry = false;
      } else if (ch === "}") {
        stack.pop();
      }
    }
  }

  return null;
}
