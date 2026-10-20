import { expect, test, type Page } from "@playwright/test";
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { prepareZXingModule, readBarcodes } from "zxing-wasm";
import { cardForm, cleanUp, origin, register, syntheticImage } from "./helpers";

test.afterAll(cleanUp);
const qrText = "Synthetic QR: Māris";
const barcodeText = "000123456789";

async function codedImage() {
    const qr = await bwipjs.toBuffer({
        bcid: "qrcode",
        text: qrText,
        scale: 5,
        padding: 15,
        backgroundcolor: "FFFFFF",
    });
    const barcode = await bwipjs.toBuffer({
        bcid: "code128",
        text: barcodeText,
        scale: 3,
        height: 18,
        padding: 15,
        backgroundcolor: "FFFFFF",
    });
    return {
        name: "synthetic-codes.png",
        mimeType: "image/png",
        buffer: await sharp({
            create: {
                width: 900,
                height: 600,
                channels: 3,
                background: "white",
            },
        })
            .composite([
                { input: qr, left: 50, top: 25 },
                { input: barcode, left: 50, top: 360 },
            ])
            .png()
            .toBuffer(),
    };
}

async function editCard(page: Page) {
    await page
        .getByRole("button", { name: "Card actions", exact: true })
        .click();
    await page
        .getByRole("menuitem", { name: "Edit card", exact: true })
        .click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Edit card");
}

async function expectModalCodeCards(page: Page) {
    const codes = page.getByRole("region", { name: "Extracted codes" });
    for (const card of await codes
        .getByRole("button", { name: /^Open code \d+ full size$/ })
        .all()) {
        const layout = await card.evaluate((element) => {
            // Read both widths in one frame while the parent dialog animates.
            const bounds = element.getBoundingClientRect();
            const region = element.closest('[aria-label="Extracted codes"]')!;
            return {
                width: bounds.width,
                height: bounds.height,
                availableWidth: region.getBoundingClientRect().width,
                contained:
                    element.scrollWidth <= element.clientWidth &&
                    element.scrollHeight <= element.clientHeight,
            };
        });
        expect(layout.width / layout.height).toBeCloseTo(8560 / 5398, 2);
        expect(layout.width).toBeCloseTo(layout.availableWidth, 0);
        expect(layout.contained).toBe(true);
        const image = card.getByRole("img");
        if (await image.count()) {
            expect(
                await image.evaluate(
                    (element) => getComputedStyle(element).objectFit,
                ),
            ).toBe("contain");
        }
    }
}

