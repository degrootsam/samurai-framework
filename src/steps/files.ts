const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;
type Unit = keyof typeof UNITS;

/** Bytes for a size: a whole number of bytes, or a text like "60 MB", "1.5 GB", "512 KB" (powers of 1024) */
export function parseSize(size: number | string): number | undefined {
  if (typeof size === "number")
    return Number.isInteger(size) && size >= 0 ? size : undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)\s*$/i.exec(size);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * UNITS[match[2]!.toUpperCase() as Unit]);
}

/** A size in the largest unit that gives a whole number: 62914560 → "60 MB", 1536 → "1536 B" */
export function formatSize(bytes: number): string {
  for (const unit of ["GB", "MB", "KB"] as const) {
    if (bytes >= UNITS[unit] && bytes % UNITS[unit] === 0)
      return `${bytes / UNITS[unit]} ${unit}`;
  }
  return `${bytes} B`;
}

/** A size for people: the largest unit it reaches, one decimal at most ("300 MB", "1.3 GB") */
export function humanSize(bytes: number): string {
  for (const unit of ["GB", "MB", "KB"] as const) {
    if (bytes >= UNITS[unit])
      return `${Math.round((bytes / UNITS[unit]) * 10) / 10} ${unit}`;
  }
  return `${bytes} B`;
}

/** The bytes a size's source text means: a number literal, or a quoted size text */
export function sizeFromSource(text: string): number | undefined {
  if (/^\d+$/.test(text)) return parseSize(Number(text));
  const quoted = /^(["'`])(.*)\1$/s.exec(text);
  return quoted ? parseSize(quoted[2]!) : undefined;
}
