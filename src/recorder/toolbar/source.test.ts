import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANDIDATES_JS } from "../candidates.js";
import { TOOLBAR_KEY, TOOLBAR_SANDBOX } from "./protocol.js";
import { TOOLBAR_SOURCE } from "./source.js";
import { TOOLBAR_CSS } from "./styles.js";

describe("toolbar script", () => {
  it("compiles as a function declaration", () => {
    assert.doesNotThrow(() => new Function(`return (${TOOLBAR_SOURCE})`));
    assert.match(TOOLBAR_SOURCE, /^\(send\) => \{/);
  });

  it("is the slices of source/ joined in order, each section banner once", () => {
    const banners = [
      "// ---- DOM ----",
      "// ---- Names and labels ----",
      "// ---- Placement ----",
      "// ---- Views ----",
      "// ---- Panels and picking ----",
      "// ---- Drag ----",
      "// ---- Events inside the toolbar",
      "// ---- Events on the page",
      "// ---- The recorder's side ----",
      "// ---- Attach ----",
    ];
    let from = 0;
    for (const banner of banners) {
      const at = TOOLBAR_SOURCE.indexOf(banner, from);
      assert.ok(at >= from, `${banner} is missing or out of order`);
      assert.equal(
        TOOLBAR_SOURCE.indexOf(banner, at + 1),
        -1,
        `${banner} appears twice`,
      );
      from = at;
    }
    assert.match(TOOLBAR_SOURCE, /attach\);\n\}$/);
  });

  it("draws into a closed shadow root on its own host element", () => {
    assert.ok(TOOLBAR_SOURCE.includes(`attachShadow({ mode: "closed" })`));
    assert.ok(TOOLBAR_SOURCE.includes(`"samurai-recorder-toolbar"`));
  });

  it("keeps its hook under the shared key and leaves the sandbox name to the caller", () => {
    assert.ok(TOOLBAR_SOURCE.includes(`Symbol.for("${TOOLBAR_KEY}")`));
    assert.ok(!TOOLBAR_SOURCE.includes(TOOLBAR_SANDBOX));
  });

  it("shares the candidate code inside the function and carries its styles", () => {
    const body = TOOLBAR_SOURCE.slice(TOOLBAR_SOURCE.indexOf("{"));
    assert.ok(body.includes(CANDIDATES_JS));
    assert.ok(TOOLBAR_SOURCE.includes(JSON.stringify(TOOLBAR_CSS)));
  });

  it("holds no template literals, which could not survive the page", () => {
    assert.ok(!TOOLBAR_SOURCE.includes("`"));
  });

  it("styles start from a clean slate", () => {
    assert.match(TOOLBAR_CSS, /^\s*:host \{ all: initial; \}/);
  });

  it("uses the spec's wording", () => {
    for (const text of [
      "Recording",
      "Paused",
      "Nothing you do now is recorded.",
      "Click an element · Esc cancels",
      "Add a step that opens this page?",
      "Click into a field first",
      "This recording has no environment",
      "Until the page settles",
      "No requests for 500 ms",
      "Save and insert",
      " to .gitignore before committing.",
      "Visible part",
      "Whole page",
    ]) {
      assert.ok(TOOLBAR_SOURCE.includes(text), text);
    }
  });
});
