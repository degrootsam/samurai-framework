import type { BrowserCommands, BrowserResult } from "./bidi-modules/browser.js";
import type {
  BrowsingContextEvents,
  BrowsingContextModule as BrowsingContextCommands,
  BrowsingContextResult,
} from "./bidi-modules/browsing-context.js";
import type { EmulationCommands, EmulationResult } from "./bidi-modules/emulation.js";
import type {
  InputCommands,
  InputEvents,
  InputResult,
} from "./bidi-modules/input.js";
import type { LogEvents } from "./bidi-modules/log.js";
import type { PermissionsCommands } from "./bidi-modules/permissions.js";
import type {
  NetworkCommands,
  NetworkEvents,
  NetworkResult,
} from "./bidi-modules/network.js";
import type {
  ScriptCommands,
  ScriptEvents,
  ScriptResult,
} from "./bidi-modules/script.js";
import type { SessionModule, SessionResult } from "./bidi-modules/session.js";
import type { StorageCommands, StorageResult } from "./bidi-modules/storage.js";
import type { WebExtensionResult } from "./bidi-modules/web-extensions.js";
import type { CommandResponse } from "./bidi-protocols/command.js";
import type { ErrorResponse } from "./bidi-protocols/error.js";
import type { BiDiEvent } from "./bidi-protocols/event.js";

export type BiDiCommands = BrowserCommands &
  SessionModule &
  BrowsingContextCommands &
  ScriptCommands &
  InputCommands &
  StorageCommands &
  NetworkCommands &
  EmulationCommands &
  PermissionsCommands;

export type BiDiEvents = BrowsingContextEvents &
  InputEvents &
  LogEvents &
  NetworkEvents &
  ScriptEvents;

export type BiDiMessages = CommandResponse | ErrorResponse | BiDiEvent;

export type ResultData =
  | BrowserResult
  | BrowsingContextResult
  | EmulationResult
  | InputResult
  | NetworkResult
  | ScriptResult
  | SessionResult
  | StorageResult
  | WebExtensionResult;

export type EmptyResult = Extensible;

export interface Extensible {
  [key: string]: any;
}
