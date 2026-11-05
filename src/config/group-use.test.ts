import assert from "node:assert/strict";
import { test } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import { groupUseOf, validateGroupUse } from "./group-use.js";

const withUse = (use: unknown): SamuraiTestConfig =>
  ({
    groups: [{ name: "a" }, { name: "phone", use }],
  }) as SamuraiTestConfig;

const refuses = (use: unknown, pattern: RegExp) =>
  assert.throws(() => validateGroupUse(withUse(use)), pattern);

test("a group's use accepts the options of config use, and a viewport", () => {
  validateGroupUse(
    withUse({
      locale: "nl-NL",
      timezone: "Europe/Amsterdam",
      isMobile: true,
      hasTouch: true,
      acceptInsecureCerts: true,
      colorScheme: "dark",
      extraHTTPHeaders: { "x-a": "b" },
      viewport: { width: 390, height: 844 },
    }),
  );
  validateGroupUse(withUse({ viewport: null }));
  validateGroupUse({} as SamuraiTestConfig);
});

test("errors name the group's place in the config and the option", () => {
  refuses(
    { locale: "not a locale" },
    /^TypeError: config\.groups\[1\]\.use\.locale: invalid locale "not a locale"$/,
  );
  refuses(
    { isMobile: "yes" },
    /config\.groups\[1\]\.use\.isMobile: isMobile must be true or false/,
  );
  refuses(
    { timezone: "Mars/Base" },
    /config\.groups\[1\]\.use\.timezone: unknown timezone "Mars\/Base"/,
  );
  refuses(
    { colour: 1 },
    /^TypeError: config\.groups\[1\]\.use: unknown option "colour"$/,
  );
  refuses("nope", /config\.groups\[1\]\.use: the options must be an object/);
});

test("a viewport needs a positive whole width and height, or null", () => {
  refuses(
    { viewport: { width: 0, height: 10 } },
    /config\.groups\[1\]\.use\.viewport: /,
  );
  refuses({ viewport: { width: 10.5, height: 10 } }, /use\.viewport: /);
  refuses({ viewport: { width: 10 } }, /use\.viewport: /);
  refuses({ viewport: 5 }, /use\.viewport: /);
});

test("groupUseOf gives the use of the named group, or nothing", () => {
  const config = withUse({ locale: "fr-FR" });
  assert.deepEqual(groupUseOf(config.groups, "phone"), { locale: "fr-FR" });
  assert.deepEqual(groupUseOf(config.groups, "a"), {});
  assert.deepEqual(groupUseOf(config.groups, "nope"), {});
  assert.deepEqual(groupUseOf(undefined, "a"), {});
});
