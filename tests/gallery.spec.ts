import { expect, test, type Page } from "@playwright/test";
import bwipjs from "bwip-js/node";
import { cardForm, cleanUp, origin, register, syntheticImage } from "./helpers";

test.afterAll(cleanUp);

const codes = [
    { format: "QRCode", text: "Synthetic gallery QR" },
    { format: "Code128", text: "000123456789" },
].map((code) => ({
    ...code,
    bytes: Buffer.from(code.text).toString("base64"),
    gs1: false,
}));

async function swipe(
    page: Page,
    direction: "left" | "right" | "vertical" | "short",
) {
    const touch = await page.context().newCDPSession(page);
    const viewport = page.viewportSize()!;
    const dx =
        direction === "left"
            ? -viewport.width * 0.5
            : direction === "right"
              ? viewport.width * 0.5
              : direction === "short"
                ? -12
                : 0;
    const x =
        viewport.width *
        (direction === "left" ? 0.75 : direction === "right" ? 0.25 : 0.5);
    const y = viewport.height * 0.45;
    try {
        await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 1 }],
        });
        for (let step = 1; step <= 4; step++) {
            await touch.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [
                    {
                        x: x + (dx * step) / 4,
                        y:
                            y +
                            (direction === "vertical" ? (100 * step) / 4 : 0),
                        id: 1,
                    },
                ],
            });
        }
        await touch.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
        });
    } finally {
        await touch.detach();
    }
}

async function createCard(
    page: Page,
    label: string,
    withImages = true,
    selectedCodes = codes,
) {
    const form = cardForm(
        label,
        withImages
            ? [await syntheticImage(), await syntheticImage("Back")]
            : [],
    );
    form.set("codes", JSON.stringify(selectedCodes));
    const result = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: form,
    });
    expect(result.status()).toBe(201);
    return (await result.json()).card as { id: string };
}

