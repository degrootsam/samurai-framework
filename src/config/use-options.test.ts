import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeUse,
  validateUseConfig,
  validateUseOptions,
} from "./use-options.js";

const refuses = (options: unknown, pattern: RegExp) =>
  assert.throws(() => validateUseOptions(options), pattern);

test("every option is accepted with a valid value", () => {
  const options = {
    locale: "nl-NL",
    timezone: "Europe/Amsterdam",
    userAgent: "Mozilla/5.0 (Test)",
    javaScriptEnabled: false,
    acceptInsecureCerts: true,
    hasTouch: true,
    isMobile: true,
    storageState: "state.json",
    extraHTTPHeaders: { "x-feature": "on" },
    colorScheme: "dark",
    geolocation: { latitude: 52.37, longitude: 4.9, accuracy: 10 },
    offline: true,
    orientation: "landscape",
    screen: { width: 800, height: 600 },
  } as const;
  assert.deepEqual(validateUseOptions(options), options);
});

test("a storage state object is accepted", () => {
  validateUseOptions({
    storageState: {
      cookies: [{ name: "a", value: "b", domain: "example.com" }],
      origins: [{ origin: "https://example.com", localStorage: [] }],
    },
  });
});

test("errors read use(): what is wrong", () => {
  refuses("nope", /^TypeError: use\(\): the options must be an object$/);
  refuses({ colour: 1 }, /use\(\): unknown option "colour"/);
  refuses(
    { locale: "not a locale!" },
    /use\(\): invalid locale "not a locale!"/,
  );
  refuses({ locale: 5 }, /use\(\): invalid locale 5/);
  refuses({ timezone: "Mars/Base" }, /use\(\): unknown timezone "Mars\/Base"/);
  refuses({ userAgent: "" }, /use\(\): userAgent must be a non-empty string/);
  refuses(
    { isMobile: "yes" },
    /use\(\): isMobile must be true or false, got "yes"/,
  );
  refuses({ hasTouch: 1 }, /use\(\): hasTouch must be true, false or null/);
  refuses(
    { javaScriptEnabled: "no" },
    /use\(\): javaScriptEnabled must be true, false or null/,
  );
  refuses(
    { acceptInsecureCerts: "1" },
    /use\(\): acceptInsecureCerts must be true or false/,
  );
  refuses(
    { colorScheme: "blue" },
    /use\(\): colorScheme must be "light", "dark" or "no-preference", got "blue"/,
  );
  refuses(
    { extraHTTPHeaders: [] },
    /use\(\): extraHTTPHeaders must be an object/,
  );
  refuses(
    { extraHTTPHeaders: { "bad name": "x" } },
    /use\(\): extraHTTPHeaders has an invalid header name "bad name"/,
  );
  refuses(
    { extraHTTPHeaders: { a: 1 } },
    /use\(\): extraHTTPHeaders "a" must be a string/,
  );
  refuses(
    { storageState: 5 },
    /use\(\): storageState must be a file path or an object/,
  );
  refuses(
    { storageState: "" },
    /use\(\): storageState must not be an empty path/,
  );
  refuses(
    { storageState: { cookies: "x" } },
    /use\(\): storageState.cookies must be an array/,
  );
  refuses(
    { storageState: { cookies: [{ name: "a" }] } },
    /use\(\): every storageState cookie needs/,
  );
  refuses(
    { storageState: { origins: [{ origin: "" }] } },
    /use\(\): every storageState origin needs/,
  );
});

test("the config's use may hold other keys; its new options are still checked", () => {
  validateUseConfig({
    use: { viewport: null, headless: true, locale: "de-DE" },
  });
  validateUseConfig({});
  assert.throws(
    () => validateUseConfig({ use: { locale: "" } }),
    /use\(\): invalid locale ""/,
  );
});

test("a later layer wins, key by key", () => {
  assert.deepEqual(
    mergeUse([
      { locale: "nl-NL", colorScheme: "dark" },
      {},
      { locale: "de-DE", extraHTTPHeaders: { a: "1" } },
    ]),
    { locale: "de-DE", colorScheme: "dark", extraHTTPHeaders: { a: "1" } },
  );
});

test("null is accepted for the options that can be put back", () => {
  const options = {
    locale: null,
    timezone: null,
    userAgent: null,
    geolocation: null,
    offline: null,
    orientation: null,
    screen: null,
    hasTouch: null,
    javaScriptEnabled: null,
  };
  assert.deepEqual(validateUseOptions(options), options);
});

test("a renamed option is refused with the name to use", () => {
  refuses(
    { timezoneId: "UTC" },
    /use\(\): unknown option "timezoneId"; use "timezone"/,
  );
  refuses({ touch: 1 }, /use\(\): unknown option "touch"; use "hasTouch"/);
  assert.throws(
    () => validateUseOptions({ timezoneId: "UTC" }, true),
    /use "timezone"/,
    "also where config use allows other keys",
  );
});

test("geolocation, orientation and screen are checked", () => {
  refuses(
    { geolocation: { latitude: 91, longitude: 0 } },
    /latitude must be between -90 and 90/,
  );
  refuses(
    { geolocation: { latitude: 0, longitude: 181 } },
    /longitude must be between -180 and 180/,
  );
  refuses(
    { geolocation: { latitude: 0, longitude: 0, accuracy: -1 } },
    /accuracy must be 0 or more/,
  );
  refuses(
    { geolocation: 5 },
    /geolocation must be \{ latitude, longitude \} or null/,
  );
  refuses({ orientation: "diagonal" }, /unknown orientation "diagonal"/);
  refuses(
    { screen: { width: 0, height: 600 } },
    /screen width and height must be positive integers/,
  );
  refuses({ screen: { width: 800.5, height: 600 } }, /screen width and height/);
});
