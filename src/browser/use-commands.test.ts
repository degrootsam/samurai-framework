import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { UnsupportedOperationError } from "../transport/unsupported.js";
import {
  autoReply,
  FakeWebSocket,
  makeConnector,
} from "../testing/fake-websocket.js";
import { applyUse, UseError } from "./use-commands.js";
import type { RuntimeUseOptions } from "../types/use.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

const failing = (code: string, message = "nope") =>
  Object.assign(new Error(message), { code });

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = makeConnector(ws);
  stops.push(autoReply(ws, handlers));
  const sent = () => ws.sent.map((m) => [m.method, m.params] as [string, any]);
  return { ws, connector, sent };
}
const PAGE = { contexts: ["ctx-1"] };

describe("applyUse: what each option sends", () => {
  const cases: Array<[string, RuntimeUseOptions, string, object]> = [
    [
      "locale",
      { locale: "nl-NL" },
      "emulation.setLocaleOverride",
      { locale: "nl-NL" },
    ],
    [
      "timezone",
      { timezone: "Europe/Amsterdam" },
      "emulation.setTimezoneOverride",
      { timezone: "Europe/Amsterdam" },
    ],
    [
      "userAgent",
      { userAgent: "Samurai/1.0" },
      "emulation.setUserAgentOverride",
      { userAgent: "Samurai/1.0" },
    ],
    [
      "geolocation",
      { geolocation: { latitude: 52.37, longitude: 4.9, accuracy: 10 } },
      "emulation.setGeolocationOverride",
      { coordinates: { latitude: 52.37, longitude: 4.9, accuracy: 10 } },
    ],
    [
      "geolocation without accuracy",
      { geolocation: { latitude: 1, longitude: 2 } },
      "emulation.setGeolocationOverride",
      { coordinates: { latitude: 1, longitude: 2 } },
    ],
    [
      "offline",
      { offline: true },
      "emulation.setNetworkConditions",
      { networkConditions: { type: "offline" } },
    ],
    [
      "orientation",
      { orientation: "portrait" },
      "emulation.setScreenOrientationOverride",
      { screenOrientation: { natural: "portrait", type: "portrait-primary" } },
    ],
    [
      "orientation (full type)",
      { orientation: "landscape-secondary" },
      "emulation.setScreenOrientationOverride",
      {
        screenOrientation: {
          natural: "landscape",
          type: "landscape-secondary",
        },
      },
    ],
    [
      "screen",
      { screen: { width: 800, height: 600 } },
      "emulation.setScreenSettingsOverride",
      { screenArea: { width: 800, height: 600 } },
    ],
    [
      "hasTouch",
      { hasTouch: true },
      "emulation.setTouchOverride",
      { maxTouchPoints: 1 },
    ],
    [
      "javaScriptEnabled false",
      { javaScriptEnabled: false },
      "emulation.setScriptingEnabled",
      { enabled: false },
    ],
  ];
  for (const [name, options, method, params] of cases) {
    it(`${name} → ${method}`, async () => {
      const { connector, sent } = setup();
      await applyUse(connector, PAGE, options);
      assert.deepEqual(sent(), [[method, { ...params, ...PAGE }]]);
    });
  }
});

