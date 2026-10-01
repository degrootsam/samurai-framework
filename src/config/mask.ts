import { inspect } from "node:util";
import { format } from "winston";

export const MASK = "••••";
/** Values shorter than this only match as a whole token, so "1" does not hide every digit */
const SHORT_LENGTH = 4;

const secrets = new Map<string, string>();
let patterns: RegExp[] = [];

/** Registers a secret value; every later maskText/maskDeep/log line hides it */
export function registerSecret(name: string, value: string): void {
  if (value === "") return;
  secrets.set(name, value);
  rebuild();
}

/** Forgets every registered secret (tests only) */
export function resetSecrets(): void {
  secrets.clear();
  patterns = [];
}

export function isShortSecret(value: string): boolean {
  return value.length > 0 && value.length < SHORT_LENGTH;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A value plus its JSON-escaped, inspect-escaped and percent-encoded spellings */
function variants(value: string): string[] {
  const forms = [value, JSON.stringify(value).slice(1, -1), inspect(value).slice(1, -1), encodeURIComponent(value)];
  return forms.filter((form) => form !== "");
}

function rebuild(): void {
  // Longest first, so a secret that contains another one is hidden whole
  const forms = [...new Set([...secrets.values()].flatMap(variants))].sort((a, b) => b.length - a.length);
  patterns = forms.map((value) =>
    isShortSecret(value)
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`, "gu")
      : new RegExp(escapeRegExp(value), "gu"),
  );
}

export function maskText(text: string): string {
  let masked = text;
  for (const pattern of patterns) masked = masked.replace(pattern, MASK);
  return masked;
}

/** A copy of `value` with every string in it masked, following JSON.stringify semantics for objects */
export function maskDeep<T>(value: T): T {
  if (patterns.length === 0) return value;
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, path: WeakSet<object>): unknown {
  if (typeof value === "string") return maskText(value);
  if (value === null || typeof value !== "object") return value;
  if (path.has(value)) return "[Circular]";
  path.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, path));
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") return walk(toJSON.call(value), path);
    const entries: Array<[string, unknown]> = Object.entries(value);
    if (value instanceof Error) {
      const own = new Set(entries.map(([key]) => key));
      for (const key of ["name", "message", "stack"] as const) {
        if (!own.has(key)) entries.unshift([key, value[key]]);
      }
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, walk(item, path)]));
  } finally {
    path.delete(value);
  }
}

/** Winston format that masks every string field of a log entry (message and metadata) */
export const maskFormat = format((info) => {
  if (patterns.length === 0) return info;
  for (const key of Object.keys(info)) info[key] = walk(info[key], new WeakSet());
  return info;
});
