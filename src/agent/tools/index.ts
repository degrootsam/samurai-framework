import { act } from "./act.js";
import { ask } from "./ask.js";
import type { AgentTool, ToolContext } from "./context.js";
import { expectTool } from "./expect.js";
import { finish } from "./finish.js";
import { navigate } from "./navigate.js";
import { screenshot } from "./screenshot.js";
import { snapshot } from "./snapshot.js";
import { undo } from "./undo.js";
import { useSecret } from "./use-secret.js";

/** The agent's tools, bound to a run. Nothing else reaches the browser, the spec file or the person */
export function createTools(context: ToolContext): AgentTool[] {
  return [
    snapshot,
    navigate,
    act,
    expectTool,
    screenshot,
    useSecret,
    undo,
    ask,
    finish,
  ].map((tool) => tool(context));
}