describe("applyUse: resetting", () => {
  it("null puts the real value back", async () => {
    const { connector, sent } = setup();
    await applyUse(connector, PAGE, {
      locale: null,
      timezone: null,
      userAgent: null,
      geolocation: null,
      offline: null,
      orientation: null,
      screen: null,
      hasTouch: null,
      javaScriptEnabled: null,
    });
    assert.deepEqual(
      sent().map(([method, params]) => [
        method,
        Object.values(params).filter((v) => v === null).length,
      ]),
      [
        ["emulation.setLocaleOverride", 1],
        ["emulation.setTimezoneOverride", 1],
        ["emulation.setUserAgentOverride", 1],
        ["emulation.setGeolocationOverride", 1],
        ["emulation.setNetworkConditions", 1],
        ["emulation.setScreenOrientationOverride", 1],
        ["emulation.setScreenSettingsOverride", 1],
        ["emulation.setTouchOverride", 1],
        ["emulation.setScriptingEnabled", 1],
      ],
    );
  });

  it("offline false is back online, javaScriptEnabled true is back to the default", async () => {
    const { connector, sent } = setup();
    await applyUse(connector, PAGE, {
      offline: false,
      javaScriptEnabled: true,
    });
    assert.deepEqual(sent(), [
      ["emulation.setNetworkConditions", { networkConditions: null, ...PAGE }],
      ["emulation.setScriptingEnabled", { enabled: null, ...PAGE }],
    ]);
  });

  it("undefined leaves an option alone; no options send nothing", async () => {
    const { connector, sent } = setup();
    await applyUse(connector, PAGE, {});
    await applyUse(connector, PAGE, {
      locale: undefined,
      timezone: "UTC",
    });
    assert.deepEqual(
      sent().map(([method]) => method),
      ["emulation.setTimezoneOverride"],
    );
  });
});

describe("applyUse: targets and order", () => {
  it("a user context target is sent as userContexts", async () => {
    const { connector, sent } = setup();
    await applyUse(connector, { userContexts: ["u1"] }, { locale: "de-DE" });
    assert.deepEqual(sent(), [
      [
        "emulation.setLocaleOverride",
        { locale: "de-DE", userContexts: ["u1"] },
      ],
    ]);
  });

  it("options are applied in a fixed order, whatever the order they were given in", async () => {
    const { connector, sent } = setup();
    await applyUse(connector, PAGE, {
      offline: true,
      timezone: "UTC",
      locale: "en-GB",
      userAgent: "x",
    });
    assert.deepEqual(
      sent().map(([method]) => method),
      [
        "emulation.setLocaleOverride",
        "emulation.setTimezoneOverride",
        "emulation.setUserAgentOverride",
        "emulation.setNetworkConditions",
      ],
    );
  });
});

describe("applyUse: validation happens before anything is sent", () => {
  const invalid: Array<[string, RuntimeUseOptions, RegExp]> = [
    [
      "latitude too big",
      { geolocation: { latitude: 91, longitude: 0 } },
      /latitude must be between -90 and 90/,
    ],
    [
      "latitude too small",
      { geolocation: { latitude: -90.5, longitude: 0 } },
      /latitude/,
    ],
    [
      "longitude too big",
      { geolocation: { latitude: 0, longitude: 181 } },
      /longitude must be between -180 and 180/,
    ],
    [
      "longitude not a number",
      { geolocation: { latitude: 0, longitude: NaN } },
      /longitude/,
    ],
    [
      "negative accuracy",
      { geolocation: { latitude: 0, longitude: 0, accuracy: -1 } },
      /accuracy must be 0 or more/,
    ],
    [
      "unknown timezone",
      { timezone: "Not/AZone" },
      /unknown timezone "Not\/AZone"/,
    ],
    [
      "malformed locale",
      { locale: "not a locale!" },
      /invalid locale "not a locale!"/,
    ],
    [
      "empty user agent",
      { userAgent: "" },
      /userAgent must be a non-empty string/,
    ],
    [
      "fractional screen",
      { screen: { width: 800.5, height: 600 } },
      /screen width and height must be positive integers/,
    ],
    [
      "zero screen",
      { screen: { width: 0, height: 600 } },
      /screen width and height/,
    ],
    [
      "unknown orientation",
      { orientation: "diagonal" as never },
      /unknown orientation "diagonal"/,
    ],
    [
      "hasTouch not a boolean",
      { hasTouch: 1 as never },
      /hasTouch must be true, false or null/,
    ],
    [
      "a renamed option",
      { timezoneId: "UTC" } as never,
      /unknown option "timezoneId"; use "timezone"/,
    ],
    [
      "the old touch option",
      { touch: 2 } as never,
      /unknown option "touch"; use "hasTouch"/,
    ],
    [
      "an option that cannot change while the browser runs",
      { colorScheme: "dark" } as never,
      /colorScheme can only be set before the browser starts/,
    ],
    [
      "an unknown option",
      { colour: "red" } as never,
      /unknown option "colour"/,
    ],
  ];
  for (const [name, options, message] of invalid) {
    it(`${name} is a TypeError`, async () => {
      const { connector, sent } = setup();
      await assert.rejects(
        applyUse(connector, PAGE, { locale: "en-GB", ...options }),
        (err: unknown) => {
          assert.ok(err instanceof TypeError, String(err));
          assert.match((err as Error).message, message);
          return true;
        },
      );
      assert.deepEqual(sent(), [], "the valid locale was not applied either");
    });
  }

  it("accepts UTC offsets as timezones, and locales with extensions", async () => {
    const { connector, sent } = setup();
    await applyUse(connector, PAGE, {
      timezone: "Europe/Berlin",
      locale: "de-DE-u-nu-latn",
    });
    assert.equal(sent().length, 2);
  });
});

