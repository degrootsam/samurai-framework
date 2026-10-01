import { createLogger, format, transports } from "winston";
import { maskFormat } from "../config/mask.js";

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
    //
    // - Write to all logs with level `info` and below to `quick-start-combined.log`.
    // - Write all logs error (and below) to `quick-start-error.log`.
    //
    new transports.Console({
      // The `samurai` command quiets this to "warn"; the log files keep everything
      level: process.env.SAMURAI_LOG_LEVEL ?? "debug",
      // stdout stays free for a command's own output (`samurai run --json`)
      stderrLevels: ["error", "warn", "info", "verbose", "debug"],
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.printf(({ level, message, meta }) => {
          return `${level.toUpperCase()}: ${message}${meta ? `\n${JSON.stringify(meta)}` : null}`;
        }),
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
