import { test } from "../runner/test-runner.js";

test("My first test", async (page) => {
  await page.navigateTo("https://itmetsam.nl");
  const link = page.locator("a[text()='Start een project']");
  await link.click();
  await page.waitForNetworkIdle();
  const nameField = page.locator("input[@id='contact-name']");
  await nameField.fill("test");
  const emailField = page.locator("input[@id='contact-email']");
  await emailField.fill("sammiedegroot@gmail.com");
  const subjectField = page.locator("input[@id='contact-subject']");
  await subjectField.fill("Test subject");
  const messageField = page.locator("textarea[@id='contact-message']");
  await messageField.fill(
    "This is a very long message which describes what I would like",
  );
  const submitButton = page.locator("button[@type='submit']");
  await submitButton.click();
  await page.waitForNetworkIdle();
  const successAlert = page.locator("div[@class='alert-description']");
});
