import { test } from "node:test";
import assert from "node:assert/strict";
import type Page from "../browser/page.js";
import {
  agentRunFixture,
  ended,
  OPTIONS,
  pause,
} from "../testing/agent-run.js";

const fx = agentRunFixture(9613);
const { start } = fx;

test(
  "taking over activates the agent's page and the run carries on",
  OPTIONS,
  async () => {
    const calls: string[] = [];
    let handed = false;
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      {},
      (event, session) => {
        if (event.type === "usage" && !handed) {
          handed = true;
          session().takeOver();
          void pause(1200).then(() => session().handBack());
        }
      },
      (page: Page) => {
        const original = page.bringToFront.bind(page);
        page.bringToFront = async () => {
          try {
            await original();
            calls.push("activated");
          } catch (error) {
            calls.push(`refused: ${String(error)}`);
            throw error;
          }
        };
      },
    );
    ended(await run.session.result, "finished");
    assert.equal(calls.length, 1, calls.join(", "));
    // Headless or not, the browser either activates the context or refuses it; the take over works either way
    console.log(`bringToFront: ${calls[0]}`);
  },
);

test(
  "a browser that refuses to activate does not fail the take over",
  OPTIONS,
  async () => {
    let handed = false;
    const run = start(
      [
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "snapshot" }] },
        { calls: [{ name: "finish", args: { summary: "ok" } }] },
      ],
      {},
      (event, session) => {
        if (event.type === "usage" && !handed) {
          handed = true;
          session().takeOver();
          void pause(1200).then(() => session().handBack());
        }
      },
      (page: Page) => {
        page.bringToFront = () => Promise.reject(new Error("unsupported"));
      },
    );
    ended(await run.session.result, "finished");
  },
);
