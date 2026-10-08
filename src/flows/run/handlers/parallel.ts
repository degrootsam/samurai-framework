import type { Handler } from "./support.js";

/** Its branches are walked by the walker; the node itself just opens them */
export const parallel: Handler = async () => ({ status: "passed" });