test("scanned codes fill the screen and close with X, Escape, or browser Back", async ({
    page,
    context,
}, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    const codes = [
        { format: "QRCode", text: qrText },
        { format: "Code128", text: barcodeText },
    ].map((code) => ({
        ...code,
        bytes: Buffer.from(code.text).toString("base64"),
        gs1: false,
    }));
    const form = cardForm("Full-screen codes", [await syntheticImage()]);
    form.set("codes", JSON.stringify(codes));
    const created = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: form,
    });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Full-screen codes", exact: true })
        .click();
    const detail = page.getByRole("dialog", {
        name: "Full-screen codes",
        exact: true,
    });
    const viewer = page.getByRole("dialog", { name: /^Code [12]:/ });
    const url = page.url();
    const pages = context.pages().length;
    const historyLength = await page.evaluate(() => history.length);
    await prepareZXingModule({
        overrides: {
            wasmBinary: await readFile(
                "node_modules/zxing-wasm/dist/full/zxing_full.wasm",
            ),
        },
        fireImmediately: true,
    });

    async function fitted(position: number, decode = false) {
        await expect(viewer).toBeVisible();
        await expect(
            viewer.getByRole("button", { name: "Close code", exact: true }),
        ).toBeFocused();
        await expect(viewer.getByRole("img")).toHaveCount(1);
        await expect(
            viewer.getByText(codes[position - 1].format, { exact: true }),
        ).toBeVisible();
        await expect(viewer.locator("code")).toHaveText(
            codes[position - 1].text,
        );
        await expect
            .poll(() =>
                viewer
                    .getByRole("img")
                    .evaluate(
                        (image: HTMLImageElement) =>
                            image.complete && image.naturalWidth > 0,
                    ),
            )
            .toBe(true);
        await expect
            .poll(() =>
                viewer.evaluate((element) => {
                    const bounds = element.getBoundingClientRect();
                    return (
                        Math.abs(bounds.x) < 1 &&
                        Math.abs(bounds.y) < 1 &&
                        Math.abs(bounds.width - innerWidth) < 1 &&
                        Math.abs(bounds.height - innerHeight) < 1 &&
                        element.scrollWidth <= element.clientWidth &&
                        element.scrollHeight <= element.clientHeight
                    );
                }),
            )
            .toBe(true);
        const image = viewer.getByRole("img");
        const codeCard = viewer.locator('[data-slot="full-screen-code-card"]');
        const cardBounds = (await codeCard.boundingBox())!;
        expect(cardBounds.width / cardBounds.height).toBeCloseTo(
            8560 / 5398,
            2,
        );
        expect(cardBounds.width).toBeGreaterThan(cardBounds.height);
        const viewport = page.viewportSize()!;
        const expectedWidth = Math.min(
            viewport.width,
            (viewport.height * 8560) / 5398,
        );
        expect(cardBounds.width).toBeCloseTo(expectedWidth, 0);
        expect(cardBounds.x).toBeCloseTo(
            (viewport.width - expectedWidth) / 2,
            0,
        );
        expect(cardBounds.y).toBeCloseTo(
            (viewport.height - cardBounds.height) / 2,
            0,
        );
        await expect(codeCard).toBeInViewport({ ratio: 1 });
        expect(
            await codeCard.evaluate(
                (element) =>
                    element.scrollHeight <= element.clientHeight &&
                    element.scrollWidth <= element.clientWidth,
            ),
        ).toBe(true);
        expect(
            await image.evaluate(
                (element) => getComputedStyle(element).objectFit,
            ),
        ).toBe("contain");
        const close = viewer.getByRole("button", {
            name: "Close code",
            exact: true,
        });
        const closeBounds = (await close.boundingBox())!;
        expect(closeBounds.height).toBeGreaterThanOrEqual(44);
        await expect(close).toBeInViewport({ ratio: 1 });
        await expect(
            viewer.locator(
                '[data-slot="dialog-header"], [data-slot="dialog-footer"]',
            ),
        ).toHaveCount(0);
        if (decode) {
            const screenshot = await page.screenshot({
                path: testInfo.outputPath(`full-screen-code-${position}.png`),
                scale: "css",
                animations: "disabled",
            });
            const detected = await readBarcodes(screenshot);
            expect(detected).toHaveLength(1);
            expect(Buffer.from(detected[0].bytes).toString("base64")).toBe(
                codes[position - 1].bytes,
            );
        }
        await expect(page).toHaveURL(url);
        expect(context.pages()).toHaveLength(pages);
    }

    for (const position of [1, 2]) {
        const opener = page.getByRole("button", {
            name: `Open code ${position} full size`,
            exact: true,
        });
        for (const method of ["x", "escape", "back"]) {
            await expect(opener).toBeVisible();
            await expectModalCodeCards(page);
            const border = await opener.evaluate((element) => {
                const style = getComputedStyle(element);
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = 1;
                const context = canvas.getContext("2d")!;
                context.fillStyle = style.borderTopColor;
                context.fillRect(0, 0, 1, 1);
                return {
                    width: parseFloat(style.borderTopWidth),
                    style: style.borderTopStyle,
                    color: [...context.getImageData(0, 0, 1, 1).data],
                };
            });
            expect(border.width).toBeGreaterThan(0);
            expect(border.style).toBe("solid");
            expect(border.color[3]).toBe(255);
            for (const channel of border.color.slice(0, 3)) {
                expect(channel).toBeGreaterThan(180);
                expect(channel).toBeLessThan(250);
            }
            await opener.scrollIntoViewIfNeeded();
            const scrollTop = await detail
                .locator('[data-slot="dialog-body"]')
                .evaluate((element) => element.scrollTop);
            if (method === "x") {
                await opener.locator("code").click();
            } else if (method === "escape") {
                await opener
                    .getByText(codes[position - 1].format, { exact: true })
                    .click();
            } else {
                const bounds = (await opener.boundingBox())!;
                await opener.click({
                    position: { x: bounds.width - 8, y: bounds.height - 8 },
                });
            }
            await fitted(position, method === "x");
            expect(await page.evaluate(() => history.state.fooDialog)).toBe(
                `card:${card.id}:code:${position}`,
            );
            expect(await page.evaluate(() => history.length)).toBe(
                historyLength + 1,
            );
            if (method === "x") {
                await viewer
                    .getByRole("button", { name: "Close code", exact: true })
                    .click();
            } else if (method === "escape") {
                await page.keyboard.press("Escape");
            } else {
                await page.goBack();
            }
            await expect(viewer).toHaveCount(0);
            await expect(detail).toBeVisible();
            await expect(opener).toBeFocused();
            expect(
                await detail
                    .locator('[data-slot="dialog-body"]')
                    .evaluate((element) => element.scrollTop),
            ).toBeCloseTo(scrollTop, 0);
        }
    }
    await page.goForward();
    await fitted(2);
    const viewport = page.viewportSize()!;
    await page.setViewportSize(
        viewport.width > viewport.height
            ? { width: 390, height: 844 }
            : { width: 844, height: 390 },
    );
    await fitted(2, true);
    await page.setViewportSize(viewport);
    await page.reload();
    await fitted(2);
    await page.keyboard.press("Escape");
    await expect(detail).toBeVisible();

    await page.evaluate((id) => {
        history.pushState(
            { ...history.state, fooDialog: `card:${id}:code:999` },
            "",
            location.href,
        );
        dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    }, card.id);
    await expect
        .poll(() => page.evaluate(() => history.state.fooDialog))
        .toBe(`card:${card.id}`);
    await expect(viewer).toHaveCount(0);
    await expect(detail).toBeVisible();

    await page
        .getByRole("button", { name: "Open code 1 full size", exact: true })
        .click();
    await fitted(1);
    await page.route("**/barcode-engine.wasm", (route) =>
        route.fulfill({ status: 503, body: "unavailable" }),
    );
    await page.reload();
    await expect(viewer.getByRole("alert")).toHaveText(
        "Couldn't display this code. Close and reopen the card to retry.",
    );
    await viewer
        .getByRole("button", { name: "Close code", exact: true })
        .click();
    await expect(detail).toBeVisible();
    await expect(viewer).toHaveCount(0);
    await page.unroute("**/barcode-engine.wasm");
    await page.reload();
    await expect(
        page.getByRole("button", {
            name: "Open code 1 full size",
            exact: true,
        }),
    ).toBeVisible();
    expect(errors).toEqual([]);
});

