import type { Field } from "../flows/core/index.js";
import type { TestFixtures } from "./test.js";

/** What a test sees when it is built with `test.extend()`: the built-in fixtures, a custom one of the same name replacing it */
export type FixturesOf<X> = Omit<TestFixtures, keyof X> & X;

/** `B` on top of `A`: a key in both takes the type from `B` */
export type MergeFixtures<A, B> = Omit<A, keyof B> & B;

/** One key of the value a fixture sets up, listed for the app and the report */
export interface FixtureOutput {
  name: string;
  label?: string;
  /** The test gets the key, but the report and the app never do */
  secret?: boolean;
}

/**
 * One setting of an option fixture, as data for a form: the flows field types, with paths relative to the option
 * object. `secret` stores the name of a secret and `variable` the name of a variable; the fixture receives the
 * resolved value.
 */
export type FixtureField =
  | Extract<
      Field,
      {
        type:
          | "text"
          | "code"
          | "expression"
          | "number"
          | "select"
          | "segmented"
          | "switch";
      }
    >
  | {
      path: string;
      label?: string;
      type: "secret" | "variable";
      default?: string;
    };

/** The options of a fixture written as `[fixture, options]` */
export interface FixtureOptions {
  /** Set the fixture up for every test, whether or not the test asks for it */
  auto?: boolean;
  /**
   * `"test"`: set up for each test (the default). `"worker"`: set up once per worker for the tests that use it with
   * the same options and environment, and torn down when the worker is done. A worker fixture gets no `page`.
   */
  scope?: "test" | "worker";
  /** The name in the app's catalog */
  label?: string;
  /** A design-system icon name */
  icon?: string;
  /** One sentence for the catalog */
  description?: string;
  /** The keys of the value the fixture sets up, when it is a flat record of strings, numbers and booleans */
  outputs?: FixtureOutput[];
  /** Milliseconds a setup or a teardown may take. @default the test timeout */
  timeout?: number;
  /** The fixture is the options of the fixture `<name without "Options">`: a value that `use` overrides key by key */
  option?: boolean;
  /** The form of an option fixture */
  fields?: FixtureField[];
}

/** A value, or a function that sets the value up, calls `use(value)` and cleans up once `use` returns */
export type FixtureValue<R, Args> =
  | Exclude<R, (...args: never[]) => unknown>
  | ((args: Args, use: (value: R) => Promise<void>) => Promise<void>);

/** What `test.extend()` takes: each fixture alone, or as `[fixture, options]` */
export type FixtureDefinitions<T, Existing> = {
  [K in keyof T]:
    | FixtureValue<T[K], FixturesOf<MergeFixtures<Existing, T>>>
    | [
        FixtureValue<T[K], FixturesOf<MergeFixtures<Existing, T>>>,
        FixtureOptions,
      ];
};
