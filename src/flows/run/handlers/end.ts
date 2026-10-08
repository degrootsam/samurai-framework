import type { Handler } from "./support.js";

export const end: Handler = async () => ({ status: "passed" });
