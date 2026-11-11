import type { Io } from "../cli/io.js";

/** An `Io` that collects what the CLI writes, for the CLI tests */
export function io() {
  const out: string[] = [];
  const err: string[] = [];
  const target: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    color: false,
    env: {},
  };
  return { target, out: () => out.join(""), err: () => err.join("") };
}
