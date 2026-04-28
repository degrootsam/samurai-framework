import type { BrowserResult } from "./bidi-modules/browser.ts";
import type {
  BrowsingContextEvents,
  BrowsingContextModule as BrowsingContextCommands,
  BrowsingContextResult,
} from "./bidi-modules/browsing-context.ts";
import type { EmulationResult } from "./bidi-modules/emulation.ts";
import type {
  InputCommands,
  InputEvents,
  InputResult,
} from "./bidi-modules/input.ts";
import type { LogEvents } from "./bidi-modules/log.ts";
import type { NetworkEvents, NetworkResult } from "./bidi-modules/network.ts";
import type {
  ScriptCommands,
  ScriptEvents,
  ScriptResult,
} from "./bidi-modules/script.ts";
import type { SessionModule, SessionResult } from "./bidi-modules/session.ts";
import type { StorageCommands, StorageResult } from "./bidi-modules/storage.ts";
import type { WebExtensionResult } from "./bidi-modules/web-extensions.ts";
import type { CommandResponse } from "./bidi-protocols/command.ts";
import type { ErrorResponse } from "./bidi-protocols/error.ts";
import type { BiDiEvent } from "./bidi-protocols/event.ts";

export type BiDiCommands = SessionModule &
  BrowsingContextCommands &
  ScriptCommands &
  InputCommands &
  StorageCommands;

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
