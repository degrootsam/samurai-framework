import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import type { HeaderEntry } from "./api-response.js";

/** One request to send, a single hop: redirects are the caller's business */
export interface HopRequest {
  url: URL;
  method: string;
  /** Names lower-cased */
  headers: Record<string, string>;
  body?: Buffer | undefined;
  ignoreHTTPSErrors: boolean;
  /** Milliseconds this hop may take; 0 is no limit */
  timeout: number;
  /** The timeout the caller set for the whole request, which the timeout message names (`timeout` is what is left of it) */
  budget?: number | undefined;
  signal: AbortSignal;
}

export interface HopResponse {
  status: number;
  statusText: string;
  headers: HeaderEntry[];
  /** The `Set-Cookie` headers, one entry each */
  setCookies: string[];
  /** Decoded: `Content-Encoding` is already undone */
  body: Buffer;
}

/** A request that failed before a response was complete */
export class TransportError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  if (body.length === 0) return body;
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(body);
    case "br":
      return zlib.brotliDecompressSync(body);
    case "deflate":
      try {
        return zlib.inflateSync(body);
      } catch {
        // Some servers send deflate without the zlib header
        return zlib.inflateRawSync(body);
      }
    default:
      return body;
  }
}

/** The url without credentials or query: what an error may say about where the request went */
export function describeURL(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

/** Sends one request over `http` or `https` and reads the whole response. Errors never include header values. */
export function sendHop(request: HopRequest): Promise<HopResponse> {
  const { url, method, headers, body, signal } = request;
  const where = `${method} ${describeURL(url)}`;
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new TransportError(`request aborted (${where})`));
    const transport = url.protocol === "https:" ? https : http;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (error: Error | undefined, value?: HopResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value as HopResponse);
    };
    const req = transport.request(
      url,
      {
        method,
        headers: {
          ...headers,
          ...(body && { "content-length": String(body.length) }),
        },
        // No shared pool: nothing stays open after the last request
        agent: false,
        ...(url.protocol === "https:" && {
          rejectUnauthorized: !request.ignoreHTTPSErrors,
        }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", (err) =>
          finish(new TransportError(`${err.message} (${where})`)),
        );
        res.on("end", () => {
          try {
            const raw = res.rawHeaders;
            const entries: HeaderEntry[] = [];
            for (let i = 0; i + 1 < raw.length; i += 2)
              entries.push({
                name: raw[i] as string,
                value: raw[i + 1] as string,
              });
            const decoded =
              method === "HEAD"
                ? Buffer.alloc(0)
                : decode(
                    Buffer.concat(chunks),
                    res.headers["content-encoding"],
                  );
            finish(undefined, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers: entries,
              setCookies: res.headers["set-cookie"] ?? [],
              body: decoded,
            });
          } catch (err) {
            finish(
              new TransportError(
                `the response body could not be decoded: ${(err as Error).message} (${where})`,
              ),
            );
          }
        });
      },
    );
    const onAbort = () => {
      req.destroy();
      finish(new TransportError(`request aborted (${where})`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    timer =
      request.timeout > 0
        ? setTimeout(() => {
            req.destroy();
            finish(
              new TransportError(
                `timed out after ${request.budget ?? request.timeout}ms (${where})`,
                "ETIMEDOUT",
              ),
            );
          }, request.timeout)
        : undefined;
    req.on("error", (err: NodeJS.ErrnoException) =>
      finish(
        new TransportError(`${err.code ?? err.message} (${where})`, err.code),
      ),
    );
    req.end(body);
  });
}
