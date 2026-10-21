/**
 * What this framework can do, as plain data. The SAMURAI app reads it from a project's own copy
 * of the framework to know which features that copy supports, so it asks instead of guessing.
 * Imports nothing, so it is cheap to load; a key that is missing means the copy is too old to
 * support it. Every value must survive `JSON.stringify`.
 */
export const CAPABILITIES = {
  /** Test groups: a group name on a test and running one group. */
  groups: true,
  /** The toolbar the recorder shows in the page it records. */
  recorderToolbar: true,
  /** The recorder writing its recording to files in the project. */
  recorderFiles: true,
  /** The flows contract version; a test keeps it equal to `FLOWS_API`. */
  flowsApi: 2,
  /** Steps that flows can run, including project steps made with `defineStep`. */
  flowSteps: true,
  /** Browsers the framework downloads and manages itself. */
  managedBrowsers: true,
  /** Modifiers on tests, such as `skip`, `only` and `fixme`. */
  modifiers: true,
  /** A reason given with a skipped test, shown in the results. */
  skipReason: true,
} as const;

/** The shape of {@link CAPABILITIES}. */
export type Capabilities = typeof CAPABILITIES;
