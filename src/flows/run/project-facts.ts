import type { FlowFacts } from "../core/index.js";
import type { ResolvedGroup } from "../../runner/groups.js";

/** What `flowFacts` needs of a project's test */
interface TestIO {
  id: string;
  /** The inputs the test declares, with their defaults */
  inputs?: Record<string, string>;
  /** The outputs the test declares */
  outputs?: string[];
}

/** The facts a flow is checked and wired with: each test's declared inputs and outputs, and each group's tests */
export function flowFacts(
  tests: readonly TestIO[],
  groups: readonly Pick<ResolvedGroup, "name" | "testIds">[],
): FlowFacts {
  return {
    tests: Object.fromEntries(
      tests.map((t) => [
        t.id,
        {
          inputs: Object.entries(t.inputs ?? {}).map(([name, value]) => ({
            name,
            default: value,
          })),
          outputs: [...(t.outputs ?? [])],
        },
      ]),
    ),
    groups: Object.fromEntries(groups.map((g) => [g.name, [...g.testIds]])),
  };
}
