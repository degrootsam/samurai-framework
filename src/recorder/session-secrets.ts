import { isGitIgnored } from "../project/index.js";
import type { PreparedRun } from "../runner/prepare-run.js";
import { parseSpec } from "../steps/parse.js";
import type { SamuraiTestConfig } from "../types/config.js";
import type { RecorderEvent } from "./normalise.js";
import type { ControllerOptions } from "./toolbar/types.js";

/** Every `secrets.<NAME>` a parsed value contains, at any depth */
function secretNames(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) node.forEach((item) => secretNames(item, found));
  else if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record.kind === "secret" && typeof record.name === "string")
      found.add(record.name);
    Object.values(record).forEach((item) => secretNames(item, found));
  }
}

/** What the toolbar shows of the project: its environment, variables, secrets and the test's screenshots */
export async function toolbarOptions(
  run: Pick<PreparedRun, "settings" | "secrets">,
  source: string,
  dir: string,
  config: Pick<SamuraiTestConfig, "environments">,
  testIndex: number,
): Promise<ControllerOptions> {
  const tests = parseSpec(source);
  const names = new Set(run.secrets.keys());
  secretNames(tests, names);
  const secrets: Record<string, string | undefined> = {};
  for (const name of names) secrets[name] = run.secrets.get(name);
  const { environment } = run.settings;
  return {
    environment,
    canAddVariables: typeof config.environments === "object",
    variables: run.settings.variables,
    secrets,
    secretsIgnored: await isGitIgnored(dir, `.env.${environment}`),
    inputs: Object.fromEntries(
      (tests[testIndex]?.inputs ?? []).map((input) => [
        input.name,
        input.default,
      ]),
    ),
    screenshots:
      tests[testIndex]?.steps.filter(({ step }) => step.kind === "screenshot")
        .length ?? 0,
  };
}

/** The secrets a recording needs set: those its steps read, then those added from the panel, once each */
export function resultSecrets(
  events: readonly RecorderEvent[],
  added: Iterable<string>,
): string[] {
  return [
    ...new Set([
      ...events.flatMap((event) =>
        event.op !== "remove" &&
        event.step.kind === "fill" &&
        event.step.value.kind === "secret"
          ? [event.step.value.name]
          : [],
      ),
      ...added,
    ]),
  ];
}
