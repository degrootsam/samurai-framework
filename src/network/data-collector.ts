import type { BiDiConnector } from "../transport/bidi-connection.js";
import { BiDiError } from "../transport/bidi-error.js";
import type { Collector } from "../types/bidi-modules/network.js";

/** How large a response body may be to be kept: 10 MiB */
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Chrome counts the headers of a response in the size it compares with the collector's limit (a 14-byte body
 * arrives as about 200 bytes), Firefox counts the body. Chrome's limit is raised by this much and the body is
 * measured after it is read.
 */
const CHROME_HEADER_ALLOWANCE = 64 * 1024;

/** The body of a response cannot be read */
export class ResponseBodyUnavailableError extends Error {
  public readonly url: string;
  public readonly reason: string;

  constructor(url: string, reason: string) {
    super(`Response body of ${url} is unavailable: ${reason}`);
    this.name = "ResponseBodyUnavailableError";
    this.url = url;
    this.reason = reason;
  }
}

/**
 * A browser only keeps response bodies for a request when a data collector was registered before the request
 * started. This registers one for a page and reads bodies through it.
 */
export class DataCollector {
  private disposed = false;

  private constructor(
    private connector: BiDiConnector,
    private id: Collector,
    private maxBodySize: number,
  ) {}

  public static async start(
    connector: BiDiConnector,
    contextId: string,
    options: { maxBodySize?: number } = {},
  ): Promise<DataCollector> {
    const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
    const { collector } = await connector.send("network.addDataCollector", {
      dataTypes: ["response"],
      maxEncodedDataSize:
        connector.browserName === "chrome"
          ? maxBodySize + CHROME_HEADER_ALLOWANCE
          : maxBodySize,
      contexts: [contextId],
    });
    return new DataCollector(connector, collector, maxBodySize);
  }

  /** The body of the response to request `requestId`; `url` only names it in errors */
  public async read(requestId: string, url: string): Promise<Buffer> {
    try {
      const { bytes } = await this.connector.send("network.getData", {
        dataType: "response",
        request: requestId,
        collector: this.id,
      });
      const body =
        bytes.type === "base64"
          ? Buffer.from(bytes.value, "base64")
          : Buffer.from(bytes.value, "utf8");
      if (body.length > this.maxBodySize) {
        throw new ResponseBodyUnavailableError(
          url,
          `the response is larger than maxBodySize (${this.maxBodySize} bytes)`,
        );
      }
      return body;
    } catch (err) {
      if (err instanceof BiDiError && err.code === "no such network data") {
        throw new ResponseBodyUnavailableError(
          url,
          "no body was collected: the collector started after the request, or the response is larger than maxBodySize",
        );
      }
      if (err instanceof BiDiError && err.code === "unavailable network data") {
        throw new ResponseBodyUnavailableError(
          url,
          "the body is not available yet",
        );
      }
      throw err;
    }
  }

  /** Lets the browser drop its copy of a body that has been read. Never throws */
  public async release(requestId: string): Promise<void> {
    try {
      await this.connector.send("network.disownData", {
        dataType: "response",
        collector: this.id,
        request: requestId,
      });
    } catch {
      // Already gone: nothing left to free
    }
  }

  /** Idempotent */
  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.connector.send("network.removeDataCollector", {
        collector: this.id,
      });
    } catch (err) {
      if (!(
        err instanceof BiDiError && err.code === "no such network collector"
      ))
        throw err;
    }
  }
}
