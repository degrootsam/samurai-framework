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
    /** `data` is the image, Base64-encoded */
    result: { data: string };
  };
  /** Finds nodes with a CSS, XPath, text or accessibility locator. */
  "browsingContext.locateNodes": {
    params: {
      context: BrowsingContext;
      locator: NodeLocator;
      maxNodeCount?: number | undefined;
      serializationOptions?: SerializationOptions | undefined;
      startNodes?: SharedReference[] | undefined;
    };
    result: { nodes: NodeRemoteValue[] };
  };
  /** Accepts or dismisses the open user prompt. */
  "browsingContext.handleUserPrompt": {
    params: { context: BrowsingContext; accept?: boolean | undefined; userText?: string | undefined };
    result: {};
  };
  /** Sets or resets (null) the viewport size and device pixel ratio. */
  "browsingContext.setViewport": {
    params: {
      context?: BrowsingContext | undefined;
      viewport?: { width: number; height: number } | null | undefined;
      devicePixelRatio?: number | null | undefined;
      userContexts?: UserContext[] | undefined;
    };
    result: {};
  };
  /** Reloads the document. */
  "browsingContext.reload": {
    params: {
      context: BrowsingContext;
      ignoreCache?: boolean | undefined;
      wait?: ReadinessState | undefined;
    };
    result: { navigation: Navigation | null; url: string };
  };
  /** Moves through the session history by `delta` entries. */
  "browsingContext.traverseHistory": {
    params: { context: BrowsingContext; delta: number };
    result: {};
  };
  /** Closes a top-level browsing context. */
  "browsingContext.close": {
    params: { context: BrowsingContext; promptUnload?: boolean | undefined };
    result: {};
  };
  /** Renders the document as a PDF; `data` is Base64. */
  "browsingContext.print": {
    params: {
      context: BrowsingContext;
      background?: boolean | undefined;
      margin?: { top?: number; bottom?: number; left?: number; right?: number } | undefined;
      orientation?: "portrait" | "landscape" | undefined;
      page?: { width?: number; height?: number } | undefined;
      pageRanges?: (number | string)[] | undefined;
      scale?: number | undefined;
      shrinkToFit?: boolean | undefined;
    };
    result: { data: string };
  };
}

/** Locators understood by `browsingContext.locateNodes`. */
export type NodeLocator =
  | { type: "css"; value: string }
  | { type: "xpath"; value: string }
  | {
      type: "innerText";
      value: string;
      ignoreCase?: boolean;
      matchType?: "full" | "partial";
      maxDepth?: number;
    }
  | { type: "accessibility"; value: { name?: string; role?: string } }
  | { type: "context"; value: { context: BrowsingContext } };

/** A navigable presents a Document to the user via its active session history entry. */
export type BrowsingContext = string;
/** Represents the stage of document loading at which a navigation command will return. */
export type ReadinessState = "none" | "interactive" | "complete";
/** Represents a reference to a DOM Node that is usable in any realm (including Sandbox Realms). */
export type SharedId = string;
/** Represents a handle to an object owned by the ECMAScript runtime. The handle is only valid in a specific Realm. */
export type Handle = string;
export type ImageFormat = {
  /** A MIME type: "image/png" or "image/jpeg". Anything else is silently treated as PNG */
  type: string;
  /** 0 to 1, for "image/jpeg" */
  quality?: number | undefined;
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
  /** null when the tree was not requested this deep */
  children: InfoList | null;
  clientWindow: ClientWindow;
  context: BrowsingContext;
  originalOpener: BrowsingContext | null;
  url: string;
  userContext: UserContext;
  /** Absent or null for top-level contexts */
  parent?: BrowsingContext | null;
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
  filepath: string;
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
