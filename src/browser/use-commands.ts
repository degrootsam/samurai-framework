import {
  isUnsupported,
  UnsupportedOperationError,
} from "../transport/unsupported.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BiDiCommands } from "../types/bidi.js";
import { USE_OPTION_NAMES, validateUseOptions } from "../config/use-options.js";
import type { RuntimeUseOptions } from "../types/use.js";

export type UseTarget = { contexts: string[] } | { userContexts: string[] };

/** A part of the options could not be applied; what was applied before it stays applied */
export class UseError extends Error {
  /** The options that were applied before the failure, in the order they were applied */
  public readonly applied: string[];
  public readonly failed: string;
  public readonly cause: unknown;

  constructor(failed: string, applied: string[], cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `use(): ${failed} failed${applied.length ? ` after applying ${applied.join(", ")}` : ""}: ${detail}`,
    );
    this.name = "UseError";
    this.failed = failed;
    this.applied = applied;
    this.cause = cause;
  }
}

/** The browser does not implement the command an option needs */
export class UseUnsupportedError extends UnsupportedOperationError {
  public readonly option: string;
  public readonly applied: string[];

  constructor(option: string, applied: string[]) {
    super(
      `use(): ${option} is not supported by the browser${AT_START_ONLY.has(option) ? ` at run time; set it in config use, a group’s use or test.use()` : ""}`,
    );
    this.name = "UseUnsupportedError";
    this.option = option;
    this.applied = applied;
  }
}

/** Options Firefox can only take when it starts (a profile setting), so run time is unsupported there */
const AT_START_ONLY = new Set(["javaScriptEnabled"]);

interface Step {
  option: string;
  method: keyof BiDiCommands & `emulation.${string}`;
  params: object;
}

/** The options that can change while the browser runs, in the order they are applied */
export const RUNTIME_OPTIONS = [
  "locale",
  "timezone",
  "userAgent",
  "geolocation",
  "offline",
  "orientation",
  "screen",
  "hasTouch",
  "javaScriptEnabled",
] as const;

/**
 * Checks the options of `page.use()` / `context.use()` / `newContext()`: the values like config `use` does, and
 * only the options that can change at run time. Throws `use(): what is wrong`, before anything is sent.
 */
export function validateRuntimeUse(options: RuntimeUseOptions): void {
  validateUseOptions(options);
  for (const key of Object.keys(options))
    if (!(RUNTIME_OPTIONS as readonly string[]).includes(key))
      throw new TypeError(
        `use(): ${USE_OPTION_NAMES.includes(key) ? `${key} can only be set before the browser starts: in config use, a group’s use or test.use()` : `unknown option "${key}"`}`,
      );
}

/** Turns validated options into BiDi commands, in a fixed order */
function plan(options: RuntimeUseOptions): Step[] {
  const steps: Step[] = [];
  const add = (
    option: Step["option"],
    method: Step["method"],
    params: object,
  ) => steps.push({ option, method, params });

  if (options.locale !== undefined)
    add("locale", "emulation.setLocaleOverride", { locale: options.locale });
  if (options.timezone !== undefined)
    add("timezone", "emulation.setTimezoneOverride", {
      timezone: options.timezone,
    });
  if (options.userAgent !== undefined)
    add("userAgent", "emulation.setUserAgentOverride", {
      userAgent: options.userAgent,
    });
  if (options.geolocation !== undefined)
    add("geolocation", "emulation.setGeolocationOverride", {
      coordinates: options.geolocation,
    });
  if (options.offline !== undefined)
    add("offline", "emulation.setNetworkConditions", {
      networkConditions: options.offline ? { type: "offline" } : null,
    });
  if (options.orientation !== undefined) {
    const type =
      options.orientation === null
        ? null
        : options.orientation === "portrait" ||
            options.orientation === "landscape"
          ? (`${options.orientation}-primary` as const)
          : options.orientation;
    add("orientation", "emulation.setScreenOrientationOverride", {
      screenOrientation: type && {
        natural: type.startsWith("portrait") ? "portrait" : "landscape",
        type,
      },
    });
  }
  if (options.screen !== undefined)
    add("screen", "emulation.setScreenSettingsOverride", {
      screenArea: options.screen,
    });
  if (options.hasTouch !== undefined)
    add("hasTouch", "emulation.setTouchOverride", {
      maxTouchPoints: options.hasTouch ? 1 : null,
    });
  if (options.javaScriptEnabled !== undefined)
    add("javaScriptEnabled", "emulation.setScriptingEnabled", {
      enabled: options.javaScriptEnabled === false ? false : null,
    });

  return steps;
}

/**
 * Applies the options to `target`, one command after the other, after checking all of them. Nothing is rolled
 * back when one fails: the error says what was applied. An option the browser does not support throws
 * `UseUnsupportedError`, unless `onUnsupported` is given: then it is reported there and skipped (how `use` in
 * config behaves: it warns, `page.use()` throws).
 */
export async function applyUse(
  connector: BiDiConnector,
  target: UseTarget,
  options: RuntimeUseOptions,
  onUnsupported?: (option: string) => void,
): Promise<void> {
  validateRuntimeUse(options);
  const applied: string[] = [];
  for (const step of plan(options)) {
    try {
      await connector.send(step.method, { ...step.params, ...target } as never);
    } catch (err) {
      if (!isUnsupported(err)) throw new UseError(step.option, applied, err);
      if (!onUnsupported) throw new UseUnsupportedError(step.option, applied);
      onUnsupported(step.option);
      continue;
    }
    applied.push(step.option);
  }
}
