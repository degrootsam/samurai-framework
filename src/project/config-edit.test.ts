import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigEditError, editConfig, hasConfigPath } from "./config-edit.js";

const CONFIG = `import { defineConfig } from "@itmetsam/samurai-framework";

export default defineConfig({
  // keep me
  environments: {
    dev: { baseURL: "http://localhost:3000" },
  },
});
`;

describe("editConfig", () => {
  it("adds a nested value and creates the objects on the way", () => {
    const out = editConfig(
      CONFIG,
      ["environments", "dev", "variables", "adminUser"],
      "a@b.c",
    );
    assert.match(out, /adminUser: "a@b\.c"/);
    assert.match(out, /\/\/ keep me/);
    assert.match(out, /baseURL: "http:\/\/localhost:3000"/);
  });

  it("replaces an existing value and leaves the rest byte for byte", () => {
    const once = editConfig(
      CONFIG,
      ["environments", "dev", "variables", "x"],
      "1",
    );
    const twice = editConfig(
      once,
      ["environments", "dev", "variables", "x"],
      "2",
    );
    assert.equal(twice, once.replace('x: "1"', 'x: "2"'));
  });

  it("refuses a config whose environments come from a variable", () => {
    const spread = `const environments = {};\nexport default defineConfig({ environments });\n`;
    assert.throws(
      () => editConfig(spread, ["environments", "dev", "variables", "x"], "1"),
      ConfigEditError,
    );
  });
});

describe("hasConfigPath", () => {
  it("finds an existing property and not a missing one", () => {
    assert.equal(
      hasConfigPath(CONFIG, ["environments", "dev", "baseURL"]),
      true,
    );
    assert.equal(
      hasConfigPath(CONFIG, ["environments", "dev", "variables", "x"]),
      false,
    );
  });
});