describe("applyUse: when the browser refuses", () => {
  it("a command the browser does not know is UnsupportedOperationError naming the option, with what was applied", async () => {
    const { connector } = setup({
      "emulation.setTouchOverride": () => failing("unknown command"),
    });
    await assert.rejects(
      applyUse(connector, PAGE, { locale: "nl-NL", hasTouch: true }),
      (err: unknown) => {
        assert.ok(err instanceof UnsupportedOperationError);
        assert.match(
          err.message,
          /use\(\): hasTouch is not supported by the browser/,
        );
        assert.equal((err as { option?: string }).option, "hasTouch");
        assert.deepEqual((err as { applied?: string[] }).applied, ["locale"]);
        return true;
      },
    );
  });

  it("with onUnsupported the option is reported and skipped, and the rest is applied (how config use behaves)", async () => {
    const { connector, sent } = setup({
      "emulation.setTouchOverride": () => failing("unknown command"),
    });
    const skipped: string[] = [];
    await applyUse(
      connector,
      PAGE,
      { locale: "nl-NL", hasTouch: true, timezone: "UTC" },
      (option) => skipped.push(option),
    );
    assert.deepEqual(skipped, ["hasTouch"]);
    assert.deepEqual(
      sent().map(([method]) => method),
      [
        "emulation.setLocaleOverride",
        "emulation.setTimezoneOverride",
        "emulation.setTouchOverride",
      ],
    );
  });

  it("unsupported operation counts the same", async () => {
    const { connector } = setup({
      "emulation.setScriptingEnabled": () => failing("unsupported operation"),
    });
    await assert.rejects(
      applyUse(connector, PAGE, { javaScriptEnabled: false }),
      UnsupportedOperationError,
    );
  });

  it("another failure is an UseError listing what was applied and what failed; nothing is rolled back", async () => {
    const { connector, sent } = setup({
      "emulation.setUserAgentOverride": () =>
        failing("invalid argument", "bad ua"),
    });
    await assert.rejects(
      applyUse(connector, PAGE, {
        locale: "nl-NL",
        timezone: "Europe/Amsterdam",
        userAgent: "x",
        offline: true,
      }),
      (err: unknown) => {
        assert.ok(err instanceof UseError);
        assert.deepEqual(err.applied, ["locale", "timezone"]);
        assert.equal(err.failed, "userAgent");
        assert.equal((err.cause as { code: string }).code, "invalid argument");
        assert.match(
          err.message,
          /use\(\): userAgent failed after applying locale, timezone: .*bad ua/,
        );
        return true;
      },
    );
    assert.equal(
      sent().length,
      3,
      "the offline option after the failure was not sent",
    );
  });

  it("with nothing applied before the failure the message says so", async () => {
    const { connector } = setup({
      "emulation.setLocaleOverride": () => failing("invalid argument", "bad"),
    });
    await assert.rejects(
      applyUse(connector, PAGE, { locale: "nl-NL" }),
      /use\(\): locale failed: /,
    );
  });
});
