import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BiDiConnector } from "../transport/bidi-connection.js";

export interface ScreenshotOptions {
  /** Also write the image here (folders are created) */
  path?: string;
  /** The whole document instead of the viewport */
  fullPage?: boolean;
  /** Only this part: in viewport coordinates, or document coordinates with `fullPage` */
  clip?: { x: number; y: number; width: number; height: number };
  /** @default "png" */
  type?: "png" | "jpeg";
  /** 0 to 100, jpeg only */
  quality?: number;
}

/** The options a single element's screenshot takes: the image format and where to write it */
export type ElementScreenshotOptions = Pick<ScreenshotOptions, "path" | "type" | "quality">;

const MIME = { png: "image/png", jpeg: "image/jpeg" } as const;

/** The `format` of a capture command; validates the type/quality combination */
function imageFormat({ type, quality }: Pick<ScreenshotOptions, "type" | "quality">) {
  if (quality !== undefined) {
    if (type !== "jpeg") throw new RangeError("screenshot(): quality only applies to jpeg");
    if (!Number.isFinite(quality) || quality < 0 || quality > 100) {
      throw new RangeError("screenshot(): quality must be between 0 and 100");
    }
  }
  if (type === undefined) return undefined;
  return { type: MIME[type], ...(quality !== undefined && { quality: quality / 100 }) };
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
  const clip = element
    ? { type: "element" as const, element: { sharedId: element.sharedId } }
    : options.clip && { type: "box" as const, ...options.clip };
  const { data } = await connector.send("browsingContext.captureScreenshot", {
    context,
    ...(options.fullPage && { origin: "document" as const }),
    ...(format && { format }),
    ...(clip && { clip }),
  });
  const image = Buffer.from(data, "base64");
  await writeOutput(options.path, image);
  return image;
}

/** Writes `data` to `file`, creating the folders; nothing happens without a path */
export async function writeOutput(file: string | undefined, data: Buffer): Promise<void> {
  if (!file) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}
