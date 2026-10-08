import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FlowFile, FlowNodeModel } from "./schema.js";
import { KEY_PATTERN, keyBase, uniqueKey, withKeys } from "./keys.js";

const n = (over: Partial<FlowNodeModel>): FlowNodeModel => ({
  id: "x",
  kind: "test",
  onFailure: "stop",
  position: { x: 0, y: 0 },
  ...over,
});

describe("keys", () => {
  test("keyBase uses the title, else the test's name, else the group, else the kind", () => {
    assert.equal(keyBase(n({ title: "Log in!" })), "log_in");
    assert.equal(
      keyBase(n({ ref: { testId: "auth/login.spec.ts::Auth > Signs in" } })),
      "signs_in",
    );
    assert.equal(
      keyBase(n({ kind: "group", ref: { group: "Smoke 2" } })),
      "smoke_2",
    );
    assert.equal(keyBase(n({ kind: "set-variable" })), "set_variable");
    assert.equal(keyBase(n({ title: "123" })), "n123");
  });
  test("uniqueKey adds _2, _3 …", () => {
    assert.equal(uniqueKey("login", new Set()), "login");
    assert.equal(uniqueKey("login", new Set(["login", "login_2"])), "login_3");
  });
  test("withKeys fills missing and duplicate keys, leaves valid ones", () => {
    const flow: FlowFile = {
      id: "f",
      name: "f",
      nodes: [
        n({ id: "s", kind: "start" }),
        n({ id: "a", title: "Login", key: "login" }),
        n({ id: "b", title: "Login" }),
        n({ id: "c", title: "Pay", key: "login" }),
      ],
      edges: [],
    };
    const keyed = withKeys(flow);
    assert.deepEqual(
      keyed.nodes.map((x) => x.key),
      ["start", "login", "login_2", "pay"],
    );
    assert.equal(withKeys(keyed), keyed);
    assert.equal(
      keyed.nodes.every((x) => KEY_PATTERN.test(x.key!)),
      true,
    );
  });
  test("withKeys never takes a key another node already has", () => {
    const flow: FlowFile = {
      id: "f",
      name: "f",
      nodes: [n({ id: "a", title: "Login" }), n({ id: "b", key: "login" })],
      edges: [],
    };
    assert.deepEqual(
      withKeys(flow).nodes.map((x) => x.key),
      ["login_2", "login"],
    );
  });
});
