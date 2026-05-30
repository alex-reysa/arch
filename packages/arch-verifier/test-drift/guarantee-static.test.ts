import { describe, expect, it } from "vitest";
import { detectNotificationRollbackViolation } from "../src/guarantee-static.js";

const SAFE = `
export async function runCreatePost(input: unknown) {
  const validation = validateCreatePostInput(input);
  const payload = { ...validation.value };
  const postInsertValidation = validatePost(payload);
  const inserted = await createPost(postInsertValidation.value);
  // step: call (post-persistence; failure does NOT rollback)
  try {
    await PushNotifier.send(inserted);
  } catch {
    // swallowed by design
  }
  return { ok: true, value: inserted };
}
`;

const VIOLATION = `
export async function runCreatePost(input: unknown) {
  const payload = { ...input };
  const inserted = await createPost(payload);
  // a developer removed the try/catch — failure now propagates
  await PushNotifier.send(inserted);
  return { ok: true, value: inserted };
}
`;

const NO_PERSISTENCE = `
export async function runReadOnly(input: unknown) {
  await PushNotifier.send(input);
  return { ok: true };
}
`;

describe("detectNotificationRollbackViolation", () => {
  it("returns null for the generated-correct (try/catch-wrapped) shape", () => {
    expect(detectNotificationRollbackViolation(SAFE)).toBeNull();
  });

  it("flags an awaited post-persistence integration call not wrapped in try/catch", () => {
    const reason = detectNotificationRollbackViolation(VIOLATION);
    expect(reason).not.toBeNull();
    expect(reason!).toMatch(/try\/catch/);
  });

  it("returns null when there is no persistence step (guarantee not applicable)", () => {
    expect(detectNotificationRollbackViolation(NO_PERSISTENCE)).toBeNull();
  });
});
