import type { ActionReply } from "./protocol.js";
import type { Message, Replying } from "./types.js";

const REPLYING: readonly Message["action"][] = [
  "assert",
  "assert-page",
  "insert",
  "add-insertable",
  "save-output",
];

/**
 * Drops the repeat of an action that is running or was answered `{ ok: true }` (a double click: its first copy
 * answers), and lets a retry after `{ ok: false }` through.
 */
export class ActionGuard {
  /** Ids of the replying actions (`REPLYING`) being processed */
  private readonly inFlight = new Set<number>();
  /** Ids `accept` let through whose `run` hasn't started yet */
  private readonly claimed = new Set<number>();
  /** Ids answered `{ ok: true }`: their step exists, a repeat is a double click */
  private readonly done = new Set<number>();

  /** Whether to process `message`; call it as the message arrives, before queueing it */
  public accept(message: Message): boolean {
    if (!REPLYING.includes(message.action)) return true;
    const { id } = message as Replying;
    if (this.inFlight.has(id) || this.done.has(id)) return false;
    this.inFlight.add(id);
    this.claimed.add(id);
    return true;
  }

  /** Runs an action that expects a reply, unless it is a repeat (see `accept`); `reply` gets the answer */
  public async run(
    message: Replying,
    work: () => Promise<ActionReply>,
    reply: (id: number, result: ActionReply) => void,
  ): Promise<void> {
    const { id } = message;
    if (!this.claimed.has(id) && !this.accept(message)) return;
    this.claimed.delete(id);
    try {
      const result = await work();
      if (result.ok) this.done.add(id);
      reply(id, result);
    } finally {
      this.inFlight.delete(id);
    }
  }
}
