import type { BrowsingContextEvent } from "../bidi-modules/browsing-context.js";
import type { LogEvent } from "../bidi-modules/log.js";
import type { NetworkEvent } from "../bidi-modules/network.js";
import type { ScriptEvent } from "../bidi-modules/script.js";
import type { Extensible } from "../bidi.js";

export type BiDiEvent = Extensible &
  EventData & {
    type: "event";
  };

export type EventData =
  | BrowsingContextEvent
  | InputEvent
  | LogEvent
  | NetworkEvent
  | ScriptEvent;
