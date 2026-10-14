import path from "node:path";

/** A screenshot name as a file name: letters, digits, - and _ (the rest becomes -) */
export function cleanName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned === "" ? "screenshot" : cleaned;
}

/** Where a run (or one test) saves named screenshots, and the ones it saved */
export class Evidence {
  public readonly screenshots: { name: string; path: string }[] = [];
  private readonly used = new Set<string>();

  constructor(
    private readonly resultDir: string,
    private readonly testDir?: string,
  ) {}

  /** The file for the next screenshot called `name` (`.jpg` for a jpeg, else `.png`); a repeat gets -2, -3, … */
  public fileFor(name: string, type: "png" | "jpeg" = "png") {
    const base = cleanName(name);
    let unique = base;
    for (let n = 2; this.used.has(unique); n++) unique = `${base}-${n}`;
    this.used.add(unique);
    const relative = [
      "screenshots",
      ...(this.testDir ? this.testDir.split("/") : []),
      `${unique}.${type === "jpeg" ? "jpg" : "png"}`,
    ].join("/");
    const entry = {
      file: path.join(this.resultDir, ...relative.split("/")),
      name: unique,
      path: relative,
    };
    this.screenshots.push({ name: entry.name, path: entry.path });
    return entry;
  }
}
