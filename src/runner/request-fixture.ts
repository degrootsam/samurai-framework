import type { APIRequestContext } from "../request/api-request-context.js";
import { createRequestContext } from "../request/request.js";
import type { UseOptions } from "../types/use.js";

/**
 * The `request` fixture of one test: an `APIRequestContext` of its own (its own cookies), made when the test first
 * reads it, from the run's `baseURL` and the `use` options, and disposed when the test is over
 */
export class RequestFixture {
  private context: APIRequestContext | undefined;

  constructor(
    private readonly baseURL: string | undefined,
    private readonly use: UseOptions,
  ) {}

  public get(): APIRequestContext {
    const { use } = this;
    return (this.context ??= createRequestContext({
      baseURL: this.baseURL,
      extraHTTPHeaders: use.extraHTTPHeaders,
      ignoreHTTPSErrors: use.acceptInsecureCerts,
      ...(use.storageState !== undefined && {
        storageState: use.storageState,
      }),
    }));
  }

  public async dispose(): Promise<void> {
    await this.context?.dispose();
  }
}
