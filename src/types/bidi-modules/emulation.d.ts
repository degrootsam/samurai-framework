import type { EmptyResult } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { BrowsingContext } from "./browsing-context.js";

/** Commands available in the emulation module, keyed by method name. */
export interface EmulationCommands {
  "emulation.setForcedColorsModeThemeOverride": {
    params: SetForcedColorsModeThemeOverrideParameters;
    result: SetForcedColorsModeThemeOverrideResult;
  };
  "emulation.setGeolocationOverride": {
    params: SetGeolocationOverrideParameters;
    result: SetGeolocationOverrideResult;
  };
  "emulation.setLocaleOverride": { params: SetLocaleOverrideParameters; result: SetLocaleOverrideResult };
  "emulation.setNetworkConditions": { params: SetNetworkConditionsParameters; result: EmptyResult };
  "emulation.setScreenOrientationOverride": {
    params: SetScreenOrientationOverrideParameters;
    result: SetScreenOrientationOverrideResult;
  };
  "emulation.setScreenSettingsOverride": { params: SetScreenSettingsOverrideParameters; result: EmptyResult };
  "emulation.setScriptingEnabled": { params: SetScriptingEnabledParameters; result: SetScriptingEnabledResult };
  "emulation.setScrollbarTypeOverride": {
    params: SetScrollbarTypeOverrideParameters;
    result: SetScrollbarTypeOverrideResult;
  };
  "emulation.setTimezoneOverride": { params: SetTimezoneOverrideParameters; result: SetTimezoneOverrideResult };
  "emulation.setTouchOverride": { params: SetTouchOverrideParameters; result: SetTouchOverrideResult };
  "emulation.setUserAgentOverride": { params: SetUserAgentOverrideParameters; result: SetUserAgentOverrideResult };
}

/** Union of all possible result types returned by emulation module commands. */
export type EmulationResult =
  | SetForcedColorsModeThemeOverrideResult
  | SetGeolocationOverrideResult
  | SetLocaleOverrideResult
  | SetScreenOrientationOverrideResult
  | SetScriptingEnabledResult
  | SetScrollbarTypeOverrideResult
  | SetTimezoneOverrideResult
  | SetTouchOverrideResult
  | SetUserAgentOverrideResult;

/** Result of `emulation.setForcedColorsModeThemeOverride`. */
export type SetForcedColorsModeThemeOverrideResult = EmptyResult;
/** Result of `emulation.setGeolocationOverride`. */
export type SetGeolocationOverrideResult = EmptyResult;
/** Result of `emulation.setLocaleOverride`. */
export type SetLocaleOverrideResult = EmptyResult;
/** Result of `emulation.setScreenOrientationOverride`. */
export type SetScreenOrientationOverrideResult = EmptyResult;
/** Result of `emulation.setScriptingEnabled`. */
export type SetScriptingEnabledResult = EmptyResult;
/** Result of `emulation.setScrollbarTypeOverride`. */
export type SetScrollbarTypeOverrideResult = EmptyResult;
/** Result of `emulation.setTimezoneOverride`. */
export type SetTimezoneOverrideResult = EmptyResult;
/** Result of `emulation.setTouchOverride`. */
export type SetTouchOverrideResult = EmptyResult;
/** Result of `emulation.setUserAgentOverride`. */
export type SetUserAgentOverrideResult = EmptyResult;

/** Union of all commands in the emulation module, which overrides device and environment properties. */
export type EmulationCommand =
  | SetForcedColorsModeThemeOverride
  | SetGeolocationOverride
  | SetLocaleOverride
  | SetNetworkConditions
  | SetScreenOrientationOverride
  | SetScreenSettingsOverride
  | SetScriptingEnabled
  | SetScrollbarTypeOverride
  | SetTimezoneOverride
  | SetTouchOverride
  | SetUserAgentOverride;

/** The color scheme theme to emulate for forced-colors media queries. */
export type ForcedColorsModeTheme = "light" | "dark";

