import type { EachHook, Modifier, Suite } from "../types/test.js";

/** The four hook lists a suite can hold */
export type HookKind = "beforeEach" | "afterEach" | "beforeAll" | "afterAll";

/** One root suite per spec file; a `describe` block is a child of the suite it is written in */
const roots = new Map<string, Suite>();
/** The `describe` blocks being registered, outermost first */
const open: Suite[] = [];

export function newSuite(
  title?: string,
  parent?: Suite,
  modifier?: Modifier,
  reason?: string,
): Suite {
  return {
    ...(title !== undefined && { title }),
    ...(parent && { parent }),
    ...(modifier && { modifier }),
    ...(reason !== undefined && { reason }),
  };
}

/** The suite a test or hook written now belongs to: the innermost open `describe`, else the file's own */
export function currentSuite(file: string): Suite {
  const inner = open[open.length - 1];
  if (inner) return inner;
  let root = roots.get(file);
  if (!root) {
    root = newSuite();
    roots.set(file, root);
  }
  return root;
}

/** Opens a `describe` block under the current suite; `leaveSuite` closes it */
export function enterSuite(
  file: string,
  title: string,
  modifier?: Modifier,
  reason?: string,
): Suite {
  const suite = newSuite(title, currentSuite(file), modifier, reason);
  open.push(suite);
  return suite;
}

export function leaveSuite(): void {
  open.pop();
}

/** Forgets every suite: a run registers its specs afresh */
export function resetSuites(): void {
  roots.clear();
  open.length = 0;
}

/**
 * What applies to a test: the innermost `skip` or `fixme` (the test's own, then its suites', inside out), else
 * `only` when the test or any suite around it is focused. A skip beats a focus. The reason comes with the skip
 * or fixme that applies.
 */
export function modifierOf(own: Mark, suite: Suite): Mark {
  if (own.modifier === "skip" || own.modifier === "fixme") return markOf(own);
  let focused = own.modifier === "only";
  for (let s: Suite | undefined = suite; s; s = s.parent) {
    if (s.modifier === "only") focused = true;
    else if (s.modifier) return markOf(s);
  }
  return focused ? { modifier: "only" } : {};
}

/** A modifier and the reason given with it */
export interface Mark {
  modifier?: Modifier;
  reason?: string;
}

function markOf({ modifier, reason }: Mark): Mark {
  return {
    ...(modifier && { modifier }),
    ...(reason !== undefined && { reason }),
  };
}

/** The suites from the file's root down to `suite` */
export function suiteChain(suite: Suite): Suite[] {
  const chain: Suite[] = [];
  for (let s: Suite | undefined = suite; s; s = s.parent) chain.unshift(s);
  return chain;
}

/** The `beforeEach` hooks of a test: outermost suite first, in the order they were written */
export function beforeEachOf(suite: Suite): EachHook[] {
  return suiteChain(suite).flatMap((s) => s.beforeEach ?? []);
}

/** The `afterEach` hooks of a test: innermost suite first, in the order they were written */
export function afterEachOf(suite: Suite): EachHook[] {
  return suiteChain(suite)
    .reverse()
    .flatMap((s) => s.afterEach ?? []);
}

/** Adds a hook to the suite being registered */
export function addHook<K extends HookKind>(
  suite: Suite,
  kind: K,
  hook: NonNullable<Suite[K]>[number],
): void {
  ((suite[kind] ??= []) as unknown[]).push(hook);
}
