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
    // The console shows the log; `logs/error.log` keeps errors and `logs/combined.log` everything
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
    new transports.File({
      filename: `logs/error.log`,
      level: "error",
    }),
    new transports.File({ filename: `logs/combined.log` }),
  ],
});

export default logger;
