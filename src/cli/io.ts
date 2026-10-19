/** What the command line reads from and writes to; the process supplies it, tests fake it */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Whether output goes to a terminal that shows colours */
  color: boolean;
  env: Partial<NodeJS.ProcessEnv>;
  /** Aborts a recording (Ctrl+C) */
  signal?: AbortSignal;
}
