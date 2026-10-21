/** The test folder when the config names none */
export const DEFAULT_SRC_DIR = "./src";
/** The spec pattern when a group names none */
export const DEFAULT_TEST_MATCH = "**/*.spec.ts";
/** The browsers of a run that names none */
export const DEFAULT_BROWSERS = ["firefox"] as const;
/** Time (ms) a test may take */
export const DEFAULT_TIMEOUT = 30000;
/** The retry time of actions and assertions when nothing sets one (ms) */
export const DEFAULT_EXPECT_TIMEOUT = 5000;
/** Time (ms) a navigation or a wait for a load state may take */
export const DEFAULT_NAVIGATION_TIMEOUT = 30000;
/** What a navigation waits for when nothing says otherwise: the load event */
export const DEFAULT_WAIT_UNTIL = "complete";
/** Time (ms) a command may wait for its reply before it fails with code "timeout" */
export const DEFAULT_COMMAND_TIMEOUT = 30000;
/** Time (ms) without requests in flight that counts as idle */
export const DEFAULT_IDLE_TIME = 500;
/** Time (ms) a handler may take to answer a request before the router lets it continue */
export const DEFAULT_ROUTE_TIMEOUT = 30000;
/** How large a response body may be to be kept: 10 MiB */
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;
/** Whether response bodies are collected for every request */
export const DEFAULT_COLLECT_BODIES = false;
/** Whether the network of a page is tracked */
export const DEFAULT_TRACK_NETWORK = true;
/** The size a page gets unless config `use.viewport` says otherwise */
export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
/** Where downloads are saved, relative to the project */
export const DEFAULT_DOWNLOADS_DIR = "result/downloads";
/** The files folder, relative to the project */
export const DEFAULT_FILES_DIR = "files";
/** How many times a failing test is run again */
export const DEFAULT_RETRIES = 0;
/** Which page log entries go in the report: those of failed tests */
export const DEFAULT_LOGS_CAPTURE = "failures";
/** Whether uncaught page errors fail a test */
export const DEFAULT_FAIL_ON_PAGE_ERROR = false;
