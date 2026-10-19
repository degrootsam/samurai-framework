import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { callFunction } from "../script/call-function.js";
import { ElementHandle } from "../script/element-handle.js";
import type { BiDiConnector } from "../transport/bidi-connection.js";

export interface ScreenshotOptions {
  /** Also write the image here (folders are created) */
  path?: string;
  /** The whole document instead of the viewport */
  fullPage?: boolean;
  /** Only this part: in viewport coordinates, or document coordinates with `fullPage` */
  clip?: { x: number; y: number; width: number; height: number };
  /** Also save the image as run evidence under this name (see the Page API docs) */
  name?: string;
  /** @default "png" */
  type?: "png" | "jpeg";
  /** 0 to 100, jpeg only */
  quality?: number;
}

/** The options a single element's screenshot takes: the image format and where to write it */
export type ElementScreenshotOptions = Pick<
  ScreenshotOptions,
  "path" | "type" | "quality"
>;

const MIME = { png: "image/png", jpeg: "image/jpeg" } as const;

/** The `format` of a capture command; validates the type/quality combination */
function imageFormat({
  type,
  quality,
}: Pick<ScreenshotOptions, "type" | "quality">) {
  if (quality !== undefined) {
    if (type !== "jpeg")
      throw new RangeError("screenshot(): quality only applies to jpeg");
    if (!Number.isFinite(quality) || quality < 0 || quality > 100) {
      throw new RangeError("screenshot(): quality must be between 0 and 100");
    }
  }
  if (type === undefined) return undefined;
  return {
    type: MIME[type],
    ...(quality !== undefined && { quality: quality / 100 }),
  };
}

/**
 * Captures the page (or, with `element`, that element) and returns the image. Writes it to `options.path` too.
 * The browser answers Base64.
 */
export async function takeScreenshot(
  connector: BiDiConnector,
  context: string,
  options: ScreenshotOptions = {},
  element?: { sharedId: string },
): Promise<Buffer> {
  const format = imageFormat(options);
  // An element is captured as its box in the document: Chrome cannot capture an `element` clip that is not
  // wholly in the viewport, and this works the same for an element taller than the viewport
  const clip = element
    ? {
        type: "box" as const,
        ...(await documentBox(connector, context, element)),
      }
    : options.clip && { type: "box" as const, ...options.clip };
  const { data } = await connector.send("browsingContext.captureScreenshot", {
    context,
    ...((options.fullPage || element) && { origin: "document" as const }),
    ...(format && { format }),
    ...(clip && { clip }),
  });
  const image = Buffer.from(data, "base64");
  await writeOutput(options.path, image);
  return image;
}

/** The element's box in document coordinates (CSS pixels) */
async function documentBox(
  connector: BiDiConnector,
  context: string,
  element: { sharedId: string },
): Promise<{ x: number; y: number; width: number; height: number }> {
  return callFunction(
    connector,
    context,
    `(el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    }`,
    [new ElementHandle(element.sharedId)],
  );
}

/** Writes `data` to `file`, creating the folders; nothing happens without a path */
export async function writeOutput(
  file: string | undefined,
  data: Buffer,
): Promise<void> {
  if (!file) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}
