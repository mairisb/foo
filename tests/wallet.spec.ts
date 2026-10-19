import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
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
    rotationImage,
    expectImageRotation,
    perspectiveImage,
    expectPerspectiveColors,
} from "./helpers";

test.afterAll(cleanUp);

async function chooseCardAction(
    page: Page,
    action: "Edit card" | "Delete card",
) {
    await page
        .getByRole("button", { name: "Card actions", exact: true })
        .click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function dismissDialog(page: Page) {
    await page
        .getByRole("dialog")
        .getByRole("button", { name: /^(Close|Cancel)$/ })
        .click();
}

async function imageTransfer(
    page: Page,
    files: { name: string; mimeType: string; buffer: Buffer }[],
) {
    return page.evaluateHandle(
        (files) => {
            const transfer = new DataTransfer();
            for (const file of files) {
                const bytes = Uint8Array.from(atob(file.data), (character) =>
                    character.charCodeAt(0),
                );
                transfer.items.add(
                    new File([bytes], file.name, { type: file.mimeType }),
                );
            }
            return transfer;
        },
        files.map((file) => ({
            name: file.name,
            mimeType: file.mimeType,
            data: file.buffer.toString("base64"),
        })),
    );
}

test("clipboard images append when creating and editing cards", async ({
    page,
}, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const name = page.getByLabel("Card name", { exact: true });
    const previews = page.getByRole("img", { name: /^Preview of image/ });
    const front = await syntheticImage("Front", "jpeg");
    const back = await syntheticImage("Back");
    const extra = await syntheticImage("Extra", "webp");
    async function paste(files: (typeof front)[], target = dialog, text = "") {
        const clipboard = await imageTransfer(page, files);
        await clipboard.evaluate(
            (data, text) => data.setData("text/plain", text),
            text,
        );
        try {
            return await target.evaluate((element, clipboardData) => {
                const event = new ClipboardEvent("paste", {
                    bubbles: true,
                    cancelable: true,
                    clipboardData,
                });
                element.dispatchEvent(event);
                return event.defaultPrevented;
            }, clipboard);
        } finally {
            await clipboard.dispose();
        }
    }
    await name.fill("Pasted images");
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(front);
    expect(
        await paste(
            [back, extra],
            name,
            "Do not put this image caption in the card name",
        ),
    ).toBe(true);
    await expect(name).toHaveValue("Pasted images");
    await expect(previews).toHaveCount(3);
    for (const preview of await previews.all()) {
        await expect
            .poll(() =>
                preview.evaluate(
                    (image: HTMLImageElement) => image.naturalWidth,
                ),
            )
            .toBeGreaterThan(0);
    }
    // Text-only clipboard events keep the input's normal paste behavior.
    expect(await paste([], name, "Text paste remains available")).toBe(false);
    expect(
        await paste(
            [
                {
                    name: "notes.txt",
                    mimeType: "text/plain",
                    buffer: Buffer.from("Text attachment"),
                },
            ],
            name,
            "Text",
        ),
    ).toBe(false);
    await expect(previews).toHaveCount(3);
    expect(
        await paste([
            back,
            { ...back, name: "unsupported.gif", mimeType: "image/gif" },
        ]),
    ).toBe(true);
    await expect(page.getByRole("alert")).toHaveText(
        "Choose JPG, PNG, or WebP images.",
    );
    await expect(previews).toHaveCount(3);
    const oversized = await page.evaluateHandle(() => {
        const clipboard = new DataTransfer();
        clipboard.items.add(
            new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
                type: "image/png",
            }),
        );
        return clipboard;
    });
    await dialog.evaluate((element, clipboardData) => {
        element.dispatchEvent(
            new ClipboardEvent("paste", {
                bubbles: true,
                cancelable: true,
                clipboardData,
            }),
        );
    }, oversized);
    await oversized.dispose();
    await expect(page.getByRole("alert")).toHaveText(
        "Each image must be 10 MB or smaller.",
    );
    await expect(previews).toHaveCount(3);
    // Footer controls are outside the form element but still accept image pastes.
    expect(
        await paste(
            [front],
            dialog.getByRole("button", { name: "Cancel", exact: true }),
        ),
    ).toBe(true);
    await expect(previews).toHaveCount(4);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page
        .getByRole("button", { name: "Adjust image 1 corners", exact: true })
        .click();
    await expect(dialog).toHaveAccessibleName("Adjust image 1 corners");
    expect(await paste([extra])).toBe(true);
    await dialog
        .getByRole("button", { name: "Cancel corner adjustment", exact: true })
        .click();
    await expect(dialog).toHaveAccessibleName("Add card");
    await expect(previews).toHaveCount(4);
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
    await dialog.locator('[data-slot="dialog-body"]').evaluate((body) => {
        body.scrollTop = 0;
    });
    await page.screenshot({
        path: testInfo.outputPath("clipboard-images.png"),
        animations: "disabled",
    });
    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => {
        releaseSave = resolve;
    });
    await page.route("**/api/cards", async (route) => {
        if (route.request().method() === "POST") {
            await gate;
        }
        await route.continue();
    });
    const saving = page.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/cards"),
    );
    try {
        await dialog
            .getByRole("button", { name: "Save card", exact: true })
            .click();
        await expect(
            dialog.getByRole("button", { name: "Saving...", exact: true }),
        ).toBeDisabled();
        expect(await paste([back])).toBe(true);
        await expect(previews).toHaveCount(4);
    } finally {
        releaseSave();
    }
    const response = await saving;
    expect(response.status()).toBe(201);
    const { card } = await response.json();
    expect(card.imageCount).toBe(4);
    await page.unroute("**/api/cards");
    await expect(dialog).toHaveCount(0);
    const original = await (
        await page.request.get(`/api/cards/${card.id}/images/1`)
    ).body();
    await page.reload();
    await page
        .getByRole("button", { name: "Open Pasted images", exact: true })
        .click();
    await chooseCardAction(page, "Edit card");
    await expect(dialog).toHaveAccessibleName("Edit card");
    expect(await paste([extra])).toBe(true);
    await expect(previews).toHaveCount(5);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveAccessibleName("Pasted images");
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card
            .imageCount,
    ).toBe(4);
    await chooseCardAction(page, "Edit card");
    await expect(dialog).toHaveAccessibleName("Edit card");
    expect(await paste([extra])).toBe(true);
    await dialog
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(dialog).toHaveAccessibleName("Pasted images");
    await page.reload();
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card,
    ).toMatchObject({ imageCount: 5, revision: 1 });
    expect(
        await (await page.request.get(`/api/cards/${card.id}/images/1`)).body(),
    ).toEqual(original);
    expect(errors).toEqual([]);
});