test("gallery browses codes and images with chevrons, wheel, swipes, and browser Back", async ({
    page,
    isMobile,
}, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await register(page.request);
    const card = await createCard(page, "Gallery card");
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Gallery card", exact: true })
        .click();
    const detail = page.getByRole("dialog", {
        name: "Gallery card",
        exact: true,
    });
    const opener = page.getByRole("button", {
        name: "Open code 1 full size",
        exact: true,
    });
    await opener.scrollIntoViewIfNeeded();
    const scrollTop = await detail
        .locator('[data-slot="dialog-body"]')
        .evaluate((element) => element.scrollTop);
    const historyLength = await page.evaluate(() => history.length);
    await opener.click();
    const viewer = page.getByRole("dialog", {
        name: /^(Code [12]:|Image [12] of Gallery card)/,
    });
    const next = viewer.getByRole("button", { name: "Next item", exact: true });
    const previous = viewer.getByRole("button", {
        name: "Previous item",
        exact: true,
    });
    async function at(kind: "code" | "image", position: number) {
        await expect(viewer).toHaveAccessibleName(
            kind === "code"
                ? `Code ${position}: ${codes[position - 1].format}`
                : `Image ${position} of Gallery card`,
        );
        await expect
            .poll(() =>
                viewer
                    .getByRole("img")
                    .evaluateAll(
                        (images) =>
                            images.length === 1 &&
                            images.every(
                                (image) =>
                                    image instanceof HTMLImageElement &&
                                    image.complete &&
                                    image.naturalWidth > 0,
                            ),
                    ),
            )
            .toBe(true);
        await expect(viewer.getByRole("status")).toHaveText(
            `${kind === "code" ? position : position + 2}/4`,
        );
        expect(await page.evaluate(() => history.state.fooDialog)).toBe(
            `card:${card.id}:${kind}:${position}`,
        );
        expect(await page.evaluate(() => history.length)).toBe(
            historyLength + 1,
        );
    }
    await at("code", 1);
    if (isMobile) {
        await expect(next).toBeHidden();
        await expect(previous).toBeHidden();
        await swipe(page, "short");
        await at("code", 1);
        await swipe(page, "vertical");
        await at("code", 1);
        await swipe(page, "right");
        await at("code", 1);
        await swipe(page, "left");
        await at("code", 2);
        await swipe(page, "left");
        await at("image", 1);
        await swipe(page, "left");
        await at("image", 2);
        await swipe(page, "left");
        await at("image", 2);
        await swipe(page, "right");
        await at("image", 1);
        await swipe(page, "right");
        await at("code", 2);
        await swipe(page, "right");
        await at("code", 1);
    } else {
        await expect(previous).toBeDisabled();
        await expect(next).toBeVisible();
        await expect(next.locator("svg")).toHaveAttribute(
            "data-material-symbol",
            "chevron-right-rounded",
        );
        expect((await next.boundingBox())!.width).toBeGreaterThanOrEqual(44);
        await next.click();
        await at("code", 2);
        await page.keyboard.press("ArrowRight");
        await at("image", 1);
        const viewport = page.viewportSize()!;
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, 120);
        await at("image", 2);
        await expect(next).toBeDisabled();
        await page.keyboard.press("ArrowRight");
        await at("image", 2);
        await previous.click();
        await at("image", 1);
        await page.keyboard.press("ArrowLeft");
        await at("code", 2);
        // Leave the explicit 180ms wheel-gesture window before a new gesture.
        await page.waitForTimeout(210);
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, -120);
        await at("code", 1);
        await page.keyboard.press("ArrowLeft");
        await at("code", 1);
        await page.waitForTimeout(210);
        // One continuous wheel burst advances exactly one item.
        await viewer.evaluate((element) => {
            for (let index = 0; index < 5; index++) {
                element.dispatchEvent(
                    new WheelEvent("wheel", {
                        deltaY: 120,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        });
        await at("code", 2);
        await page.keyboard.press("ArrowLeft");
        await at("code", 1);
    }
    await page.screenshot({
        path: testInfo.outputPath("gallery-code.png"),
        scale: "css",
        animations: "disabled",
    });
    for (let index = 0; index < 3; index++) {
        await page.keyboard.press("ArrowRight");
    }
    await at("image", 2);
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(detail).toBeVisible();
    await expect(opener).toBeFocused();
    expect(
        await detail
            .locator('[data-slot="dialog-body"]')
            .evaluate((element) => element.scrollTop),
    ).toBeCloseTo(scrollTop, 0);
    await page.goForward();
    await at("image", 2);
    await page.reload();
    await at("image", 2);
    await page.keyboard.press("Escape");
    await expect(detail).toBeVisible();
    expect(errors).toEqual([]);
});

test("gallery can browse away from image failures and single items have no navigation", async ({
    page,
}) => {
    await register(page.request);
    const card = await createCard(page, "Gallery retry", true, []);
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Gallery retry", exact: true })
        .click();
    const opener = page.getByRole("button", {
        name: "Open image 1 full size",
        exact: true,
    });
    await opener.click();
    const viewer = page.getByRole("dialog", {
        name: /^Image [12] of Gallery retry$/,
    });
    await expect(
        viewer.getByRole("button", { name: "Close image", exact: true }),
    ).toBeFocused();
    await page.route(
        `**/api/cards/${card.id}/images/2?*`,
        (route) => route.fulfill({ status: 503, body: "unavailable" }),
        { times: 1 },
    );
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByRole("alert")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByRole("img")).toHaveAttribute(
        "alt",
        "Image 1 of Gallery retry",
    );
    await page.keyboard.press("ArrowRight");
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
    await viewer
        .getByRole("button", { name: "Close image", exact: true })
        .click();
    await expect(opener).toBeFocused();
    await page.keyboard.press("Escape");
    await createCard(page, "One code", false, codes.slice(0, 1));
    await page.reload();
    await page
        .getByRole("button", { name: "Open One code", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Open code 1 full size", exact: true })
        .click();
    const single = page.getByRole("dialog", {
        name: "Code 1: QRCode",
        exact: true,
    });
    await expect(
        single.getByRole("button", { name: /^(Next|Previous) item$/ }),
    ).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await expect(single).toBeVisible();
    await single
        .getByRole("button", { name: "Close code", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "One code", exact: true }),
    ).toBeVisible();
});

test("long code values scroll without switching items and modified wheel gestures stay available", async ({
    page,
}) => {
    await register(page.request);
    const text = "Synthetic long code value\n".repeat(50);
    const longCode = {
        format: "QRCode",
        text,
        bytes: Buffer.from(text).toString("base64"),
        gs1: false,
    };
    const card = await createCard(page, "Scrollable value", false, [
        longCode,
        codes[1],
    ]);
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Scrollable value", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Open code 1 full size", exact: true })
        .click();
    const viewer = page.getByRole("dialog", { name: /^Code [12]:/ });
    const value = viewer.locator("[data-viewer-scroll]");
    await expect
        .poll(() =>
            value.evaluate(
                (element) => element.scrollHeight > element.clientHeight,
            ),
        )
        .toBe(true);
    await value.hover();
    await page.mouse.wheel(0, 100);
    await expect
        .poll(() => value.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
    expect(await page.evaluate(() => history.state.fooDialog)).toBe(
        `card:${card.id}:code:1`,
    );
    await value.focus();
    await page.keyboard.press("ArrowDown");
    await expect(viewer).toHaveAccessibleName("Code 1: QRCode");
    const zoomAllowed = await viewer.evaluate((element) => {
        const event = new WheelEvent("wheel", {
            deltaY: 120,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
        });
        return element.dispatchEvent(event);
    });
    expect(zoomAllowed).toBe(true);
    await expect(viewer).toHaveAccessibleName("Code 1: QRCode");
    await value.hover();
    await page.mouse.wheel(120, 0);
    await expect(viewer).toHaveAccessibleName("Code 2: Code128");
    await expect(
        viewer.getByRole("button", { name: "Close code", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(viewer).toHaveAccessibleName("Code 1: QRCode");
    await value.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await value.hover();
    await page.waitForTimeout(210);
    await page.mouse.wheel(0, 120);
    await expect(viewer).toHaveAccessibleName("Code 2: Code128");
    await viewer
        .getByRole("button", { name: "Close code", exact: true })
        .click();
    await expect(
        page.getByRole("dialog", { name: "Scrollable value", exact: true }),
    ).toBeVisible();
});

test("draft code gallery keeps creation and editing drafts through browser Back", async ({
    page,
    isMobile,
}) => {
    await register(page.request);
    await page.goto("/");
    await page.getByRole("button", { name: "Add card", exact: true }).click();
    await page.getByLabel("Card name", { exact: true }).fill("Unsaved gallery");
    await page.locator('input[type="file"]').setInputFiles(
        await Promise.all(
            codes.map(async (code) => ({
                name: `${code.format}.png`,
                mimeType: "image/png",
                buffer: await bwipjs.toBuffer({
                    bcid: code.format === "QRCode" ? "qrcode" : "code128",
                    text: code.text,
                    scale: 4,
                    padding: 15,
                    backgroundcolor: "FFFFFF",
                }),
            })),
        ),
    );
    for (const position of [1, 2]) {
        await page
            .getByRole("button", {
                name: `Scan image ${position} for codes`,
                exact: true,
            })
            .click();
        await expect(
            page
                .getByRole("region", { name: "Extracted codes" })
                .getByRole("img"),
        ).toHaveCount(position);
    }
    const historyLength = await page.evaluate(() => history.length);
    const opener = page.getByRole("button", {
        name: "Open code 1 full size",
        exact: true,
    });
    await opener.click();
    await expect(
        page.getByRole("button", { name: "Close code", exact: true }),
    ).toBeFocused();
    if (isMobile) {
        await swipe(page, "left");
    } else {
        await page.keyboard.press("ArrowRight");
    }
    await expect(
        page.getByRole("dialog", { name: "Code 2: Code128", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
    expect(await page.evaluate(() => history.state.fooDialog)).toBe(
        "add:code:2",
    );
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Add card");
    await expect(opener).toBeFocused();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Unsaved gallery",
    );
    await expect(
        page.getByRole("img", { name: /^Preview of image/ }),
    ).toHaveCount(2);
    expect(
        (await (await page.request.get("/api/cards")).json()).cards,
    ).toHaveLength(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const card = await createCard(page, "Saved gallery", false);
    await page.reload();
    await page
        .getByRole("button", { name: "Open Saved gallery", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Card actions", exact: true })
        .click();
    await page
        .getByRole("menuitem", { name: "Edit card", exact: true })
        .click();
    await page
        .getByLabel("Card name", { exact: true })
        .fill("Edited gallery draft");
    await page
        .getByRole("button", { name: "Open code 2 full size", exact: true })
        .click();
    await expect(
        page.getByRole("button", { name: "Close code", exact: true }),
    ).toBeFocused();
    if (isMobile) {
        await swipe(page, "right");
    } else {
        await page.keyboard.press("ArrowLeft");
    }
    await expect(
        page.getByRole("dialog", { name: "Code 1: QRCode", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => history.state.fooDialog)).toBe(
        `edit:${card.id}:code:1`,
    );
    await page.goBack();
    await expect(page.getByLabel("Card name", { exact: true })).toHaveValue(
        "Edited gallery draft",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName(
        "Saved gallery",
    );
});
