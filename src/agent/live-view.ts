import type Page from "../browser/page.js";
import type Locator from "../locator/locator.js";
import type { LiveHooks } from "./tools/context.js";
import type {
  AgentEvent,
  LiveActedEvent,
  LiveFrameEvent,
  LiveViewOptions,
} from "./types.js";

const DEFAULT_FPS = 4;
const DEFAULT_QUALITY = 60;
/** How often the page is looked at while nothing happens */
const IDLE_MS = 500;
/** How long after an action or a change the page counts as busy */
const BUSY_MS = 1500;

/** What the page tells cheaply on every look: where it is, how big the viewport is and a signature of what changed */
const LOOK = `(() => {
  const active = document.activeElement;
  return {
    url: location.href,
    title: document.title,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    sig: [
      document.readyState, scrollX, scrollY,
      document.documentElement.scrollHeight,
      document.getElementsByTagName("*").length,
      active && active.tagName,
      active && typeof active.value === "string" ? active.value.length : "",
    ].join("|"),
  };
})()`;

interface Look {
  url: string;
  title: string;
  width: number;
  height: number;
  dpr: number;
  sig: string;
}

/** What the live view hands to the run */
export interface LiveSink {
  /** An event for the log (`url`, `acted`) */
  emit(event: AgentEvent): void;
  /** A frame: delivered to the listener and the newest to a reader, never kept */
  frame(event: LiveFrameEvent): void;
  /** True while the person drives: the page is looked at as often as allowed */
  person(): boolean;
}

/**
 * Streams what the agent's page looks like: `frame`, `url` and `acted` events. One loop looks at the page, so a
 * slow consumer or a slow capture never holds the agent: the loop takes one picture at a time, at most `maxFps` a
 * second, and only while something changes, a tool runs or the person drives. A picture identical to the last
 * one is not sent. Everything here fails quietly: the live view is never a reason for a run to fail.
 */
export class LiveView implements LiveHooks {
  private readonly interval: number;
  private readonly quality: number;
  private busyUntil = Date.now() + BUSY_MS;
  private stopped = false;
  private wake: (() => void) | undefined;
  private loop: Promise<void> | undefined;
  private jpeg = true;
  private last = { sig: "", url: "", title: "", data: "", at: 0 };

  constructor(
    private readonly page: Page,
    private readonly sink: LiveSink,
    options: LiveViewOptions = {},
  ) {
    const fps = Math.min(10, Math.max(0.2, options.maxFps ?? DEFAULT_FPS));
    this.interval = Math.round(1000 / fps);
    this.quality = Math.min(
      100,
      Math.max(1, options.quality ?? DEFAULT_QUALITY),
    );
  }

  public start(): void {
    this.loop ??= this.run();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.loop;
    // The last state of the page, so the final frame shows where the run ended
    const wait = this.interval - (Date.now() - this.last.at);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    await this.tick().catch(() => undefined);
  }

  public touch(): void {
    this.busyUntil = Date.now() + BUSY_MS;
    this.wake?.();
  }

  public async boxOf(locator: Locator): Promise<LiveActedEvent["box"] | null> {
    try {
      const box = await locator.boundingBox();
      return box && box.width > 0 && box.height > 0 ? box : null;
    } catch {
      return null;
    }
  }

  public acted(input: {
    locator: Locator;
    label: string;
    step?: number;
    before: LiveActedEvent["box"] | null;
  }): void {
    void this.boxOf(input.locator).then((after) => {
      const box = after ?? input.before;
      if (box)
        this.sink.emit({
          type: "acted",
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          label: input.label,
          ...(input.step !== undefined && { step: input.step }),
          at: Date.now(),
        });
      this.touch();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    }).finally(() => (this.wake = undefined));
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const busy = this.sink.person() || Date.now() < this.busyUntil;
      const since = Date.now() - this.last.at;
      // Busy: as often as the cap allows. Idle: now and then, to notice a change
      await this.sleep(busy ? Math.max(0, this.interval - since) : IDLE_MS);
      if (this.stopped) break;
      if (Date.now() - this.last.at < this.interval) continue;
      await this.tick().catch(() => undefined);
    }
  }

  private async tick(): Promise<void> {
    const look = await this.page.evaluate<Look>(LOOK);
    if (look.url !== this.last.url || look.title !== this.last.title) {
      this.last.url = look.url;
      this.last.title = look.title;
      this.sink.emit({
        type: "url",
        url: look.url,
        title: look.title,
        at: Date.now(),
      });
    }
    const changed = look.sig !== this.last.sig;
    this.last.sig = look.sig;
    if (changed)
      this.busyUntil = Math.max(this.busyUntil, Date.now() + BUSY_MS);
    const busy = this.sink.person() || Date.now() < this.busyUntil;
    if (!changed && !busy && this.last.data !== "") return;
    await this.capture(look);
  }

  private async capture(look: Look): Promise<void> {
    let image: Buffer | undefined;
    let mime: LiveFrameEvent["mime"] = "image/jpeg";
    const at = Date.now();
    if (this.jpeg) {
      try {
        image = await this.page.screenshot({
          type: "jpeg",
          quality: this.quality,
        });
      } catch (error) {
        // A browser that cannot do JPEG answers the command with an error; a closed page does too
        if (/jpeg|format|quality/i.test(String(error))) this.jpeg = false;
        else throw error;
      }
    }
    if (!image) {
      mime = "image/png";
      image = await this.page.screenshot({ type: "png" });
    }
    this.last.at = at;
    const data = image.toString("base64");
    if (data === this.last.data) return;
    this.last.data = data;
    this.sink.frame({
      type: "frame",
      mime,
      data,
      width: look.width,
      height: look.height,
      devicePixelRatio: look.dpr,
      at,
    });
  }
}
