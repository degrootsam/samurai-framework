import { flowFactsFrom, type FlowFacts } from "../core/index.js";
import type { ResolvedGroup } from "../../runner/groups.js";

/** What `flowFacts` needs of a project's test, as the runner registers it */
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
  return flowFactsFrom(
    tests.map((t) => ({
      id: t.id,
      inputs: Object.entries(t.inputs ?? {}).map(([name, value]) => ({
        name,
        default: value,
      })),
      ...(t.outputs && { outputs: t.outputs }),
    })),
    groups,
  );
}
