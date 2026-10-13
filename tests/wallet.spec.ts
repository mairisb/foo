import { test, expect } from "@playwright/test";
import { cleanUp, email, password, retrySeconds, syntheticImage } from "./helpers";

test.afterAll(cleanUp);
test("sign in, create cards, and read them after reload and a new session", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const accountEmail = email();
  await page.goto("/login");
  // Exercise a client interaction before screenshots so screenshot styling
  // cannot race React's initial hydration.
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.screenshot({
    path: testInfo.outputPath("login.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByLabel("Name", { exact: true }).fill("Alex");
  await page.getByLabel("Email", { exact: true }).fill(accountEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/sign-up/email"),
    );
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    const response = await pending;
    if (response.status() !== 429 || attempt === 2) {
      expect(response.status()).toBe(200);
      break;
    }
    await page.waitForTimeout((retrySeconds(response.headers()) + 1) * 1000);
  }
  await expect(
    page.getByRole("heading", { name: /^My cards/, level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add card" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add card" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add card", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(page.getByLabel("Card name", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Card name", { exact: true }).fill("Weekly groceries");
  await expect(page.getByLabel("Card number", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Barcode format" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("add-card.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Weekly groceries" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Weekly groceries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await page.getByLabel("Card name", { exact: true }).fill("Daily coffee");
  const front = await syntheticImage();
  const back = await syntheticImage("Back");
  await page.getByLabel("Image 1 (optional)", { exact: true }).setInputFiles(front);
  const savedOneImage = page.waitForResponse(response => response.url().endsWith("/api/cards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  expect((await (await savedOneImage).json()).card.imageCount).toBe(1);
  await expect(
    page.getByRole("button", { name: "Open Daily coffee" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await page.getByLabel("Card name", { exact: true }).fill("Gym membership");
  await page.getByLabel("Image 1 (optional)", { exact: true }).setInputFiles(front);
  await page.getByLabel("Image 2 (optional)", { exact: true }).setInputFiles(back);
  await page.getByRole("button", { name: "Clear image 2", exact: true }).click();
  await expect(page.getByLabel("Image 2 (optional)", { exact: true })).toHaveValue("");
  await page.getByLabel("Image 2 (optional)", { exact: true }).setInputFiles(back);
  await page.screenshot({ path: testInfo.outputPath("add-images.png"), fullPage: true, animations: "disabled" });
  const savedTwoImages = page.waitForResponse(response => response.url().endsWith("/api/cards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  expect((await (await savedTwoImages).json()).card.imageCount).toBe(2);
  await expect(page.getByRole("button", { name: "Open Gym membership" })).toBeVisible();
  await page.reload();
  await page.screenshot({
    path: testInfo.outputPath("wallet.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open Weekly groceries" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Weekly groceries" })
      .getByText("No images.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Open Daily coffee" }).click();
  await expect(page.getByRole("img", { name: "Image 1 of Daily coffee" })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Open Gym membership" }).click();
  for (const position of [1, 2]) {
    const image = page.getByRole("img", { name: `Image ${position} of Gym membership` });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("card-detail.png"),
    fullPage: true,
    animations: "disabled",
  });
  const fullSizePage = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open image 1 full size" }).click();
  const imagePage = await fullSizePage;
  await imagePage.waitForLoadState();
  expect(await imagePage.evaluate(() => document.contentType)).toBe("image/jpeg");
  await imagePage.close();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(accountEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Daily coffee" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Weekly groceries" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Gym membership" }).click();
  await expect.poll(() => page.getByRole("img", { name: "Image 2 of Gym membership" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: /share|edit|remove|delete|search/i }),
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
