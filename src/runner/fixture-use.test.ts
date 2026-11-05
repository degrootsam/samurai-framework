import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SamuraiTestConfig } from "../types/config.js";
import type { RegisteredTestCase } from "../types/test.js";
import {
  checkFixtureUseNames,
  checkTestFixtureUse,
  effectiveFixtureUse,
} from "./fixture-use.js";
import { layersOf } from "./fixture-registry.js";
import { fixtureCatalog } from "./fixture-registry.js";
import { test as samurai } from "./registry.js";
import { withProject } from "./project.js";
import { effectiveUse } from "./use-options.js";
import { newSuite } from "./suite.js";

const make = async ({}: any, use: (value: unknown) => Promise<void>) => use(1);
const shop = samurai.extend<any>({
  orderOptions: [{ items: 1, paid: true }, { option: true }],
  order: make,
  customer: make,
});

const config: SamuraiTestConfig = {
  fixtures: [shop],
  environments: {
    staging: { use: { fixtures: { order: true }, locale: "nl-NL" } },
    production: {
      use: { fixtures: { order: false, customer: true }, locale: "de-DE" },
    },
  },
  use: { fixtures: { customer: true }, orderOptions: { items: 5 } },
  groups: [
    {
      name: "checkout",
      use: {
        fixtures: { order: true },
        orderOptions: { paid: false },
        locale: "fr-FR",
      },
    },
  ],
};

const testIn = (group?: string, ...use: object[]) =>
  ({
    name: "t",
    file: "/p/a.spec.ts",
    titlePath: ["t"],
    function: async () => {},
    suite: { ...newSuite(), use },
    ...(group !== undefined && { group }),
  }) as unknown as RegisteredTestCase;

const inEnvironment = <T>(environment: string, work: () => Promise<T>) =>
  withProject({ projectDir: process.cwd(), config, environment }, work);

describe("the use layers of a test", () => {
  it("config, environment, group and test.use apply in that order", async () => {
    await inEnvironment("staging", async () => {
      assert.equal((await effectiveUse(testIn())).locale, "nl-NL");
      assert.equal((await effectiveUse(testIn("checkout"))).locale, "fr-FR");
      assert.equal(
        (await effectiveUse(testIn("checkout", { locale: "es-ES" }))).locale,
        "es-ES",
      );
    });
  });

  it("the browser's use carries no fixture keys", async () => {
    await inEnvironment("staging", async () => {
      assert.deepEqual(
        await effectiveUse(
          testIn("checkout", { fixtures: { x: true }, xOptions: { a: 1 } }),
        ),
        { locale: "fr-FR" },
      );
    });
  });
});

describe("effectiveFixtureUse", () => {
  it("attaches by name and merges option fixtures key by key through the layers", async () => {
    await inEnvironment("staging", async () => {
      const use = await effectiveFixtureUse(
        testIn("checkout", { orderOptions: { items: 2 } }),
      );
      assert.deepEqual(use.attach.sort(), ["customer", "order"]);
      assert.deepEqual(use.options, {
        orderOptions: { items: 2, paid: false },
      });
      assert.equal(use.disabled.size, 0);
    });
  });

  it("a layer's false removes the attachment for the layers after it", async () => {
    await inEnvironment("staging", async () => {
      const use = await effectiveFixtureUse(
        testIn("checkout", { fixtures: { customer: false } }),
      );
      assert.deepEqual(use.attach, ["order"]);
    });
  });

  it("the environment's false always wins and names the environment", async () => {
    await inEnvironment("production", async () => {
      const use = await effectiveFixtureUse(
        testIn("checkout", { fixtures: { order: true } }),
      );
      // the group and the test insist on the order: the environment turns it off, so the test is skipped
      assert.deepEqual(use.attach, ["customer", "order"]);
      assert.equal(
        use.disabled.get("order"),
        "Fixture order is turned off in production",
      );
    });
  });

  it("without a group, the group's layer does not apply", async () => {
    await inEnvironment("staging", async () => {
      const use = await effectiveFixtureUse(testIn());
      assert.deepEqual(use.options, { orderOptions: { items: 5 } });
    });
  });
});

describe("checkFixtureUseNames", () => {
  const catalog = fixtureCatalog([shop]);
  const check = (cfg: SamuraiTestConfig) => checkFixtureUseNames(cfg, catalog);

  it("accepts known fixtures and option fixtures", () => {
    check(config);
  });

  it("names the place and the known fixtures", () => {
    assert.throws(
      () => check({ use: { fixtures: { orderr: true } } }),
      /^Error: config\.use\.fixtures: unknown fixture "orderr"\. Known fixtures: order, customer$/,
    );
    assert.throws(
      () =>
        check({
          environments: { prod: { use: { fixtures: { nope: false } } } },
        }),
      /config\.environments\.prod\.use\.fixtures: unknown fixture "nope"/,
    );
    assert.throws(
      () =>
        check({
          groups: [{ name: "g", use: { nopeOptions: { a: 1 } } }],
        }),
      /config\.groups\[0\]\.use\.nopeOptions: unknown option fixture "nopeOptions"\. Known option fixtures: orderOptions/,
    );
  });

  it("says when no fixtures are listed", () => {
    assert.throws(
      () => checkFixtureUseNames({ use: { fixtures: { a: true } } }, []),
      /No fixtures are listed in config\.fixtures/,
    );
  });
});

describe("checkTestFixtureUse", () => {
  const layers = layersOf(shop);

  it("accepts what the test's own extend defines", () => {
    checkTestFixtureUse(
      { fixtures: { order: true }, orderOptions: { a: 1 } },
      layers,
    );
  });

  it("refuses a fixture or option fixture it does not define", () => {
    assert.throws(
      () => checkTestFixtureUse({ fixtures: { nope: true } }, layers),
      /use\(\): unknown fixture "nope"\. This test has: orderOptions, order, customer/,
    );
    assert.throws(
      () => checkTestFixtureUse({ nopeOptions: {} }, layers),
      /use\(\): unknown option fixture "nopeOptions"/,
    );
    assert.throws(
      () =>
        checkTestFixtureUse(
          { fixtures: { a: true }, orderOptions: {} },
          undefined,
        ),
      /This test has no fixtures; write it with test\.extend\(\)/,
    );
  });
});