test("scanned barcodes and QR codes persist with the card and remain draft until Save", async ({
    page,
}, testInfo) => {
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
        if (/jsdelivr|unpkg|qrserver|iconify/.test(request.url())) {
            externalRequests.push(request.url());
        }
    });
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Scanned loyalty card");
    await page
        .locator('input[type="file"]')
        .setInputFiles([await codedImage(), await syntheticImage()]);
    await page
        .getByRole("button", { name: "Rotate image 1 right", exact: true })
        .click();
    const scan = page.getByRole("button", {
        name: "Scan image 1 for codes",
        exact: true,
    });
    await expect(scan.locator("svg")).toHaveAttribute(
        "data-material-symbol",
        "barcode-scanner-rounded",
    );
    await scan.scrollIntoViewIfNeeded();
    await page.screenshot({
        path: testInfo.outputPath("scan-image-toolbar.png"),
    });
    await scan.click();
    await expect(
        page.getByText("Added 2 codes. Save the card to keep them.", {
            exact: true,
        }),
    ).toBeVisible();
    const codes = page.getByRole("region", { name: "Extracted codes" });
    const codeImages = codes.getByRole("img");
    await expect(codeImages).toHaveCount(2);
    await expectModalCodeCards(page);
    await expect(codes.getByText(qrText, { exact: true })).toBeVisible();
    await expect(codes.getByText(barcodeText, { exact: true })).toBeVisible();
    await expect
        .poll(() =>
            codeImages.evaluateAll((images) =>
                images.every(
                    (image) =>
                        image instanceof HTMLImageElement &&
                        image.complete &&
                        image.naturalWidth > 0,
                ),
            ),
        )
        .toBe(true);
    expect(
        await codes.evaluate(
            (element) =>
                !!(
                    element.compareDocumentPosition(
                        document.querySelector('input[type="file"]')!,
                    ) & Node.DOCUMENT_POSITION_FOLLOWING
                ),
        ),
    ).toBe(true);
    for (const [position, method] of [
        [1, "x"],
        [1, "escape"],
        [2, "back"],
    ] as const) {
        const opener = page.getByRole("button", {
            name: `Open code ${position} full size`,
            exact: true,
        });
        await opener.click();
        const viewer = page.getByRole("dialog", { name: /^Code [12]:/ });
        await expect(viewer).toBeVisible();
        await expect(viewer.getByRole("img")).toBeVisible();
        expect(await page.evaluate(() => history.state.fooDialog)).toBe(
            `add:code:${position}`,
        );
        if (method === "x") {
            await viewer
                .getByRole("button", { name: "Close code", exact: true })
                .click();
        } else if (method === "escape") {
            await page.keyboard.press("Escape");
        } else {
            await page.goBack();
        }
        await expect(viewer).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
            "Scanned loyalty card",
        );
        await expect(
            page.getByRole("img", { name: /^Preview of image/ }),
        ).toHaveCount(2);
        await expect(codeImages).toHaveCount(2);
    }
    await page.goForward();
    await expect(page.getByRole("dialog", { name: /^Code 2:/ })).toBeVisible();
    await page.getByRole("button", { name: "Close code", exact: true }).click();
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
    await scan.click();
    await expect(
        page.getByText("These codes are already on the card.", { exact: true }),
    ).toBeVisible();
    await expect(codeImages).toHaveCount(2);
    await page
        .getByRole("button", { name: "Scan image 2 for codes", exact: true })
        .click();
    await expect(
        page.getByText(
            "No barcode or QR code found. Try a clearer image or adjust its corners.",
            { exact: true },
        ),
    ).toBeVisible();
    await expect(codeImages).toHaveCount(2);
    await dialog.locator('[data-slot="dialog-body"]').evaluate((element) => {
        element.scrollTop = 0;
    });
    await page.screenshot({
        path: testInfo.outputPath("extracted-codes.png"),
        animations: "disabled",
    });
    const saved = page.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/cards",
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    const card = (await (await saved).json()).card;
    expect(card.codes).toHaveLength(2);
    expect(
        card.codes.find((code: { format: string }) => code.format === "Code128")
            .bytes,
    ).toBe(Buffer.from(barcodeText).toString("base64"));
    await expect(dialog).toHaveCount(0);
    await page
        .getByRole("button", { name: "Open Scanned loyalty card", exact: true })
        .click();
    await expect(codeImages).toHaveCount(2);
    expect(
        await codes.evaluate(
            (element) =>
                !!(
                    element.compareDocumentPosition(
                        document.querySelector(
                            'button[aria-label="Open image 1 full size"]',
                        )!,
                    ) & Node.DOCUMENT_POSITION_FOLLOWING
                ),
        ),
    ).toBe(true);
    // Read the generated symbols again, preserving bytes rather than checking only text.
    await prepareZXingModule({
        overrides: {
            wasmBinary: await readFile(
                "node_modules/zxing-wasm/dist/full/zxing_full.wasm",
            ),
        },
        fireImmediately: true,
    });
    for (const source of await codeImages.evaluateAll((images) =>
        images.map((image) => image.getAttribute("src")!),
    )) {
        const svg = Buffer.from(decodeURIComponent(source.split(",")[1]));
        const { data, info } = await sharp(svg)
            .flatten({ background: "white" })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const detected = await readBarcodes({
            data: new Uint8ClampedArray(data),
            width: info.width,
            height: info.height,
            colorSpace: "srgb",
        });
        expect(detected).toHaveLength(1);
        expect(
            card.codes.some(
                (code: { bytes: string }) =>
                    code.bytes ===
                    Buffer.from(detected[0].bytes).toString("base64"),
            ),
        ).toBe(true);
    }
    const original = await (
        await page.request.get(`/api/cards/${card.id}/images/1`)
    ).body();
    await editCard(page);
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Unsaved code draft");
    await expectModalCodeCards(page);
    await page
        .getByRole("button", { name: "Open code 1 full size", exact: true })
        .click();
    expect(await page.evaluate(() => history.state.fooDialog)).toBe(
        `edit:${card.id}:code:1`,
    );
    await page.goBack();
    await expect(dialog).toHaveAccessibleName("Edit card");
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Unsaved code draft",
    );
    await expect(codeImages).toHaveCount(2);
    await scan.click();
    await expect(
        page
            .getByText("These codes are already on the card.", { exact: true })
            .last(),
    ).toBeVisible();
    await codes
        .getByRole("button", { name: "Remove code 1", exact: true })
        .click();
    await expect(codeImages).toHaveCount(1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveAccessibleName("Scanned loyalty card");
    await expect(codeImages).toHaveCount(2);
    await editCard(page);
    await codes
        .getByRole("button", { name: "Remove code 1", exact: true })
        .click();
    const edited = page.waitForResponse(
        (response) => response.request().method() === "PATCH",
    );
    await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
    expect((await (await edited).json()).card.codes).toHaveLength(1);
    await page.reload();
    await expect(codeImages).toHaveCount(1);
    expect(
        await (await page.request.get(`/api/cards/${card.id}/images/1`)).body(),
    ).toEqual(original);
    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
});

