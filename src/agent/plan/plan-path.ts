import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadRawConfig, projectDir } from "../../config/config.js";
import { DEFAULT_PLANS_DIR } from "../../config/defaults.js";

const SLUG_LENGTH = 60;

/** Lower-case ascii words of a goal joined by `-`, at most 60 characters; `plan` when nothing is left */
export function slugOf(goal: string): string {
  const slug = goal
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "plan" : slug;
}

/** The config's `plansDir`; a project without a `samurai.config.ts` (and no config given) uses the default */
async function plansDirOf(): Promise<string> {
  try {
    return (await loadRawConfig()).plansDir ?? DEFAULT_PLANS_DIR;
  } catch (error) {
    if (existsSync(path.join(projectDir(), "samurai.config.ts"))) throw error;
    return DEFAULT_PLANS_DIR;
  }
}

/**
 * The file `samurai plan` writes when no `--out` is given: `<plansDir>/<slug-of-goal>.plan.md` below the project
 * folder, with `-2`, `-3`, ... added until the name is free, so an earlier plan is never replaced. The folder is
 * created. Returns the path relative to the project folder, with `/` separators.
 */
export async function defaultPlanFile(goal: string): Promise<string> {
  const dir = await plansDirOf();
  const folder = path.resolve(projectDir(), dir);
  mkdirSync(folder, { recursive: true });
  const slug = slugOf(goal);
  for (let n = 1; ; n++) {
    const name = `${n === 1 ? slug : `${slug}-${n}`}.plan.md`;
    if (!existsSync(path.join(folder, name)))
      return path
        .relative(projectDir(), path.join(folder, name))
        .split(path.sep)
        .join("/");
  }
}

/**
 * The plan files (`*.plan.md`) below the config's `plansDir`, searched in all sub-folders: paths relative to the
 * project folder, with `/` separators, sorted. A missing folder gives an empty list.
 */
export async function listPlans(): Promise<string[]> {
  const folder = path.resolve(projectDir(), await plansDirOf());
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".plan.md"))
    .map((name) =>
      path
        .relative(projectDir(), path.join(folder, name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}
