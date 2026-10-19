export interface NetworkRequest {
  /** The browser's id; the same for every hop of a redirect chain */
  id: string;
  url: string;
  method: string;
  /** Header names lower-cased; repeated headers joined with ", " */
  headers: Record<string, string>;
  /** "document", "script", "image", …; falls back to the initiator type, then "other" */
  resourceType: string;
  navigation: string | null;
  /** The request this one is the redirect of, or null */
  redirectedFrom: NetworkRequest | null;
  /** True while a network intercept holds it */
  isBlocked: boolean;
}

export interface NetworkResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  fromCache: boolean;
  request: NetworkRequest;
}

export type FailedRequest = NetworkRequest & { errorText: string };

/** What `page.on` and the tracker emit: the event name and the arguments its listeners get */
export interface EventMap {
  request: [NetworkRequest];
  response: [NetworkResponse];
  requestfailed: [FailedRequest];
}
export type NetworkEventName = keyof EventMap;
