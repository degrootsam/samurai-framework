import { spawn } from "node:child_process";
import logger from "../logger/index.js";
import { BiDiConnector } from "../transport/bidi-connection.js";
import type { BrowserProcess } from "./chrome-launch.js";
import {
  browserLaunchEnv,
  browserLaunchFlag,
  defaultLaunchOptions,
  type BrowserLaunchOptions,
} from "./launch-flags.js";
import { abandonLaunch, startSession } from "./session.js";

// Firefox logs "WebDriver BiDi listening on ws://<host>:<port>" without the endpoint path
const FIREFOX_WS_PATH = "/session";
const FIREFOX_WS_REGEX = /ws:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d+/g;
const PORT_IN_USE = /!!!\scould\snot\sstart\sserver\son\sport\s\d+/;

export interface FirefoxLaunch {
  executablePath: string;
  /** Names the browser in the start timeout error */
  label: string;
  launchOptions: Partial<BrowserLaunchOptions>;
  commandTimeout: number | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Starts Firefox, waits for it to announce its BiDi endpoint, connects and opens the BiDi session.
 * Rejects with an Error when the process exits first or the handshake fails, with the abort reason when aborted,
 * and with a message string when the debugging port is taken. A failed launch stops what it started.
 */
export function launchFirefox(launch: FirefoxLaunch): Promise<{
  proc: BrowserProcess;
  connector: BiDiConnector;
}> {
  const { executablePath, label, launchOptions, commandTimeout, signal } =
    launch;
  logger.verbose("Trying to spawn firefox process");
  const proc = spawn(
    executablePath,
    browserLaunchFlag("firefox", launchOptions),
    { env: { ...process.env, ...browserLaunchEnv("firefox") } },
  );

  return new Promise((resolve, reject) => {
    const onUnexpectedClose = (code: number | null) =>
      reject(
        new Error(`Browser process exited unexpectedly with code ${code}`),
      );
    proc.on("close", onUnexpectedClose);

    const onAbort = () => {
      logger.verbose("Launch of firefox aborted, killing process");
      proc.kill();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const settled = () => {
      proc.off("close", onUnexpectedClose);
      signal?.removeEventListener("abort", onAbort);
    };

    proc.stdout.on("data", (data: Buffer) => {
      logger.debug(`firefox stdout: ${data}`);
      if (PORT_IN_USE.test(String(data))) {
        proc.kill();
        reject(
          `PORT ${launchOptions.port ?? defaultLaunchOptions("firefox").port} is already in use!`,
        );
      }
    });

    proc.stderr.on("data", async (data: Buffer) => {
      logger.debug(`firefox stderr: ${data}`);
      const urlMatch = String(data).match(FIREFOX_WS_REGEX);
      logger.debug("Browser announced its endpoint", { urlMatch });
      if (!urlMatch || urlMatch.length === 0) return;
      // Killing the process mid-handshake rejects pending BiDi calls; surface that via reject
      // instead of an unhandled rejection from this async listener
      let connector: BiDiConnector | undefined;
      try {
        const url = urlMatch[0] + FIREFOX_WS_PATH;
        logger.verbose("Websocket URL match: %s", url);
        connector = await BiDiConnector.connect(url, { commandTimeout });
        const status = await connector.send("session.status", {});
        logger.verbose("Session status", status);
        await startSession(connector, label, commandTimeout);
        logger.verbose("Session started successfully");
        settled();
        resolve({ proc, connector });
      } catch (err) {
        settled();
        abandonLaunch(proc, connector);
        reject(err);
      }
    });
  });
}
