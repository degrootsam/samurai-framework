import { ChildProcess, spawn } from "node:child_process";

export class Browser {
  private browserProcess: ChildProcess;

  public connect() {
    this.tryConnectToWebsocket();
  }

  private async tryConnectToWebsocket() {}

  private waitForWebsocketConnection() {}
}

const browser = new Browser();
browser.connect();
