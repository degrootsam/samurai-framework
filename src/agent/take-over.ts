import type Page from "../browser/page.js";
import { maskText } from "../config/mask.js";
import type { Recorder } from "../recorder/recorder.js";
import { stepToSource } from "../steps/emit.js";
import type { StepRecorder } from "./recording.js";
import type { TakeOverHooks } from "./session.js";
import type { Snapshotter } from "./snapshot.js";

export interface PersonRecording extends TakeOverHooks {
  /** Ends a recording that is still open (the run ended while the person had the browser) */
  dispose(): Promise<void>;
}

/**
 * While the person drives, the framework's own recorder watches the same page and writes what they do into the
 * spec after the agent's steps, so nothing they record is lost. On hand back the recorder stops, the agent's
 * recording carries on after the last step, and the agent is told what happened and shown the page as it is.
 */
export function personRecording(input: {
  page: Page;
  steps: StepRecorder;
  snapshots: Snapshotter;
  baseURL?: string;
}): PersonRecording {
  const { page, steps, snapshots } = input;
  let recorder: Recorder | undefined;
  const written = new Map<number, string>();

  const close = async () => {
    const open = recorder;
    recorder = undefined;
    if (!open) return;
    await open.stop().catch(() => undefined);
    steps.rebase();
  };

  return {
    async begin() {
      written.clear();
      recorder = await page.record({
        at: steps.count,
        initialGoto: false,
        ...(input.baseURL !== undefined && { baseURL: input.baseURL }),
        onEvent: (event) => {
          steps.external(event);
          if (event.op === "remove") written.delete(event.index);
          else written.set(event.index, stepToSource(event.step));
        },
      });
    },
    async end() {
      await close();
      const mine = [...written.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, code]) => code);
      const did =
        mine.length > 0
          ? `They added ${mine.length} ${mine.length === 1 ? "step" : "steps"} to the test: ${mine.join(" ")}`
          : "They added no steps";
      const page_ = maskText((await snapshots.take()).text);
      return `The person used the browser while you were stopped. ${did}. The page may have changed; this is the page now:\n\n${page_}\n\nYour last call was not run. Call it again only if it is still needed.`;
    },
    dispose: close,
  };
}
