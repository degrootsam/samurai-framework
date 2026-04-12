import { execSync } from "node:child_process";

type SupportedBrowser = "chrome" | "firefox";
const supportedBrowsers: SupportedBrowser[] = ["chrome", "firefox"];
const supportedPlatforms = ["darwin", "win32", "linux"];

export class BrowserFinder {
  constructor(browserName: SupportedBrowser) {
    if (!supportedBrowsers.includes(browserName)) {
      throw new Error(
        "This browser is not supported. Supported browsers include: " +
          supportedBrowsers.join(", "),
      );
    }
    if (
      process.platform !== "darwin" &&
      process.platform !== "win32" &&
      process.platform !== "linux"
    ) {
      throw new Error("This platform is not supported");
    }
    this.tryFindBrowser(browserName);
  }
  private tryFindBrowser(browser: SupportedBrowser) {
    let browserExeName = browser;
    try {
      execSync(command);
    } catch (err) {}
  }
}
