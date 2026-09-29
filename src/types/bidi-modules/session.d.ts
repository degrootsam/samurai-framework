import type { EmptyResult, Extensible } from "../bidi.js";
import type { UserContext } from "./browser.js";
import type { BrowsingContext } from "./browsing-context.js";

/** Commands available in the WebDriver BiDi session module, which manages session lifecycle and event subscriptions. */
export interface SessionModule {
  /** Creates a new BiDi session with the given capabilities. */
  "session.new": {
    params: { capabilities: object };
    result: { sessionId: string; capabilities: object };
  };
  /** Subscribes to one or more events, optionally scoped to specific browsing contexts or user contexts. */
  "session.subscribe": {
    params: {
      events: string[];
      contexts?: BrowsingContext[];
      userContexts?: UserContext[];
    };
    result: { subscription: Subscription };
  };
  "session.status": {
    params: {};
    result: {
      ready: boolean;
      message: string;
    };
  };
}

/** A unique identifier for an active event subscription, returned by `session.subscribe`. */
export type Subscription = string;

/** Defines how user prompts (alerts, confirms, prompts) should be automatically handled. */
export type UserPromptHandlerType = "accept" | "dismiss" | "ignore";

/** Union of all possible result types returned by session module commands. */
export type SessionResult =
  | EndResult
  | NewResult
  | StatusResult
  | SubscribeResult
  | UnsubscribeResult;

/** Result of `session.end`. */
export type EndResult = EmptyResult;

/** Automatically detects proxy settings from the environment. */
interface AutodetectProxyConfiguration extends Extensible {
  proxyType: "autodetect";
}

/** Connects directly without a proxy. */
interface DirectProxyConfiguration extends Extensible {
  proxyType: "direct";
}

/** SOCKS proxy address and protocol version. */
interface SocksProxyConfiguration {
  socksProxy: string;
  /** SOCKS protocol version; 0..255 */
  socksVersion: number;
}

/** Manually specified proxy settings, with optional per-protocol overrides and exclusion list. */
interface ManualProxyConfiguration extends Extensible {
  proxyType: "manual";
  httpProxy?: string;
  sslProxy?: string;
  socks?: SocksProxyConfiguration;
  /** Hosts that should bypass the proxy. */
  noProxy?: string[];
}

/** Uses a Proxy Auto-Configuration (PAC) file at the given URL. */
interface PacProxyConfiguration extends Extensible {
  proxyType: "pac";
  proxyAutoconfigUrl: string;
}

/** Uses the operating system's proxy settings. */
interface SystemProxyConfiguration extends Extensible {
  proxyType: "system";
}

/** Union of all proxy configuration variants, discriminated by `proxyType`. */
export type ProxyConfiguration =
  | AutodetectProxyConfiguration
  | DirectProxyConfiguration
  | ManualProxyConfiguration
  | PacProxyConfiguration
  | SystemProxyConfiguration;

/** Per-prompt-type configuration for automatically handling browser dialogs. */
export interface UserPromptHandler {
  alert?: UserPromptHandlerType;
  beforeUnload?: UserPromptHandlerType;
  confirm?: UserPromptHandlerType;
  /** Fallback handler used when no type-specific handler is set. */
  default?: UserPromptHandlerType;
  file?: UserPromptHandlerType;
  prompt?: UserPromptHandlerType;
}

/** Result of `session.new`, containing the assigned session ID and the negotiated capabilities. */
export interface NewResult {
  sessionId: string;
  capabilities: {
    acceptInsecureCerts: boolean;
    browserName: string;
    browserVersion: string;
    platformName: string;
    setWindowRect: boolean;
    userAgent: string;
    proxy?: ProxyConfiguration;
    unhandledPromptBehavior?: UserPromptHandler;
    /** The WebSocket URL for BiDi communication, if supported. */
    webSocketUrl?: string;
  } & Extensible;
}

/** Result of `session.status`. */
export type StatusResult = EmptyResult;

/** Result of `session.subscribe`, containing the new subscription identifier. */
export interface SubscribeResult {
  subscription: Subscription;
}

/** Result of `session.unsubscribe`. */
export type UnsubscribeResult = EmptyResult;
