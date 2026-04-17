import type { Extensible } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { Cookie } from "./network.js";

export type StorageResult =
  | DeleteCookiesResult
  | GetCookiesResult
  | SetCookieResult;

export interface PartitionKey extends Extensible {
  userContext?: UserContext;
  sourceOrigin?: string;
}

export interface DeleteCookiesResult {
  partitionKey: PartitionKey;
}

export interface GetCookiesResult {
  cookies: Cookie[];
  partitionKey: PartitionKey;
}

export interface SetCookieResult {
  partitionKey: PartitionKey;
}
