/** A URL starting with "/", "./" or "../" */
export const RELATIVE_URL = /^\.{0,2}\//;

/** Resolves a slash-led `url` against `base`; any other URL is returned as given */
export function resolveRelativeURL(url: string, base: string): string {
  return RELATIVE_URL.test(url) ? new URL(url, base).href : url;
}
