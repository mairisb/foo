import { test, expect } from "@playwright/test";
import {
    cleanUp,
    email,
    password,
    retrySeconds,
    syntheticImage,
    register,
    cardForm,
    editForm,
    origin,
} from "./helpers";

test.afterAll(cleanUp);
test("modal headers and bottom card actions stay visible while scrolling", async ({
    page,
}, testInfo) => {
    await register(page.request);
    const front = await syntheticImage();
    const back = await syntheticImage("Back");
    const images = [front, back, front, back, front, back];
    const title = `Long card name ${"W".repeat(65)}`;
    const created = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm(title, images),
    });
    expect(created.status()).toBe(201);

    async function checkPinnedHeader(screenshot: string, hasActions = false) {
        const dialog = page.getByRole("dialog");
        const header = dialog.locator('[data-slot="dialog-header"]');
        const body = dialog.locator('[data-slot="dialog-body"]');
        const close = dialog.getByRole("button", {
            name: "Close dialog",
            exact: true,
        });
        const footer = dialog.locator('[data-slot="dialog-footer"]');
        await expect
            .poll(() =>
                dialog.locator("img").evaluateAll((elements) =>
                    elements.every((element) => {
                        const image = element as HTMLImageElement;
                        return image.complete && image.naturalWidth > 0;
                    }),
                ),
            )
            .toBe(true);
        await expect
            .poll(() =>
                body.evaluate(
                    (element) => element.scrollHeight - element.clientHeight,
                ),
            )
            .toBeGreaterThan(100);
        // Wait for the opening animation to settle before measuring positions.
        await dialog.evaluate(async (element) => {
            await Promise.all(
                element
                    .getAnimations({ subtree: true })
                    .map((animation) => animation.finished),
            );
        });
        const headerTop = await header.evaluate(
            (element) => element.getBoundingClientRect().top,
        );
        const closeTop = await close.evaluate(
            (element) => element.getBoundingClientRect().top,
        );
        const footerTop = hasActions
            ? await footer.evaluate(
                  (element) => element.getBoundingClientRect().top,
              )
            : 0;
        await body.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await expect
            .poll(() => body.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(100);
        expect(
            await header.evaluate(
                (element) => element.getBoundingClientRect().top,
            ),
        ).toBeCloseTo(headerTop, 1);
        expect(
            await close.evaluate(
                (element) => element.getBoundingClientRect().top,
            ),
        ).toBeCloseTo(closeTop, 1);
        await expect(close).toBeInViewport();
        await expect(close.locator("svg")).toBeVisible();
        await expect(close).toHaveText("");
        expect(
            await close.evaluate(
                (element) => element.getBoundingClientRect().height,
            ),
        ).toBeGreaterThanOrEqual(44);
        if (hasActions) {
            const actions = footer.getByRole("group", {
                name: "Card actions",
                exact: true,
            });
            const edit = actions.getByRole("button", {
                name: "Edit card",
                exact: true,
            });
            const remove = actions.getByRole("button", {
                name: "Delete card",
                exact: true,
            });
            await expect(edit).toBeInViewport();
            await expect(remove).toBeInViewport();
            expect(
                await footer.evaluate(
                    (element) => element.getBoundingClientRect().top,
                ),
            ).toBeCloseTo(footerTop, 1);
            expect(
                await edit.evaluate(
                    (element) => element.getBoundingClientRect().top,
                ),
            ).toBeCloseTo(
                await remove.evaluate(
                    (element) => element.getBoundingClientRect().top,
                ),
                1,
            );
            const bodyBottom = await body.evaluate(
                (element) => element.getBoundingClientRect().bottom,
            );
            expect(footerTop).toBeGreaterThanOrEqual(bodyBottom - 1);
        }
        expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(page.viewportSize()!.width);
        await page.screenshot({
            path: testInfo.outputPath(screenshot),
            fullPage: true,
            animations: "disabled",
        });
    }

    await page.goto("/");
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Unsaved draft");
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(images);
    await checkPinnedHeader("sticky-add-header.png");
    await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Add card", exact: true }),
    ).toBeFocused();
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(1);

    await page
        .getByRole("button", { name: `Open ${title}`, exact: true })
        .click();
    await checkPinnedHeader("sticky-card-header.png", true);
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await checkPinnedHeader("sticky-edit-header.png");
    await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: title, exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Delete card", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Delete card?", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("button", { name: "Delete card", exact: true }),
    ).toBeFocused();
    await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("sign in, create, read, edit, and delete cards across sessions", async ({
    page,
}, testInfo) => {
    const browserErrors: string[] = [];
    let registering = true;
    page.on("console", (message) => {
        // A signup retry explicitly checks and respects a 429 response below.
        if (
            registering &&
            message.location().url.endsWith("/api/auth/sign-up/email") &&
            message.text().includes("429")
        ) {
            return;
        }
        if (message.type() === "error") {
            browserErrors.push(message.text());
        }
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
        await page.waitForTimeout(
            (retrySeconds(response.headers()) + 1) * 1000,
        );
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
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Weekly groceries");
    await expect(page.getByLabel("Card number", { exact: true })).toHaveCount(
        0,
    );
    await expect(
        page.getByRole("combobox", { name: "Barcode format" }),
    ).toHaveCount(0);
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
    const savedOneImage = page.waitForResponse(
        (response) =>
            response.url().endsWith("/api/cards") &&
            response.request().method() === "POST",
    );
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
        await expect
            .poll(() =>
                page
                    .getByRole("img", {
                        name: `Preview of image ${position}`,
                        exact: true,
                    })
                    .evaluate((image: HTMLImageElement) => image.naturalWidth),
            )
            .toBeGreaterThan(0);
    }
    await page
        .getByRole("button", { name: "Remove image 2", exact: true })
        .click();
    await expect(
        page.getByRole("img", { name: /^Preview of image/ }),
    ).toHaveCount(2);
    await expect(imageInput).toHaveValue("");
    await imageInput.setInputFiles([back, front]);
    await expect(
        page.getByRole("img", { name: /^Preview of image/ }),
    ).toHaveCount(4);
    await page.screenshot({
        path: testInfo.outputPath("add-images.png"),
        fullPage: true,
        animations: "disabled",
    });
    const savedImages = page.waitForResponse(
        (response) =>
            response.url().endsWith("/api/cards") &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    const gymCard = (await (await savedImages).json()).card;
    expect(gymCard.imageCount).toBe(4);
    await expect(
        page.getByRole("button", { name: "Open Gym membership" }),
    ).toBeVisible();
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
    await expect(
        page.getByRole("img", { name: "Image 1 of Daily coffee" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Open Gym membership" }).click();
    for (const position of [1, 2, 3, 4]) {
        const image = page.getByRole("img", {
            name: `Image ${position} of Gym membership`,
        });
        await expect(image).toBeVisible();
        await expect
            .poll(() =>
                image.evaluate((image: HTMLImageElement) => image.naturalWidth),
            )
            .toBeGreaterThan(0);
    }
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: testInfo.outputPath("card-detail.png"),
        fullPage: true,
        animations: "disabled",
    });
    const fullSizePage = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Open image 1 full size" }).click();
    const imagePage = await fullSizePage;
    await imagePage.waitForLoadState();
    expect(await imagePage.evaluate(() => document.contentType)).toBe(
        "image/jpeg",
    );
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
    await expect
        .poll(() =>
            page
                .getByRole("img", { name: "Image 4 of Gym membership" })
                .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Edit card", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Gym membership",
    );
    await expect(
        page.getByRole("img", { name: /^Preview of image/ }),
    ).toHaveCount(4);
    await page.getByLabel("Card name", { exact: true }).fill("Discarded title");
    await page
        .getByRole("button", { name: "Remove image 2", exact: true })
        .click();
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(extra);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Gym membership", exact: true }),
    ).toBeVisible();
    expect(
        (await (await page.request.get(`/api/cards/${gymCard.id}`)).json())
            .card,
    ).toMatchObject({ label: "Gym membership", imageCount: 4, revision: 0 });
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("");
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
    );
    const editedName = "Gym membership updated";
    await page.getByLabel("Card name", { exact: true }).fill(editedName);
    await page
        .getByRole("button", { name: "Remove image 2", exact: true })
        .click();
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles([extra, back]);
    await expect(
        page.getByRole("img", { name: /^Preview of image/ }),
    ).toHaveCount(5);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page
        .getByRole("dialog", { name: "Edit card", exact: true })
        .locator('[data-slot="dialog-body"]')
        .evaluate((element) => {
            element.scrollTop = 0;
        });
    await page.screenshot({
        path: testInfo.outputPath("edit-card.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: editedName, exact: true }),
    ).toBeVisible();
    const changedImage = page.getByRole("img", {
        name: `Image 2 of ${editedName}`,
        exact: true,
    });
    await expect(changedImage).toHaveAttribute("src", /\?v=1$/);
    await expect
        .poll(() =>
            changedImage.evaluate(
                (image: HTMLImageElement) => image.naturalWidth,
            ),
        )
        .toBeGreaterThan(0);
    await page.screenshot({
        path: testInfo.outputPath("edited-card.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await expect(
        page.getByRole("button", { name: `Open ${editedName}`, exact: true }),
    ).toContainText("5 images");
    await page.reload();
    await page
        .getByRole("button", { name: `Open ${editedName}`, exact: true })
        .click();
    await expect
        .poll(() =>
            page
                .getByRole("img", { name: `Image 5 of ${editedName}` })
                .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    await page
        .getByRole("button", { name: "Delete card", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Delete card?", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await page.screenshot({
        path: testInfo.outputPath("delete-confirmation.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: editedName, exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Delete card", exact: true }),
    ).toBeFocused();
    await page
        .getByRole("button", { name: "Delete card", exact: true })
        .click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
        page.getByRole("heading", { name: "My cards (3)", exact: true }),
    ).toBeVisible();
    const names = [editedName, "Daily coffee", "Weekly groceries"];
    for (const [index, name] of names.entries()) {
        await page
            .getByRole("button", { name: `Open ${name}`, exact: true })
            .click();
        await page
            .getByRole("button", { name: "Delete card", exact: true })
            .click();
        const deleted = page.waitForResponse(
            (response) =>
                response.request().method() === "DELETE" &&
                response.url().includes("/api/cards/"),
        );
        await page
            .getByRole("button", { name: "Delete card", exact: true })
            .click();
        expect((await deleted).status()).toBe(200);
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(
            page.getByRole("button", { name: `Open ${name}`, exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole("heading", {
                name: `My cards (${2 - index})`,
                exact: true,
            }),
        ).toBeVisible();
        await expect(
            page.getByRole("button", { name: "Add card", exact: true }),
        ).toBeFocused();
    }
    await page.reload();
    await expect(
        page.getByRole("heading", { name: "My cards (0)", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText("No cards yet.", { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: /share|search/i }),
    ).toHaveCount(0);
    expect(browserErrors).toEqual([]);
});

test("images can be reordered before creation and while editing", async ({
    page,
}, testInfo) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            browserErrors.push(message.text());
        }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await register(page.request);
    const front = await syntheticImage();
    const back = await syntheticImage("Back");
    const extra = await syntheticImage("Extra");
    const reference = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Reference images", [front, back, extra]),
    });
    expect(reference.status()).toBe(201);
    const referenceId = (await reference.json()).card.id;
    const original: Buffer[] = [];
    for (const position of [1, 2, 3]) {
        original.push(
            await (
                await page.request.get(
                    `/api/cards/${referenceId}/images/${position}`,
                )
            ).body(),
        );
    }

    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Reordered images");
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles([front, back, extra]);
    const previews = page.getByRole("img", { name: /^Preview of image/ });
    for (const preview of await previews.all()) {
        await expect
            .poll(() =>
                preview.evaluate(
                    (image: HTMLImageElement) => image.naturalWidth,
                ),
            )
            .toBeGreaterThan(0);
    }
    const initialUrls = await previews.evaluateAll((images) =>
        images.map((image) => (image as HTMLImageElement).src),
    );
    await expect(
        page.getByRole("button", { name: "Move image 1 up", exact: true }),
    ).toBeDisabled();
    await expect(
        page.getByRole("button", { name: "Move image 3 down", exact: true }),
    ).toBeDisabled();
    await page
        .getByRole("button", { name: "Move image 3 up", exact: true })
        .click();
    // Keyboard interaction also moves the image while retaining its preview.
    await page
        .getByRole("button", { name: "Move image 1 down", exact: true })
        .focus();
    await page.keyboard.press("Enter");
    expect(
        await previews.evaluateAll((images) =>
            images.map((image) => (image as HTMLImageElement).src),
        ),
    ).toEqual([initialUrls[2], initialUrls[0], initialUrls[1]]);
    await expect(page.getByRole("status")).toHaveText(
        "Image 1 moved to position 2 of 3.",
    );
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page
        .getByRole("dialog")
        .locator('[data-slot="dialog-body"]')
        .evaluate((element) => {
            element.scrollTop = 0;
        });
    await page.screenshot({
        path: testInfo.outputPath("reorder-new-images.png"),
        fullPage: true,
        animations: "disabled",
    });
    const saving = page.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/cards"),
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    const saved = await saving;
    expect(saved.status()).toBe(201);
    const { card } = await saved.json();
    async function expectImages(expected: Buffer[]) {
        for (const [index, bytes] of expected.entries()) {
            expect(
                await (
                    await page.request.get(
                        `/api/cards/${card.id}/images/${index + 1}`,
                    )
                ).body(),
            ).toEqual(bytes);
        }
    }
    await expectImages([original[2], original[0], original[1]]);
    await page.reload();
    await page
        .getByRole("button", { name: "Open Reordered images", exact: true })
        .click();
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await page
        .getByRole("button", { name: "Move image 1 down", exact: true })
        .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectImages([original[2], original[0], original[1]]);
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card
            .revision,
    ).toBe(0);

    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await page
        .getByRole("button", { name: "Remove image 2", exact: true })
        .click();
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(front);
    await page
        .getByRole("button", { name: "Move image 3 up", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Move image 2 up", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Move image 3 up", exact: true })
        .click();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page
        .getByRole("dialog")
        .locator('[data-slot="dialog-body"]')
        .evaluate((element) => {
            element.scrollTop = 0;
        });
    await page.screenshot({
        path: testInfo.outputPath("reorder-saved-images.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Reordered images", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("img", {
            name: "Image 1 of Reordered images",
            exact: true,
        }),
    ).toHaveAttribute("src", /\?v=1$/);
    await expectImages(original);
    await page.reload();
    await page
        .getByRole("button", { name: "Open Reordered images", exact: true })
        .click();
    await expectImages(original);
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card,
    ).toMatchObject({ revision: 1, imageCount: 3 });
    expect(browserErrors).toEqual([]);
});

test("failed deletion keeps the card and allows retry", async ({
    page,
}, testInfo) => {
    await register(page.request);
    const created = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Retry card"),
    });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Retry card", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Delete card", exact: true })
        .click();
    let release!: () => void;
    let received!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
        received = resolve;
    });
    const path = `**/api/cards/${card.id}`;
    await page.route(path, async (route) => {
        received();
        await gate;
        await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
                error: "Couldn't delete the card. Try again.",
            }),
        });
    });
    try {
        await page
            .getByRole("button", { name: "Delete card", exact: true })
            .click();
        await pending;
        await expect(
            page.getByRole("button", { name: "Deleting...", exact: true }),
        ).toBeDisabled();
        await expect(
            page.getByRole("button", { name: "Cancel", exact: true }),
        ).toBeDisabled();
        await expect(
            page.getByRole("button", { name: "Close dialog", exact: true }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(
            page.getByRole("dialog", { name: "Delete card?", exact: true }),
        ).toBeVisible();
    } finally {
        release();
    }
    await expect(page.getByRole("alert")).toHaveText(
        "Couldn't delete the card. Try again.",
    );
    expect((await page.request.get(`/api/cards/${card.id}`)).status()).toBe(
        200,
    );
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page.screenshot({
        path: testInfo.outputPath("delete-error.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page.unroute(path);
    await page
        .getByRole("button", { name: "Delete card", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
        page.getByRole("button", { name: "Open Retry card", exact: true }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
        page.getByText("No cards yet.", { exact: true }),
    ).toBeVisible();
});

test("editing keeps drafts after failure and reloads after a conflict", async ({
    page,
}, testInfo) => {
    await register(page.request);
    const front = await syntheticImage();
    const back = await syntheticImage("Back");
    const extra = await syntheticImage("Extra");
    const created = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Edit retry", [front, back]),
    });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Edit retry", exact: true })
        .click();
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Saved after retry");
    await page
        .getByRole("button", { name: "Remove image 1", exact: true })
        .click();
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(extra);
    await page
        .getByRole("button", { name: "Move image 2 up", exact: true })
        .click();
    const reorderedPreviews = await page
        .getByRole("img", { name: /^Preview of image/ })
        .evaluateAll((images) =>
            images.map((image) => (image as HTMLImageElement).src),
        );
    let release!: () => void;
    let received!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const pending = new Promise<void>((resolve) => {
        received = resolve;
    });
    const path = `**/api/cards/${card.id}`;
    await page.route(path, async (route) => {
        received();
        await gate;
        await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
                error: "Couldn't save changes. Try again.",
            }),
        });
    });
    try {
        await page
            .getByRole("button", { name: "Save changes", exact: true })
            .click();
        await pending;
        for (const name of [
            "Saving...",
            "Cancel",
            "Close dialog",
            "Add images",
        ]) {
            await expect(
                page.getByRole("button", { name, exact: true }),
            ).toBeDisabled();
        }
        for (const button of await page
            .getByRole("button", { name: /^Move image/ })
            .all()) {
            await expect(button).toBeDisabled();
        }
        await page.keyboard.press("Escape");
        await expect(
            page.getByRole("dialog", { name: "Edit card", exact: true }),
        ).toBeVisible();
    } finally {
        release();
    }
    await expect(page.getByRole("alert")).toHaveText(
        "Couldn't save changes. Try again.",
    );
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Saved after retry",
    );
    await expect(
        page.getByRole("img", { name: /^Preview of image/ }),
    ).toHaveCount(2);
    expect(
        await page
            .getByRole("img", { name: /^Preview of image/ })
            .evaluateAll((images) =>
                images.map((image) => (image as HTMLImageElement).src),
            ),
    ).toEqual(reorderedPreviews);
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card,
    ).toMatchObject({ label: "Edit retry", revision: 0, imageCount: 2 });
    await page.unroute(path);
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Saved after retry", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Older draft");
    const elsewhere = await page.request.patch(`/api/cards/${card.id}`, {
        headers: { origin },
        multipart: editForm("Changed elsewhere", 1),
    });
    expect(elsewhere.status()).toBe(200);
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(page.getByRole("alert")).toHaveText(
        "This card changed. Close and reopen the editor before saving.",
    );
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Older draft",
    );
    await page
        .getByRole("dialog", { name: "Edit card", exact: true })
        .locator('[data-slot="dialog-body"]')
        .evaluate((element) => {
            element.scrollTop = 0;
        });
    await page.screenshot({
        path: testInfo.outputPath("edit-conflict.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Edit card", exact: true }).click();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Changed elsewhere",
    );
    await page.getByLabel("Card name", { exact: true }).fill("Fresh edit");
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Fresh edit", exact: true }),
    ).toBeVisible();
    await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
    await page.reload();
    await expect(
        page.getByRole("button", { name: "Open Fresh edit", exact: true }),
    ).toContainText("2 images");
});
