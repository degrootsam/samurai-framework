import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromeCapabilities, chromeFlags } from "./chrome-launch.js";

const launch = {
  executablePath: "/opt/chrome",
  driverPath: "/opt/chromedriver",
  profileDir: "/tmp/profile",
  headless: true,
  commandTimeout: undefined,
};

describe("chromeFlags", () => {
  it("uses the project profile and runs headless when asked", () => {
    const flags = chromeFlags(launch);
    assert.ok(flags.includes("--user-data-dir=/tmp/profile"));
    assert.ok(flags.includes("--headless=new"));
    assert.ok(
      !chromeFlags({ ...launch, headless: false }).includes("--headless=new"),
    );
  });
});

describe("chromeCapabilities", () => {
  it("asks chromedriver for a BiDi socket and leaves dialogs to the framework", () => {
    const { alwaysMatch } = chromeCapabilities(launch).capabilities;
    assert.equal(alwaysMatch.webSocketUrl, true);
    assert.deepEqual(alwaysMatch.unhandledPromptBehavior, {
      default: "ignore",
    });
    assert.equal(alwaysMatch["goog:chromeOptions"].binary, "/opt/chrome");
  });
});
