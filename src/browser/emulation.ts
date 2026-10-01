import { UnsupportedOperationError } from "../locator/selector-errors.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { BiDiCommands } from "../types/bidi.js";

const ORIENTATIONS = [
  "portrait-primary",
  "portrait-secondary",
  "landscape-primary",
  "landscape-secondary",
] as const;
type OrientationType = (typeof ORIENTATIONS)[number];

/**
 * What to pretend about the browser. `undefined` leaves an option as it is, `null` puts the real value back.
 * Which options a browser supports differs: an unsupported one throws UnsupportedOperationError.
 */
export interface EmulationOptions {
  /** A BCP 47 tag, e.g. "nl-NL": `navigator.language`, `Intl` formatting */
  locale?: string | null;
  /** An IANA timezone, e.g. "Europe/Amsterdam" */
  timezone?: string | null;
  userAgent?: string | null;
  /** Needs the geolocation permission: see `page.grantPermission("geolocation")` */
  geolocation?: { latitude: number; longitude: number; accuracy?: number } | null;
  /** `true`: no network (`navigator.onLine` is false and requests fail); `false` or `null`: back online */
  offline?: boolean | null;
  /** "portrait" and "landscape" mean the primary orientation of that kind */
  orientation?: "portrait" | "landscape" | OrientationType | null;
  /** The size `screen.width` and `screen.height` report */
  screen?: { width: number; height: number } | null;
  /** How many touch points `navigator.maxTouchPoints` reports */
  touch?: number | null;
  /** `false` turns JavaScript off; `true` or `null` on again */
  javaScriptEnabled?: boolean | null;
}

export type EmulationTarget = { contexts: string[] } | { userContexts: string[] };

/** A part of the options could not be applied; what was applied before it stays applied */
export class EmulationError extends Error {
  /** The options that were applied before the failure, in the order they were applied */
  public readonly applied: string[];
  public readonly failed: string;
  public readonly cause: unknown;

  constructor(failed: string, applied: string[], cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`emulate(): ${failed} failed${applied.length ? ` after applying ${applied.join(", ")}` : ""}: ${detail}`);
    this.name = "EmulationError";
    this.failed = failed;
    this.applied = applied;
    this.cause = cause;
  }
}

/** The browser does not implement an emulation command */
export class EmulationUnsupportedError extends UnsupportedOperationError {
  public readonly option: string;
  public readonly applied: string[];

  constructor(option: string, applied: string[]) {
    super(`emulate({ ${option} }) is not supported by the browser`);
    this.name = "EmulationUnsupportedError";
    this.option = option;
    this.applied = applied;
  }
}

interface Step {
  option: string;
  method: keyof BiDiCommands & `emulation.${string}`;
  params: object;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

/** Turns the options into commands, in a fixed order; throws RangeError for an invalid value, before anything is sent */
function plan(options: EmulationOptions): Step[] {
  const steps: Step[] = [];

  if (options.locale !== undefined) {
    if (options.locale !== null) {
      try {
        if (options.locale === "" || Intl.getCanonicalLocales(options.locale).length !== 1) throw new RangeError();
      } catch {
        throw new RangeError(`emulate(): invalid locale "${options.locale}"`);
      }
    }
    steps.push({ option: "locale", method: "emulation.setLocaleOverride", params: { locale: options.locale } });
  }

  if (options.timezone !== undefined) {
    if (options.timezone !== null) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: options.timezone });
      } catch {
        throw new RangeError(`emulate(): unknown timezone "${options.timezone}"`);
      }
    }
    steps.push({ option: "timezone", method: "emulation.setTimezoneOverride", params: { timezone: options.timezone } });
  }

  if (options.userAgent !== undefined) {
    if (options.userAgent === "") throw new RangeError("emulate(): userAgent must not be empty");
    steps.push({ option: "userAgent", method: "emulation.setUserAgentOverride", params: { userAgent: options.userAgent } });
  }

  if (options.geolocation !== undefined) {
    const place = options.geolocation;
    if (place !== null) {
      if (!isNumber(place.latitude) || place.latitude < -90 || place.latitude > 90) {
        throw new RangeError("emulate(): latitude must be between -90 and 90");
      }
      if (!isNumber(place.longitude) || place.longitude < -180 || place.longitude > 180) {
        throw new RangeError("emulate(): longitude must be between -180 and 180");
      }
      if (place.accuracy !== undefined && (!isNumber(place.accuracy) || place.accuracy < 0)) {
        throw new RangeError("emulate(): accuracy must be 0 or more");
      }
    }
    steps.push({
      option: "geolocation",
      method: "emulation.setGeolocationOverride",
      params: { coordinates: place },
    });
  }

  if (options.offline !== undefined) {
    steps.push({
      option: "offline",
      method: "emulation.setNetworkConditions",
      params: { networkConditions: options.offline ? { type: "offline" } : null },
    });
  }

  if (options.orientation !== undefined) {
    let screenOrientation: { natural: "portrait" | "landscape"; type: OrientationType } | null = null;
    if (options.orientation !== null) {
      const type = (
        options.orientation === "portrait" || options.orientation === "landscape"
          ? `${options.orientation}-primary`
          : options.orientation
      ) as OrientationType;
      if (!ORIENTATIONS.includes(type)) throw new RangeError(`emulate(): unknown orientation "${options.orientation}"`);
      screenOrientation = { natural: type.startsWith("portrait") ? "portrait" : "landscape", type };
    }
    steps.push({ option: "orientation", method: "emulation.setScreenOrientationOverride", params: { screenOrientation } });
  }

  if (options.screen !== undefined) {
    const area = options.screen;
    if (area !== null && !(isPositiveInteger(area.width) && isPositiveInteger(area.height))) {
      throw new RangeError("emulate(): screen width and height must be positive integers");
    }
    steps.push({ option: "screen", method: "emulation.setScreenSettingsOverride", params: { screenArea: area } });
  }

  if (options.touch !== undefined) {
    if (options.touch !== null && !isPositiveInteger(options.touch)) {
      throw new RangeError("emulate(): touch must be a positive integer");
    }
    steps.push({ option: "touch", method: "emulation.setTouchOverride", params: { maxTouchPoints: options.touch } });
  }

  if (options.javaScriptEnabled !== undefined) {
    steps.push({
      option: "javaScriptEnabled",
      method: "emulation.setScriptingEnabled",
      params: { enabled: options.javaScriptEnabled === false ? false : null },
    });
  }

  return steps;
}

/** Throws RangeError when a value is invalid, without sending anything */
export function validateEmulation(options: EmulationOptions): void {
  plan(options);
}

/**
 * Applies the options to `target`, one command after the other. Nothing is rolled back when one fails:
 * the error says what was applied.
 */
export async function applyEmulation(
  connector: BiDiConnector,
  target: EmulationTarget,
  options: EmulationOptions,
): Promise<void> {
  const applied: string[] = [];
  for (const step of plan(options)) {
    try {
      await connector.send(step.method, { ...step.params, ...target } as never);
    } catch (err) {
      if (err instanceof BiDiError && (err.code === "unknown command" || err.code === "unsupported operation")) {
        throw new EmulationUnsupportedError(step.option, applied);
      }
      throw new EmulationError(step.option, applied, err);
    }
    applied.push(step.option);
  }
}
