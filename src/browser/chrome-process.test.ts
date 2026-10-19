import assert from "node:assert/strict";
import EventEmitter from "node:events";
import { describe, it } from "node:test";
import { tick } from "../testing/fake-websocket.js";
import { ChromeProcess } from "./chrome-launch.js";

class FakeDriver extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = 0;
  kill() {
    this.killed++;
    return true;
  }
}

const setup = () => {
  const driver = new FakeDriver();
  const deleted: string[] = [];
  const proc = new ChromeProcess(driver as never, async (url) => {
    deleted.push(url);
  });
  return { driver, deleted, proc };
};

describe("ChromeProcess", () => {
  it("is running until the chromedriver exits, then reports exit once", () => {
    const { driver, proc } = setup();
    let exits = 0;
    proc.once("exit", () => exits++);
    assert.equal(proc.exitCode, null);
    driver.exitCode = 0;
    driver.emit("exit");
    driver.emit("exit");
    assert.equal(proc.exitCode, 0);
    assert.equal(exits, 1);
  });

  it("ends when the socket drops (a person closed the window) and stops the chromedriver", () => {
    const { driver, proc } = setup();
    let exited = false;
    proc.once("exit", () => (exited = true));
    proc.ended();
    assert.equal(exited, true);
    assert.equal(driver.killed, 1);
    assert.notEqual(proc.exitCode, null);
  });

  it("kill deletes the session first and then ends the chromedriver", async () => {
    const { driver, deleted, proc } = setup();
    proc.session = "http://127.0.0.1:1/session/abc";
    proc.kill();
    assert.equal(
      driver.killed,
      0,
      "chromedriver stays up until the session is gone",
    );
    await tick(10);
    assert.deepEqual(deleted, ["http://127.0.0.1:1/session/abc"]);
    assert.equal(driver.killed, 1);
  });

  it("kill without a session ends the chromedriver at once", () => {
    const { driver, deleted, proc } = setup();
    proc.kill();
    assert.equal(driver.killed, 1);
    assert.deepEqual(deleted, []);
  });
});
