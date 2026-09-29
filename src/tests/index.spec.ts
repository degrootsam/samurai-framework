import { expect } from "../assert/expect.js";
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
  await expect(nameField).toBeVisible();
  await expect(nameField).toHaveValue("test");
  await expect(emailField).toHaveValue("sammiedegroot@gmail.com");
  await expect(subjectField).toHaveValue("Test subject");
  await expect(messageField).toHaveValue(/very long message/);

  const submitButton = page.locator("button[@type='submit']");
  await submitButton.click();
  await page.waitForNetworkIdle();
  const successAlert = page.locator("div[@class='alert-description']");
  await expect(successAlert).toContainText(
    "Je aanvraag is ontvangen! Je ontvangt automatisch een kopie van de aanvraag op het opgegeven E-mailadres. Ik neem binnen 3 werkdagen contact met je op over je aanvraag.",
  );
});
