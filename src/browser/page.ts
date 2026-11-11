import type { Recorder, RecorderOptions } from "../recorder/recorder.js";
import { PageObserving } from "./page-observing.js";
import type {
  PageEventName,
  WaitableEventName,
  WaitForEventOptions,
  WaitOptions,
} from "./page-events.js";
import type { PageSettings, ReadinessState } from "./page-settings.js";
import type {
  LoadState,
  NavigateOptions,
  NavigationResult,
} from "./page-navigation.js";

/** @public */
export type {
  PageEventName,
  WaitableEventName,
  WaitForEventOptions,
  WaitOptions,
};
/** @public */
export type { PageSettings, ReadinessState };
/** @public */
export type { LoadState, NavigateOptions, NavigationResult };

export default class Page extends PageObserving {
  /**
   * Starts recording what a person does in the page as steps (see `Recorder`). The page must be driven by
   * a person; stop with `recorder.stop()`.
   */
  public async record(options: RecorderOptions): Promise<Recorder> {
    this.assertOpen();
    // Loaded when asked for: the recorder is built on Page, so a static import would be a loop
    const { Recorder } = await import("../recorder/recorder.js");
    return Recorder.start(
      { page: this, connector: this.biDiConnector, context: this.id },
      options,
    );
  }

  /**
   * What the browser sets up on every page it opens: the default size, then everything that has to be listening
   * before the page does anything (requests, dialogs, logs, downloads, file pickers). Safe to call again.
   */
  public async startTracking(): Promise<void> {
    await this.applyDefaultViewport();
    await this.startNetworkTracking();
    await this.startDialogHandling();
    await this.startLogging();
    await this.startDownloadTracking();
    await this.startFileChooserTracking();
  }
}
