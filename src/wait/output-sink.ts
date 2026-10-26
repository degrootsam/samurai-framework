/*
 * The outputs a running test saves. It lives here, below `assert` and `locator`, because both save into it
 * (`fill`, the text checks) and neither may import `runner`.
 */

/**
 * Where one attempt of a test keeps the outputs it saves. Once closed it ignores what still arrives, so a
 * capture that outlives its test (it timed out, or nobody awaited it) never lands in the next one.
 */
export interface OutputSink {
  /** Whether the test declared `name` */
  declares(name: string): boolean;
  /** Keeps `value` under `name`; throws for a name the test did not declare, ignores it once closed */
  set(name: string, value: string): void;
  /** What was saved so far */
  values(): Record<string, string>;
}

class Sink implements OutputSink {
  private readonly saved: Record<string, string> = {};
  public closed = false;

  constructor(private readonly declared: readonly string[]) {}

  declares(name: string): boolean {
    return this.declared.includes(name);
  }

  set(name: string, value: string): void {
    if (this.closed) return;
    if (!this.declares(name))
      throw new Error(`output ${JSON.stringify(name)} is not declared`);
    this.saved[name] = value;
  }

  values(): Record<string, string> {
    return { ...this.saved };
  }
}

/** The sink of the attempt that is running; one at a time, like the pending assertions */
let current: Sink | undefined;

/** Opens the sink of an attempt that declared `declared`, closing any one still open */
export function beginOutputs(declared: readonly string[]): OutputSink {
  if (current) current.closed = true;
  current = new Sink(declared);
  return current;
}

/** The open sink, or none outside a test. A capture takes it when it starts and saves into that one */
export function currentOutputSink(): OutputSink | undefined {
  return current;
}

/** Closes the open sink and returns what it holds */
export function endOutputs(): Record<string, string> {
  const sink = current;
  current = undefined;
  if (!sink) return {};
  sink.closed = true;
  return sink.values();
}

/**
 * Takes the open sink for a capture that starts now (`method` names the call in the errors) and returns the
 * function that saves `value` under `name` into it. The sink is bound here: a value that arrives after the test
 * ended goes to its own closed sink and is ignored.
 */
export function bindOutput(
  method: string,
  name: string,
): (value: string) => void {
  const sink = current;
  if (!sink)
    throw new Error(`${method}: output can only be saved inside a test`);
  if (!sink.declares(name))
    throw new Error(
      `${method}: output ${JSON.stringify(name)} is not declared`,
    );
  return (value) => sink.set(name, value);
}
