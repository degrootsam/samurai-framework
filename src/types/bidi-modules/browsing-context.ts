import type { EmptyResult } from "../bidi.js";
import type { ClientWindow, UserContext } from "./browser.js";
import type { NodeRemoteValue } from "./script.js";
import type { UserPromptHandlerType } from "./session.js";

/** Commands available in the WebDriver BiDi browsingContext module. */
export interface BrowsingContextModule {
  /** Returns the browsing context tree, optionally limited to a subtree and/or depth. */
  "browsingContext.getTree": {
    params: { maxDepth?: number; root?: BrowsingContext };
    result: { contexts: InfoList };
  };
  /** Creates a new top-level browsing context (tab or window). */
  "browsingContext.create": {
    params: {
      type: "window" | "tab";
      background?: boolean | undefined;
      userContext?: UserContext | undefined;
    };
    result: {
      context: BrowsingContext;
      userContext: UserContext;
    };
  };
  /** Navigates the given browsing context to a URL, optionally waiting for a readiness state. */
  "browsingContext.navigate": {
    params: {
      context: BrowsingContext;
      url: string;
      wait?: ReadinessState | undefined;
    };
    result: { navigation: BrowsingContext; url: string };
  };
  /** Captures a screenshot of the given browsing context, with optional clip and format. */
  "browsingContext.captureScreenshot": {
    params: {
      context: BrowsingContext;
      origin?: "viewport" | "document" | undefined;
      format?: ImageFormat | undefined;
      clip?: ClipRectangle | undefined;
    };
    result: {};
  };
}

/** A navigable presents a Document to the user via its active session history entry. */
export type BrowsingContext = string;
/** Represents the stage of document loading at which a navigation command will return. */
export type ReadinessState = "none" | "interactive" | "complete";
/** Represents a reference to a DOM Node that is usable in any realm (including Sandbox Realms). */
export type SharedId = string;
/** Represents a handle to an object owned by the ECMAScript runtime. The handle is only valid in a specific Realm. */
export type Handle = string;
export type ImageFormat = {
  type: string;
  quality?: 0.0 | 0.25 | 0.5 | 0.75 | 1.0 | undefined;
};
export type ElementRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type ClipRectangle = BoxClipRectangle | ElementClipRectangle;
export type ElementClipRectangle = {
  type: "element";
  element: SharedReference;
};
export type BoxClipRectangle = {
  type: "box";
  x: number;
  y: number;
  width: number;
  height: number;
};
/** Represents a reference to a node */
export type SharedReference = {
  sharedId: string;
  handle?: undefined | Handle;
};

export type InfoList = Info[];

/** Represents the properties of a navigable. */
export type Info = {
  children: InfoList[];
  clientWindow: ClientWindow;
  context: BrowsingContext;
  originalOpener: BrowsingContext;
  url: string;
  userContext: UserContext;
  parent?: BrowsingContext;
};

/** Unique identifier for a navigation within a browsing context. */
export type Navigation = string;

/** Common parameters included in all navigation-related events. */
export interface BaseNavigationInfo {
  context: BrowsingContext;
  navigation: Navigation;
  timestamp: number;
  url: string;
  userContext: UserContext;
}

/** Parameters for navigation events that carry no additional data beyond the base. */
export type NavigationInfo = BaseNavigationInfo;

/** Emitted when a new browsing context is created. */
export interface ContextCreated {
  method: "browsingContext.contextCreated";
  params: Info;
}

/** Emitted when a browsing context is destroyed. */
export interface ContextDestroyed {
  method: "browsingContext.contextDestroyed";
  params: Info;
}

/** Emitted when the DOMContentLoaded event fires in the browsing context. */
export interface DomContentLoaded {
  method: "browsingContext.domContentLoaded";
  params: NavigationInfo;
}

/** Parameters for a download that was canceled. */
export interface DownloadCanceledParams extends BaseNavigationInfo {
  status: "canceled";
}

/** Parameters for a download that completed successfully. */
export interface DownloadCompleteParams extends BaseNavigationInfo {
  status: "complete";
  filePath: string;
}

/** Parameters for the `browsingContext.downloadEnd` event — either canceled or complete. */
export type DownloadEndParams = DownloadCanceledParams | DownloadCompleteParams;

/** Emitted when a download finishes (either completed or canceled). */
export interface DownloadEnd {
  method: "browsingContext.downloadEnd";
  params: DownloadEndParams;
}

/** Parameters for the `browsingContext.downloadWillBegin` event. */
export interface DownloadWillBeginParams extends BaseNavigationInfo {
  suggestedFilename: string;
}

/** Emitted just before a download begins. */
export interface DownloadWillBegin {
  method: "browsingContext.downloadWillBegin";
  params: DownloadWillBeginParams;
}

/** Emitted when a same-document navigation via a fragment identifier completes. */
export interface FragmentNavigated {
  method: "browsingContext.fragmentNavigated";
  params: NavigationInfo;
}

/** Parameters for the `browsingContext.historyUpdated` event. */
export interface HistoryUpdatedParameters {
  context: BrowsingContext;
  timestamp: number;
  url: string;
  userContext?: UserContext;
}

/** Emitted when the URL changes due to `history.pushState` or `history.replaceState`. */
export interface HistoryUpdated {
  method: "browsingContext.historyUpdated";
  params: HistoryUpdatedParameters;
}

/** Emitted when the `load` event fires in the browsing context. */
export interface Load {
  method: "browsingContext.load";
  params: NavigationInfo;
}

