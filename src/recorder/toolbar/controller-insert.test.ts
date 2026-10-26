import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigEditError } from "../../project/config-edit.js";
import { ExistsError } from "../../project/variables.js";
import {
  failingType,
  SECRET,
  NEW_SECRET,
  LOCATOR,
  lastOf,
  insert,
  add,
  setup,
} from "./controller-fixture.js";

describe("ToolbarController insert and add", () => {
  it("inserts a variable: types its value, then records the reference", async () => {
    const { controller, calls, observed, replies, noSecretLeaks } = setup();
    await controller.handle(insert(5, "env", "testUser"));
    assert.deepEqual(calls, ["type dev@example.com"]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "env", name: "testUser" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 5, result: { ok: true } }]);
    noSecretLeaks();
  });

  it("inserts a set secret without sending its value to the page", async () => {
    const { controller, calls, observed, replies, noSecretLeaks } = setup();
    await controller.handle(insert(6, "secret", "ADMIN_PASSWORD"));
    assert.deepEqual(calls, [`type ${SECRET}`]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "secret", name: "ADMIN_PASSWORD" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 6, result: { ok: true } }]);
    noSecretLeaks();
  });

  it("reports a field it couldn't type into and records nothing", async () => {
    const { controller, observed, replies } = setup(
      {},
      {
        type: async () => {
          throw new Error("not editable");
        },
      },
    );
    await controller.handle(insert(7, "env", "testUser"));
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      { id: 7, result: { ok: false, error: "Couldn't type into that field" } },
    ]);
  });

  it("rejects an element no locator identifies", async () => {
    const { controller, observed, replies, calls } = setup(
      {},
      { rank: async () => undefined },
    );
    await controller.handle(insert(8, "env", "testUser"));
    assert.deepEqual(calls, []);
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      {
        id: 8,
        result: {
          ok: false,
          error: "This element can't be identified uniquely",
        },
      },
    ]);
  });

  it("rejects inserting a secret that has no value (the view opens New secret instead)", async () => {
    const { controller, observed, replies, calls } = setup();
    await controller.handle(insert(9, "secret", "API_TOKEN"));
    assert.deepEqual(calls, []);
    assert.deepEqual(observed, []);
    assert.deepEqual(replies, [
      {
        id: 9,
        result: { ok: false, error: "Set a value for API_TOKEN first" },
      },
    ]);
  });

  it("adds a variable to the project, lists it and inserts it", async () => {
    const { controller, calls, observed, replies, last } = setup();
    await controller.handle(add(10, "env", "adminUser", "admin@example.com"));
    assert.deepEqual(calls, [
      "addVariable adminUser=admin@example.com",
      "type admin@example.com",
    ]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "env", name: "adminUser" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 10, result: { ok: true } }]);
    assert.deepEqual(lastOf(last().variables), {
      name: "adminUser",
      value: "admin@example.com",
    });
  });

  it("shows name errors under the name field", async () => {
    const exists = setup(
      {},
      {
        addVariable: async (name) => {
          throw new ExistsError(`"${name}" already exists`);
        },
      },
    );
    await exists.controller.handle(add(11, "env", "adminUser", "x"));
    assert.deepEqual(exists.replies, [
      {
        id: 11,
        result: {
          ok: false,
          error: `"adminUser" already exists`,
          field: "name",
        },
      },
    ]);
    assert.deepEqual(exists.observed, []);

    const listed = setup();
    await listed.controller.handle(add(12, "env", "testUser", "x"));
    assert.deepEqual(listed.replies, [
      {
        id: 12,
        result: {
          ok: false,
          error: `"testUser" already exists`,
          field: "name",
        },
      },
    ]);
    assert.deepEqual(listed.calls, [], "nothing written");

    const invalid = setup(
      {},
      {
        setSecret: async () => {
          throw new Error(
            "Use letters, digits and _; a secret is UPPER_SNAKE_CASE.",
          );
        },
      },
    );
    await invalid.controller.handle(add(13, "secret", "bad name", NEW_SECRET));
    assert.deepEqual(invalid.replies, [
      {
        id: 13,
        result: {
          ok: false,
          error: "Use letters, digits and _; a secret is UPPER_SNAKE_CASE.",
          field: "name",
        },
      },
    ]);
    invalid.noSecretLeaks();
  });

  it("says so when samurai.config.ts can't be edited, and inserts nothing", async () => {
    const { controller, replies, observed, calls, last } = setup(
      {},
      {
        addVariable: async () => {
          throw new ConfigEditError("not a plain object");
        },
      },
    );
    await controller.handle(add(14, "env", "adminUser", "x"));
    assert.deepEqual(replies, [
      {
        id: 14,
        result: {
          ok: false,
          error:
            "samurai.config.ts can't be changed automatically. Add adminUser to environments.dev.variables yourself.",
        },
      },
    ]);
    assert.deepEqual(observed, []);
    assert.ok(!calls.some((call) => call.startsWith("type")));
    controller.loaded();
    assert.ok(!last().variables.some((v) => v.name === "adminUser"));
    controller.dispose();
  });

  it("refuses to add a variable when the recording has no environment", async () => {
    const { controller, replies, calls } = setup({ canAddVariables: false });
    await controller.handle(add(15, "env", "adminUser", "x"));
    assert.deepEqual(replies, [
      {
        id: 15,
        result: { ok: false, error: "This recording has no environment" },
      },
    ]);
    assert.deepEqual(calls, []);
  });

  it("adds a secret: writes it, lists it as set and types the given value", async () => {
    const { controller, calls, observed, replies, last, noSecretLeaks } =
      setup();
    await controller.handle(add(16, "secret", "API_TOKEN", NEW_SECRET));
    assert.deepEqual(calls, [
      `setSecret API_TOKEN=${NEW_SECRET}`,
      "secretAdded API_TOKEN",
      `type ${NEW_SECRET}`,
    ]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "secret", name: "API_TOKEN" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 16, result: { ok: true } }]);
    assert.deepEqual(
      last().secrets.find((s) => s.name === "API_TOKEN"),
      { name: "API_TOKEN", set: true },
    );
    // A secret that already has a value is not overwritten from the panel
    await controller.handle(add(17, "secret", "ADMIN_PASSWORD", NEW_SECRET));
    assert.deepEqual(lastOf(replies), {
      id: 17,
      result: {
        ok: false,
        error: `"ADMIN_PASSWORD" already exists`,
        field: "name",
      },
    });
    noSecretLeaks();
  });

  it("never echoes a secret value in an error", async () => {
    const { controller, replies, noSecretLeaks } = setup(
      {},
      {
        setSecret: async (_name, value) => {
          throw new Error(`Could not write ${value}`);
        },
      },
    );
    await controller.handle(add(18, "secret", "NEW_ONE", NEW_SECRET));
    assert.equal(lastOf(replies)?.result.ok, false);
    noSecretLeaks();
  });

  it("shows a toast when typing fails, since the panel is gone by then", async () => {
    const { controller, last, replies } = setup({}, failingType);
    await controller.handle(insert(40, "env", "testUser"));
    assert.equal(last().toast?.text, "Couldn't type into that field");
    assert.deepEqual(replies, [
      {
        id: 40,
        result: { ok: false, error: "Couldn't type into that field" },
      },
    ]);

    const added = setup({}, failingType);
    await added.controller.handle(add(41, "env", "adminUser", "x"));
    assert.equal(
      added.last().toast?.text,
      "Saved adminUser, but couldn't type into that field",
    );
    assert.ok(
      added.last().variables.some((v) => v.name === "adminUser"),
      "the saved variable is listed",
    );
  });

  it("tells the recorder a secret was added before it types it, even when typing fails", async () => {
    const { controller, calls } = setup(
      {},
      {
        type: async (_locator, value) => {
          calls.push(`type ${value}`);
          throw new Error("not editable");
        },
      },
    );
    await controller.handle(add(44, "secret", "NEW_ONE", NEW_SECRET));
    assert.deepEqual(calls, [
      `setSecret NEW_ONE=${NEW_SECRET}`,
      "secretAdded NEW_ONE",
      `type ${NEW_SECRET}`,
    ]);
  });
});

