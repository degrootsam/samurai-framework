import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_GRACEFUL_TIMEOUT,
  DEFAULT_WEB_SERVER_TIMEOUT,
} from "../config/web-server-options.js";
import logger from "../logger/index.js";
import type { WebServerConfig } from "../types/config.js";
import { OutputTail } from "./output-tail.js";
import {
  answers,
  describeTarget,
  waitUntilReady,
  type ReadyTarget,
} from "./wait-for-url.js";

/** The servers of a run, started */
export interface RunningServers {
  /** Where the first server with a `url` or `port` answers: the base URL when none is configured */
  baseURL?: string;
  /** Stops every server this run started (not the ones it reused). Safe to call twice */
  stop(): Promise<void>;
}

const fail = (problem: string): never => {
  throw new Error(`webServer(): ${problem}`);
};

const windows = process.platform === "win32";

function targetOf(server: WebServerConfig): ReadyTarget {
  return server.url !== undefined
    ? {
        url: server.url,
        ...(server.ignoreHTTPSErrors && { ignoreHTTPSErrors: true }),
      }
    : { port: server.port! };
}

/** The base URL a server stands for: its URL's origin, or `http://localhost:<port>` */
function baseURLOf(server: WebServerConfig): string {
  return server.url !== undefined
    ? new URL(server.url).origin
    : `http://localhost:${server.port}`;
}

function signalGroup(
  pid: number,
  signal: NodeJS.Signals | 0,
  child?: ChildProcess,
): boolean {
  try {
    if (windows) {
      if (signal !== 0)
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
      return child?.exitCode === null;
    }
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

class StartedServer {
  private exited = false;
  private exitText = "";
  private stopping?: Promise<void>;
  private readonly onProcessExit = () => {
    if (this.child.pid !== undefined)
      signalGroup(this.child.pid, "SIGKILL", this.child);
  };
  readonly tail: OutputTail;
  private readonly exitPromise: Promise<void>;

  constructor(
    readonly child: ChildProcess,
    private readonly server: WebServerConfig,
  ) {
    this.tail = new OutputTail(20, Object.values(server.env ?? {}));
    for (const [stream, mode, out] of [
      [child.stdout, server.stdout ?? "ignore", process.stdout],
      [child.stderr, server.stderr ?? "pipe", process.stderr],
    ] as const)
      stream?.on("data", (chunk: Buffer) => {
        this.tail.add(chunk);
        if (mode === "pipe") out.write(chunk);
      });
    this.exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this.exited = true;
        this.exitText =
          code !== null ? `code ${code}` : `signal ${String(signal)}`;
        resolve();
      });
      child.once("error", (error) => {
        this.exited = true;
        this.exitText = `error: ${error.message}`;
        resolve();
      });
    });
    process.once("exit", this.onProcessExit);
  }

  hasExited(): boolean {
    return this.exited;
  }

  describeExit(): string {
    return this.exitText;
  }

  /** SIGTERM-style signal to the group, then SIGKILL for what is left after the grace period */
  stop(): Promise<void> {
    this.stopping ??= this.stopNow();
    return this.stopping;
  }

  private async stopNow(): Promise<void> {
    const pid = this.child.pid;
    const { signal = "SIGTERM", timeout = DEFAULT_GRACEFUL_TIMEOUT } =
      this.server.gracefulShutdown ?? {};
    if (pid !== undefined) {
      if (timeout > 0 && !windows) {
        signalGroup(pid, signal);
        const deadline = Date.now() + timeout;
        while (
          Date.now() < deadline &&
          (!this.exited || signalGroup(pid, 0, this.child))
        )
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
      signalGroup(pid, "SIGKILL", this.child);
      await Promise.race([
        this.exitPromise,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    process.off("exit", this.onProcessExit);
  }
}

async function startOne(
  server: WebServerConfig,
  context: { projectDir: string; signal?: AbortSignal | undefined },
): Promise<StartedServer | undefined> {
  const target = targetOf(server);
  const name = describeTarget(target);
  if (await answers(target)) {
    if (server.reuseExistingServer) return undefined;
    fail(
      `${name} is already in use: stop what runs there, or set reuseExistingServer: true`,
    );
  }
  logger.verbose("Starting web server for %s", name);
  const child = spawn(server.command, {
    shell: true,
    cwd: path.resolve(context.projectDir, server.cwd ?? "."),
    env: { ...process.env, ...server.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !windows,
  });
  const started = new StartedServer(child, server);
  const timeout = server.timeout ?? DEFAULT_WEB_SERVER_TIMEOUT;
  const verdict = await waitUntilReady(target, {
    timeout,
    ...(context.signal && { signal: context.signal }),
    stopped: () => started.hasExited(),
  });
  if (verdict === "ready") return started;

  // Capture what the server printed before it is stopped
  const exited = started.hasExited();
  const how = exited ? started.describeExit() : "";
  await started.stop();
  const output = started.tail.text();
  const log = output === "" ? "" : `\nLast output:\n${output}`;
  if (verdict === "aborted" && !exited)
    return fail(`aborted while waiting for ${name}`);
  if (exited)
    fail(`the process exited (${how}) before ${name} was ready${log}`);
  return fail(`timed out after ${timeout}ms waiting for ${name}${log}`);
}

/**
 * Starts the servers one after the other and waits for each. A server that fails to start stops the ones already
 * started and throws `webServer(): what is wrong`, with the last lines of its output.
 */
export async function startWebServers(
  servers: readonly WebServerConfig[],
  context: { projectDir: string; signal?: AbortSignal | undefined },
): Promise<RunningServers> {
  const started: StartedServer[] = [];
  const stop = async () => {
    await Promise.all([...started].reverse().map((s) => s.stop()));
  };
  let baseURL: string | undefined;
  try {
    for (const server of servers) {
      const running = await startOne(server, context);
      if (running) started.push(running);
      baseURL ??= baseURLOf(server);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { ...(baseURL !== undefined && { baseURL }), stop };
}
