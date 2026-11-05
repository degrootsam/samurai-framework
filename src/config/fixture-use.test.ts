import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  checkFixtureUse,
  isFixtureUseKey,
  mergeFixtureUse,
  omitFixtureUse,
  pickFixtureUse,
} from "./fixture-use.js";
import { validateUseOptions } from "./use-options.js";

describe("fixture keys of use", () => {
  test("`fixtures` and keys ending in Options are the fixture keys", () => {
    assert.equal(isFixtureUseKey("fixtures"), true);
    assert.equal(isFixtureUseKey("orderOptions"), true);
    assert.equal(isFixtureUseKey("locale"), false);
    assert.equal(isFixtureUseKey("Options"), false);
  });

  test("omitFixtureUse keeps the browser options, pickFixtureUse the fixture ones", () => {
    const layer = {
      locale: "nl-NL",
      fixtures: { order: true },
      orderOptions: { items: 2 },
    };
    assert.deepEqual(omitFixtureUse(layer), { locale: "nl-NL" });
    assert.deepEqual(pickFixtureUse(layer), {
      fixtures: { order: true },
      orderOptions: { items: 2 },
    });
    assert.deepEqual(omitFixtureUse(undefined), {});
  });

  test("checkFixtureUse accepts booleans and objects, refuses the rest", () => {
    checkFixtureUse({ fixtures: { a: true, b: false }, aOptions: { x: 1 } });
    assert.throws(
      () => checkFixtureUse({ fixtures: [] }),
      /use\(\): fixtures must be an object of fixture names and true or false/,
    );
    assert.throws(
      () => checkFixtureUse({ fixtures: { a: "yes" } }),
      /use\(\): fixtures.a must be true or false, got "yes"/,
    );
    assert.throws(
      () => checkFixtureUse({ orderOptions: 3 }),
      /use\(\): orderOptions must be an object/,
    );
  });

  test("validateUseOptions lets the fixture keys through and checks them", () => {
    assert.deepEqual(
      validateUseOptions({ fixtures: { order: true }, orderOptions: { n: 1 } }),
      { fixtures: { order: true }, orderOptions: { n: 1 } },
    );
    assert.throws(
      () => validateUseOptions({ fixtures: { order: 1 } }),
      /fixtures.order must be true or false/,
    );
    assert.throws(
      () => validateUseOptions({ nope: 1 }),
      /unknown option "nope"/,
    );
  });
});

describe("mergeFixtureUse", () => {
  test("`fixtures` merge key by key, a later layer winning", () => {
    const merged = mergeFixtureUse([
      { fixtures: { customer: true, order: false } },
      { fixtures: { order: true } },
      {},
      { fixtures: { customer: false } },
    ]);
    assert.deepEqual(merged.fixtures, { customer: false, order: true });
  });

  test("option fixtures merge key by key too", () => {
    const merged = mergeFixtureUse([
      { orderOptions: { items: 1, paid: true } },
      { orderOptions: { items: 2 }, other: 1 },
      { orderOptions: { paid: false }, shipOptions: { fast: true } },
    ]);
    assert.deepEqual(merged.options, {
      orderOptions: { items: 2, paid: false },
      shipOptions: { fast: true },
    });
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(mergeFixtureUse([]), { fixtures: {}, options: {} });
  });
});
