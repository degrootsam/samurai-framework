import type { ModelMessage, ToolResultPart } from "ai";

export const STALE_SNAPSHOT_NOTE =
  "[old snapshot removed: call snapshot to read the page now]";
export const STALE_SCREENSHOT_NOTE =
  "[old screenshot removed: call screenshot to see the page now]";

type Series = "snapshot" | "screenshot";
type Item = { series: Series; message: number; part: number };

function isToolResult(part: unknown): part is ToolResultPart {
  return (part as { type?: string } | null)?.type === "tool-result";
}

function seriesOf(part: ToolResultPart): Series | undefined {
  const { output } = part;
  if (part.toolName === "snapshot" && output.type === "text") return "snapshot";
  if (
    output.type === "content" &&
    output.value.some((item) => item.type === "file")
  ) {
    return "screenshot";
  }
  return undefined;
}

function collectItems(
  messages: readonly ModelMessage[],
  openingPage: boolean,
): Item[] {
  const items: Item[] = [];
  const firstUser = messages.findIndex((message) => message.role === "user");
  messages.forEach((message, m) => {
    if (
      m === firstUser &&
      openingPage &&
      message.role === "user" &&
      Array.isArray(message.content)
    ) {
      const last = message.content.map((part) => part.type).lastIndexOf("text");
      if (last >= 0) items.push({ series: "snapshot", message: m, part: last });
    }
    if (message.role !== "tool") return;
    message.content.forEach((part, p) => {
      const series = isToolResult(part) ? seriesOf(part) : undefined;
      if (series) items.push({ series, message: m, part: p });
    });
  });
  return items;
}

/**
 * Replaces every page dump except the latest of each kind (snapshots, screenshots)
 * with a short note, so the conversation does not resend stale pages. Returns new
 * objects for changed messages only; the input is never mutated.
 */
export function pruneStalePages(
  messages: readonly ModelMessage[],
  options: { openingPage?: boolean } = {},
): ModelMessage[] {
  const items = collectItems(messages, options.openingPage ?? false);
  const lastOfSeries = new Map<Series, Item>();
  for (const item of items) lastOfSeries.set(item.series, item);
  const stale = items.filter((item) => lastOfSeries.get(item.series) !== item);
  if (stale.length === 0) return [...messages];

  const out = [...messages];
  const copied = new Set<number>();
  for (const { series, message, part } of stale) {
    const original = out[message]!;
    if (!copied.has(message)) {
      out[message] = {
        ...original,
        content: [...(original.content as unknown[])],
      } as ModelMessage;
      copied.add(message);
    }
    const content = out[message]!.content as unknown[];
    const old = content[part] as
      ToolResultPart | { type: "text"; text: string };
    content[part] =
      old.type === "tool-result"
        ? {
            ...old,
            output: {
              type: "text",
              value:
                series === "snapshot"
                  ? STALE_SNAPSHOT_NOTE
                  : STALE_SCREENSHOT_NOTE,
            },
          }
        : { ...old, text: STALE_SNAPSHOT_NOTE };
  }
  return out;
}
