import type { Variables } from "./run-settings.js";

export class UnknownVariableError extends Error {
  constructor(name: string, environment: string) {
    super(`Variable "${name}" is not defined in environment "${environment}"`);
    this.name = "UnknownVariableError";
  }
}

/**
 * Keys that every object answers and that `await`, JSON.stringify and util.inspect probe:
 * symbols, `then`, `toJSON` and Object.prototype members. Reading them never throws.
 */
export function isPassthroughKey(target: object, key: string | symbol): boolean {
  return (
    typeof key === "symbol" ||
    key === "then" ||
    key === "toJSON" ||
    (!Object.prototype.hasOwnProperty.call(target, key) && key in target)
  );
}

/** The test's `env`: the environment's variables, read-only; an unknown name throws */
export function createEnvFixture(environment: string, variables: Variables): Readonly<Variables> {
  return new Proxy(Object.freeze({ ...variables }), {
    get(target, key, receiver) {
      if (isPassthroughKey(target, key) || Object.prototype.hasOwnProperty.call(target, key)) return Reflect.get(target, key, receiver);
      throw new UnknownVariableError(String(key), environment);
    },
  });
}
