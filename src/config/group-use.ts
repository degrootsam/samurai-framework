import type {
  GroupUse,
  SamuraiGroup,
  SamuraiTestConfig,
} from "../types/config.js";
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
    (name === "viewport" || USE_OPTION_NAMES.includes(name));
  throw new TypeError(`${place}${known ? `.${name}` : ""}: ${problem}`);
}

/**
 * Checks the `use` of every group of the config: the options of config `use` (`test.use()` ones, and `viewport`).
 * Throws `config.groups[1].use.locale: what is wrong`.
 */
export function validateGroupUse(config: SamuraiTestConfig): void {
  config.groups?.forEach((group, index) => {
    if (group.use === undefined) return;
    const place = `config.groups[${index}].use`;
    try {
      const raw: unknown = group.use;
      const isObject =
        typeof raw === "object" && raw !== null && !Array.isArray(raw);
      const { viewport, ...options } = (isObject ? raw : {}) as GroupUse;
      // Anything but an object is refused here, with the message `test.use()` gives
      validateUseOptions(isObject ? options : raw);
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
  });
}

/** The `use` of the group called `name`; nothing when there is no such group or it has none */
export function groupUseOf(
  groups: readonly SamuraiGroup[] | undefined,
  name: string,
): GroupUse {
  return groups?.find((group) => group.name === name)?.use ?? {};
}