test("images can be dropped when creating and editing cards", async ({
    page,
}, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Dropped images");
    const front = await syntheticImage("Front", "jpeg");
    const back = await syntheticImage("Back");
    const extra = await syntheticImage("Extra", "webp");
    const transfer = await imageTransfer(page, [back, extra]);
    const dropZone = page.getByRole("group", {
        name: "Image upload",
        exact: true,
    });
    const previews = page.getByRole("img", { name: /^Preview of image/ });
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(front);
    await dropZone.dispatchEvent("dragenter", { dataTransfer: transfer });
    await dropZone.dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(dropZone).toHaveAttribute("data-dragging", "true");
    // Moving over the button inside the drop area must keep its highlight.
    await dropZone
        .getByRole("button", { name: "Add images", exact: true })
        .dispatchEvent("dragenter", { dataTransfer: transfer });
    await dropZone.dispatchEvent("dragleave", { dataTransfer: transfer });
    await expect(dropZone).toHaveAttribute("data-dragging", "true");
    await page.screenshot({
        path: testInfo.outputPath("image-drop-area.png"),
        animations: "disabled",
    });
    await dropZone
        .getByRole("button", { name: "Add images", exact: true })
        .dispatchEvent("drop", { dataTransfer: transfer });
    await expect(dropZone).toHaveAttribute("data-dragging", "false");
    await expect(previews).toHaveCount(3);
    for (const preview of await previews.all()) {
        await expect
            .poll(() =>
                preview.evaluate(
                    (image: HTMLImageElement) => image.naturalWidth,
                ),
            )
            .toBeGreaterThan(0);
    }
    const outsideDropPrevented = await page
        .getByRole("heading", { name: "Add card", exact: true })
        .evaluate((heading, dataTransfer) => {
            return !heading.dispatchEvent(
                new DragEvent("drop", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer,
                }),
            );
        }, transfer);
    expect(outsideDropPrevented).toBe(true);
    await expect(previews).toHaveCount(3);
    const invalid = await imageTransfer(page, [
        front,
        {
            name: "notes.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Not an image"),
        },
    ]);
    await dropZone.dispatchEvent("drop", { dataTransfer: invalid });
    await expect(page.getByRole("alert")).toHaveText(
        "Choose JPG, PNG, or WebP images.",
    );
    await expect(previews).toHaveCount(3);
    await invalid.dispose();
    const oversized = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(
            new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
                type: "image/png",
            }),
        );
        return data;
    });
    await dropZone.dispatchEvent("drop", { dataTransfer: oversized });
    await expect(page.getByRole("alert")).toHaveText(
        "Each image must be 10 MB or smaller.",
    );
    await expect(previews).toHaveCount(3);
    await oversized.dispose();
    const another = await imageTransfer(page, [front]);
    await dropZone.dispatchEvent("drop", { dataTransfer: another });
    await expect(previews).toHaveCount(4);
    await expect(page.getByRole("alert")).toHaveCount(0);
    let releaseSave!: () => void;
    const heldSave = new Promise<void>((resolve) => {
        releaseSave = resolve;
    });
    await page.route("**/api/cards", async (route) => {
        if (route.request().method() === "POST") {
            await heldSave;
        }
        await route.continue();
    });
    const saving = page.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/cards"),
    );
    try {
        await page
            .getByRole("button", { name: "Save card", exact: true })
            .click();
        await expect(dropZone).toHaveAttribute("aria-disabled", "true");
        await dropZone.dispatchEvent("dragover", { dataTransfer: another });
        await expect(
            dropZone.getByRole("button", { name: "Add images", exact: true }),
        ).toBeDisabled();
        await dropZone.dispatchEvent("drop", { dataTransfer: another });
        await expect(previews).toHaveCount(4);
    } finally {
        releaseSave();
    }
    const savedResponse = await saving;
    expect(savedResponse.status()).toBe(201);
    const { card } = await savedResponse.json();
    expect(card.imageCount).toBe(4);
    await page.unroute("**/api/cards");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const original: Buffer[] = [];
    for (const position of [1, 2, 3, 4]) {
        original.push(
            await (
                await page.request.get(
                    `/api/cards/${card.id}/images/${position}`,
                )
            ).body(),
        );
    }
    await transfer.dispose();
    await another.dispose();
    await page.reload();
    await page
        .getByRole("button", { name: "Open Dropped images", exact: true })
        .click();
    await chooseCardAction(page, "Edit card");
    const editTransfer = await imageTransfer(page, [extra]);
    await dropZone.dispatchEvent("drop", { dataTransfer: editTransfer });
    await expect(previews).toHaveCount(5);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Dropped images", exact: true }),
    ).toBeVisible();
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card
            .imageCount,
    ).toBe(4);
    await chooseCardAction(page, "Edit card");
    await dropZone.dispatchEvent("drop", { dataTransfer: editTransfer });
    await expect(previews).toHaveCount(5);
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Dropped images", exact: true }),
    ).toBeVisible();
    await editTransfer.dispose();
    await page.reload();
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card,
    ).toMatchObject({ imageCount: 5, revision: 1 });
    for (const [index, image] of original.entries()) {
        expect(
            await (
                await page.request.get(
                    `/api/cards/${card.id}/images/${index + 1}`,
                )
            ).body(),
        ).toEqual(image);
    }
    expect(errors).toEqual([]);
});

