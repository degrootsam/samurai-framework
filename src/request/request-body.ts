import { randomBytes } from "node:crypto";

/** A file in a `multipart` body */
export interface FilePayload {
  name: string;
  /** @default "application/octet-stream" */
  mimeType?: string;
  buffer: Buffer;
}

type Scalar = string | number | boolean;

/** The body options of a request: at most one is set */
export interface BodyOptions {
  /** Sent as it is (a string, a `Buffer`), or as JSON (anything else) */
  data?: string | Buffer | object | number | boolean | null;
  /** Sent as `application/x-www-form-urlencoded` */
  form?: Record<string, Scalar> | URLSearchParams;
  /** Sent as `multipart/form-data`: fields and files */
  multipart?: Record<string, Scalar | FilePayload>;
}

export interface EncodedBody {
  body: Buffer;
  contentType: string;
}

function isFile(value: unknown): value is FilePayload {
  return (
    typeof value === "object" &&
    value !== null &&
    Buffer.isBuffer((value as FilePayload).buffer)
  );
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const quoted = (text: string) => text.replace(/["\r\n]/g, "_");

function multipartOf(parts: Record<string, Scalar | FilePayload>): EncodedBody {
  const boundary = `----samurai${randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(parts)) {
    const file = isFile(value);
    const head = file
      ? `Content-Disposition: form-data; name="${quoted(name)}"; filename="${quoted(value.name)}"\r\nContent-Type: ${value.mimeType ?? "application/octet-stream"}`
      : `Content-Disposition: form-data; name="${quoted(name)}"`;
    chunks.push(
      Buffer.from(`--${boundary}\r\n${head}\r\n\r\n`),
      file ? value.buffer : Buffer.from(String(value)),
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * The bytes of a request body and the `Content-Type` that goes with them (a header the caller sets wins over it).
 * `undefined` when there is no body. Throws `fetch(): ...` when more than one of the options is set.
 */
export function encodeBody(options: BodyOptions): EncodedBody | undefined {
  const given = (["data", "form", "multipart"] as const).filter(
    (key) => options[key] !== undefined,
  );
  if (given.length > 1)
    throw new Error(
      `fetch(): ${given.join(" and ")} cannot be used together, pick one`,
    );
  const { data, form, multipart } = options;
  if (form !== undefined) {
    const params =
      form instanceof URLSearchParams
        ? form
        : new URLSearchParams(
            Object.entries(form).map(([key, value]) => [key, String(value)]),
          );
    return {
      body: Buffer.from(params.toString()),
      contentType: "application/x-www-form-urlencoded",
    };
  }
  if (multipart !== undefined) return multipartOf(multipart);
  if (data === undefined) return undefined;
  if (typeof data === "string")
    return {
      body: Buffer.from(data),
      contentType: isJson(data)
        ? "application/json"
        : "application/octet-stream",
    };
  if (Buffer.isBuffer(data) || data instanceof Uint8Array)
    return {
      body: Buffer.from(data),
      contentType: "application/octet-stream",
    };
  return {
    body: Buffer.from(JSON.stringify(data)),
    contentType: "application/json",
  };
}