describe("ToolbarController inputs", () => {
  it("lists the declared inputs in the state", async () => {
    const { controller, last } = setup();
    await controller.handle(insert(49, "env", "testUser"));
    assert.deepEqual(last().inputs, [{ name: "email", value: "a@b.c" }]);
  });

  it("a new input types its value and declares it with that default, without writing the project", async () => {
    const { controller, calls, observed, replies, last } = setup();
    await controller.handle(add(50, "input", "phone", "0612345678"));
    assert.deepEqual(calls, ["type 0612345678"]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "input", name: "phone" },
        declare: "0612345678",
      },
    ]);
    assert.deepEqual(replies, [{ id: 50, result: { ok: true } }]);
    assert.ok(last().inputs.some((i) => i.name === "phone"));
  });

  it("an existing input types its default and declares nothing", async () => {
    const { controller, calls, observed, replies } = setup();
    await controller.handle(insert(51, "input", "email"));
    assert.deepEqual(calls, ["type a@b.c"]);
    assert.deepEqual(observed, [
      {
        type: "insert",
        locator: LOCATOR,
        value: { kind: "input", name: "email" },
      },
    ]);
    assert.deepEqual(replies, [{ id: 51, result: { ok: true } }]);
  });

  it("refuses a name that is taken, not a name or reserved, and an input that isn't declared", async () => {
    const { controller, calls, observed, replies } = setup();
    await controller.handle(add(52, "input", "email", "x"));
    await controller.handle(add(53, "input", "my-name", "x"));
    await controller.handle(add(56, "input", "status", "x"));
    await controller.handle(insert(54, "input", "nope"));
    assert.deepEqual(calls, []);
    assert.deepEqual(observed, []);
    assert.deepEqual(
      replies.map((r) => r.result),
      [
        { ok: false, error: `"email" already exists`, field: "name" },
        {
          ok: false,
          error: "name: use letters, digits and _",
          field: "name",
        },
        { ok: false, error: `name: "status" is reserved`, field: "name" },
        { ok: false, error: `There is no input "nope"` },
      ],
    );
  });

  it("a field it couldn't type into declares nothing", async () => {
    const { controller, observed, last } = setup({}, failingType);
    await controller.handle(add(55, "input", "phone", "1"));
    assert.deepEqual(observed, []);
    assert.ok(!last().inputs.some((i) => i.name === "phone"));
  });
});
