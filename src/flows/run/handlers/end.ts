import type { Handler } from "./types.js";

export const end: Handler = async () => ({ status: "passed" });
