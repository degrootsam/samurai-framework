import { spawn } from "node:child_process";
import EventEmitter from "node:events";
import { mkdirSync } from "node:fs";
import logger from "../logger/index.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import { SESSION_CAPABILITIES } from "./session-capabilities.js";

/** What `Browser` needs of the thing it launched: the browser process, or for Chrome the chromedriver in front of it */
export interface BrowserProcess {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  once(event: "exit", listener: (...args: any[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ChromeLaunch {
  executablePath: string;
  driverPath: string;
  profileDir: string;
  headless: boolean;
  commandTimeout: number | undefined;
  signal?: AbortSignal | undefined;
}

export const chromeFlags = ({
  headless,
  profileDir,
}: Pick<ChromeLaunch, "headless" | "profileDir">): string[] => [
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-search-engine-choice-screen",
  `--user-data-dir=${profileDir}`,
  // Headless Chrome draws 15 px classic scrollbars inside the viewport; Firefox headless overlays them
  ...(headless ? ["--headless=new", "--hide-scrollbars"] : []),
];

/** The capabilities chromedriver gets: a classic session that also opens a BiDi socket */
export const chromeCapabilities = (launch: ChromeLaunch) => ({
  capabilities: {
    alwaysMatch: {
      browserName: "chrome",
      webSocketUrl: true,
      ...SESSION_CAPABILITIES.alwaysMatch,
      "goog:chromeOptions": {
        binary: launch.executablePath,
        args: chromeFlags(launch),
      },
    },
  },
});

/**
 * Chrome speaks BiDi through its chromedriver: this starts one, asks it for a session with `webSocketUrl`, and
 * connects to the socket it hands back. The session exists when this resolves, so there is no `session.new`.
 * The returned process handle ends when the chromedriver does or the socket drops (a person closed the window).
 */
export async function launchChrome(launch: ChromeLaunch): Promise<{
  proc: BrowserProcess;
  connector: BiDiConnector;
}> {
  mkdirSync(launch.profileDir, { recursive: true });
  launch.signal?.throwIfAborted();
  const driver = spawn(launch.driverPath, ["--port=0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const proc = new ChromeProcess(driver);
  const onAbort = () => proc.kill();
  launch.signal?.addEventListener("abort", onAbort, { once: true });
  let connector: BiDiConnector | undefined;
  try {
    const port = await driverPort(driver);
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/session`, {
      method: "POST",
      body: JSON.stringify(chromeCapabilities(launch)),
      signal: launch.signal ?? null,
    });
    const body = (await res.json()) as {
      value: {
        sessionId?: string;
        capabilities?: { webSocketUrl?: string };
        message?: string;
      };
    };
    const { sessionId, capabilities } = body.value;
    if (!res.ok || !sessionId || !capabilities?.webSocketUrl)
      throw new Error(
        `chromedriver could not start Chrome: ${body.value.message ?? res.statusText}`,
      );
    proc.session = `${base}/session/${sessionId}`;
    logger.verbose("Chrome BiDi socket: %s", capabilities.webSocketUrl);
    connector = await BiDiConnector.connect(capabilities.webSocketUrl, {
      ...(launch.commandTimeout !== undefined && {
        commandTimeout: launch.commandTimeout,
      }),
    });
    connector.onClosed(() => proc.ended());
    return { proc, connector };
  } catch (err) {
    connector?.kill();
    proc.kill();
    if (launch.signal?.aborted) throw launch.signal.reason;
    throw err;
  } finally {
    launch.signal?.removeEventListener("abort", onAbort);
  }
}

function driverPort(driver: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    const onData = (data: Buffer) => {
      logger.debug(`chromedriver: ${data}`);
      const match = String(data).match(/started successfully on port (\d+)/);
      if (match) resolve(Number(match[1]));
    };
    driver.stdout?.on("data", onData);
    driver.stderr?.on("data", onData);
    driver.once("error", reject);
    driver.once("exit", (code) =>
      reject(
        new Error(`chromedriver exited with code ${code} before it was ready`),
      ),
    );
  });
}

/** chromedriver as the process of a Chrome launch: ending it ends Chrome, and so does deleting the session */
export class ChromeProcess extends EventEmitter implements BrowserProcess {
  public session: string | undefined;
  private done = false;

  constructor(
    private driver: Pick<
      ReturnType<typeof spawn>,
      "once" | "kill" | "exitCode" | "signalCode"
    >,
    private deleteSession: (url: string) => Promise<unknown> = (url) =>
      fetch(url, { method: "DELETE" }),
  ) {
    super();
    driver.once("exit", () => this.ended());
  }

  get exitCode(): number | null {
    return this.done ? (this.driver.exitCode ?? 0) : null;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.driver.signalCode;
  }

  /** The socket or the chromedriver is gone: the launch is over */
  ended() {
    if (this.done) return;
    this.done = true;
    this.emit("exit");
    this.driver.kill();
  }

  kill(signal?: NodeJS.Signals): boolean {
    // Deleting the session makes chromedriver quit Chrome; killing chromedriver alone could leave it running
    const session = this.session;
    this.session = undefined;
    if (session) {
      this.deleteSession(session)
        .catch(() => undefined)
        .finally(() => this.driver.kill(signal));
      return true;
    }
    return this.driver.kill(signal);
  }
}