/** Parameters for `emulation.setForcedColorsModeThemeOverride`. */
export interface SetForcedColorsModeThemeOverrideParameters {
  /** The theme to force, or `null` to reset to the real value. */
  theme: ForcedColorsModeTheme | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides the forced-colors media feature theme (e.g. to simulate Windows High Contrast). */
export interface SetForcedColorsModeThemeOverride {
  method: "emulation.setForcedColorsModeThemeOverride";
  params: SetForcedColorsModeThemeOverrideParameters;
}

/** Indicates that the geolocation position is unavailable. */
export interface GeolocationPositionError {
  type: "positionUnavailable";
}

/** A geolocation override response that simulates an unavailable position. */
export interface GeolocationCoordinatesResponseError {
  error: GeolocationPositionError;
}

/** A geolocation override response with specific coordinates (or `null` to reset). */
export interface GeolocationCoordinatesResponse {
  coordinates: GeolocationCoordinates | null;
}

/** Either a successful coordinates override or an error response. */
export type GeolocationOverrideResponse =
  | GeolocationCoordinatesResponse
  | GeolocationCoordinatesResponseError;

/** Parameters for `emulation.setGeolocationOverride`. */
export type SetGeolocationOverrideParameters = GeolocationOverrideResponse & {
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
};

/** Overrides the geolocation position reported to scripts. */
export interface SetGeolocationOverride {
  method: "emulation.setGeolocationOverride";
  params: SetGeolocationOverrideParameters;
}

/** Parameters for `emulation.setLocaleOverride`. */
export interface SetLocaleOverrideParameters {
  /** BCP 47 locale tag to override with, or `null` to reset. */
  locale: string | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides the locale reported to scripts (e.g. `Intl` APIs). */
export interface SetLocaleOverride {
  method: "emulation.setLocaleOverride";
  params: SetLocaleOverrideParameters;
}

/** Network conditions to simulate — currently only `offline` is supported. */
export type NetworkConditions = NetworkConditionsOffline;

/** Simulates a completely offline network connection. */
export interface NetworkConditionsOffline {
  type: "offline";
}

/** Parameters for `emulation.setNetworkConditions`. */
export interface SetNetworkConditionsParameters {
  /** The network conditions to simulate, or `null` to reset. */
  networkConditions: NetworkConditions | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Simulates network conditions such as being offline. */
export interface SetNetworkConditions {
  method: "emulation.setNetworkConditions";
  params: SetNetworkConditionsParameters;
}

/** Parameters for `emulation.setScreenOrientationOverride`. */
export interface SetScreenOrientationOverrideParameters {
  /** The orientation to emulate, or `null` to reset. */
  screenOrientation: ScreenOrientation | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** The natural orientation and current type of the screen. */
export interface ScreenOrientation {
  natural: ScreenOrientationNatural;
  type: ScreenOrientationType;
}

/** The device's natural (hardware) orientation. */
export type ScreenOrientationNatural = "landscape" | "portrait";

/** The logical screen orientation type as defined by the Screen Orientation API. */
export type ScreenOrientationType =
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary";

/** Overrides the screen orientation reported to scripts. */
export interface SetScreenOrientationOverride {
  method: "emulation.setScreenOrientationOverride";
  params: SetScreenOrientationOverrideParameters;
}

/** Width and height of a screen area in CSS pixels. */
export interface ScreenArea {
  width: number;
  height: number;
}

/** Parameters for `emulation.setScreenSettingsOverride`. */
export interface SetScreenSettingsOverrideParameters {
  /** The screen area dimensions to emulate, or `null` to reset. */
  screenArea: ScreenArea | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides screen size settings (e.g. `screen.width` / `screen.height`) reported to scripts. */
export interface SetScreenSettingsOverride {
  method: "emulation.setScreenSettingsOverride";
  params: SetScreenSettingsOverrideParameters;
}

/** Parameters for `emulation.setScriptingEnabled`. */
export interface SetScriptingEnabledParameters {
  /** `false` to disable JavaScript execution, or `null` to reset to default. */
  enabled: false | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Disables or re-enables JavaScript execution in the given contexts. */
export interface SetScriptingEnabled {
  method: "emulation.setScriptingEnabled";
  params: SetScriptingEnabledParameters;
}

/** Parameters for `emulation.setScrollbarTypeOverride`. */
export interface SetScrollbarTypeOverrideParameters {
  /** `"classic"` for always-visible scrollbars, `"overlay"` for overlay scrollbars, or `null` to reset. */
  scrollbarType: "classic" | "overlay" | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides the scrollbar rendering style in the given contexts. */
export interface SetScrollbarTypeOverride {
  method: "emulation.setScrollbarTypeOverride";
  params: SetScrollbarTypeOverrideParameters;
}

/** Parameters for `emulation.setTimezoneOverride`. */
export interface SetTimezoneOverrideParameters {
  /** A valid IANA timezone identifier (e.g. `"America/New_York"`), or `null` to reset. */
  timezone: string | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides the timezone used by scripts (e.g. `Intl.DateTimeFormat`). */
export interface SetTimezoneOverride {
  method: "emulation.setTimezoneOverride";
  params: SetTimezoneOverrideParameters;
}

/** Parameters for `emulation.setTouchOverride`. */
export interface SetTouchOverrideParameters {
  /** Maximum number of simultaneous touch points to emulate, or `null` to reset. */
  maxTouchPoints: number | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides touch support, enabling touch events in non-touch environments. */
export interface SetTouchOverride {
  method: "emulation.setTouchOverride";
  params: SetTouchOverrideParameters;
}

/** Parameters for `emulation.setUserAgentOverride`. */
export interface SetUserAgentOverrideParameters {
  /** The user-agent string to report, or `null` to reset to the real value. */
  userAgent: string | null;
  contexts?: BrowsingContext[];
  userContexts?: UserContext[];
}

/** Overrides the User-Agent string reported by the browser. */
export interface SetUserAgentOverride {
  method: "emulation.setUserAgentOverride";
  params: SetUserAgentOverrideParameters;
}