test("common loyalty formats preserve leading zeros and GS1 symbols", async ({
    page,
}) => {
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Other formats");
    const fixtures = [
        { bcid: "ean13", text: "0123456789012" },
        { bcid: "code39", text: "SYNTHETIC" },
        { bcid: "gs1-128", text: "(01)09501101530003(10)SYNTHETIC" },
    ];
    await page.locator('input[type="file"]').setInputFiles(
        await Promise.all(
            fixtures.map(async (fixture) => ({
                name: `${fixture.bcid}.png`,
                mimeType: "image/png",
                buffer: await bwipjs.toBuffer({
                    ...fixture,
                    scale: 3,
                    padding: 15,
                    backgroundcolor: "FFFFFF",
                }),
            })),
        ),
    );
    for (let index = 0; index < fixtures.length; index++) {
        await page
            .getByRole("button", {
                name: `Scan image ${index + 1} for codes`,
                exact: true,
            })
            .click();
        await expect(
            page
                .getByRole("region", { name: "Extracted codes" })
                .getByRole("img"),
        ).toHaveCount(index + 1);
    }
    const saved = page.waitForResponse(
        (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === "/api/cards",
    );
    await page.getByRole("button", { name: "Save card", exact: true }).click();
    const { card } = await (await saved).json();
    expect(card.codes.map((code: { text: string }) => code.text)).toEqual(
        fixtures.map((fixture) => fixture.text),
    );
    expect(card.codes[2].gs1).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
        .getByRole("button", { name: "Open Other formats", exact: true })
        .click();
    const images = page
        .getByRole("region", { name: "Extracted codes" })
        .getByRole("img");
    await expect(images).toHaveCount(3);
    await prepareZXingModule({
        overrides: {
            wasmBinary: await readFile(
                "node_modules/zxing-wasm/dist/full/zxing_full.wasm",
            ),
        },
        fireImmediately: true,
    });
    for (const [index, src] of (
        await images.evaluateAll((images) =>
            images.map((image) => image.getAttribute("src")!),
        )
    ).entries()) {
        const png = await sharp(
            Buffer.from(decodeURIComponent(src.split(",")[1])),
        )
            .flatten({ background: "white" })
            .png()
            .toBuffer();
        const result = await readBarcodes(png);
        expect(result).toHaveLength(1);
        expect(Buffer.from(result[0].bytes).toString("base64")).toBe(
            card.codes[index].bytes,
        );
        expect(result[0].contentType === "GS1").toBe(card.codes[index].gs1);
    }
});

test("barcode scan failures can retry and pending scans guard the card draft", async ({
    page,
}) => {
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await page.getByLabel("Card name", { exact: true }).fill("Retry scan");
    await page.locator('input[type="file"]').setInputFiles(await codedImage());
    const scan = page.getByRole("button", {
        name: "Scan image 1 for codes",
        exact: true,
    });
    await page.route(
        "**/barcode-engine.wasm",
        (route) => route.fulfill({ status: 503, body: "unavailable" }),
        { times: 1 },
    );
    await scan.click();
    await expect(
        page.getByText("Couldn't scan this image. Please try again.", {
            exact: true,
        }),
    ).toBeVisible();
    await expect(scan).toBeEnabled();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(
        "**/barcode-engine.wasm",
        async (route) => {
            await gate;
            await route.continue();
        },
        { times: 1 },
    );
    await scan.click();
    try {
        await expect(scan).toHaveAttribute("aria-busy", "true");
        await expect(
            page.getByLabel("Card name", { exact: true }),
        ).toBeDisabled();
        await expect(
            dialog.getByRole("button", { name: "Cancel", exact: true }),
        ).toBeDisabled();
        await expect(
            dialog.getByRole("button", { name: "Save card", exact: true }),
        ).toBeDisabled();
        await expect(
            dialog.getByRole("button", { name: "Close", exact: true }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await page.evaluate(() => history.back());
        await expect(dialog).toHaveAccessibleName("Add card");
    } finally {
        release();
    }
    await expect(
        page.getByText("Added 2 codes. Save the card to keep them.", {
            exact: true,
        }),
    ).toBeVisible();
    await expect(scan).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
});
