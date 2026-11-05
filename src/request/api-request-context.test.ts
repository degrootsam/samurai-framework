import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import zlib from "node:zlib";
import { createRequestContext } from "./request.js";

let server: Server;
let base = "";
const hits: {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}[] = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      hits.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });
      const url = new URL(req.url ?? "/", "http://x");
      const send = (
        status: number,
        headers: Record<string, string | string[]>,
        text = "",
      ) => void res.writeHead(status, headers).end(text);
      switch (url.pathname) {
        case "/echo":
          return send(
            200,
            { "content-type": "application/json" },
            JSON.stringify({
              method: req.method,
              query: url.search,
              body,
              type: req.headers["content-type"],
            }),
          );
        case "/login":
          return send(
            200,
            { "set-cookie": ["sid=1; Path=/", "theme=dark; Path=/"] },
            "in",
          );
        case "/whoami":
          return send(200, {}, req.headers.cookie ?? "none");
        case "/redirect-set":
          return send(302, {
            location: "/whoami",
            "set-cookie": "hop=1; Path=/",
          });
        case "/see-other":
          return send(303, { location: "/echo" });
        case "/temporary":
          return send(307, { location: "/echo" });
        case "/moved":
          return send(301, { location: "/echo?moved=1" });
        case "/loop":
          return send(302, { location: "/loop" });
        case "/gzip":
          return send(
            200,
            { "content-encoding": "gzip" },
            zlib.gzipSync("zipped") as unknown as string,
          );
        case "/br":
          return send(
            200,
            { "content-encoding": "br" },
            zlib.brotliCompressSync("brotli") as unknown as string,
          );
        case "/deflate":
          return send(
            200,
            { "content-encoding": "deflate" },
            zlib.deflateSync("deflated") as unknown as string,
          );
        case "/missing":
          return send(404, {}, "nope");
        case "/slow":
          return void setTimeout(() => send(200, {}, "late"), 2000).unref();
        case "/reset":
          return void req.socket.destroy();
        default:
          return send(200, { "x-dup": ["a", "b"] }, "ok");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test("get resolves against baseURL, adds params and exposes the response", async () => {
  const api = createRequestContext({ baseURL: `${base}/` });
  const res = await api.get("/echo?a=1", { params: { b: "two", c: 3 } });
  assert.equal(res.status(), 200);
  assert.equal(res.ok(), true);
  assert.equal(res.url(), `${base}/echo?a=1&b=two&c=3`);
  assert.equal(res.headers()["content-type"], "application/json");
  assert.deepEqual((await res.json()) as object, {
    method: "GET",
    query: "?a=1&b=two&c=3",
    body: "",
  });
  const urlParams = await api.get("/echo", {
    params: new URLSearchParams("k=1&k=2"),
  });
  assert.equal(new URL(urlParams.url()).search, "?k=1&k=2");
  await api.dispose();
});

test("a relative URL without a baseURL throws what is wrong", async () => {
  const api = createRequestContext();
  await assert.rejects(
    api.get("/x"),
    /^Error: fetch\(\): "\/x" needs a baseURL; set one in samurai.config.ts, the environment or request.newContext\(\)$/,
  );
  await assert.rejects(api.get("ftp://x/"), /must be an http or https URL/);
});

test("post sends JSON data, form and multipart with their content types", async () => {
  const api = createRequestContext({ baseURL: base });
  const sent = async (options: object) => {
    const res = await api.post("/echo", options);
    return (await res.json()) as { method: string; body: string; type: string };
  };
  const json = await sent({ data: { a: 1 } });
  assert.equal(json.method, "POST");
  assert.equal(json.type, "application/json");
  assert.equal(json.body, '{"a":1}');
  const form = await sent({ form: { user: "me", pw: "x y" } });
  assert.equal(form.type, "application/x-www-form-urlencoded");
  assert.equal(form.body, "user=me&pw=x+y");
  const multi = await sent({
    multipart: {
      n: "1",
      f: { name: "f.txt", mimeType: "text/plain", buffer: Buffer.from("FILE") },
    },
  });
  assert.match(multi.type, /^multipart\/form-data; boundary=/);
  assert.match(multi.body, /filename="f.txt"[\s\S]*FILE/);
  const own = await sent({
    data: "raw",
    headers: { "Content-Type": "text/csv" },
  });
  assert.equal(own.type, "text/csv");
});

test("put, patch, delete, head and fetch use their method; headers merge over extraHTTPHeaders", async () => {
  const api = createRequestContext({
    baseURL: base,
    extraHTTPHeaders: { "x-a": "ctx", "x-b": "ctx" },
  });
  for (const [name, method] of [
    ["put", "PUT"],
    ["patch", "PATCH"],
    ["delete", "DELETE"],
  ] as const) {
    const res = await api[name]("/echo");
    assert.equal(((await res.json()) as { method: string }).method, method);
  }
  const head = await api.head("/echo");
  assert.equal(head.status(), 200);
  assert.equal((await head.body()).length, 0);
  await api.fetch("/echo", { method: "options", headers: { "X-B": "call" } });
  const last = hits[hits.length - 1]!;
  assert.equal(last.method, "OPTIONS");
  assert.equal(last.headers["x-a"], "ctx");
  assert.equal(last.headers["x-b"], "call");
  const viaObject = await api.fetch({ url: `${base}/echo`, method: "PUT" });
  assert.equal(((await viaObject.json()) as { method: string }).method, "PUT");
});

test("headersArray keeps repeated headers and headers() joins them", async () => {
  const api = createRequestContext({ baseURL: base });
  const res = await api.get("/other");
  assert.deepEqual(
    res
      .headersArray()
      .filter((h) => h.name === "x-dup")
      .map((h) => h.value),
    ["a", "b"],
  );
  assert.equal(res.headers()["x-dup"], "a, b");
  assert.equal(res.statusText(), "OK");
  assert.equal(await res.text(), "ok");
  await assert.rejects(
    res.json(),
    /^Error: json\(\): the response body of .* is not JSON: /,
  );
  await res.dispose();
  await assert.rejects(res.body(), /^Error: response disposed$/);
});

test("gzip, deflate and br bodies are decoded", async () => {
  const api = createRequestContext({ baseURL: base });
  assert.equal(await (await api.get("/gzip")).text(), "zipped");
  assert.equal(await (await api.get("/br")).text(), "brotli");
  assert.equal(await (await api.get("/deflate")).text(), "deflated");
});

test("redirects: 303 and 301 become GET, 307 keeps method and body, maxRedirects 0 returns the 3xx", async () => {
  const api = createRequestContext({ baseURL: base });
  const see = (await (
    await api.post("/see-other", { data: { a: 1 } })
  ).json()) as { method: string; body: string };
  assert.deepEqual([see.method, see.body], ["GET", ""]);
  const moved = await api.post("/moved", { data: "x" });
  assert.equal(new URL(moved.url()).search, "?moved=1");
  assert.equal(((await moved.json()) as { method: string }).method, "GET");
  const temporary = (await (
    await api.post("/temporary", { data: { a: 1 } })
  ).json()) as { method: string; body: string };
  assert.deepEqual([temporary.method, temporary.body], ["POST", '{"a":1}']);
  const stopped = await api.get("/see-other", { maxRedirects: 0 });
  assert.equal(stopped.status(), 303);
  assert.equal(stopped.headers().location, "/echo");
  await assert.rejects(
    api.get("/loop", { maxRedirects: 3 }),
    /^Error: fetch\(\): too many redirects, more than 3 /,
  );
});

test("a context keeps the cookies of responses, redirect hops included, and sends them back", async () => {
  const api = createRequestContext({ baseURL: base });
  assert.equal(await (await api.get("/whoami")).text(), "none");
  await api.get("/login");
  assert.equal(await (await api.get("/whoami")).text(), "sid=1; theme=dark");
  const hop = await api.get("/redirect-set");
  assert.equal(await hop.text(), "sid=1; theme=dark; hop=1");
  const state = await api.storageState();
  assert.deepEqual(state.cookies?.map((c) => c.name).sort(), [
    "hop",
    "sid",
    "theme",
  ]);
  const other = createRequestContext({ baseURL: base, storageState: state });
  assert.equal(
    await (await other.get("/whoami")).text(),
    "sid=1; theme=dark; hop=1",
  );
  const fresh = createRequestContext({ baseURL: base });
  assert.equal(await (await fresh.get("/whoami")).text(), "none");
});

test("failOnStatusCode throws without leaking headers or the query", async () => {
  const api = createRequestContext({
    baseURL: base,
    extraHTTPHeaders: { authorization: "Bearer SECRET" },
  });
  const res = await api.get("/missing?token=SECRET");
  assert.equal(res.status(), 404);
  assert.equal(res.ok(), false);
  await assert.rejects(
    api.get("/missing?token=SECRET", { failOnStatusCode: true }),
    (err: Error) => {
      assert.equal(err.message, `fetch(): 404 Not Found (GET ${base}/missing)`);
      assert.ok(!err.message.includes("SECRET"));
      return true;
    },
  );
});

test("timeout, reset connections, retries and dispose fail with fetch(): messages", async () => {
  const api = createRequestContext({ baseURL: base });
  await assert.rejects(
    api.get("/slow", { timeout: 100 }),
    /^Error: fetch\(\): timed out after 100ms \(GET .*\/slow\)$/,
  );
  await assert.rejects(api.get("/reset"), /^Error: fetch\(\): ECONNRESET /);
  const before = hits.length;
  await assert.rejects(api.get("/reset", { maxRetries: 2 }), /ECONNRESET/);
  assert.equal(hits.length - before, 3);
  const pending = api.get("/slow");
  await api.dispose();
  await assert.rejects(pending, /^Error: fetch\(\): request aborted /);
  await assert.rejects(api.get("/echo"), /^Error: request context disposed$/);
});

test("the Cookie header a caller sets is kept next to the jar's", async () => {
  const api = createRequestContext({ baseURL: base });
  await api.get("/login");
  assert.equal(
    await (await api.get("/whoami", { headers: { Cookie: "mine=1" } })).text(),
    "mine=1; sid=1; theme=dark",
  );
});
