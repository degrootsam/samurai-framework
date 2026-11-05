import type { SamuraiTestConfig, WebServerConfig } from "../types/config.js";

export const DEFAULT_WEB_SERVER_TIMEOUT = 60_000;
export const DEFAULT_GRACEFUL_TIMEOUT = 5_000;

const KEYS = [
  "command",
  "url",
  "port",
  "cwd",
  "env",
  "timeout",
  "reuseExistingServer",
  "stdout",
  "stderr",
  "ignoreHTTPSErrors",
  "gracefulShutdown",
];
const STREAMS = ["pipe", "ignore"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (where: string, problem: string): never => {
  throw new Error(`${where}: ${problem}`);
};

/** The config's `webServer` as a list (empty when there is none). Call after validation */
export function webServersOf(config: SamuraiTestConfig): WebServerConfig[] {
  const { webServer } = config;
  if (webServer === undefined) return [];
  return Array.isArray(webServer) ? webServer : [webServer];
}

/** Checks the `webServer`, `globalSetup` and `globalTeardown` keys of a config. Throws `config.<key>: what is wrong` */
export function validateWebServerConfig(config: SamuraiTestConfig): void {
  const { webServer } = config;
  if (webServer !== undefined) {
    if (Array.isArray(webServer)) {
      if (webServer.length === 0)
        fail("config.webServer", "the list must not be empty");
      webServer.forEach((server, index) =>
        checkServer(server, `config.webServer[${index}]`),
      );
    } else checkServer(webServer, "config.webServer");
  }
  for (const key of ["globalSetup", "globalTeardown"] as const) {
    const hook = config[key];
    if (
      hook !== undefined &&
      typeof hook !== "function" &&
      (typeof hook !== "string" || hook === "")
    )
      fail(`config.${key}`, "must be a module path or a function");
  }
}

function checkServer(server: unknown, where: string): void {
  if (!isObject(server)) return fail(where, "must be an object");
  for (const key of Object.keys(server))
    if (!KEYS.includes(key)) fail(where, `unknown key "${key}"`);
  const s = server as unknown as WebServerConfig;
  if (typeof s.command !== "string" || s.command.trim() === "")
    fail(`${where}.command`, "must be a non-empty string");
  if ((s.url === undefined) === (s.port === undefined))
    fail(where, "give either url or port");
  if (s.url !== undefined) checkUrl(s.url, `${where}.url`);
  if (
    s.port !== undefined &&
    !(Number.isInteger(s.port) && s.port >= 1 && s.port <= 65535)
  )
    fail(`${where}.port`, `must be a whole number from 1 to 65535`);
  if (s.cwd !== undefined && (typeof s.cwd !== "string" || s.cwd === ""))
    fail(`${where}.cwd`, "must be a non-empty string");
  if (s.env !== undefined) {
    if (!isObject(s.env))
      fail(`${where}.env`, "must be an object of names and string values");
    for (const [name, value] of Object.entries(s.env))
      if (typeof value !== "string")
        fail(`${where}.env`, `"${name}" must be a string`);
  }
  if (
    s.timeout !== undefined &&
    !(
      typeof s.timeout === "number" &&
      Number.isFinite(s.timeout) &&
      s.timeout > 0
    )
  )
    fail(`${where}.timeout`, "must be a positive number of milliseconds");
  for (const key of ["reuseExistingServer", "ignoreHTTPSErrors"] as const)
    if (s[key] !== undefined && typeof s[key] !== "boolean")
      fail(`${where}.${key}`, "must be true or false");
  for (const key of ["stdout", "stderr"] as const)
    if (s[key] !== undefined && !STREAMS.includes(s[key] as string))
      fail(`${where}.${key}`, `must be "pipe" or "ignore"`);
  if (s.gracefulShutdown !== undefined)
    checkGraceful(s.gracefulShutdown, where);
}

function checkUrl(url: unknown, where: string): void {
  try {
    if (typeof url !== "string") throw new TypeError();
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") throw new TypeError();
  } catch {
    fail(where, "must be an http or https URL");
  }
}

function checkGraceful(graceful: unknown, where: string): void {
  if (!isObject(graceful))
    return fail(`${where}.gracefulShutdown`, "must be an object");
  for (const key of Object.keys(graceful))
    if (key !== "signal" && key !== "timeout")
      fail(`${where}.gracefulShutdown`, `unknown key "${key}"`);
  const { signal, timeout } = graceful;
  if (signal !== undefined && signal !== "SIGTERM" && signal !== "SIGINT")
    fail(`${where}.gracefulShutdown.signal`, `must be "SIGTERM" or "SIGINT"`);
  if (
    timeout !== undefined &&
    !(typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0)
  )
    fail(
      `${where}.gracefulShutdown.timeout`,
      "must be a number of milliseconds, 0 or more",
    );
}
