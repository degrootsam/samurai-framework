import { createLogger, format, transports } from "winston";

const logger = createLogger({
  level: "debug",
  format: format.combine(
    format.timestamp({
      format: "DD-MM-YYYY HH:mm:ss",
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.metadata({ key: "meta" }),
    format.json({ space: 2 }),
  ),
  defaultMeta: { service: "samurai-framework" },
  transports: [
    //
    // - Write to all logs with level `info` and below to `quick-start-combined.log`.
    // - Write all logs error (and below) to `quick-start-error.log`.
    //
    new transports.File({
      filename: `logs/error.log`,
      level: "error",
    }),
    new transports.File({ filename: `logs/combined.log` }),
  ],
});

export default logger;
