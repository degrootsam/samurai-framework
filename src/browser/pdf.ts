import type { BiDiConnector } from "../transport/bidi-connection.js";
import { writeOutput } from "./screenshot.js";

/** Paper sizes in centimetres, as the browser wants them */
const PAPER = {
  Letter: { width: 21.59, height: 27.94 },
  Legal: { width: 21.59, height: 35.56 },
  Tabloid: { width: 27.94, height: 43.18 },
  Ledger: { width: 43.18, height: 27.94 },
  A0: { width: 84.1, height: 118.9 },
  A1: { width: 59.4, height: 84.1 },
  A2: { width: 42, height: 59.4 },
  A3: { width: 29.7, height: 42 },
  A4: { width: 21, height: 29.7 },
  A5: { width: 14.8, height: 21 },
  A6: { width: 10.5, height: 14.8 },
} as const;

export type PaperFormat = keyof typeof PAPER;

export interface PdfOptions {
  /** Also write the PDF here (folders are created) */
  path?: string;
  landscape?: boolean;
  /** 0.1 to 2 */
  scale?: number;
  /** Pages to print, e.g. `["1-3", 5]` */
  pageRanges?: (string | number)[];
  /** Page margins in centimetres */
  margin?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Print background colours and images */
  printBackground?: boolean;
  /** Paper size. Without one the browser's default is used */
  format?: PaperFormat;
}

/** Renders the page as a PDF and returns it (also written to `options.path`) */
export async function printPdf(
  connector: BiDiConnector,
  context: string,
  options: PdfOptions = {},
): Promise<Buffer> {
  const { scale, format } = options;
  if (scale !== undefined && !(scale >= 0.1 && scale <= 2)) {
    throw new RangeError("pdf(): scale must be between 0.1 and 2");
  }
  if (format !== undefined && !(format in PAPER)) {
    throw new RangeError(`pdf(): unknown paper format "${format}"; use one of ${Object.keys(PAPER).join(", ")}`);
  }
  const { data } = await connector.send("browsingContext.print", {
    context,
    ...(options.landscape && { orientation: "landscape" as const }),
    ...(scale !== undefined && { scale }),
    ...(options.pageRanges && { pageRanges: options.pageRanges }),
    ...(options.margin && { margin: options.margin }),
    ...(options.printBackground && { background: true }),
    ...(format && { page: { ...PAPER[format] } }),
  });
  const pdf = Buffer.from(data, "base64");
  await writeOutput(options.path, pdf);
  return pdf;
}
