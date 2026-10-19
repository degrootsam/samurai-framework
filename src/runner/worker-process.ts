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
    execArgv: ["--import", "tsx"],
  };
}

/** Starts each worker as a child process of this one and talks to it over the IPC channel; the pool sends `init` */
export function processWorkerFactory(): WorkerFactory {
  return () => {
    const { file, execArgv } = workerEntry();
    // A worker's logs go to the same stderr; stdout stays the main process's (the `--json` output)
    const child = fork(file, [], {
      execArgv,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    return {
      send: (message) => void child.send(message),
      onMessage: (listener) =>
        void child.on("message", (message) => listener(message as FromWorker)),
      onExit: (listener) => void child.on("exit", (code) => listener(code)),
      kill: () => void child.kill("SIGKILL"),
    } satisfies WorkerHandle;
  };
}
