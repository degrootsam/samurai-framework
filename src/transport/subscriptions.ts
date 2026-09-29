import type { BiDiEvents } from "../types/bidi.js";

export type EventName = keyof BiDiEvents;

export interface Subscription {
  /** Idempotent */
  unsubscribe(): Promise<void>;
}

export interface SubscribeOptions {
  /** Scope to these browsing contexts. Scoped subscriptions are never shared */
  contexts?: string[];
}

/** Sends the two session commands; the connector provides it */
export interface SessionCommands {
  subscribe(params: { events: string[]; contexts?: string[] }): Promise<{ subscription: string }>;
  unsubscribe(params: { subscriptions: string[] }): Promise<unknown>;
}

interface Shared {
  count: number;
  id: string | undefined;
  /** Serialises subscribe/unsubscribe commands for this event so they never interleave */
  chain: Promise<void>;
}

/**
 * Global (unscoped) subscriptions are refcounted per event name: the first subscriber sends
 * `session.subscribe`, the last one leaving sends `session.unsubscribe`.
 */
export class SubscriptionManager {
  private shared = new Map<EventName, Shared>();

  constructor(private commands: SessionCommands) {}

  public async subscribe(events: EventName[], options: SubscribeOptions = {}): Promise<Subscription> {
    if (options.contexts) return this.subscribeScoped(events, options.contexts);

    const acquired: EventName[] = [];
    try {
      for (const event of events) {
        await this.acquire(event);
        acquired.push(event);
      }
    } catch (err) {
      await Promise.allSettled(acquired.map((event) => this.release(event)));
      throw err;
    }

    let released = false;
    return {
      unsubscribe: async () => {
        if (released) return;
        released = true;
        await Promise.all(acquired.map((event) => this.release(event)));
      },
    };
  }

  private async subscribeScoped(events: EventName[], contexts: string[]): Promise<Subscription> {
    const { subscription } = await this.commands.subscribe({ events, contexts });
    let released = false;
    return {
      unsubscribe: async () => {
        if (released) return;
        released = true;
        await this.commands.unsubscribe({ subscriptions: [subscription] });
      },
    };
  }

  private state(event: EventName): Shared {
    let state = this.shared.get(event);
    if (!state) {
      state = { count: 0, id: undefined, chain: Promise.resolve() };
      this.shared.set(event, state);
    }
    return state;
  }

  private acquire(event: EventName): Promise<void> {
    const state = this.state(event);
    state.count++;
    const step = state.chain.then(async () => {
      if (state.count > 0 && state.id === undefined) {
        state.id = (await this.commands.subscribe({ events: [event] })).subscription;
      }
    });
    state.chain = step.catch(() => {});
    return step.catch((err) => {
      state.count--;
      throw err;
    });
  }

  private release(event: EventName): Promise<void> {
    const state = this.state(event);
    state.count--;
    const step = state.chain.then(async () => {
      if (state.count === 0 && state.id !== undefined) {
        const id = state.id;
        state.id = undefined;
        await this.commands.unsubscribe({ subscriptions: [id] });
      }
    });
    state.chain = step.catch(() => {});
    return step;
  }
}
