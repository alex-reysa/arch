import { createHash } from "node:crypto";

export function hashCanonical(canonicalJson: string): string {
  return createHash("sha256").update(canonicalJson).digest("hex");
}

export function hashFragment(canonicalJson: string): string {
  return createHash("sha256").update(canonicalJson).digest("hex");
}
