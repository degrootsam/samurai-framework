import { NODE_FIELDS, RUN_FIELDS, type ExpressionScope } from "./check.js";

export interface HelpEntry {
  label: string;
  insert: string;
  detail?: string;
}
export interface HelpSections {
  nodes: HelpEntry[];
  vars: HelpEntry[];
  env: HelpEntry[];
  run: HelpEntry[];
}

const access = (root: string, name: string) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? `${root}.${name}` : `${root}["${name}"]`;

const NODE_DETAIL: Record<(typeof NODE_FIELDS)[number], string> = {
  status: '"passed", "failed" or "skipped"',
  durationMs: "how long it took, in ms",
  error: "its error message, when it failed",
};
const RUN_DETAIL: Record<(typeof RUN_FIELDS)[number], string> = {
  environment: "the environment this run uses",
  trigger: '"manual"',
  startedAt: "when the run started (ISO time)",
};

/** What an expression at a node can use, as entries to insert; the same names the checker accepts */
export function helpEntries(scope: ExpressionScope): HelpSections {
  return {
    nodes: scope.before.flatMap((key) =>
      NODE_FIELDS.map((f) => ({
        label: `${key}.${f}`,
        insert: `nodes.${key}.${f}`,
        detail: NODE_DETAIL[f],
      })),
    ),
    vars: scope.vars.map((name) => ({
      label: name,
      insert: access("vars", name),
    })),
    env: scope.env.variables.map((name) => ({
      label: name,
      insert: access("env", name),
      detail: scope.env.name,
    })),
    run: RUN_FIELDS.map((f) => ({
      label: f,
      insert: `run.${f}`,
      detail: RUN_DETAIL[f],
    })),
  };
}

/** Inserts text at the cursor; returns the new value and cursor */
export function insertAt(value: string, cursor: number, text: string) {
  return {
    value: value.slice(0, cursor) + text + value.slice(cursor),
    cursor: cursor + text.length,
  };
}

export const HELPER_DOCS: {
  name: string;
  signature: string;
  example: string;
  description: string;
}[] = [
  {
    name: "contains",
    signature: "contains(list or text, value)",
    example: 'contains(vars.tags, "vip")',
    description: "Whether a list has the value, or text contains it",
  },
  {
    name: "startsWith",
    signature: "startsWith(text, start)",
    example: 'startsWith(run.environment, "prod")',
    description: "Whether text starts with the given text",
  },
  {
    name: "matches",
    signature: "matches(text, /pattern/)",
    example: "matches(env.baseURL, /^https:/)",
    description: "Whether text matches a regular expression",
  },
  {
    name: "len",
    signature: "len(list or text)",
    example: "len(vars.items) > 0",
    description: "How many items a list has, or characters a text",
  },
  {
    name: "exists",
    signature: "exists(value)",
    example: "exists(vars.orderId)",
    description: "Whether a value is set",
  },
];
