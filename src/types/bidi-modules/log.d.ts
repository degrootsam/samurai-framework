import type { RemoteValue, Source, StackTrace } from "./script.js";

/** The severity level of a log entry. */
export type Level = "debug" | "info" | "warn" | "error";

/** A log entry — either a generic, console, or JavaScript error entry. */
export type Entry = GenericLogEntry | ConsoleLogEntry | JavascriptLogEntry;

/** Common fields shared by all log entry types. */
export interface BaseLogEntry {
  level: Level;
  source: Source;
  /** Human-readable text representation of the log entry. */
  string: string | null;
  timestamp: number;
  stackTrace?: StackTrace;
}

/** A log entry of an unrecognized or custom type. */
export interface GenericLogEntry extends BaseLogEntry {
  type: string;
}

/** A log entry produced by a `console.*` method call. */
export interface ConsoleLogEntry extends BaseLogEntry {
  type: "console";
  /** The console method that produced this entry (e.g. `log`, `warn`, `error`). */
  method: string;
  args: RemoteValue[];
}

/** A log entry produced by an uncaught JavaScript error. */
export interface JavascriptLogEntry extends BaseLogEntry {
  type: "javascript";
}

/** Events emitted by the log module, keyed by method name. */
export interface LogEvents {
  "log.entryAdded": { params: Entry };
}

/** Union of all events emitted by the log module. */
export type LogEvent = EntryAdded;

/** Emitted when a new log entry is added (e.g. a console message or JS error). */
export interface EntryAdded {
  method: "log.entryAdded";
  params: Entry;
}
