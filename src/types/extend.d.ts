import type { TestFixtures } from "./test.js";

/** What a test sees when it is built with `test.extend()`: the built-in fixtures, a custom one of the same name replacing it */
export type FixturesOf<X> = Omit<TestFixtures, keyof X> & X;

/** `B` on top of `A`: a key in both takes the type from `B` */
export type MergeFixtures<A, B> = Omit<A, keyof B> & B;

/** The options of a fixture written as `[fixture, options]` */
export interface FixtureOptions {
  /** Set the fixture up for every test, whether or not the test asks for it */
  auto?: boolean;
  /** Fixtures live as long as one test; worker-scoped fixtures are not supported */
  scope?: "test";
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
