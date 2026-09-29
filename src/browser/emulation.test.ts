import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { UnsupportedOperationError } from "../locator/selector-errors.js";
import { autoReply, FakeWebSocket } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { applyEmulation, EmulationError, type EmulationOptions } from "./emulation.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

const failing = (code: string, message = "nope") => Object.assign(new Error(message), { code });

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, handlers));
  const sent = () => ws.sent.map((m) => [m.method, m.params] as [string, any]);
  return { ws, connector, sent };
}
const PAGE = { contexts: ["ctx-1"] };

describe("applyEmulation: what each option sends", () => {
  const cases: Array<[string, EmulationOptions, string, object]> = [
    ["locale", { locale: "nl-NL" }, "emulation.setLocaleOverride", { locale: "nl-NL" }],
    ["timezone", { timezone: "Europe/Amsterdam" }, "emulation.setTimezoneOverride", { timezone: "Europe/Amsterdam" }],
    ["userAgent", { userAgent: "Samurai/1.0" }, "emulation.setUserAgentOverride", { userAgent: "Samurai/1.0" }],
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
    ["offline", { offline: true }, "emulation.setNetworkConditions", { networkConditions: { type: "offline" } }],
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
      { screenOrientation: { natural: "landscape", type: "landscape-secondary" } },
    ],
    ["screen", { screen: { width: 800, height: 600 } }, "emulation.setScreenSettingsOverride", { screenArea: { width: 800, height: 600 } }],
    ["touch", { touch: 5 }, "emulation.setTouchOverride", { maxTouchPoints: 5 }],
    ["javaScriptEnabled false", { javaScriptEnabled: false }, "emulation.setScriptingEnabled", { enabled: false }],
  ];
  for (const [name, options, method, params] of cases) {
    it(`${name} → ${method}`, async () => {
      const { connector, sent } = setup();
      await applyEmulation(connector, PAGE, options);
      assert.deepEqual(sent(), [[method, { ...params, ...PAGE }]]);
    });
  }
});

describe("applyEmulation: resetting", () => {
  it("null puts the real value back", async () => {
    const { connector, sent } = setup();
    await applyEmulation(connector, PAGE, {
      locale: null,
      timezone: null,
      userAgent: null,
      geolocation: null,
      offline: null,
      orientation: null,
      screen: null,
      touch: null,
      javaScriptEnabled: null,
    });
    assert.deepEqual(sent().map(([method, params]) => [method, Object.values(params).filter((v) => v === null).length]), [
      ["emulation.setLocaleOverride", 1],
      ["emulation.setTimezoneOverride", 1],
      ["emulation.setUserAgentOverride", 1],
      ["emulation.setGeolocationOverride", 1],
      ["emulation.setNetworkConditions", 1],
      ["emulation.setScreenOrientationOverride", 1],
      ["emulation.setScreenSettingsOverride", 1],
      ["emulation.setTouchOverride", 1],
      ["emulation.setScriptingEnabled", 1],
    ]);
  });

  it("offline false is back online, javaScriptEnabled true is back to the default", async () => {
    const { connector, sent } = setup();
    await applyEmulation(connector, PAGE, { offline: false, javaScriptEnabled: true });
    assert.deepEqual(sent(), [
      ["emulation.setNetworkConditions", { networkConditions: null, ...PAGE }],
      ["emulation.setScriptingEnabled", { enabled: null, ...PAGE }],
    ]);
  });

  it("undefined leaves an option alone; no options send nothing", async () => {
    const { connector, sent } = setup();
    await applyEmulation(connector, PAGE, {});
    await applyEmulation(connector, PAGE, { locale: undefined, timezone: "UTC" });
    assert.deepEqual(sent().map(([method]) => method), ["emulation.setTimezoneOverride"]);
  });
});

describe("applyEmulation: targets and order", () => {
  it("a user context target is sent as userContexts", async () => {
    const { connector, sent } = setup();
    await applyEmulation(connector, { userContexts: ["u1"] }, { locale: "de-DE" });
    assert.deepEqual(sent(), [["emulation.setLocaleOverride", { locale: "de-DE", userContexts: ["u1"] }]]);
  });

  it("options are applied in a fixed order, whatever the order they were given in", async () => {
    const { connector, sent } = setup();
    await applyEmulation(connector, PAGE, { offline: true, timezone: "UTC", locale: "en-GB", userAgent: "x" });
    assert.deepEqual(sent().map(([method]) => method), [
      "emulation.setLocaleOverride",
      "emulation.setTimezoneOverride",
      "emulation.setUserAgentOverride",
      "emulation.setNetworkConditions",
    ]);
  });
});

