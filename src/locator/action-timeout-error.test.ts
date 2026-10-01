import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionTimeoutError } from "./action-timeout-error.js";

const base = { action: "click", selector: '//button[@type="submit"]', timeout: 5000 } as const;

test("unreadable: no probe completed", () => {
  const err = new ActionTimeoutError({ ...base, reason: "unreadable" });
  assert.equal(err.message, 'click(): could not read //button[@type="submit"] within 5000ms');
});

test("not attached", () => {
  const err = new ActionTimeoutError({
    ...base,
    reason: "not-attached",
    checks: { attached: "fail", visible: "pending" },
  });
  assert.equal(err.message, 'click(): //button[@type="submit"] was not attached within 5000ms');
});

test("wrong state for waitFor", () => {
  const err = new ActionTimeoutError({
    action: "waitFor",
    selector: '//div[@class="spinner"]',
    timeout: 300,
    reason: "wrong-state",
    state: "hidden",
  });
  assert.equal(err.message, 'waitFor(): //div[@class="spinner"] did not become hidden within 300ms');
});

test("not actionable lists every check in order", () => {
  const err = new ActionTimeoutError({
    ...base,
    reason: "not-actionable",
    checks: {
      attached: "pass",
      visible: "pass",
      stable: "pass",
      enabled: "fail",
      "hit target": "pending",
    },
  });
  assert.equal(
    err.message,
    'click(): //button[@type="submit"] was not actionable within 5000ms\n' +
      "  attached ✓  visible ✓  stable ✓  enabled ✗  hit target —",
  );
});

test("a failed hit target names the covering element", () => {
  const err = new ActionTimeoutError({
    ...base,
    reason: "not-actionable",
    checks: {
      attached: "pass",
      visible: "pass",
      stable: "pass",
      enabled: "pass",
      "hit target": "fail",
    },
    coveredBy: "div#cookie-banner.overlay",
  });
  assert.equal(
    err.message,
    'click(): //button[@type="submit"] was not actionable within 5000ms\n' +
      "  attached ✓  visible ✓  stable ✓  enabled ✓  hit target ✗ (covered by div#cookie-banner.overlay)",
  );
});

test("exposes its details", () => {
  const checks = { attached: "fail" } as const;
  const err = new ActionTimeoutError({ ...base, reason: "not-attached", checks });
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ActionTimeoutError");
  assert.equal(err.action, "click");
  assert.equal(err.selector, '//button[@type="submit"]');
  assert.equal(err.timeout, 5000);
  assert.equal(err.reason, "not-attached");
  assert.deepEqual(err.checks, checks);
  assert.equal(err.coveredBy, undefined);
  assert.equal(err.state, undefined);
});
