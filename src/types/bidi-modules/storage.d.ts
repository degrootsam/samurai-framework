import type { Extensible } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { BrowsingContext } from "./browsing-context.js";
import type { BytesValue, Cookie, SameSite } from "./network.js";

export type StorageCommands = {
  "storage.getCookies": {
    params: {
      filter?: CookieFilter;
      partition?: PartitionDescriptor;
    };
    result: {
      cookies: Cookie[];
      partitionKey: PartitionKey;
    };
  };
  "storage.setCookie": {
    params: {
      cookie: PartialCookie;
      partition?: PartitionDescriptor;
    };
    result: {
      partitionKey: PartitionKey;
    };
  };
  "storage.deleteCookies": {
    params: {
      filter?: CookieFilter;
      partition?: PartitionDescriptor;
    };
    result: {
      partitionKey: PartitionKey;
    };
  };
};

export interface PartialCookie extends Partial<Cookie> {
  name: string;
  value: BytesValue;
  domain: string;
}

export interface CookieFilter extends Extensible {
  name?: string;
  value?: BytesValue;
  domain?: string;
  path?: string;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSite;
  expiry?: number;
}

export type PartitionDescriptor =
  | BrowsingContextPartitionDescriptor
  | StorageKeyPartitionDescriptor
  | undefined;

export interface BrowsingContextPartitionDescriptor {
  type: "context";
  context: BrowsingContext;
}

export interface StorageKeyPartitionDescriptor extends Extensible {
  type: "storagekey";
  userContext?: UserContext;
  sourceOrigin?: string;
}

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
