import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { autoReply, FakeWebSocket, tick } from "../testing/fake-websocket.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { DataCollector, ResponseBodyUnavailableError } from "./data-collector.js";

const stops: Array<() => void> = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

const failing = (code: string, message = "nope") => Object.assign(new Error(message), { code });

function setup(handlers: Record<string, (params: any) => object | Error> = {}) {
  const ws = new FakeWebSocket();
  const connector = new BiDiConnector(ws as unknown as WebSocket);
  stops.push(autoReply(ws, { "network.addDataCollector": () => ({ collector: "c1" }), ...handlers }));
  const commands = (method: string) => ws.sent.filter((m) => m.method === method).map((m) => m.params as any);
  return { ws, connector, commands };
}

describe("DataCollector.start", () => {
  it("collects response bodies of this page, up to maxBodySize", async () => {
    const { connector, commands } = await setup();
    await DataCollector.start(connector, "top", { maxBodySize: 5000 });
    assert.deepEqual(commands("network.addDataCollector"), [
      { dataTypes: ["response"], maxEncodedDataSize: 5000, contexts: ["top"] },
    ]);
  });

  it("defaults to 10 MiB", async () => {
    const { connector, commands } = await setup();
    await DataCollector.start(connector, "top");
    assert.equal(commands("network.addDataCollector")[0].maxEncodedDataSize, 10 * 1024 * 1024);
  });
});

describe("DataCollector.read", () => {
  it("returns a text body as its UTF-8 bytes", async () => {
    const { connector, commands } = await setup({
      "network.getData": () => ({ bytes: { type: "string", value: "héllo" } }),
    });
    const collector = await DataCollector.start(connector, "top");
    const body = await collector.read("r1", "https://e.test/x");
    assert.deepEqual([...body], [...Buffer.from("héllo", "utf8")]);
    assert.deepEqual(commands("network.getData"), [{ dataType: "response", request: "r1", collector: "c1" }]);
  });

  it("decodes a base64 body byte for byte", async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    const { connector } = await setup({
      "network.getData": () => ({ bytes: { type: "base64", value: bytes.toString("base64") } }),
    });
    const collector = await DataCollector.start(connector, "top");
    assert.deepEqual([...(await collector.read("r1", "u"))], [...bytes]);
  });

  it("explains missing data: collected too late, or larger than the limit", async () => {
    const { connector } = await setup({ "network.getData": () => failing("no such network data") });
    const collector = await DataCollector.start(connector, "top");
    await assert.rejects(collector.read("r1", "https://e.test/x"), (err: unknown) => {
      assert.ok(err instanceof ResponseBodyUnavailableError);
      assert.equal(err.url, "https://e.test/x");
      assert.match(err.reason, /no body was collected/);
      assert.match(err.reason, /started after the request/);
      assert.match(err.reason, /larger than maxBodySize/);
      assert.match(err.message, /^Response body of https:\/\/e\.test\/x is unavailable: /);
      return true;
    });
  });

  it("says when the data is not there yet", async () => {
    const { connector } = await setup({ "network.getData": () => failing("unavailable network data") });
    const collector = await DataCollector.start(connector, "top");
    await assert.rejects(collector.read("r1", "u"), /not available yet/);
  });

  it("other browser errors are rethrown as they are", async () => {
    const { connector } = await setup({ "network.getData": () => failing("unknown error") });
    const collector = await DataCollector.start(connector, "top");
    await assert.rejects(collector.read("r1", "u"), { name: "BiDiError", code: "unknown error" });
  });
});

describe("DataCollector.release and dispose", () => {
  it("release frees the browser's copy", async () => {
    const { connector, commands } = await setup();
    const collector = await DataCollector.start(connector, "top");
    await collector.release("r1");
    assert.deepEqual(commands("network.disownData"), [{ dataType: "response", collector: "c1", request: "r1" }]);
  });

  it("release never throws: the copy may be gone already", async () => {
    const { connector } = await setup({ "network.disownData": () => failing("no such network data") });
    const collector = await DataCollector.start(connector, "top");
    await assert.doesNotReject(collector.release("r1"));
  });

  it("dispose removes the collector once", async () => {
    const { connector, commands } = await setup();
    const collector = await DataCollector.start(connector, "top");
    await collector.dispose();
    await collector.dispose();
    await tick(5);
    assert.deepEqual(commands("network.removeDataCollector"), [{ collector: "c1" }]);
  });

  it("dispose ignores a collector the browser no longer knows", async () => {
    const { connector } = await setup({ "network.removeDataCollector": () => failing("no such network collector") });
    const collector = await DataCollector.start(connector, "top");
    await assert.doesNotReject(collector.dispose());
  });
});
