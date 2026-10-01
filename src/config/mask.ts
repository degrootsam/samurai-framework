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

function rebuild(): void {
  // Longest first, so a secret that contains another one is hidden whole
  const values = [...new Set(secrets.values())].sort((a, b) => b.length - a.length);
  patterns = values.map((value) =>
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

/** A copy of `value` with every string in it (plain objects and arrays, any depth) masked */
export function maskDeep<T>(value: T): T {
  if (patterns.length === 0) return value;
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
  }
  return value;
}

/** Winston format that masks every string field of a log entry (message and metadata) */
export const maskFormat = format((info) => {
  if (patterns.length === 0) return info;
  for (const key of Object.keys(info)) info[key] = walk(info[key]);
  return info;
});
