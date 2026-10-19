import type { Handler } from "./types.js";

/** Its branches are walked by the walker; the node itself just opens them */
export const parallel: Handler = async () => ({ status: "passed" });
