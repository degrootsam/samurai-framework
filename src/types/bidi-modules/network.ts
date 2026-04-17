import type { EmptyResult, Extensible } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { BrowsingContext, Navigation } from "./browsing-context.js";
import type { StackTrace } from "./script.js";

/** Events emitted by the network module, keyed by method name. */
export interface NetworkEvents {
  "network.authRequired": { params: AuthRequiredParameters };
  "network.beforeRequestSent": { params: BeforeRequestSentParameters };
  "network.fetchError": { params: FetchErrorParameters };
  "network.responseCompleted": { params: ResponseCompletedParameters };
  "network.responseStarted": { params: ResponseStartedParameters };
}

/** Union of all events emitted by the network module. */
export type NetworkEvent =
  | AuthRequired
  | BeforeRequestSent
  | FetchError
  | ResponseCompleted
  | ResponseStarted;

/** Unique identifier for a network request. */
export type Request = string;

/** A value that can be encoded as a plain string or as base64. */
export type BytesValue = StringValue | Base64Value;

/** A plaintext bytes value. */
export interface StringValue {
  type: "string";
  value: string;
}

/** A base64-encoded bytes value. */
export interface Base64Value {
  type: "base64";
  value: string;
}

/** An HTTP header name-value pair. */
export interface Header {
  name: string;
  value: BytesValue;
}

/** The SameSite attribute of a cookie, controlling cross-site sending behavior. */
export type SameSite = "strict" | "lax" | "none" | "default";

/** A network cookie with all its attributes. */
export interface Cookie extends Extensible {
  name: string;
  value: BytesValue;
  domain: string;
  path: string;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSite;
  /** Cookie expiry as Unix timestamp in seconds, if set. */
  expiry?: number;
}

/** Detailed timing information for a fetch/network request, following the Resource Timing API. */
export interface FetchTimingInfo {
  timeOrigin: number;
  requestTime: number;
  redirectStart: number;
  redirectEnd: number;
  fetchStart: number;
  dnsStart: number;
  dnsEnd: number;
  connectStart: number;
  connectEnd: number;
  tlsStart: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
}

/** Full details about an outgoing network request. */
export interface RequestData {
  request: Request;
  url: string;
  method: string;
  headers: Header[];
  cookies: Cookie[];
  headersSize: number;
  /** Body size in bytes, or `null` if not applicable. */
  bodySize: number | null;
  destination: string;
  initiatorType: string | null;
  timings: FetchTimingInfo;
}

/** Unique identifier for an active network intercept. */
export type Intercept = string;

/** Common parameters included in all network events. */
export interface BaseParameters {
  context: BrowsingContext | null;
  /** Whether this request is currently blocked by an active intercept. */
  isBlocked: boolean;
  navigation: Navigation | null;
  redirectCount: Number;
  request: RequestData;
  timestamp: number;
  userContext?: UserContext | null;
  /** Active intercepts that match this request, if any. */
  intercepts?: Intercept[];
}

/** Size metadata for a response body. */
export interface ResponseContent {
  size: number;
}

/** An HTTP authentication challenge from a server. */
export interface AuthChallenge {
  scheme: string;
  realm: string;
}

/** Full details about a network response. */
export interface ResponseData {
  url: string;
  protocol: string;
  status: number;
  statusText: string;
  fromCache: boolean;
  headers: Header[];
  mimeType: string;
  bytesReceived: number;
  headersSize: number | null;
  bodySize: number | null;
  content: ResponseContent;
  authChallenges?: AuthChallenge[];
}

/** Parameters for the `network.authRequired` event. */
export interface AuthRequiredParameters extends BaseParameters {
  response: ResponseData;
}

/** Emitted when a server responds with an authentication challenge (HTTP 401/407). */
export interface AuthRequired {
  method: "network.authRequired";
  params: AuthRequiredParameters;
}

/** Information about what initiated a network request. */
export interface NetworkInitiator {
  columnNumber?: number;
  lineNumber?: number;
  request?: Request;
  stackTrace?: StackTrace;
  type?: "parser" | "script" | "preflight" | "other";
}

/** Parameters for the `network.beforeRequestSent` event. */
export interface BeforeRequestSentParameters extends BaseParameters {
  initiator?: NetworkInitiator;
}

/** Emitted before a network request is sent, allowing inspection or interception. */
export interface BeforeRequestSent {
  method: "network.beforeRequestSent";
  params: BeforeRequestSentParameters;
}

/** Parameters for the `network.fetchError` event. */
export interface FetchErrorParameters extends BaseParameters {
  errorText: string;
}

/** Emitted when a network request fails due to a network-level error. */
export interface FetchError {
  method: "network.fetchError";
  params: FetchErrorParameters;
}

/** Parameters for the `network.responseCompleted` event. */
export interface ResponseCompletedParameters extends BaseParameters {
  response: ResponseData;
}

/** Emitted when a network response has been fully received. */
export interface ResponseCompleted {
  method: "network.responseCompleted";
  params: ResponseCompletedParameters;
}

/** Parameters for the `network.responseStarted` event. */
export interface ResponseStartedParameters extends BaseParameters {
  network: ResponseData;
}

/** Emitted when the response headers have been received and the response has started. */
export interface ResponseStarted {
  method: "network.responseStarted";
  params: ResponseStartedParameters;
}

/** Union of all possible result types returned by network module commands. */
export type NetworkResult =
  | AddDataCollectorResult
  | AddInterceptResult
  | ContinueRequestResult
  | ContinueResponseResult
  | ContinueWithAuthResult
  | DisownDataResult
  | FailRequestResult
  | GetDataResult
  | ProvideResponseResult
  | RemoveDataCollectorResult
  | RemoveInterceptResult
  | SetCacheBehaviorResult
  | SetExtraHeadersResult;

/** Unique identifier for an active network data collector. */
export type Collector = string;

/** Result of `network.addDataCollector`, containing the ID of the new collector. */
export interface AddDataCollectorResult {
  collector: Collector;
}

/** Result of `network.addIntercept`, containing the ID of the new intercept. */
export interface AddInterceptResult {
  intercept: Intercept;
}

/** Result of `network.continueRequest`. */
export type ContinueRequestResult = EmptyResult;
/** Result of `network.continueResponse`. */
export type ContinueResponseResult = EmptyResult;
/** Result of `network.continueWithAuth`. */
export type ContinueWithAuthResult = EmptyResult;
/** Result of `network.disownData` (releases collected data). */
export type DisownDataResult = EmptyResult;
/** Result of `network.failRequest`. */
export type FailRequestResult = EmptyResult;

/** Result of `network.getData`, containing the collected bytes. */
export interface GetDataResult {
  bytes: BytesValue;
}

/** Result of `network.provideResponse`. */
export type ProvideResponseResult = EmptyResult;
/** Result of `network.removeDataCollector`. */
export type RemoveDataCollectorResult = EmptyResult;
/** Result of `network.removeIntercept`. */
export type RemoveInterceptResult = EmptyResult;
/** Result of `network.setCacheBehavior`. */
export type SetCacheBehaviorResult = EmptyResult;
/** Result of `network.setExtraHeaders`. */
export type SetExtraHeadersResult = EmptyResult;
