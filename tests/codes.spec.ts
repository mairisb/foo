import { expect, test, type Page } from "@playwright/test";
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { prepareZXingModule, readBarcodes } from "zxing-wasm";
import { cleanUp, register, syntheticImage } from "./helpers";

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
    await expect(scan.locator("svg path")).toHaveAttribute("d", /^M1 21v-5/);
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
                            'a[aria-label="Open image 1 full size"]',
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
