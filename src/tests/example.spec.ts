import { expect, test } from "../api.js";

test("example.com has its heading", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(page.locator("/html[1]/body[1]/p[1]")).toContainText(
    "This domain is for use in documentation examples without needing permission. This is not a service;",
  );
});
