import { homedir } from "node:os";
import path from "node:path";

/** Where downloaded browsers live, shared by every project of this user: `SAMURAI_BROWSERS_PATH`, else the OS cache folder */
export function browsersCacheDir(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.SAMURAI_BROWSERS_PATH) return path.resolve(env.SAMURAI_BROWSERS_PATH);
  switch (platform) {
    case "darwin":
      return path.join(home, "Library", "Caches", "samurai", "browsers");
    case "win32":
      return path.join(
        env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
        "samurai",
        "browsers",
      );
    default:
      return path.join(
        env.XDG_CACHE_HOME || path.join(home, ".cache"),
        "samurai",
        "browsers",
      );
  }
}
