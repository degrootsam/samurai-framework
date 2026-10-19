import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  FromWorker,
  WorkerFactory,
  WorkerHandle,
} from "./worker-protocol.js";

/** The worker entry: `worker.js` in `dist/`, `worker.ts` when running from the sources under tsx */
function workerEntry(): { file: string; execArgv: string[] } {
  const compiled = fileURLToPath(new URL("./worker.js", import.meta.url));
  if (existsSync(compiled)) return { file: compiled, execArgv: [] };
  return {
    file: fileURLToPath(new URL("./worker.ts", import.meta.url)),
    // Resolved from here, not from the project folder: the sources run from a checkout that has tsx
    execArgv: ["--import", import.meta.resolve("tsx")],
  };
}

/** Ends a worker and everything it started (its browser, chromedriver) that is still running: a worker that dies leaves them behind */
function killGroup(pid: number | undefined) {
  if (pid === undefined || process.platform === "win32") return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // nothing of the group is left
  }
}

/**
 * Starts each worker as a child process of this one and talks to it over the IPC channel; the pool sends `init`.
 * A worker leads its own process group (not on Windows), so that when it exits, its browser goes with it.
 */
export function processWorkerFactory(): WorkerFactory {
  return () => {
    const { file, execArgv } = workerEntry();
    // A worker's logs go to the same stderr; stdout stays the main process's (the `--json` output)
    const child = fork(file, [], {
      execArgv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    // A write to a worker that already died fails here; its `exit` event follows and is what the pool acts on
    child.on("error", () => {});
    return {
      send: (message) => void child.send(message),
      onMessage: (listener) =>
        void child.on("message", (message) => listener(message as FromWorker)),
      onExit: (listener) =>
        void child.on("exit", (code) => {
          killGroup(child.pid);
          listener(code);
        }),
      kill: () => {
        killGroup(child.pid);
        child.kill("SIGKILL");
      },
    } satisfies WorkerHandle;
  };
}
