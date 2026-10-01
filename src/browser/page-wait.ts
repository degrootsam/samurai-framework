import { WaitTimeoutError } from "../wait/wait-until.js";

/** No download started in time */
export class DownloadWaitTimeoutError extends WaitTimeoutError<undefined> {
  constructor(timeout: number) {
    super(timeout, undefined);
    this.name = "DownloadWaitTimeoutError";
    this.message = `waitForDownload(): no download started within ${timeout}ms`;
  }
}

/** No file picker opened in time */
export class FileChooserTimeoutError extends WaitTimeoutError<undefined> {
  constructor(timeout: number) {
    super(timeout, undefined);
    this.name = "FileChooserTimeoutError";
    this.message = `waitForFileChooser(): no file chooser opened within ${timeout}ms`;
  }
}
