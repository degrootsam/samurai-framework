import type { EmptyResult } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { BrowsingContext } from "./browsing-context.js";

/** Commands available in the WebDriver BiDi script module, which manages JavaScript execution and realms. */
export interface ScriptCommands {
  /** Evaluates a JavaScript expression in the given target realm and returns the serialized result. */
  "script.evaluate": {
    params: {
      expression: string;
      target: Target;
      awaitPromise: boolean;
      resultOwnership?: ResultOwnership | undefined;
      serializationOptions?: SerializationOptions | undefined;
      userActivation?: boolean | undefined;
    };
    result: EvaluateResult;
  };
}

/** Events emitted by the script module, keyed by method name. */
export interface ScriptEvents {
  "script.message": { params: MessageParameters };
  "script.realmCreated": { params: RealmInfo };
  "script.realmDestroyed": { params: RealmDestroyedParameters };
}

/** Result of a `script.evaluate` call — either a successful value or a thrown exception. */
export type EvaluateResult = EvaluateResultSuccess | EvaluateResultException;

/** Successful result of a `script.evaluate` call. */
export type EvaluateResultSuccess = {
  type: "success";
  result: RemoteValue;
  realm: Realm;
};

/** Result of a `script.evaluate` call where the expression threw an exception. */
export type EvaluateResultException = {
  type: "exception";
  exceptionDetails: ExceptionDetails;
  realm: Realm;
};

/** Details about a JavaScript exception, including its location and stack trace. */
export type ExceptionDetails = {
  columnNumber: number;
  exception: RemoteValue;
  lineNumber: number;
  stackTrace: StackTrace;
  text: string;
};

/** A JavaScript stack trace consisting of one or more call frames. */
export type StackTrace = {
  callFrames: StackFrame[];
};

/** A single frame in a JavaScript stack trace. */
export type StackFrame = {
  columnNumber: number;
  functionName: string;
  lineNumber: number;
  url: string;
};

/** Each realm has an associated realm id, which is a string
 * uniquely identifying that realm. This is implicitly set when
 * the realm is created. */
export type Realm = string;
/** Targets a specific browsing context (and optional sandbox) for script execution. */
export type ContextTarget = {
  context: BrowsingContext;
  sandbox?: string | undefined;
};

/** Targets a specific realm by ID for script execution. */
export type RealmTarget = {
  realm: Realm;
};

/** Represents a value that is either a Realm or a BrowsingContext.
 * This is useful in cases where a navigable identifier can stand in
 * for the realm associated with the navigable’s active document. */
export type Target = ContextTarget | RealmTarget;

/** Specifies how the serialized value ownership will be treated. */
export type ResultOwnership = "root" | "none";

/** Allows specifying how ECMAScript objects will be serialized. */
export type SerializationOptions = {
  maxDomDepth?: number | null | undefined;
  maxObjectDepth?: number | null | undefined;
  includeShadowTree?: "none" | "open" | "all";
};

export type SharedId = string;

/** A serialized primitive ECMAScript value (undefined, null, string, number, boolean, or bigint). */
export type PrimitiveProtocolValue =
  | UndefinedValue
  | NullValue
  | StringValue
  | NumberValue
  | BooleanValue
  | BigIntValue;

/** Serialized `undefined`. */
export interface UndefinedValue {
  type: "undefined";
}

/** Serialized `null`. */
export interface NullValue {
  type: "null";
}

/** Serialized string value. */
export interface StringValue {
  type: "string";
  value: string;
}

/** Serialized number value. */
export interface NumberValue {
  type: "number";
  value: number;
}

/** Serialized boolean value. */
export interface BooleanValue {
  type: "boolean";
  value: boolean;
}

/** Serialized BigInt value. */
export interface BigIntValue {
  type: "bigint";
  value: number;
}

/** A serialized ECMAScript value returned from the remote end. Union of all possible remote value types. */
export type RemoteValue =
  | PrimitiveProtocolValue
  | SymbolRemoteValue
  | ArrayRemoteValue
  | ObjectRemoteValue
  | FunctionRemoteValue
  | RegExpRemoteValue
  | DateRemoteValue
  | MapRemoteValue
  | SetRemoteValue
  | WeakMapRemoteValue
  | WeakSetRemoteValue
  | GeneratorRemoteValue
  | ErrorRemoteValue
  | ProxyRemoteValue
  | PromiseRemoteValue
  | TypedArrayRemoteValue
  | ArrayBufferRemoteValue
  | NodeListRemoteValue
  | HTMLCollectionRemoteValue
  | NodeRemoteValue
  | WindowProxyRemoteValue;

