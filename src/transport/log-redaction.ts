/** Channels whose messages carry what the tester typed (the recorder's) or adds as a secret (its toolbar's) */
const PRIVATE_CHANNEL = /^samurai-(recorder|toolbar)-/;

/**
 * The message as the debug log gets it: a `script.message` on a private channel is logged by channel and
 * action only, so a value the tester types or a secret added from the recorder toolbar never reaches the log
 * (an added secret is only registered for masking after it is saved).
 */
export function forLog(message: {
  type?: string;
  method?: string;
  params?: { channel?: unknown; data?: unknown };
}): unknown {
  return shortened(redacted(message));
}

/** A string longer than this is cut in the log: a file's bytes travel in 1 MB chunks, 50 MB makes 70 MB of debug log */
const LOG_STRING_LIMIT = 1000;

/** A copy of `value` with every long string cut to its start and its length; short values come back as they are */
function shortened(value: unknown, depth = 0): unknown {
  if (typeof value === "string")
    return value.length > LOG_STRING_LIMIT
      ? `${value.slice(0, 200)}… (${value.length} characters)`
      : value;
  if (value === null || typeof value !== "object" || depth > 30) return value;
  if (Array.isArray(value))
    return value.map((item) => shortened(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      shortened(item, depth + 1),
    ]),
  );
}

function redacted(message: {
  type?: string;
  method?: string;
  params?: { channel?: unknown; data?: unknown };
}): unknown {
  const channel = message.params?.channel;
  if (
    message.type !== "event" ||
    message.method !== "script.message" ||
    typeof channel !== "string" ||
    !PRIVATE_CHANNEL.test(channel)
  )
    return message;
  const entries = (message.params?.data as { value?: unknown } | undefined)
    ?.value;
  const field = (key: string) => {
    if (!Array.isArray(entries)) return undefined;
    const entry = entries.find(
      (pair): pair is [string, { value?: unknown }] =>
        Array.isArray(pair) && pair[0] === key,
    );
    const value = entry?.[1]?.value;
    return typeof value === "string" ? value : undefined;
  };
  return {
    ...message,
    params: {
      ...message.params,
      data: { type: field("type"), action: field("action"), redacted: true },
    },
  };
}
