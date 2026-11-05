export interface HeaderEntry {
  name: string;
  value: string;
}

/** What a request context hands to `APIResponse` */
export interface ResponseInit {
  url: string;
  status: number;
  statusText: string;
  /** Every header as it arrived, in order, repeated names kept */
  headers: HeaderEntry[];
  body: Buffer;
}

/** The answer to a request made with an `APIRequestContext`. The body is already read. */
export class APIResponse {
  private disposed = false;

  constructor(private readonly init: ResponseInit) {}

  public status(): number {
    return this.init.status;
  }

  public statusText(): string {
    return this.init.statusText;
  }

  /** True for a status from 200 to 299 */
  public ok(): boolean {
    return this.init.status >= 200 && this.init.status < 300;
  }

  /** The URL the response came from: the last one when redirects were followed */
  public url(): string {
    return this.init.url;
  }

  /** Header names lower-cased; a name that came more than once is joined with ", " (`set-cookie` with a new line) */
  public headers(): Record<string, string> {
    const joined: Record<string, string> = {};
    for (const { name, value } of this.init.headers) {
      const key = name.toLowerCase();
      const glue = key === "set-cookie" ? "\n" : ", ";
      joined[key] = key in joined ? `${joined[key]}${glue}${value}` : value;
    }
    return joined;
  }

  /** Every header as it arrived, repeated names included (each `Set-Cookie` is an entry of its own) */
  public headersArray(): HeaderEntry[] {
    return this.init.headers.map(({ name, value }) => ({ name, value }));
  }

  public body(): Promise<Buffer> {
    if (this.disposed) return Promise.reject(new Error("response disposed"));
    return Promise.resolve(this.init.body);
  }

  public async text(): Promise<string> {
    return (await this.body()).toString("utf8");
  }

  public async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(
        `json(): the response body of ${this.init.url} is not JSON: ${(err as Error).message}`,
      );
    }
  }

  /** Frees the body: `body()`, `text()` and `json()` throw after it */
  public dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}
