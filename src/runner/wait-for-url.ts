import http from "node:http";
import https from "node:https";
import net from "node:net";

/** Pause between two probes */
const POLL_MS = 100;

/** Resolves true once `url` answers with a status from 200 to 403 (a server that is up but wants a login counts) */
function urlAnswers(
  url: string,
  options: { ignoreHTTPSErrors?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const secure = new URL(url).protocol === "https:";
    const request = (secure ? https : http).get(
      url,
      {
        timeout: 2000,
        headers: { Accept: "text/html,application/json,*/*;q=0.8" },
        ...(secure && { rejectUnauthorized: !options.ignoreHTTPSErrors }),
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        resolve(status >= 200 && status <= 403);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

/** Resolves true when something on this machine accepts a TCP connection on `port` (IPv4 or IPv6 `localhost`) */
function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "localhost", timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

/** What to probe: an `http`/`https` URL, or a local port */
export type ReadyTarget =
  { url: string; ignoreHTTPSErrors?: boolean } | { port: number };

/** One probe of `target` */
export function answers(target: ReadyTarget): Promise<boolean> {
  return "url" in target
    ? urlAnswers(target.url, {
        ...(target.ignoreHTTPSErrors && { ignoreHTTPSErrors: true }),
      })
    : portAnswers(target.port);
}

/** The target as text for messages: the URL, or `localhost:<port>` */
export function describeTarget(target: ReadyTarget): string {
  return "url" in target ? target.url : `localhost:${target.port}`;
}

/**
 * Probes `target` until it answers. Resolves "ready", or "timeout" after `timeout` ms, or "aborted" when `signal`
 * fires or `stopped()` turns true (the caller saw the server die)
 */
export async function waitUntilReady(
  target: ReadyTarget,
  options: { timeout: number; signal?: AbortSignal; stopped?: () => boolean },
): Promise<"ready" | "timeout" | "aborted"> {
  const deadline = Date.now() + options.timeout;
  for (;;) {
    if (options.signal?.aborted || options.stopped?.()) return "aborted";
    if (await answers(target)) return "ready";
    if (Date.now() >= deadline) return "timeout";
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
