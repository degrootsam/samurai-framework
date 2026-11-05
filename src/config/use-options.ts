import type { SamuraiTestConfig } from "../types/config.js";
import type { UseOptions } from "../types/use.js";
import { checkFixtureUse, isFixtureUseKey } from "./fixture-use.js";

/** The options of `use`: config, group, `test.use()` and (those that can change at run time) `page.use()` */
export const USE_OPTION_NAMES: readonly string[] = [
  "locale",
  "timezone",
  "userAgent",
  "geolocation",
  "offline",
  "orientation",
  "screen",
  "javaScriptEnabled",
  "acceptInsecureCerts",
  "hasTouch",
  "isMobile",
  "storageState",
  "extraHTTPHeaders",
  "colorScheme",
];

/** A name that was in use once, and the one that replaced it: refused with a message that says which */
const RENAMED: Record<string, string> = {
  timezoneId: "timezone",
  touch: "hasTouch",
};

const ORIENTATIONS = [
  "portrait-primary",
  "portrait-secondary",
  "landscape-primary",
  "landscape-secondary",
] as const;

/** These may be `null` (the real value back) */
const NULLABLE_BOOLEANS = ["javaScriptEnabled", "hasTouch", "offline"] as const;
const BOOLEANS = ["acceptInsecureCerts", "isMobile"] as const;

const COLOR_SCHEMES = ["light", "dark", "no-preference"];
const HEADER_NAME = /^[\w!#$%&'*+.^`|~-]+$/;

const fail = (problem: string): never => {
  throw new TypeError(`use(): ${problem}`);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks the options of `test.use()` or of the config's `use` and returns them. The config's `use` also holds
 * options that are not these (`viewport`, `headless`, ...), so it passes `allowOthers`; `test.use()` refuses
 * a key it does not know. Throws `use(): what is wrong`.
 */
export function validateUseOptions(
  options: unknown,
  allowOthers = false,
): UseOptions {
  if (!isObject(options)) return fail("the options must be an object");
  for (const key of Object.keys(options)) {
    const renamed = RENAMED[key];
    if (renamed !== undefined)
      fail(`unknown option "${key}"; use "${renamed}"`);
    if (
      !allowOthers &&
      !USE_OPTION_NAMES.includes(key) &&
      !isFixtureUseKey(key)
    )
      fail(`unknown option "${key}"`);
  }
  checkFixtureUse(options);
  const use = options as UseOptions;
  for (const name of BOOLEANS)
    if (use[name] !== undefined && typeof use[name] !== "boolean")
      fail(`${name} must be true or false, got ${JSON.stringify(use[name])}`);
  for (const name of NULLABLE_BOOLEANS)
    if (use[name] != null && typeof use[name] !== "boolean")
      fail(
        `${name} must be true, false or null, got ${JSON.stringify(use[name])}`,
      );
  if (use.locale !== null) checkLocale(use.locale);
  if (use.timezone !== null) checkTimezone(use.timezone);
  if (use.userAgent != null && !nonEmpty(use.userAgent))
    fail("userAgent must be a non-empty string");
  checkGeolocation(use.geolocation);
  checkOrientation(use.orientation);
  checkScreen(use.screen);
  if (use.colorScheme !== undefined && !COLOR_SCHEMES.includes(use.colorScheme))
    fail(
      `colorScheme must be "light", "dark" or "no-preference", got ${JSON.stringify(use.colorScheme)}`,
    );
  checkHeaders(use.extraHTTPHeaders);
  checkStorageState(use.storageState);
  return use;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

function checkLocale(locale: unknown): void {
  if (locale === undefined) return;
  try {
    if (!nonEmpty(locale) || Intl.getCanonicalLocales(locale).length !== 1)
      throw new RangeError();
  } catch {
    fail(`invalid locale ${JSON.stringify(locale)}`);
  }
}

function checkTimezone(timezone: unknown): void {
  if (timezone === undefined) return;
  try {
    if (!nonEmpty(timezone)) throw new RangeError();
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    fail(`unknown timezone ${JSON.stringify(timezone)}`);
  }
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

function checkGeolocation(place: unknown): void {
  if (place === undefined || place === null) return;
  if (!isObject(place))
    return fail("geolocation must be { latitude, longitude } or null");
  const { latitude, longitude, accuracy } = place;
  if (!isNumber(latitude) || latitude < -90 || latitude > 90)
    fail("latitude must be between -90 and 90");
  if (!isNumber(longitude) || longitude < -180 || longitude > 180)
    fail("longitude must be between -180 and 180");
  if (accuracy !== undefined && (!isNumber(accuracy) || accuracy < 0))
    fail("accuracy must be 0 or more");
}

function checkOrientation(orientation: unknown): void {
  if (orientation === undefined || orientation === null) return;
  const type =
    orientation === "portrait" || orientation === "landscape"
      ? `${orientation}-primary`
      : orientation;
  if (!ORIENTATIONS.includes(type as never))
    fail(`unknown orientation ${JSON.stringify(orientation)}`);
}

function checkScreen(screen: unknown): void {
  if (screen === undefined || screen === null) return;
  if (
    !isObject(screen) ||
    !(isPositiveInteger(screen.width) && isPositiveInteger(screen.height))
  )
    fail("screen width and height must be positive integers");
}

function checkHeaders(headers: unknown): void {
  if (headers === undefined) return;
  if (!isObject(headers))
    fail("extraHTTPHeaders must be an object of header names and values");
  for (const [name, value] of Object.entries(headers as object))
    if (!HEADER_NAME.test(name))
      fail(`extraHTTPHeaders has an invalid header name "${name}"`);
    else if (typeof value !== "string")
      fail(`extraHTTPHeaders "${name}" must be a string`);
}

function checkStorageState(state: unknown): void {
  if (state === undefined) return;
  if (typeof state === "string") {
    if (state === "") fail("storageState must not be an empty path");
    return;
  }
  if (!isObject(state))
    return fail("storageState must be a file path or an object");
  checkStorageStateObject(state);
}

/** Checks a storage state object, whether it came from the options or from a file */
export function checkStorageStateObject(state: Record<string, unknown>): void {
  for (const key of ["cookies", "origins"])
    if (state[key] !== undefined && !Array.isArray(state[key]))
      fail(`storageState.${key} must be an array`);
  for (const cookie of (state.cookies ?? []) as unknown[]) {
    if (
      !isObject(cookie) ||
      !nonEmpty(cookie.name) ||
      typeof cookie.value !== "string" ||
      !nonEmpty(cookie.domain)
    )
      fail("every storageState cookie needs a name, a value and a domain");
  }
  for (const origin of (state.origins ?? []) as unknown[]) {
    if (
      !isObject(origin) ||
      !nonEmpty(origin.origin) ||
      !Array.isArray(origin.localStorage ?? [])
    )
      fail("every storageState origin needs an origin and a localStorage list");
  }
}

/** The options after `layers` are applied in order: a later layer wins, key by key */
export function mergeUse<T extends UseOptions>(layers: readonly T[]): T {
  return Object.assign({}, ...layers) as T;
}

/** Checks the new options of a config's `use` */
export function validateUseConfig(config: SamuraiTestConfig): void {
  if (config.use !== undefined) validateUseOptions(config.use, true);
}

/** The options of `test.use()` that a config's `use` holds, without the rest (`viewport`, `headless`, ...) */
export function useOptionsOf(configUse: object | undefined): UseOptions {
  return Object.fromEntries(
    Object.entries(configUse ?? {}).filter(([key]) =>
      USE_OPTION_NAMES.includes(key),
    ),
  );
}
