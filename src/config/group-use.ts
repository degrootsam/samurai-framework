import type {
  GroupUse,
  SamuraiGroup,
  SamuraiTestConfig,
} from "../types/config.js";
import { isFixtureUseKey } from "./fixture-use.js";
import { USE_OPTION_NAMES, validateUseOptions } from "./use-options.js";

const isSize = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/** Rewrites `use(): locale must ...` as `config.groups[1].use.locale: locale must ...` */
function atGroup(place: string, err: unknown): never {
  if (!(err instanceof TypeError)) throw err;
  const problem = err.message.replace(/^use\(\): /, "");
  const name = /^(?:invalid |unknown )?(\w+)/.exec(problem)?.[1];
  const known =
    name !== undefined &&
    (name === "viewport" ||
      USE_OPTION_NAMES.includes(name) ||
      isFixtureUseKey(name));
  throw new TypeError(`${place}${known ? `.${name}` : ""}: ${problem}`);
}

/** Checks one `use` of a group or an environment; throws `<place>.locale: what is wrong` */
function validateUseAt(place: string, use: unknown): void {
  try {
    const isObject =
      typeof use === "object" && use !== null && !Array.isArray(use);
    const { viewport, ...options } = (isObject ? use : {}) as GroupUse;
    // Anything but an object is refused here, with the message `test.use()` gives
    validateUseOptions(isObject ? options : use);
    if (
      viewport !== undefined &&
      viewport !== null &&
      !(isSize(viewport.width) && isSize(viewport.height))
    )
      throw new TypeError(
        `viewport must be { width, height } with whole numbers above 0, or null, got ${JSON.stringify(viewport)}`,
      );
  } catch (err) {
    atGroup(place, err);
  }
}

/**
 * Checks the `use` of every group of the config: the options of config `use` (`test.use()` ones, and `viewport`),
 * and the fixture keys. Throws `config.groups[1].use.locale: what is wrong`.
 */
export function validateGroupUse(config: SamuraiTestConfig): void {
  config.groups?.forEach((group, index) => {
    if (group.use !== undefined)
      validateUseAt(`config.groups[${index}].use`, group.use);
  });
}

/** Checks the `use` of every environment the same way: `config.environments.production.use.locale: what is wrong` */
export function validateEnvironmentUse(config: SamuraiTestConfig): void {
  for (const [name, environment] of Object.entries(config.environments ?? {}))
    if (environment?.use !== undefined)
      validateUseAt(`config.environments.${name}.use`, environment.use);
}

/** The `use` of the group called `name`; nothing when there is no such group or it has none */
export function groupUseOf(
  groups: readonly SamuraiGroup[] | undefined,
  name: string,
): GroupUse {
  return groups?.find((group) => group.name === name)?.use ?? {};
}
