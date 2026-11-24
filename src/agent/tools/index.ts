import { act } from "./act.js";
import { addScreenshot } from "./add-screenshot.js";
import { ask } from "./ask.js";
import type { AgentTool, ToolContext } from "./context.js";
import { expectTool } from "./expect.js";
import { finish } from "./finish.js";
import { navigate } from "./navigate.js";
import { planStepTool } from "./plan-step.js";
import { screenshot } from "./screenshot.js";
import { snapshot } from "./snapshot.js";
import { undo } from "./undo.js";
import { useSecret } from "./use-secret.js";
import { wait } from "./wait.js";

/** The agent's tools, bound to a run. Nothing else reaches the browser, the spec file or the person */
export function createTools(context: ToolContext, planSteps = 0): AgentTool[] {
  return [
    snapshot,
    navigate,
    act,
    expectTool,
    addScreenshot,
    wait,
    screenshot,
    useSecret,
    undo,
    ask,
    ...(planSteps > 0 ? [planStepTool(planSteps)] : []),
    finish,
  ].map((tool) => tool(context));
}