/** An ordered list of remote values, used for array-like types. */
export type ListRemoteValue = RemoteValue[];

/** A list of key-value pairs representing a Map or Object remote value. */
export type MappingRemoteValue = [RemoteValue | string, RemoteValue][];

/** A handle to a remote object; only valid within its associated realm. */
export type Handle = string;

/** An internal identifier for a remote object used for tracking object identity across serializations. */
export type InternalId = string;

/** Serialized ECMAScript Symbol. */
export interface SymbolRemoteValue {
  type: "symbol";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript Array. */
export interface ArrayRemoteValue {
  type: "array";
  handle?: Handle;
  internalId?: InternalId;
  value?: ListRemoteValue;
}

/** Serialized ECMAScript plain object. */
export interface ObjectRemoteValue {
  type: "object";
  handle?: Handle;
  internalId?: InternalId;
  value?: MappingRemoteValue;
}

/** Serialized ECMAScript function. */
export interface FunctionRemoteValue {
  type: "function";
  handle?: Handle;
  internalId?: InternalId;
}

/** The pattern and flags of a regular expression. */
export interface RegExpValue {
  pattern: string;
  flags?: string | undefined;
}

/** Local (non-remote) representation of a RegExp value. */
export interface RegExpLocalValue {
  type: "regexp";
  value: RegExpValue;
}

/** Serialized ECMAScript RegExp. */
export interface RegExpRemoteValue extends RegExpLocalValue {
  handle?: Handle;
  internalId?: InternalId;
}

/** Local (non-remote) representation of a Date value. */
export interface DateLocalValue {
  type: "date";
  value: string;
}

/** Serialized ECMAScript Date. */
export interface DateRemoteValue extends DateLocalValue {
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript Map. */
export interface MapRemoteValue {
  type: "map";
  handle?: Handle;
  internalId?: InternalId;
  value?: MappingRemoteValue;
}

/** Serialized ECMAScript Set. */
export interface SetRemoteValue {
  type: "set";
  handle?: Handle;
  internalId?: InternalId;
  value?: ListRemoteValue;
}

/** Serialized ECMAScript WeakMap. */
export interface WeakMapRemoteValue {
  type: "weakmap";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript WeakSet. */
export interface WeakSetRemoteValue {
  type: "weakset";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript Generator. */
export interface GeneratorRemoteValue {
  type: "generator";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript Error object. */
export interface ErrorRemoteValue {
  type: "error";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript Proxy. */
export interface ProxyRemoteValue {
  type: "proxy";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript Promise. */
export interface PromiseRemoteValue {
  type: "promise";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript TypedArray (e.g. Uint8Array, Float32Array). */
export interface TypedArrayRemoteValue {
  type: "typedarray";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized ECMAScript ArrayBuffer. */
export interface ArrayBufferRemoteValue {
  type: "arraybuffer";
  handle?: Handle;
  internalId?: InternalId;
}

/** Serialized DOM NodeList. */
export interface NodeListRemoteValue {
  type: "nodelist";
  handle?: Handle;
  internalId?: InternalId;
  value?: ListRemoteValue;
}

/** Serialized DOM HTMLCollection. */
export interface HTMLCollectionRemoteValue {
  type: "htmlcollection";
  handle?: Handle;
  internalId?: InternalId;
  value?: ListRemoteValue;
}

/** Serialized DOM Node, usable via `sharedId` across realms. */
export interface NodeRemoteValue {
  type: "node";
  sharedId?: SharedId;
  handle?: Handle;
  internalId?: InternalId;
  value?: NodeProperties;
}

/** Properties of a serialized DOM Node. */
export interface NodeProperties {
  nodeType: number;
  childNodeCount: number;
  attributes?: Record<string, string>;
  children?: NodeRemoteValue[];
  localName?: string;
  /** Shadow root mode, present when the node is a shadow root. */
  mode?: "open" | "closed";
  namespaceURI?: string;
  nodeValue?: string;
  shadowRoot?: NodeRemoteValue | null;
}

/** Serialized WindowProxy object. */
export interface WindowProxyRemoteValue {
  type: "window";
  value: WindowProxyProperties;
  handle?: Handle;
  internalId?: InternalId;
}

/** Properties of a serialized WindowProxy. */
export interface WindowProxyProperties {
  context: BrowsingContext;
}

/** Union of all events emitted by the script module. */
export type ScriptEvent = Message | RealmCreated | RealmDestroyed;

/** Emitted when a script sends a message via a BiDi channel. */
export interface Message {
  method: "script.message";
  params: MessageParameters;
}

/** Emitted when a new realm is created. */
export interface RealmCreated {
  method: "script.realmCreated";
  params: RealmInfo;
}

/** Emitted when a realm is destroyed. */
export interface RealmDestroyed {
  method: "script.realmDestroyed";
  params: RealmDestroyedParameters;
}

/** Identifies a BiDi channel used for `window.bidi.send` / `script.message` communication. */
export type Channel = string;

/** Identifies the realm and browsing context that produced a script event. */
export interface Source {
  realm: Realm;
  context?: BrowsingContext;
  userContext: UserContext;
}

/** Parameters for the `script.message` event. */
export interface MessageParameters {
  channel: Channel;
  data: RemoteValue;
  source: Source;
}

/** Common properties shared by all realm info types. */
export interface BaseRealmInfo {
  realm: Realm;
  origin: string;
}

/** Realm info for a window (top-level or iframe) context. */
export interface WindowRealmInfo extends BaseRealmInfo {
  type: "window";
  context: BrowsingContext;
  userContext?: UserContext;
  /** Non-default sandbox name, if the realm is a named sandbox. */
  sandbox?: string;
}

/** Realm info for a dedicated worker. */
export interface DedicatedWorkerRealmInfo extends BaseRealmInfo {
  type: "dedicated-worker";
  /** The realms that own this dedicated worker. */
  owners: Realm[];
}

/** Realm info for a shared worker. */
export interface SharedWorkerRealmInfo extends BaseRealmInfo {
  type: "shared-worker";
}

/** Realm info for a service worker. */
export interface ServiceWorkerRealmInfo extends BaseRealmInfo {
  type: "service-worker";
}

/** Realm info for a generic worker. */
export interface WorkerRealmInfo extends BaseRealmInfo {
  type: "worker";
}

/** Realm info for a CSS paint worklet. */
export interface PaintWorkletRealmInfo extends BaseRealmInfo {
  type: "paint-worklet";
}

/** Realm info for an audio worklet. */
export interface AudioWorkletRealmInfo extends BaseRealmInfo {
  type: "audio-worklet";
}

/** Realm info for a generic worklet. */
export interface WorkletRealmInfo extends BaseRealmInfo {
  type: "worklet";
}

/** Union of all realm info variants, discriminated by `type`. */
export type RealmInfo =
  | WindowRealmInfo
  | DedicatedWorkerRealmInfo
  | SharedWorkerRealmInfo
  | ServiceWorkerRealmInfo
  | WorkerRealmInfo
  | PaintWorkletRealmInfo
  | AudioWorkletRealmInfo
  | WorkletRealmInfo;

/** Parameters for the `script.realmDestroyed` event. */
export interface RealmDestroyedParameters {
  realm: Realm;
}

/** Union of all possible result types returned by script module commands. */
export type ScriptResult =
  | AddPreloadScriptResult
  | CallFunctionResult
  | DisownResult
  | EvaluateResult
  | GetRealmsResult
  | RemovePreloadScriptResult;

/** Unique identifier for a preload script registered via `script.addPreloadScript`. */
export type PreloadScript = string;

/** Result of `script.addPreloadScript`, containing the ID of the newly registered script. */
export interface AddPreloadScriptResult {
  script: PreloadScript;
}

/** Result of `script.callFunction` — same shape as `script.evaluate`. */
export type CallFunctionResult = EvaluateResult;

/** Result of `script.disown`. */
export type DisownResult = EmptyResult;

/** Result of `script.getRealms`, containing all matching realms. */
export interface GetRealmsResult {
  realms: RealmInfo[];
}

/** Result of `script.removePreloadScript`. */
export type RemovePreloadScriptResult = EmptyResult;
