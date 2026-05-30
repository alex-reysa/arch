/**
 * IntentChange is defined in @arch/sync — but the generator package must not
 * depend on @arch/sync. We accept a structural shape so this stays at the
 * IR layer without re-exporting sync types.
 */
type IntentChange = { readonly kind: string };

export interface MigrationFile {
  readonly path: string;
  readonly content: string;
  readonly destructive: boolean;
}

/**
 * Emit Prisma migration scaffolds for additive intent changes.
 * Refuses to silently produce destructive migrations — those require
 * explicit confirmation in the apply flow.
 */
export function writeMigrationsFor(_changes: readonly IntentChange[]): readonly MigrationFile[] {
  // TODO: handle model_added, model_field_added, etc.
  return [];
}
