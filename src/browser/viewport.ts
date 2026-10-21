import { callFunction } from "../script/call-function.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

/** Time (ms) without a `resize` event after which a viewport reset counts as done */
const RESIZE_QUIET_TIME = 50;
/** Time (ms) a viewport reset waits for a `resize` event that may never come (the size did not change) */
const RESIZE_MAX_WAIT = 300;

/** A viewport as `page.setViewport` takes it: a size and optionally a device pixel ratio */
export interface Viewport {
  width: number;
  height: number;
  devicePixelRatio?: number;
}

/** Throws RangeError when the size or the ratio is not usable, before anything is sent */
export function validateViewport({
  width,
  height,
  devicePixelRatio,
}: Viewport): void {
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(
        `setViewport(): ${name} must be a positive integer, got ${value}`,
      );
    }
  }
  if (
    devicePixelRatio !== undefined &&
    !(devicePixelRatio > 0 && Number.isFinite(devicePixelRatio))
  ) {
    throw new RangeError(
      `setViewport(): devicePixelRatio must be a positive number, got ${devicePixelRatio}`,
    );
  }
}

/**
 * Gives the context this size (and optionally this device pixel ratio); `null` puts the browser's own size back
 * and waits until the page has really got it.
 */
export async function applyViewport(
  connector: BiDiConnector,
  context: string,
  viewport: Viewport | null,
): Promise<void> {
  if (viewport === null) {
    await untilResized(connector, context, () =>
      connector.send("browsingContext.setViewport", {
        context,
        viewport: null,
        devicePixelRatio: null,
      }),
    );
    return;
  }
  validateViewport(viewport);
  const { width, height, devicePixelRatio } = viewport;
  await connector.send("browsingContext.setViewport", {
    context,
    viewport: { width, height },
    ...(devicePixelRatio !== undefined && { devicePixelRatio }),
  });
}

/**
 * Runs `change`, then waits until the page has stopped resizing. Chrome answers a viewport reset before the window
 * has its own size back, so a read right after it can still show the old size. The wait ends `RESIZE_QUIET_TIME`
 * after the last `resize` event, and after `RESIZE_MAX_WAIT` when the size does not change at all (no event
 * comes). Never fails: a page that cannot be watched is simply not waited for.
 */
async function untilResized(
  connector: BiDiConnector,
  context: string,
  change: () => Promise<unknown>,
): Promise<void> {
  const sandbox = { sandbox: "samurai-viewport" };
  const watching = await callFunction(
    connector,
    context,
    `() => {
        globalThis.__resized = new Promise((resolve) => {
          let timer;
          const finish = () => {
            clearTimeout(timer);
            removeEventListener("resize", onResize);
            resolve();
          };
          const onResize = () => {
            clearTimeout(timer);
            timer = setTimeout(finish, ${RESIZE_QUIET_TIME});
          };
          addEventListener("resize", onResize);
          timer = setTimeout(finish, ${RESIZE_MAX_WAIT});
        });
      }`,
    [],
    { ...sandbox, awaitPromise: false },
  ).then(
    () => true,
    () => false,
  );
  await change();
  if (!watching) return;
  await callFunction(
    connector,
    context,
    "() => globalThis.__resized",
    [],
    sandbox,
  ).catch(() => undefined);
}
