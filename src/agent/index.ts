export { DEFAULT_LIMITS, resolveLimits, type AgentLimits } from "./limits.js";
export { assertModelObject, type AgentModel } from "./model.js";
export {
  defaultModelSpec,
  ModelSetupError,
  modelFromSpec,
} from "./providers.js";
export type {
  AgentEndReason,
  AgentEvent,
  AgentOptions,
  AgentResult,
  AgentSession,
} from "./types.js";
import { startAgent } from "./run.js";
import type { AgentOptions, AgentSession } from "./types.js";

/**
 * Starts the agent on a goal. The model is an AI SDK model object; the run opens a browser, writes typed steps
 * into the spec file as they succeed, and ends with an `ended` event whatever happens. Throws at once for a model
 * that is a string. Needs the optional packages `ai` and `zod`.
 */
export function runAgent(options: AgentOptions): AgentSession {
  return startAgent(options);
}
