import path from "node:path";
import { createLogger, format, transports } from "winston";
import { maskFormat } from "../config/mask.js";

/** Metadata every line carries (`defaultMeta`): not worth printing on each console line */
const DEFAULT_META_KEYS = ["service"];

/** One console line: `LEVEL: message`, then the line's own metadata as JSON when it has any */
export function consoleLine(entry: {
  level: string;
  message: unknown;
  meta?: Record<string, unknown> | undefined;
}): string {
  const own = Object.fromEntries(
    Object.entries(entry.meta ?? {}).filter(
      ([key]) => !DEFAULT_META_KEYS.includes(key),
    ),
  );
  const meta = Object.keys(own).length > 0 ? `\n${JSON.stringify(own)}` : "";
  return `${entry.level.toUpperCase()}: ${String(entry.message)}${meta}`;
}

const logger = createLogger({
  level: "debug",
  format: format.combine(
    format.timestamp({
      format: "DD-MM-YYYY HH:mm:ss",
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.metadata({ key: "meta" }),
    maskFormat(),
    format.json({ space: 2 }),
  ),
  defaultMeta: { service: "samurai-framework" },
  transports: [
    // The console shows the log; the files of a project's `logs/` folder are added while a project is in use (`keepLogFiles`)
    new transports.Console({
      // The `samurai` command quiets this to "warn"; the log files keep everything
      level: process.env.SAMURAI_LOG_LEVEL ?? "debug",
      // stdout stays free for a command's own output (`samurai run --json`)
      stderrLevels: ["error", "warn", "info", "verbose", "debug"],
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ level, message, meta }) =>
          consoleLine({
            level,
            message,
            meta: meta as Record<string, unknown> | undefined,
          }),
        ),
      ),
    }),
  ],
});

/** The files the log is written to now: `error.log` keeps errors, `combined.log` everything */
let files:
  | {
      dir: string;
      transports: transports.FileTransportInstance[];
      holders: number;
    }
  | undefined;

/**
 * Writes the log to `error.log` and `combined.log` in `<projectDir>/logs/` until the returned function is called.
 * Nothing is written to disk before a project is in use, so a command that has none (`samurai --version`) leaves
 * no folder behind. Holders of the same project share the files; the files close with the last one.
 */
export function keepLogFiles(projectDir: string): () => void {
  const dir = path.join(projectDir, "logs");
  if (files && files.dir !== dir) closeFiles();
  files ??= {
    dir,
    transports: [
      new transports.File({
        filename: path.join(dir, "error.log"),
        level: "error",
      }),
      new transports.File({ filename: path.join(dir, "combined.log") }),
    ],
    holders: 0,
  };
  const mine = files;
  if (mine.holders === 0) for (const t of mine.transports) logger.add(t);
  mine.holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--mine.holders === 0 && files === mine) closeFiles();
  };
}

function closeFiles() {
  if (!files) return;
  for (const t of files.transports) {
    logger.remove(t);
    t.close?.();
  }
  files = undefined;
}

export default logger;
