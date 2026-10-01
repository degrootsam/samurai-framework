import type { EmptyResult } from "../bidi.js";
import type { ProxyConfiguration, UserPromptHandler } from "./session.js";

/** Represents a collection of zero or more top-level traversables within a remote end.
 * Each user context has an associated storage partition,
 * so that remote end data is not shared between different user contexts. */
export type UserContext = string;

/** Commands available in the WebDriver BiDi browser module. */
export interface BrowserCommands {
  /** Closes the browser and terminates the session. */
  "browser.close": {
    params: Record<string, never>;
    result: CloseResult;
  };
  /** Creates an isolated user context (own cookies, storage and cache). */
  "browser.createUserContext": {
    params: {
      acceptInsecureCerts?: boolean | undefined;
      proxy?: ProxyConfiguration | undefined;
      unhandledPromptBehavior?: UserPromptHandler | undefined;
    };
    result: CreateUserContextResult;
  };
  /** Removes a user context and closes its browsing contexts. */
  "browser.removeUserContext": {
    params: { userContext: UserContext };
    result: RemoveUserContextResult;
  };
  /** Lists all user contexts, including the default one. */
  "browser.getUserContexts": {
    params: Record<string, never>;
    result: GetUserContextsResult;
  };
  /** Sets where downloads go, or denies them. `null` restores the browser default. */
  "browser.setDownloadBehavior": {
    params: {
      downloadBehavior: DownloadBehavior | null;
      userContexts?: UserContext[] | undefined;
    };
    result: SetDownloadBehaviorResult;
  };
}

/** How downloads are handled. */
export type DownloadBehavior =
  | { type: "allowed"; destinationFolder: string }
  | { type: "denied" };

/** Union of all possible result types returned by browser module commands. */
export type BrowserResult =
  | CloseResult
  | CreateUserContextResult
  | GetClientWindowsResult
  | GetUserContextsResult
  | RemoveUserContextResult
  | SetClientWindowStateResult
  | SetDownloadBehaviorResult;

/** Result of `browser.close`. */
export type CloseResult = EmptyResult;

/** Result of `browser.createUserContext`, containing the newly created user context info. */
export type CreateUserContextResult = UserContextInfo;

/** Metadata about a user context. */
export interface UserContextInfo {
  userContext: UserContext;
}

/** Unique identifier for a browser window. */
export type ClientWindow = string;

/** State and dimensions of a browser client window. */
export interface ClientWindowInfo {
  /** Whether this window is currently the active (focused) window. */
  active: boolean;
  clientWindow: ClientWindow;
  height: number;
  state: "fullscreen" | "maximized" | "minimized" | "normal";
  width: number;
  x: number;
  y: number;
}

/** Result of `browser.getClientWindows`. */
export interface GetClientWindowsResult {
  clientWindow: ClientWindowInfo[];
}

/** Result of `browser.getUserContexts`. */
export interface GetUserContextsResult {
  userContexts: UserContextInfo[];
}

/** Result of `browser.removeUserContext`. */
export type RemoveUserContextResult = EmptyResult;

/** Result of `browser.setClientWindowState`, reflecting the updated window state. */
export type SetClientWindowStateResult = ClientWindowInfo;

/** Result of `browser.setDownloadBehavior`. */
export type SetDownloadBehaviorResult = EmptyResult;
