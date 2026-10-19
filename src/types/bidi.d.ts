import type { BrowserCommands } from "./bidi-modules/browser.js";
import type {
  BrowsingContextEvents,
  BrowsingContextModule as BrowsingContextCommands,
} from "./bidi-modules/browsing-context.js";
import type { EmulationCommands } from "./bidi-modules/emulation.js";
import type { InputCommands, InputEvents } from "./bidi-modules/input.js";
import type { LogEvents } from "./bidi-modules/log.js";
import type { PermissionsCommands } from "./bidi-modules/permissions.js";
import type { NetworkCommands, NetworkEvents } from "./bidi-modules/network.js";
import type { ScriptCommands, ScriptEvents } from "./bidi-modules/script.js";
import type { SessionModule } from "./bidi-modules/session.js";
import type { StorageCommands } from "./bidi-modules/storage.js";

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

export type EmptyResult = Extensible;

export interface Extensible {
  [key: string]: any;
}