async function selectDocumentCorners(page: Page) {
    const positions: [string, number, number][] = [
        ["Top-left corner", 6, 2],
        ["Top-right corner", -3, 5],
        ["Bottom-right corner", -6, -1],
        ["Bottom-left corner", 2, -5],
    ];
    // Place the synthetic document's four corners from the default inset,
    // using the same keyboard controls available to the user (10px steps).
    for (const [name, horizontal, vertical] of positions) {
        const handle = page.getByRole("button", { name, exact: true });
        for (let step = 0; step < Math.abs(horizontal); step++) {
            await handle.press(
                horizontal > 0 ? "Shift+ArrowRight" : "Shift+ArrowLeft",
            );
        }
        for (let step = 0; step < Math.abs(vertical); step++) {
            await handle.press(
                vertical > 0 ? "Shift+ArrowDown" : "Shift+ArrowUp",
            );
        }
    }
}

test("Scanic straightens document corners during upload and editing", async ({
    page,
}, testInfo) => {
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    await page.goto("/");
    const appOrigin = new URL(page.url()).origin;
    page.on("request", (request) => {
        if (
            /^https?:/.test(request.url()) &&
            new URL(request.url()).origin !== appOrigin
        ) {
            externalRequests.push(request.url());
        }
    });
    const documentImage = await perspectiveImage();
    const other = await rotationImage();
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Straightened card");
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles([documentImage, other]);
    const adjust = page.getByRole("button", {
        name: "Adjust image 1 corners",
        exact: true,
    });
    await expect(adjust).toHaveText("");
    await expect(adjust.locator("svg")).toBeVisible();
    await adjust.scrollIntoViewIfNeeded();
    const rotationButton = page.getByRole("button", {
        name: "Rotate image 1 right",
        exact: true,
    });
    expect((await adjust.boundingBox())!.y).toBeCloseTo(
        (await rotationButton.boundingBox())!.y,
        1,
    );
    await page.screenshot({
        path: testInfo.outputPath("image-toolbar.png"),
        animations: "disabled",
    });
    await page
        .getByRole("button", { name: "Adjust image 1 corners", exact: true })
        .click();
    const section = page.getByRole("dialog", {
        name: "Adjust image 1 corners",
        exact: true,
    });
    await expect(
        section.getByRole("button", { name: "Top-left corner", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Save card", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Card name", { exact: true })).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
        section.getByRole("button", { name: /detection/i }),
    ).toHaveCount(0);
    await expect(section.locator('[data-slot="scan-candidate"]')).toHaveCount(
        0,
    );
    // Escape exits this tool and preserves the card form and original image.
    await section
        .getByRole("button", { name: "Top-left corner", exact: true })
        .press("Escape");
    await expect(section).toHaveCount(0);
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Straightened card",
    );
    await expect(
        page.getByRole("button", {
            name: "Adjust image 1 corners",
            exact: true,
        }),
    ).toBeFocused();
    await page
        .getByRole("button", { name: "Adjust image 1 corners", exact: true })
        .click();
    const handle = section.getByRole("button", {
        name: "Top-left corner",
        exact: true,
    });
    await expect(handle).toBeVisible();
    // Browser/Android Back closes only the scanner and retains the form draft.
    await page.goBack();
    await expect(section).toHaveCount(0);
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Straightened card",
    );
    await page.goForward();
    await expect(handle).toBeVisible();
    // Editor and actions fit the modal at both phone orientations, without a
    // scrolling body or an introductory paragraph above the image.
    const expectFittedEditor = async () => {
        const body = section.locator('[data-slot="dialog-body"]');
        const editor = body.locator('[data-slot="perspective-editor"]');
        await expect(editor).toBeInViewport({ ratio: 1 });
        await expect
            .poll(async () =>
                body.evaluate(
                    (element) => element.scrollHeight - element.clientHeight,
                ),
            )
            .toBeLessThanOrEqual(1);
        // Sample both rectangles in one frame while the popup finishes its
        // viewport-resize transition.
        await expect
            .poll(() =>
                body.evaluate((element) => {
                    const bodyBounds = element.getBoundingClientRect();
                    const editorBounds = element
                        .querySelector('[data-slot="perspective-editor"]')!
                        .getBoundingClientRect();
                    return Math.max(
                        Math.abs(editorBounds.height - bodyBounds.height),
                        Math.abs(editorBounds.width - bodyBounds.width),
                    );
                }),
            )
            .toBeLessThan(0.5);
        await expect(
            section.getByRole("button", { name: "Apply", exact: true }),
        ).toBeInViewport({ ratio: 1 });
        for (const label of ["Reset corners", "Preview"]) {
            const button = section
                .locator('[data-slot="dialog-header"]')
                .getByRole("button", { name: label, exact: true });
            await expect(button).toHaveText("");
            await expect(button.locator("svg")).toBeVisible();
            await expect(button).toBeInViewport({ ratio: 1 });
        }
        await expect(
            body.getByText("Drag the four corners onto the document.", {
                exact: false,
            }),
        ).toHaveCount(0);
    };
    await expectFittedEditor();
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 844, height: 390 });
    await expectFittedEditor();
    await page.screenshot({
        path: testInfo.outputPath("scanic-landscape.png"),
        animations: "disabled",
    });
    await page.setViewportSize(originalViewport);
    await expectFittedEditor();
    await page.screenshot({
        path: testInfo.outputPath("scanic-dialog.png"),
        animations: "disabled",
    });
    await expect(section.getByRole("status")).toHaveText(
        "Move the four corners into place.",
    );
    await handle.scrollIntoViewIfNeeded();
    const before = await handle.getAttribute("style");
    const bounds = (await handle.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
            {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
                id: 1,
            },
        ],
    });
    await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
            {
                x: bounds.x + bounds.width / 2 + 14,
                y: bounds.y + bounds.height / 2 + 10,
                id: 1,
            },
        ],
    });
    await touch.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
    });
    await expect.poll(() => handle.getAttribute("style")).not.toBe(before);
    await touch.detach();
    await section
        .getByRole("button", { name: "Reset corners", exact: true })
        .click();
    await expect(handle).toHaveAttribute("style", before!);
    await handle.press("Shift+ArrowRight");
    await expect.poll(() => handle.getAttribute("style")).not.toBe(before);
    await section
        .getByRole("button", { name: "Reset corners", exact: true })
        .click();
    await expect(handle).toHaveAttribute("style", before!);
    // Reset restores the default inset; manually place the photographed
    // document's corners before verifying the resulting rectangle.
    await selectDocumentCorners(page);
    const manualSelection = await handle.getAttribute("style");
    expect(manualSelection).not.toBe(before);
    await section.getByRole("button", { name: "Preview", exact: true }).click();
    const previewDialog = page.getByRole("dialog", {
        name: "Image 1 preview",
        exact: true,
    });
    const preview = previewDialog.getByRole("img", {
        name: "Straightened preview",
        exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(preview).toBeInViewport({ ratio: 1 });
    await expect(
        previewDialog.getByRole("heading", {
            name: "Image 1 preview",
            exact: true,
        }),
    ).toBeInViewport();
    await expect(
        previewDialog
            .locator('[data-slot="dialog-footer"]')
            .getByRole("button", { name: "Close preview", exact: true }),
    ).toBeInViewport();
    await expect(
        previewDialog.getByRole("button", { name: "Apply", exact: true }),
    ).toHaveCount(0);
    await expect(
        previewDialog.getByRole("button", {
            name: "Top-left corner",
            exact: true,
        }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect
        .poll(() =>
            previewDialog
                .locator('[data-slot="dialog-body"]')
                .evaluate(
                    (element) => element.scrollHeight - element.clientHeight,
                ),
        )
        .toBeLessThanOrEqual(1);
    const previewBytes = Buffer.from(
        await preview.evaluate(
            (canvas: HTMLCanvasElement) =>
                canvas.toDataURL("image/png").split(",")[1],
        ),
        "base64",
    );
    const previewSize = await expectPerspectiveColors(previewBytes);
    expect(previewSize.width).toBeGreaterThan(250);
    expect(previewSize.width).toBeLessThan(285);
    expect(previewSize.height).toBeGreaterThan(175);
    expect(previewSize.height).toBeLessThan(210);
    await page.screenshot({
        path: testInfo.outputPath("perspective-preview.png"),
        animations: "disabled",
    });
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
    // Preview is a history layer. Returning retains the same mounted editor
    // and its exact selection, and Forward restores the result.
    await page.goBack();
    await expect(handle).toHaveAttribute("style", manualSelection!);
    await expect(
        section.getByRole("button", { name: "Preview", exact: true }),
    ).toBeFocused();
    await handle.press("Shift+ArrowRight");
    await expect
        .poll(() => handle.getAttribute("style"))
        .not.toBe(manualSelection);
    const changedSelection = await handle.getAttribute("style");
    await page.goForward();
    await expect(preview).toBeVisible();
    expect(
        await preview.evaluate(
            (canvas: HTMLCanvasElement) =>
                canvas.toDataURL("image/png").split(",")[1],
        ),
    ).not.toBe(previewBytes.toString("base64"));
    await previewDialog
        .getByRole("button", { name: "Close preview", exact: true })
        .press("Escape");
    await expect(handle).toHaveAttribute("style", changedSelection!);
    await section
        .getByRole("button", { name: "Reset corners", exact: true })
        .click();
    await expect(handle).toHaveAttribute("style", before!);
    await selectDocumentCorners(page);
    await section.getByRole("button", { name: "Preview", exact: true }).click();
    await previewDialog
        .getByRole("button", { name: "Close preview", exact: true })
        .click();
    await expect(handle).toHaveAttribute("style", manualSelection!);
    await expectFittedEditor();
    await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback) {
            HTMLCanvasElement.prototype.toBlob = original;
            callback(null);
        };
    });
    await section.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(section.getByRole("alert")).toHaveText(
        "Couldn't prepare the adjusted image. Try a smaller selection.",
    );
    await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.toBlob;
        const taskWindow = window as typeof window & {
            finishPerspective?: () => void;
        };
        HTMLCanvasElement.prototype.toBlob = function (
            callback,
            type,
            quality,
        ) {
            HTMLCanvasElement.prototype.toBlob = original;
            taskWindow.finishPerspective = () =>
                original.call(this, callback, type, quality);
        };
    });
    try {
        await section
            .getByRole("button", { name: "Apply", exact: true })
            .click();
        await expect(section.getByRole("status")).toHaveText(
            "Straightening image...",
        );
        await expect(
            section.getByRole("button", {
                name: "Cancel corner adjustment",
                exact: true,
            }),
        ).toBeDisabled();
        await expect(
            section.getByRole("button", {
                name: "Top-left corner",
                exact: true,
            }),
        ).toBeDisabled();
        const view = await page.evaluate(() => window.history.state.fooDialog);
        await page.goBack();
        await expect
            .poll(() => page.evaluate(() => window.history.state.fooDialog))
            .toBe(view);
        await expect(section).toBeVisible();
    } finally {
        await page.evaluate(() => {
            const taskWindow = window as typeof window & {
                finishPerspective?: () => void;
            };
            taskWindow.finishPerspective?.();
            delete taskWindow.finishPerspective;
        });
    }
    await expect(section).toHaveCount(0);
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
    await page
        .getByRole("button", { name: "Move image 1 down", exact: true })
        .click();
    const saving = page.waitForResponse(
        (response) =>
            response.url().endsWith("/api/cards") &&
            response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    const { card } = await (await saving).json();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const path = `/api/cards/${card.id}`;
    const originalOther = await (
        await page.request.get(`${path}/images/1`)
    ).body();
    const originalDocument = await (
        await page.request.get(`${path}/images/2`)
    ).body();
    expect(await expectPerspectiveColors(originalDocument)).toEqual(
        previewSize,
    );
    await page.reload();
    await page
        .getByRole("button", { name: "Open Straightened card", exact: true })
        .click();
    async function adjustSaved() {
        await chooseCardAction(page, "Edit card");
        await page
            .getByRole("button", { name: "Rotate image 2 right", exact: true })
            .click();
        await page
            .getByRole("button", {
                name: "Adjust image 2 corners",
                exact: true,
            })
            .click();
        const tool = page.getByRole("dialog", {
            name: "Adjust image 2 corners",
            exact: true,
        });
        await expect(
            tool.getByRole("button", { name: "Apply", exact: true }),
        ).toBeEnabled();
        const savedHandle = tool.getByRole("button", {
            name: "Top-left corner",
            exact: true,
        });
        const startingSelection = await savedHandle.getAttribute("style");
        await savedHandle.press("Shift+ArrowRight");
        await expect
            .poll(() => savedHandle.getAttribute("style"))
            .not.toBe(startingSelection);
        await tool.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(tool).toHaveCount(0);
    }
    await adjustSaved();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Straightened card", exact: true }),
    ).toBeVisible();
    expect(await (await page.request.get(`${path}/images/2`)).body()).toEqual(
        originalDocument,
    );
    await adjustSaved();
    await page
        .getByRole("button", { name: "Move image 2 up", exact: true })
        .click();
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(other);
    const draftUrl = await page
        .getByRole("img", { name: "Preview of image 1", exact: true })
        .getAttribute("src");
    await page.route(`**${path}`, (route) =>
        route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Try saving again." }),
        }),
    );
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(page.getByRole("alert")).toHaveText("Try saving again.");
    await expect(
        page.getByRole("img", { name: "Preview of image 1", exact: true }),
    ).toHaveAttribute("src", draftUrl!);
    expect(await (await page.request.get(`${path}/images/2`)).body()).toEqual(
        originalDocument,
    );
    await page.unroute(`**${path}`);
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Straightened card", exact: true }),
    ).toBeVisible();
    await page.reload();
    const editedSize = await expectPerspectiveColors(
        await (await page.request.get(`${path}/images/1`)).body(),
        true,
    );
    expect(editedSize.height).toBeGreaterThan(editedSize.width);
    expect(await (await page.request.get(`${path}/images/2`)).body()).toEqual(
        originalOther,
    );
    expect((await (await page.request.get(path)).json()).card).toMatchObject({
        revision: 1,
        imageCount: 3,
    });
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
});

