export const REPAIR_AGENT_ROLE = "repair" as const;

/**
 * Repair agent: bounded patch attempts driven by verification failures.
 * The orchestrator caps attempts so a failed apply cannot loop forever.
 */
