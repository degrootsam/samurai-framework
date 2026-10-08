import type { Handler } from "./support.js";

export const wait: Handler = async (node, run) => {
  const ms = typeof node.config?.ms === "number" ? node.config.ms : 1000;
  try {
    await run.sleep(ms, run.signal);
  } catch {
    return "cancelled";
  }
  return { status: "passed" };
};
