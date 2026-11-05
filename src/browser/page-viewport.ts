import { DEFAULT_VIEWPORT } from "../config/defaults.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowsingContext } from "../types/bidi-modules/browsing-context.js";
import type { PageConfig } from "./page-settings.js";
import { applyViewport, type Viewport } from "./viewport.js";

/** A page's viewport: the size it was last given and whether Chrome lays it out like a phone */
export class PageViewport {
  private known: { width: number; height: number } | null = null;
  /** Chrome's phone layout is on (`setMobileLayout`): viewport changes keep it */
  private mobile = false;

  constructor(
    private readonly connector: BiDiConnector,
    private readonly contextId: BrowsingContext,
    private readonly config: PageConfig,
  ) {}

  public async set(viewport: Viewport | null): Promise<void> {
    await applyViewport(this.connector, this.contextId, viewport, this.mobile);
    this.known = viewport && {
      width: viewport.width,
      height: viewport.height,
    };
  }

  public async setMobileLayout(): Promise<void> {
    this.mobile = true;
    await this.set(this.known);
  }

  public size(): { width: number; height: number } | null {
    return this.known && { ...this.known };
  }

  public async applyDefault(): Promise<void> {
    const { viewport } = await this.config.use();
    if (viewport === null) return;
    await this.set(viewport ?? DEFAULT_VIEWPORT);
  }
}
