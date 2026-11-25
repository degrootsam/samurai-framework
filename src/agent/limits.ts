/** Hard limits of one agent run; reaching one ends the run cleanly with the steps written so far */
export interface AgentLimits {
  /** Model calls (loop turns). A tool call is not a turn */
  maxSteps: number;
  /** Input plus output tokens, summed over the run */
  maxTokens: number;
  /** Wall-clock time of the run in ms */
  timeoutMs: number;
}

/**
 * The most one model call may write. The AI SDK otherwise asks for the model's own maximum (64,000 tokens and more), which a gateway or a
 * provider account that caps `max_tokens` refuses. One step is a tool call or a few lines; this is far above what the agent writes.
 */
export const MAX_OUTPUT_TOKENS = 16_000;

export const DEFAULT_LIMITS: Readonly<AgentLimits> = {
  maxSteps: 40,
  maxTokens: 400_000,
  timeoutMs: 10 * 60_000,
};

/** The defaults with `overrides` on top; a limit that is not a positive finite number throws */
export function resolveLimits(
  overrides: Partial<AgentLimits> = {},
): AgentLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof AgentLimits)[]) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError(
        `agent(): limits.${key} must be a positive number, got ${String(value)}`,
      );
    limits[key] = value;
  }
  return limits;
}
