import { test } from "node:test";
import assert from "node:assert/strict";
import Page from "./page.js";
import { stubConnector } from "../testing/stub-connector.js";

test("navigateTo keeps URLs that have a scheme and prefixes bare hosts", async () => {
  const { connector, sent } = stubConnector({ type: "undefined" });
  const page = new Page(connector, "ctx");
  await page.navigateTo("about:blank");
  await page.navigateTo("https://itmetsam.nl/contact");
  await page.navigateTo("itmetsam.nl");
  await page.navigateTo("localhost:3000/login");
  await page.navigateTo("itmetsam.nl", undefined, "http");
  assert.deepEqual(
    sent.map(({ params }) => (params as { url: string }).url),
    [
      "about:blank",
      "https://itmetsam.nl/contact",
      "https://itmetsam.nl",
      "https://localhost:3000/login",
      "http://itmetsam.nl",
    ],
  );
});
