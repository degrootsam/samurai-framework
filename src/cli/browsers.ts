import {
  browsersCacheDir,
  browserStatus,
  installBrowser,
  isManagedBrowser,
  listInstalled,
  MANAGED_BROWSERS,
  PINNED,
  uninstallBrowser,
  type ManagedBrowser,
  type StoreOptions,
} from "../browsers/index.js";
import { parseCommandLine } from "./args.js";
import type { Io } from "./main.js";

export const BROWSERS_USAGE = `Usage:
  samurai browsers [list]                        The pinned browsers and every build in the cache
  samurai browsers install [firefox|chrome|all]  Download the pinned builds (default: all)
  samurai browsers uninstall <name> [--build <id>]
                                                 Remove a build (default: the pinned one)
  samurai browsers uninstall --unused            Remove builds this framework version doesn't pin
`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

class UnknownBrowser extends Error {}

function names(arg: string | undefined): ManagedBrowser[] {
  if (arg === undefined || arg === "all") return [...MANAGED_BROWSERS];
  if (!isManagedBrowser(arg)) throw new UnknownBrowser(arg);
  return [arg];
}

async function list(io: Io, store: StoreOptions) {
  for (const s of await browserStatus({ ...store, env: io.env })) {
    const state = s.override
      ? `uses ${s.override.path} (${s.override.from === "env" ? "environment variable" : "samurai.config.ts"})`
      : s.state === "installed"
        ? "installed"
        : s.state === "missing"
          ? "not installed"
          : "no download for this computer";
    io.out(`${s.label.padEnd(36)} ${state}\n`);
  }
  const other = listInstalled(store).filter((b) => !b.pinned);
  if (other.length > 0) {
    io.out("\nOther builds in the cache:\n");
    for (const b of other)
      io.out(`  ${b.name} ${b.buildId}  ${formatBytes(b.sizeBytes)}\n`);
  }
}

async function install(io: Io, targets: ManagedBrowser[], store: StoreOptions) {
  const baseUrl = io.env.SAMURAI_BROWSERS_BASE_URL;
  if (baseUrl) io.out(`Downloading from ${baseUrl}\n`);
  for (const name of targets) {
    const label = PINNED[name].label;
    let shown = -1;
    const exe = await installBrowser(name, {
      ...store,
      onProgress: (done, total) => {
        const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
        if (io.color) {
          io.out(`\r${label}: ${percent}%`);
        } else if (
          percent >= shown + 10 ||
          (percent === 100 && shown !== 100)
        ) {
          shown = percent;
          io.out(`${label}: ${percent}%\n`);
        }
      },
    });
    if (io.color) io.out("\n");
    io.out(`${label} installed at ${exe}\n`);
  }
}

/** `samurai browsers …`; `options` is for tests. The cache folder follows `io.env` */
export async function browsersCommand(
  argv: string[],
  io: Io,
  options: StoreOptions = {},
): Promise<number> {
  const store: StoreOptions = {
    ...options,
    cacheDir: options.cacheDir ?? browsersCacheDir(io.env),
  };
  const { values, positionals } = parseCommandLine(argv);
  const [sub = "list", target] = positionals;
  try {
    if (sub === "list") {
      await list(io, store);
      return 0;
    }
    if (sub === "install") {
      await install(io, names(target), store);
      return 0;
    }
    if (sub === "uninstall") {
      if (values.unused) {
        for (const b of listInstalled(store).filter((b) => !b.pinned)) {
          uninstallBrowser(b.name, b.buildId, store);
          io.out(`removed ${b.name} ${b.buildId}\n`);
        }
        io.out(
          "Projects on other framework versions may still use the removed builds.\n",
        );
        return 0;
      }
      if (target === undefined || target === "all") {
        io.err(`Which browser? \n\n${BROWSERS_USAGE}`);
        return 2;
      }
      const [name] = names(target);
      uninstallBrowser(name!, values.build, store);
      io.out(`removed ${name} ${values.build ?? PINNED[name!].buildId}\n`);
      return 0;
    }
    io.err(`Unknown browsers command "${sub}"\n\n${BROWSERS_USAGE}`);
    return 2;
  } catch (e) {
    if (e instanceof UnknownBrowser) {
      io.err(
        `Unknown browser "${e.message}". Choose firefox, chrome or all.\n`,
      );
      return 1;
    }
    throw e;
  }
}