test("Scanic adjusts blank images manually and cancels without changes", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("No outline");
    const originalBytes = await sharp({
        create: {
            width: 400,
            height: 300,
            channels: 3,
            background: "#ffffff",
        },
    })
        .png()
        .toBuffer();
    await page.getByLabel("Images (optional)", { exact: true }).setInputFiles({
        name: "blank.png",
        mimeType: "image/png",
        buffer: originalBytes,
    });
    const section = page.getByRole("dialog", {
        name: "Adjust image 1 corners",
        exact: true,
    });
    for (const dismiss of ["Escape", "Cancel"]) {
        await page
            .getByRole("button", {
                name: "Adjust image 1 corners",
                exact: true,
            })
            .click();
        await expect(section.getByRole("status")).toHaveText(
            "Move the four corners into place.",
        );
        const handle = section.getByRole("button", {
            name: "Top-left corner",
            exact: true,
        });
        const before = await handle.getAttribute("style");
        await handle.press("Shift+ArrowRight");
        await expect.poll(() => handle.getAttribute("style")).not.toBe(before);
        await section
            .getByRole("button", { name: "Preview", exact: true })
            .click();
        await expect(
            page
                .getByRole("dialog", { name: "Image 1 preview", exact: true })
                .getByRole("img", {
                    name: "Straightened preview",
                    exact: true,
                }),
        ).toBeVisible();
        await page
            .getByRole("button", { name: "Close preview", exact: true })
            .click();
        if (dismiss === "Escape") {
            await handle.press("Escape");
        } else {
            await section
                .getByRole("button", {
                    name: "Cancel corner adjustment",
                    exact: true,
                })
                .click();
        }
        await expect(section).toHaveCount(0);
        const bytes = await page
            .getByRole("img", { name: "Preview of image 1", exact: true })
            .evaluate(async (image: HTMLImageElement) =>
                Array.from(
                    new Uint8Array(
                        await (await fetch(image.src)).arrayBuffer(),
                    ),
                ),
            );
        expect(Buffer.from(bytes)).toEqual(originalBytes);
    }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
    expect(errors).toEqual([]);
    // Forward can reopen the empty form after cancellation; an old scanner
    // entry for a discarded upload must return to that form without an error.
    await page.goForward();
    await expect(
        page.getByRole("dialog", { name: "Add card", exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect
        .poll(() => page.evaluate(() => window.history.state.fooDialog))
        .toBe("add");
    await expect(
        page.getByRole("button", {
            name: "Adjust image 1 corners",
            exact: true,
        }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("images can be rotated before creation and while editing", async ({
    page,
}, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    const image = await rotationImage();
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Rotation preview");
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(image);
    const preview = page.getByRole("img", {
        name: "Preview of image 1",
        exact: true,
    });
    await expect
        .poll(() =>
            preview.evaluate(
                (element: HTMLImageElement) => element.naturalWidth,
            ),
        )
        .toBe(240);
    const originalUrl = await preview.getAttribute("src");
    for (let index = 0; index < 4; index++) {
        await page
            .getByRole("button", { name: "Rotate image 1 right", exact: true })
            .click();
    }
    await expect
        .poll(() =>
            preview.evaluate((element) => {
                const matrix = new DOMMatrixReadOnly(
                    getComputedStyle(element).transform,
                );
                return [matrix.a, matrix.b, matrix.c, matrix.d];
            }),
        )
        .toEqual([1, 0, 0, 1]);
    await page
        .getByRole("button", { name: "Rotate image 1 left", exact: true })
        .click();
    await expect
        .poll(() =>
            preview.evaluate(
                (element) =>
                    element.getBoundingClientRect().height >
                    element.getBoundingClientRect().width,
            ),
        )
        .toBe(true);
    await expect(preview).toHaveAttribute("src", originalUrl!);
    await page
        .getByRole("button", { name: "Rotate image 1 right", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Rotate image 1 right", exact: true })
        .click();
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(image);
    await page
        .getByRole("button", { name: "Move image 1 down", exact: true })
        .click();
    await page.screenshot({
        path: testInfo.outputPath("rotate-upload.png"),
        animations: "disabled",
    });
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
    const saving = page.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            response.url().endsWith("/api/cards"),
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    const { card } = await (await saving).json();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const originals: Buffer[] = [];
    for (const [index, rotation] of ([0, 90] as const).entries()) {
        const bytes = await (
            await page.request.get(`/api/cards/${card.id}/images/${index + 1}`)
        ).body();
        await expectImageRotation(bytes, rotation);
        originals.push(bytes);
    }
    await page.reload();
    await page
        .getByRole("button", { name: "Open Rotation preview", exact: true })
        .click();
    async function changeDraft() {
        await chooseCardAction(page, "Edit card");
        await page
            .getByRole("button", { name: "Rotate image 1 left", exact: true })
            .click();
        await page
            .getByRole("button", { name: "Remove image 2", exact: true })
            .click();
        await page
            .getByLabel("Images (optional)", { exact: true })
            .setInputFiles(image);
        await page
            .getByRole("button", { name: "Rotate image 2 right", exact: true })
            .click();
        await page
            .getByRole("button", { name: "Move image 2 up", exact: true })
            .click();
    }
    await changeDraft();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("dialog", { name: "Rotation preview", exact: true }),
    ).toBeVisible();
    for (const [index, bytes] of originals.entries()) {
        expect(
            await (
                await page.request.get(
                    `/api/cards/${card.id}/images/${index + 1}`,
                )
            ).body(),
        ).toEqual(bytes);
    }
    await changeDraft();
    await page.screenshot({
        path: testInfo.outputPath("rotate-edit.png"),
        animations: "disabled",
    });
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Rotation preview", exact: true }),
    ).toBeVisible();
    await page.reload();
    for (const [index, rotation] of ([90, 270] as const).entries()) {
        await expectImageRotation(
            await (
                await page.request.get(
                    `/api/cards/${card.id}/images/${index + 1}`,
                )
            ).body(),
            rotation,
        );
        await expect
            .poll(() =>
                page
                    .getByRole("img", {
                        name: `Image ${index + 1} of Rotation preview`,
                        exact: true,
                    })
                    .evaluate(
                        (element: HTMLImageElement) => element.naturalHeight,
                    ),
            )
            .toBe(240);
    }
    expect(errors).toEqual([]);
});

test("browser Back closes cards and keeps dialog history consistent", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") {
            errors.push(message.text());
        }
    });
    await register(page.request);
    const created = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Back button card"),
    });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    // A real preceding page verifies that Back can leave the wallet once closed.
    await page.goto("/manifest.webmanifest");
    await page.goto("/");
    await expect(
        page.getByRole("heading", { name: "My cards (1)", exact: true }),
    ).toBeVisible();
    const walletUrl = page.url();
    const historyLength = await page.evaluate(() => window.history.length);
    await page.evaluate(() => {
        document.documentElement.dataset.navigationTest = "same-document";
    });
    for (const method of ["back", "close", "escape"]) {
        await page
            .getByRole("button", { name: "Open Back button card", exact: true })
            .click();
        await expect(
            page.getByRole("dialog", { name: "Back button card", exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => window.history.length)).toBe(
            historyLength + 1,
        );
        if (method === "back") {
            await page.goBack();
        } else if (method === "close") {
            await dismissDialog(page);
        } else {
            await page.keyboard.press("Escape");
        }
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page).toHaveURL(walletUrl);
        await expect(page.locator("html")).toHaveAttribute(
            "data-navigation-test",
            "same-document",
        );
        await expect(
            page.getByRole("button", {
                name: "Open Back button card",
                exact: true,
            }),
        ).toBeFocused();
    }
    await page.goBack();
    await expect(page).toHaveURL(/\/manifest\.webmanifest$/);
    await page.goForward();
    await expect(page).toHaveURL(walletUrl);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goForward();
    await expect(
        page.getByRole("dialog", { name: "Back button card", exact: true }),
    ).toBeVisible();

    await chooseCardAction(page, "Edit card");
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Discard this draft");
    await page.goBack();
    await expect(
        page.getByRole("dialog", { name: "Back button card", exact: true }),
    ).toBeVisible();
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card
            .label,
    ).toBe("Back button card");
    await page.goForward();
    await expect(
        page.getByRole("dialog", { name: "Edit card", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Back button card",
    );
    await page.getByLabel("Card name", { exact: true }).fill("Saved with Back");
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Saved with Back", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByRole("dialog", { name: "Saved with Back", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goForward();
    await expect(
        page.getByRole("dialog", { name: "Saved with Back", exact: true }),
    ).toBeVisible();
    await chooseCardAction(page, "Delete card");
    await expect(
        page.getByRole("dialog", { name: "Delete card?", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await page.request.get(`/api/cards/${card.id}`)).status()).toBe(
        200,
    );
    await page.goForward();
    await expect(
        page.getByRole("dialog", { name: "Saved with Back", exact: true }),
    ).toBeVisible();
    await chooseCardAction(page, "Delete card");
    await page
        .getByRole("button", { name: "Delete card", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
        page.getByText("No cards yet.", { exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
        page.getByText("No cards yet.", { exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Unsaved card");
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
    await page.goForward();
    await expect(
        page.getByRole("dialog", { name: "Add card", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue("");
    await dismissDialog(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
});
test("modal headers, card menu, and footer controls stay visible while scrolling", async ({
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

    async function checkPinnedHeader(
        title: string,
        screenshot: string,
        hasActions = false,
    ) {
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        await expect(dialog).toBeVisible();
        const header = dialog.locator('[data-slot="dialog-header"]');
        const body = dialog.locator('[data-slot="dialog-body"]');
        const footer = dialog.locator('[data-slot="dialog-footer"]');
        const close = footer.getByRole("button", {
            name: hasActions ? "Close" : "Cancel",
            exact: true,
        });
        await expect(dialog.locator('[data-slot="dialog-close"]')).toHaveCount(
            0,
        );
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
        const headerTop = await header.evaluate(
            (element) => element.getBoundingClientRect().top,
        );
        const footerTop = await footer.evaluate(
            (element) => element.getBoundingClientRect().top,
        );
        const actions = header.getByRole("button", {
            name: "Card actions",
            exact: true,
        });
        const actionsTop = hasActions
            ? await actions.evaluate(
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
            await footer.evaluate(
                (element) => element.getBoundingClientRect().top,
            ),
        ).toBeCloseTo(footerTop, 1);
        await expect(close).toBeInViewport();
        expect(
            await close.evaluate(
                (element) => element.getBoundingClientRect().height,
            ),
        ).toBeGreaterThanOrEqual(44);
        if (hasActions) {
            await expect(actions).toBeInViewport();
            await expect(actions.locator("svg")).toBeVisible();
            await expect(actions).toHaveText("");
            expect(
                await actions.evaluate(
                    (element) => element.getBoundingClientRect().top,
                ),
            ).toBeCloseTo(actionsTop, 1);
            expect(
                await actions.evaluate(
                    (element) => element.getBoundingClientRect().height,
                ),
            ).toBeGreaterThanOrEqual(44);
        } else {
            await expect(header.getByRole("button")).toHaveCount(0);
            await expect(
                footer.getByRole("button", { name: /^Save/ }),
            ).toBeInViewport();
        }
        const bodyBottom = await body.evaluate(
            (element) => element.getBoundingClientRect().bottom,
        );
        expect(footerTop).toBeGreaterThanOrEqual(bodyBottom - 1);
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
    // Geometry checks measure scrolling after opening, independently of zoom.
    await page.addStyleTag({
        content:
            '[data-slot="dialog-content"] { animation: none !important; transition: none !important; }',
    });
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Unsaved draft");
    await page
        .getByLabel("Images (optional)", { exact: true })
        .setInputFiles(images);
    await checkPinnedHeader("Add card", "sticky-add-header.png");
    await dismissDialog(page);
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
    await checkPinnedHeader(title, "sticky-card-header.png", true);
    const actions = page.getByRole("button", {
        name: "Card actions",
        exact: true,
    });
    const historyLength = await page.evaluate(() => window.history.length);
    await actions.focus();
    await page.keyboard.press("ArrowDown");
    await expect(
        page.getByRole("menuitem", { name: "Edit card", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
        page.getByRole("menuitem", { name: "Delete card", exact: true }),
    ).toBeFocused();
    await page.screenshot({
        path: testInfo.outputPath("card-actions-menu.png"),
        animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(actions).toBeFocused();
    await expect(
        page.getByRole("dialog", { name: title, exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.history.length)).toBe(
        historyLength,
    );
    await actions.click();
    await page.getByRole("heading", { name: title, exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(
        page.getByRole("dialog", { name: title, exact: true }),
    ).toBeVisible();
    await chooseCardAction(page, "Edit card");
    await checkPinnedHeader("Edit card", "sticky-edit-header.png");
    await dismissDialog(page);
    await expect(
        page.getByRole("dialog", { name: title, exact: true }),
    ).toBeVisible();
    await chooseCardAction(page, "Delete card");
    await expect(
        page.getByRole("dialog", { name: "Delete card?", exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
        page.getByRole("button", { name: "Card actions", exact: true }),
    ).toBeFocused();
    await dismissDialog(page);
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
    await dismissDialog(page);
    await page.getByRole("button", { name: "Open Daily coffee" }).click();
    await expect(
        page.getByRole("img", { name: "Image 1 of Daily coffee" }),
    ).toBeVisible();
    await dismissDialog(page);
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
    await dismissDialog(page);
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
    await chooseCardAction(page, "Edit card");
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
    await chooseCardAction(page, "Edit card");
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
    await dismissDialog(page);
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
    await chooseCardAction(page, "Delete card");
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
        page.getByRole("button", { name: "Card actions", exact: true }),
    ).toBeFocused();
    await chooseCardAction(page, "Delete card");
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
        await chooseCardAction(page, "Delete card");
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
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
    await chooseCardAction(page, "Edit card");
    await page
        .getByRole("button", { name: "Move image 1 down", exact: true })
        .click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectImages([original[2], original[0], original[1]]);
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card
            .revision,
    ).toBe(0);

    await chooseCardAction(page, "Edit card");
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
    await expect(
        page.getByRole("dialog", { name: "Reordered images", exact: true }),
    ).toBeVisible();
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
    await chooseCardAction(page, "Delete card");
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
        const view = await page.evaluate(() => window.history.state.fooDialog);
        await page.goBack();
        await expect
            .poll(() => page.evaluate(() => window.history.state.fooDialog))
            .toBe(view);
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
    await chooseCardAction(page, "Edit card");
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
    await page
        .getByRole("button", { name: "Rotate image 1 right", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Rotate image 2 left", exact: true })
        .click();
    const draftTransforms = await page
        .getByRole("img", { name: /^Preview of image/ })
        .evaluateAll((images) =>
            images.map((image) => getComputedStyle(image).transform),
        );
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
        for (const name of ["Saving...", "Cancel", "Add images"]) {
            await expect(
                page.getByRole("button", { name, exact: true }),
            ).toBeDisabled();
        }
        for (const button of await page
            .getByRole("button", { name: /^(Move|Rotate) image/ })
            .all()) {
            await expect(button).toBeDisabled();
        }
        const view = await page.evaluate(() => window.history.state.fooDialog);
        await page.goBack();
        await expect
            .poll(() => page.evaluate(() => window.history.state.fooDialog))
            .toBe(view);
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
        await page
            .getByRole("img", { name: /^Preview of image/ })
            .evaluateAll((images) =>
                images.map((image) => getComputedStyle(image).transform),
            ),
    ).toEqual(draftTransforms);
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
    await chooseCardAction(page, "Edit card");
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
    await chooseCardAction(page, "Edit card");
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
    await dismissDialog(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(
        page.getByRole("button", { name: "Open Fresh edit", exact: true }),
    ).toContainText("2 images");
});
