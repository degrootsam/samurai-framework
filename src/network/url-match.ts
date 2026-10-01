/** A URL to match: an exact string, a glob (`*` = anything but `/`, `**` = anything) or a RegExp */
export type UrlPattern = string | RegExp;

/** True for a string without `*`: it must equal the URL */
export function isExactString(pattern: UrlPattern): pattern is string {
  return typeof pattern === "string" && !pattern.includes("*");
}

function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i++;
      } else {
        source += "[^/]*";
      }
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** Whether `url` matches `pattern` */
export function matchUrl(pattern: UrlPattern, url: string): boolean {
  if (typeof pattern === "string") {
    return isExactString(pattern) ? pattern === url : globToRegExp(pattern).test(url);
  }
  // A global or sticky RegExp remembers where it stopped; every match must start fresh
  pattern.lastIndex = 0;
  return pattern.test(url);
}

/** Same pattern, so `unroute` finds the route a `route` call made */
export function samePattern(a: UrlPattern, b: UrlPattern): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.source === b.source && a.flags === b.flags;
}
