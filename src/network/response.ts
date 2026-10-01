import { ResponseBodyUnavailableError } from "./data-collector.js";
import type { NetworkRequest, NetworkResponse } from "./network-tracker.js";

/** A response of the page, with access to its body */
export class Response {
  public readonly url: string;
  public readonly status: number;
  public readonly statusText: string;
  /** Header names lower-cased */
  public readonly headers: Record<string, string>;
  public readonly fromCache: boolean;
  public readonly request: NetworkRequest;
  private body_: Promise<Buffer> | undefined;

  constructor(
    data: NetworkResponse,
    private loadBody: (response: Response) => Promise<Buffer>,
  ) {
    this.url = data.url;
    this.status = data.status;
    this.statusText = data.statusText;
    this.headers = data.headers;
    this.fromCache = data.fromCache;
    this.request = data.request;
  }

  /** The browser's id of the request; the same for every hop of a redirect chain */
  public get id(): string {
    return this.request.id;
  }

  /** The body as bytes. Read once from the browser, then kept */
  public body(): Promise<Buffer> {
    if (this.status >= 300 && this.status < 400 && "location" in this.headers) {
      return Promise.reject(new ResponseBodyUnavailableError(this.url, "redirect response"));
    }
    this.body_ ??= this.loadBody(this).catch((err) => {
      this.body_ = undefined; // let a later call try again
      throw err;
    });
    return this.body_;
  }

  /** The body as UTF-8 text */
  public async text(): Promise<string> {
    return (await this.body()).toString("utf8");
  }

  /** The body parsed as JSON */
  public async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`Response body of ${this.url} is not JSON: ${(err as Error).message}`);
    }
  }
}