/** Emitted when a navigation is aborted before completion. */
export interface NavigationAborted {
  method: "browsingContext.navigationAborted";
  params: NavigationInfo;
}

/** Emitted when a navigation is committed (the response has been received and the new document begins loading). */
export interface NavigationCommitted {
  method: "browsingContext.navigationCommitted";
  params: NavigationInfo;
}

/** Emitted when a navigation fails due to a network or other error. */
export interface NavigationFailed {
  method: "browsingContext.navigationFailed";
  params: NavigationInfo;
}

/** Emitted when a navigation begins. */
export interface NavigationStarted {
  method: "browsingContext.navigationStarted";
  params: NavigationInfo;
}

/** The type of user prompt (dialog) that was opened. */
export type UserPromptType = "alert" | "beforeunload" | "confirm" | "prompt";

/** Parameters for the `browsingContext.userPromptClosed` event. */
export interface UserPromptClosedParameters {
  context: BrowsingContext;
  /** Whether the user accepted (e.g. clicked OK) or dismissed the prompt. */
  accepted: boolean;
  type: UserPromptType;
  userContext?: UserContext;
  /** Text entered by the user in a `prompt` dialog, if any. */
  userText?: string;
}

/** Emitted when a user prompt (dialog) is closed. */
export interface UserPromptClosed {
  method: "browsingContext.userPromptClosed";
  params: UserPromptClosedParameters;
}

/** Emitted when a user prompt (dialog) is opened. */
export interface UserPromptOpened {
  method: "browsingContext.userPromptOpened";
  params: UserPromptOpenedParameters;
}

/** Parameters for the `browsingContext.userPromptOpened` event. */
export interface UserPromptOpenedParameters {
  context: BrowsingContext;
  /** The handler that will be used to automatically respond to this prompt, per session configuration. */
  handler: UserPromptHandlerType;
  message: string;
  type: UserPromptType;
  userContext?: UserContext;
  defaultValue?: string;
}

/** Events emitted by the browsingContext module, keyed by method name. */
export interface BrowsingContextEvents {
  "browsingContext.contextCreated": { params: Info };
  "browsingContext.contextDestroyed": { params: Info };
  "browsingContext.domContentLoaded": { params: NavigationInfo };
  "browsingContext.downloadEnd": { params: DownloadEndParams };
  "browsingContext.downloadWillBegin": { params: DownloadWillBeginParams };
  "browsingContext.fragmentNavigated": { params: NavigationInfo };
  "browsingContext.historyUpdated": { params: HistoryUpdatedParameters };
  "browsingContext.load": { params: NavigationInfo };
  "browsingContext.navigationAborted": { params: NavigationInfo };
  "browsingContext.navigationCommitted": { params: NavigationInfo };
  "browsingContext.navigationFailed": { params: NavigationInfo };
  "browsingContext.navigationStarted": { params: NavigationInfo };
  "browsingContext.userPromptClosed": { params: UserPromptClosedParameters };
  "browsingContext.userPromptOpened": { params: UserPromptOpenedParameters };
}

/** Union of all events emitted by the browsingContext module. */
export type BrowsingContextEvent =
  | ContextCreated
  | ContextDestroyed
  | DomContentLoaded
  | DownloadEnd
  | DownloadWillBegin
  | FragmentNavigated
  | HistoryUpdated
  | Load
  | NavigationAborted
  | NavigationCommitted
  | NavigationFailed
  | NavigationStarted
  | UserPromptClosed
  | UserPromptOpened;

/** Union of all possible result types returned by browsingContext module commands. */
export type BrowsingContextResult =
  | ActivateResult
  | CaptureScreenshotResult
  | CloseResult
  | CreateResult
  | GetTreeResult
  | HandleUserPromptResult
  | LocateNodesResult
  | NavigateResult
  | PrintResult
  | ReloadResult
  | SetBypassCSPResult
  | SetViewportResult
  | TraverseHistoryResult;

/** Result of `browsingContext.activate`. */
export type ActivateResult = EmptyResult;

/** Result of `browsingContext.captureScreenshot`, containing base64-encoded image data. */
export interface CaptureScreenshotResult {
  data: string;
}

/** Result of `browsingContext.close`. */
export type CloseResult = EmptyResult;

/** Result of `browsingContext.create`. */
export interface CreateResult {
  context: BrowsingContext;
  userContext?: UserContext;
}

/** Result of `browsingContext.getTree`. */
export interface GetTreeResult {
  contexts: InfoList;
}

/** Result of `browsingContext.handleUserPrompt`. */
export type HandleUserPromptResult = EmptyResult;

/** Result of `browsingContext.locateNodes`. */
export interface LocateNodesResult {
  nodes: NodeRemoteValue[];
}

/** Result of `browsingContext.navigate` and `browsingContext.reload`. */
export interface NavigateResult {
  navigation: Navigation;
  url: string;
}

/** Result of `browsingContext.print`, containing base64-encoded PDF data. */
export interface PrintResult {
  data: string;
}

/** Result of `browsingContext.reload`. */
export type ReloadResult = NavigateResult;

/** Result of `browsingContext.setBypassCSP`. */
export type SetBypassCSPResult = EmptyResult;

/** Result of `browsingContext.setViewport`. */
export type SetViewportResult = EmptyResult;

/** Result of `browsingContext.traverseHistory`. */
export type TraverseHistoryResult = EmptyResult;
