import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeBody } from "./request-body.js";

test("no body option means no body", () => {
  assert.equal(encodeBody({}), undefined);
});

test("an object is sent as JSON, a JSON string as JSON, other text as bytes", () => {
  const json = encodeBody({ data: { a: [1, 2] } });
  assert.equal(json?.contentType, "application/json");
  assert.equal(json?.body.toString(), '{"a":[1,2]}');
  assert.equal(
    encodeBody({ data: '{"x":1}' })?.contentType,
    "application/json",
  );
  assert.equal(
    encodeBody({ data: "plain" })?.contentType,
    "application/octet-stream",
  );
  const bytes = encodeBody({ data: Buffer.from([1, 2, 3]) });
  assert.deepEqual([...(bytes?.body ?? [])], [1, 2, 3]);
  assert.equal(bytes?.contentType, "application/octet-stream");
  assert.equal(encodeBody({ data: [1] })?.body.toString(), "[1]");
});

test("form is urlencoded, from an object or URLSearchParams", () => {
  const fromObject = encodeBody({ form: { a: "x y", n: 1, ok: true } });
  assert.equal(fromObject?.body.toString(), "a=x+y&n=1&ok=true");
  assert.equal(fromObject?.contentType, "application/x-www-form-urlencoded");
  const params = new URLSearchParams();
  params.append("k", "1");
  params.append("k", "2");
  assert.equal(encodeBody({ form: params })?.body.toString(), "k=1&k=2");
});

test("multipart carries fields and file buffers under one boundary", () => {
  const encoded = encodeBody({
    multipart: {
      title: "hello",
      file: {
        name: 'a"b.txt',
        mimeType: "text/plain",
        buffer: Buffer.from("DATA"),
      },
      bin: { name: "b.bin", buffer: Buffer.from([0, 255]) },
    },
  })!;
  const boundary = /boundary=(.+)$/.exec(encoded.contentType)?.[1];
  assert.ok(boundary);
  const text = encoded.body.toString("latin1");
  assert.ok(text.startsWith(`--${boundary}\r\n`));
  assert.ok(text.endsWith(`--${boundary}--\r\n`));
  assert.match(text, /name="title"\r\n\r\nhello\r\n/);
  assert.match(
    text,
    /name="file"; filename="a_b.txt"\r\nContent-Type: text\/plain\r\n\r\nDATA\r\n/,
  );
  assert.match(
    text,
    /filename="b.bin"\r\nContent-Type: application\/octet-stream\r\n\r\n\u0000ÿ\r\n/,
  );
});

test("more than one body option is refused", () => {
  assert.throws(
    () => encodeBody({ data: "x", form: { a: "1" } }),
    /^Error: fetch\(\): data and form cannot be used together, pick one$/,
  );
});
