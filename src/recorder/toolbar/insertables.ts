import type { ToolbarState } from "./protocol.js";

/** What the Insert list shows of the variables, secrets (names only) and inputs the controller holds */
export function insertablesOf(held: {
  variables: ReadonlyMap<string, string>;
  secrets: ReadonlyMap<string, string | undefined>;
  inputs: ReadonlyMap<string, string>;
}): Pick<ToolbarState, "variables" | "secrets" | "inputs"> {
  const named = ([name, value]: [string, string]) => ({ name, value });
  return {
    variables: [...held.variables].map(named),
    secrets: [...held.secrets].map(([name, value]) => ({
      name,
      set: value !== undefined,
    })),
    inputs: [...held.inputs].map(named),
  };
}
