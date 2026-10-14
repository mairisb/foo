import { test, expect } from "@playwright/test";
import { cleanUp, email, password, retrySeconds, syntheticImage, register, cardForm, origin } from "./helpers";

test.afterAll(cleanUp);
test("sign in, create, read, and delete cards across sessions", async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  let registering = true;
  page.on("console", (message) => {
    // A signup retry explicitly checks and respects a 429 response below.
    if (registering && message.location().url.endsWith("/api/auth/sign-up/email") && message.text().includes("429")) return;
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
  registering = false;
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
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add images", exact: true }).click();
  await (await chooser).setFiles(front);
  const savedOneImage = page.waitForResponse(response => response.url().endsWith("/api/cards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  expect((await (await savedOneImage).json()).card.imageCount).toBe(1);
  await expect(
    page.getByRole("button", { name: "Open Daily coffee" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add card", exact: true }).click();
  await page.getByLabel("Card name", { exact: true }).fill("Gym membership");
  const extra = await syntheticImage("Extra");
  const imageInput = page.getByLabel("Images (optional)", { exact: true });
  await imageInput.setInputFiles([front, back, extra]);
  for (const position of [1, 2, 3]) {
    await expect.poll(() => page.getByRole("img", { name: `Preview of image ${position}`, exact: true }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  }
  await page.getByRole("button", { name: "Remove image 2", exact: true }).click();
  await expect(page.getByRole("img", { name: /^Preview of image/ })).toHaveCount(2);
  await expect(imageInput).toHaveValue("");
  await imageInput.setInputFiles([back, front]);
  await expect(page.getByRole("img", { name: /^Preview of image/ })).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath("add-images.png"), fullPage: true, animations: "disabled" });
  const savedImages = page.waitForResponse(response => response.url().endsWith("/api/cards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save card", exact: true }).click();
  expect((await (await savedImages).json()).card.imageCount).toBe(4);
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
  for (const position of [1, 2, 3, 4]) {
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
  await expect.poll(() => page.getByRole("img", { name: "Image 4 of Gym membership" }).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete card?", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("delete-confirmation.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Gym membership", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete card", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My cards (3)", exact: true })).toBeVisible();
  const names = ["Gym membership", "Daily coffee", "Weekly groceries"];
  for (const [index, name] of names.entries()) {
    await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
    await page.getByRole("button", { name: "Delete card", exact: true }).click();
    const deleted = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().includes("/api/cards/"));
    await page.getByRole("button", { name: "Delete card", exact: true }).click();
    expect((await deleted).status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Open ${name}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: `My cards (${2 - index})`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add card", exact: true })).toBeFocused();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "My cards (0)", exact: true })).toBeVisible();
  await expect(page.getByText("No cards yet.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /share|edit|search/i }),
  ).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("failed deletion keeps the card and allows retry", async ({ page }, testInfo) => {
  await register(page.request);
  const created = await page.request.post("/api/cards", {
    headers: { origin },
    multipart: cardForm("Retry card"),
  });
  expect(created.status()).toBe(201);
  const { card } = await created.json();
  await page.goto("/");
  await page.getByRole("button", { name: "Open Retry card", exact: true }).click();
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { received = resolve; });
  const path = `**/api/cards/${card.id}`;
  await page.route(path, async route => {
    received();
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Couldn't delete the card. Try again." }),
    });
  });
  try {
    await page.getByRole("button", { name: "Delete card", exact: true }).click();
    await pending;
    await expect(page.getByRole("button", { name: "Deleting...", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Close dialog", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Delete card?", exact: true })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole("alert")).toHaveText("Couldn't delete the card. Try again.");
  expect((await page.request.get(`/api/cards/${card.id}`)).status()).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("delete-error.png"), fullPage: true, animations: "disabled" });
  await page.unroute(path);
  await page.getByRole("button", { name: "Delete card", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Retry card", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No cards yet.", { exact: true })).toBeVisible();
});
