import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  browserLaunchEnv,
  browserLaunchFlag,
  ensureBrowserProfile,
} from "./launch-flags.js";

test("firefox starts on about:blank, not its privileged home page", () => {
  assert.deepEqual(
    browserLaunchFlag("firefox", {
      port: 9300,
      profileDir: "/tmp/profile",
      headless: true,
    }),
    [
      "--no-sandbox",
      "--no-remote",
      "--headless",
      "--remote-debugging-port=9300",
      "--profile",
      "/tmp/profile",
      "about:blank",
    ],
  );
});

test("the firefox profile is written with a blank start page, and an outdated one is rewritten", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-profile-"));
  try {
    const userJs = path.join(dir, "firefox", "user.js");
    ensureBrowserProfile("firefox", userJs);
    const written = readFileSync(userJs, "utf8");
    assert.match(written, /user_pref\("browser\.startup\.page", 0\);/);
    assert.match(
      written,
      /user_pref\("browser\.startup\.homepage", "about:blank"\);/,
    );
    assert.match(
      written,
      /user_pref\("browser\.newtabpage\.enabled", false\);/,
    );

    writeFileSync(userJs, 'user_pref("devtools.chrome.enabled", true);');
    ensureBrowserProfile("firefox", userJs);
    assert.equal(readFileSync(userJs, "utf8"), written);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("firefox may open a profile a newer Firefox used", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "samurai-appdata-"));
  try {
    const env = browserLaunchEnv("firefox", dir);
    assert.equal(env.MOZ_ALLOW_DOWNGRADE, "1");
    assert.equal(env.MOZ_APP_DATA, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