describe("applyEmulation: validation happens before anything is sent", () => {
  const invalid: Array<[string, EmulationOptions, RegExp]> = [
    ["latitude too big", { geolocation: { latitude: 91, longitude: 0 } }, /latitude must be between -90 and 90/],
    ["latitude too small", { geolocation: { latitude: -90.5, longitude: 0 } }, /latitude/],
    ["longitude too big", { geolocation: { latitude: 0, longitude: 181 } }, /longitude must be between -180 and 180/],
    ["longitude not a number", { geolocation: { latitude: 0, longitude: NaN } }, /longitude/],
    ["negative accuracy", { geolocation: { latitude: 0, longitude: 0, accuracy: -1 } }, /accuracy must be 0 or more/],
    ["unknown timezone", { timezone: "Not/AZone" }, /unknown timezone "Not\/AZone"/],
    ["malformed locale", { locale: "not a locale!" }, /invalid locale "not a locale!"/],
    ["empty user agent", { userAgent: "" }, /userAgent must not be empty/],
    ["fractional screen", { screen: { width: 800.5, height: 600 } }, /screen width and height must be positive integers/],
    ["zero screen", { screen: { width: 0, height: 600 } }, /screen width and height/],
    ["unknown orientation", { orientation: "diagonal" as never }, /unknown orientation "diagonal"/],
    ["touch below one", { touch: 0 }, /touch must be a positive integer/],
    ["fractional touch", { touch: 1.5 }, /touch must be a positive integer/],
  ];
  for (const [name, options, message] of invalid) {
    it(`${name} is a RangeError`, async () => {
      const { connector, sent } = setup();
      await assert.rejects(applyEmulation(connector, PAGE, { locale: "en-GB", ...options }), (err: unknown) => {
        assert.ok(err instanceof RangeError, String(err));
        assert.match((err as Error).message, message);
        return true;
      });
      assert.deepEqual(sent(), [], "the valid locale was not applied either");
    });
  }

  it("accepts UTC offsets as timezones, and locales with extensions", async () => {
    const { connector, sent } = setup();
    await applyEmulation(connector, PAGE, { timezone: "Europe/Berlin", locale: "de-DE-u-nu-latn" });
    assert.equal(sent().length, 2);
  });
});

describe("applyEmulation: when the browser refuses", () => {
  it("a command the browser does not know is UnsupportedOperationError naming the option, with what was applied", async () => {
    const { connector } = setup({ "emulation.setTouchOverride": () => failing("unknown command") });
    await assert.rejects(applyEmulation(connector, PAGE, { locale: "nl-NL", touch: 5 }), (err: unknown) => {
      assert.ok(err instanceof UnsupportedOperationError);
      assert.match(err.message, /emulate\(\{ touch \}\) is not supported by the browser/);
      assert.equal((err as { option?: string }).option, "touch");
      assert.deepEqual((err as { applied?: string[] }).applied, ["locale"]);
      return true;
    });
  });

  it("unsupported operation counts the same", async () => {
    const { connector } = setup({ "emulation.setScriptingEnabled": () => failing("unsupported operation") });
    await assert.rejects(applyEmulation(connector, PAGE, { javaScriptEnabled: false }), UnsupportedOperationError);
  });

  it("another failure is an EmulationError listing what was applied and what failed; nothing is rolled back", async () => {
    const { connector, sent } = setup({ "emulation.setUserAgentOverride": () => failing("invalid argument", "bad ua") });
    await assert.rejects(
      applyEmulation(connector, PAGE, { locale: "nl-NL", timezone: "Europe/Amsterdam", userAgent: "x", offline: true }),
      (err: unknown) => {
        assert.ok(err instanceof EmulationError);
        assert.deepEqual(err.applied, ["locale", "timezone"]);
        assert.equal(err.failed, "userAgent");
        assert.equal((err.cause as { code: string }).code, "invalid argument");
        assert.match(err.message, /emulate\(\): userAgent failed after applying locale, timezone: .*bad ua/);
        return true;
      },
    );
    assert.equal(sent().length, 3, "the offline option after the failure was not sent");
  });

  it("with nothing applied before the failure the message says so", async () => {
    const { connector } = setup({ "emulation.setLocaleOverride": () => failing("invalid argument", "bad") });
    await assert.rejects(applyEmulation(connector, PAGE, { locale: "nl-NL" }), /emulate\(\): locale failed: /);
  });
});
