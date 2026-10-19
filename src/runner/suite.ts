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
): Suite {
  return {
    ...(title !== undefined && { title }),
    ...(parent && { parent }),
    ...(modifier && { modifier }),
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
): Suite {
  const suite = newSuite(title, currentSuite(file), modifier);
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
 * `only` when the test or any suite around it is focused. A skip beats a focus.
 */
export function modifierOf(
  own: Modifier | undefined,
  suite: Suite,
): Modifier | undefined {
  let focused = own === "only";
  let found: Modifier | undefined = own === "only" ? undefined : own;
  for (let s: Suite | undefined = suite; s && !found; s = s.parent) {
    if (s.modifier === "only") focused = true;
    else found = s.modifier;
  }
  return found ?? (focused ? "only" : undefined);
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
