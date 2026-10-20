import { expect, test, type Page } from "@playwright/test";
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import {
    cardForm,
    cleanUp,
    origin,
    register,
    rotationImage,
    syntheticImage,
} from "./helpers";

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
    duringDrag?: () => Promise<void>,
    end: "touchEnd" | "touchCancel" = "touchEnd",
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
        await duringDrag?.();
        await touch.send("Input.dispatchTouchEvent", {
            type: end,
            touchPoints: [],
        });
    } finally {
        await touch.detach();
    }
}

test("gallery swipe follows the finger, settles, and respects reduced motion", async ({
    page,
}, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await register(page.request);
    await createCard(page, "Animated gallery", true, []);
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Animated gallery", exact: true })
        .click();
    await page
        .getByRole("button", { name: "Open image 1 full size", exact: true })
        .click();
    const viewer = page.getByRole("dialog", {
        name: /^Image [12] of Animated gallery$/,
    });
    const track = viewer.locator('[data-slot="gallery-track"]');
    const close = viewer.getByRole("button", {
        name: "Close image",
        exact: true,
    });
    await expect(close).toBeFocused();
    const closeBox = await close.boundingBox();
    const width = page.viewportSize()!.width;
    async function settled(position: number) {
        await expect(viewer.getByRole("status")).toHaveText(`${position}/2`);
        await expect
            .poll(() =>
                track.evaluate((element) =>
                    Math.round(element.getBoundingClientRect().x),
                ),
            )
            .toBe(0);
        await expect(track.locator('[data-slot="gallery-slide"]')).toHaveCount(
            1,
        );
        await expect
            .poll(() =>
                track.evaluate((element) => element.getAnimations().length),
            )
            .toBe(0);
    }
    await swipe(page, "left", async () => {
        await expect
            .poll(async () => (await track.boundingBox())!.x)
            .toBeCloseTo(-width / 2, 0);
        await expect(track.locator('[data-slot="gallery-slide"]')).toHaveCount(
            2,
        );
        await expect(viewer.getByRole("img")).toHaveCount(1);
        expect(await close.boundingBox()).toEqual(closeBox);
        await expect(viewer.getByRole("status")).toHaveText("1/2");
        await page.screenshot({
            path: testInfo.outputPath("gallery-mid-swipe.png"),
            scale: "css",
        });
    });
    await settled(2);
    // Dragging beyond an end gives resistance and returns to the current item.
    await swipe(page, "left", async () => {
        expect(Math.abs((await track.boundingBox())!.x)).toBeLessThan(
            width / 4,
        );
    });
    await settled(2);
    await swipe(page, "right");
    await settled(1);
    await swipe(page, "short");
    await settled(1);
    await swipe(page, "left", undefined, "touchCancel");
    await settled(1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await swipe(page, "left", async () => {
        expect((await track.boundingBox())!.x).toBe(0);
        await expect(track.locator('[data-slot="gallery-slide"]')).toHaveCount(
            1,
        );
    });
    await settled(2);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Hold the release animation so Back is exercised during settling.
    await viewer.evaluate((element) => {
        element.addEventListener(
            "pointerup",
            () => {
                requestAnimationFrame(() => {
                    element
                        .querySelector('[data-slot="gallery-track"]')
                        ?.getAnimations()
                        .forEach((animation) => animation.pause());
                });
            },
            { once: true },
        );
    });
    await swipe(page, "right");
    await expect
        .poll(() =>
            track.evaluate((element) =>
                element.getAnimations().map((animation) => animation.playState),
            ),
        )
        .toEqual(["paused"]);
    await expect(viewer.getByRole("status")).toHaveText("1/2");
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(
        page.getByRole("button", {
            name: "Open image 1 full size",
            exact: true,
        }),
    ).toBeFocused();
});

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

test("gallery rotation fits images, stays within the open gallery, and resets after browser Back", async ({
    page,
    isMobile,
}, testInfo) => {
    await register(page.request);
    const source = await rotationImage();
    const form = cardForm("Temporary rotation", [
        source,
        {
            ...source,
            name: "portrait.png",
            buffer: await sharp(source.buffer)
                .resize(160, 480, { fit: "fill" })
                .png()
                .toBuffer(),
        },
    ]);
    form.set("codes", JSON.stringify(codes.slice(0, 1)));
    const created = await page.request.post("/api/cards", {
        headers: { origin },
        multipart: form,
    });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    const urls = [1, 2].map(
        (position) =>
            `/api/cards/${card.id}/images/${position}?v=${card.revision}`,
    );
    const originalBytes = await Promise.all(
        urls.map(async (url) => (await page.request.get(url)).body()),
    );
    const writes: string[] = [];
    page.on("request", (request) => {
        if (
            new URL(request.url()).pathname.startsWith("/api/cards") &&
            request.method() !== "GET"
        ) {
            writes.push(request.method());
        }
    });
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Temporary rotation", exact: true })
        .click();
    const codeOpener = page.getByRole("button", {
        name: "Open code 1 full size",
        exact: true,
    });
    await codeOpener.click();
    const viewer = page.getByRole("dialog", {
        name: /^(Code 1:|Image [12] of Temporary rotation)/,
    });
    const rotate = viewer.getByRole("button", {
        name: "Rotate image clockwise",
        exact: true,
    });
    await expect(rotate).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(rotate).toBeVisible();
    const box = (await rotate.boundingBox())!;
    expect(box.x).toBeLessThan(30);
    expect(box.y).toBeLessThan(30);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(rotate.locator("svg")).toHaveAttribute(
        "data-material-symbol",
        "rotate-right-rounded",
    );
    const historyLength = await page.evaluate(() => history.length);
    async function fitted(
        position: number,
        rotation: 0 | 90 | 180 | 270,
        capture?: string,
    ) {
        await expect(viewer).toHaveAccessibleName(
            `Image ${position} of Temporary rotation`,
        );
        await expect
            .poll(() =>
                viewer
                    .locator('[data-slot="gallery-track"]')
                    .evaluate((element) => element.getAnimations().length),
            )
            .toBe(0);
        const image = viewer.getByRole("img");
        await expect
            .poll(() =>
                image.evaluate(
                    (element: HTMLImageElement) =>
                        element.complete && element.naturalWidth > 0,
                ),
            )
            .toBe(true);
        const sideways = rotation === 90 || rotation === 270;
        const geometry = await image.evaluate(
            (image: HTMLImageElement, sideways) => {
                const rect = image.getBoundingClientRect();
                const width = sideways
                    ? image.naturalHeight
                    : image.naturalWidth;
                const height = sideways
                    ? image.naturalWidth
                    : image.naturalHeight;
                const scale = Math.min(
                    innerWidth / width,
                    innerHeight / height,
                );
                const viewer = image.closest('[role="dialog"]')!;
                return {
                    rect: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    },
                    viewport: { width: innerWidth, height: innerHeight },
                    width: Math.floor(width * scale),
                    height: Math.floor(height * scale),
                    left: Math.round((innerWidth - width * scale) / 2),
                    top: Math.round((innerHeight - height * scale) / 2),
                    overflow:
                        viewer.scrollWidth > viewer.clientWidth ||
                        viewer.scrollHeight > viewer.clientHeight,
                };
            },
            sideways,
        );
        expect(geometry.rect.x).toBeCloseTo(0, 0);
        expect(geometry.rect.y).toBeCloseTo(0, 0);
        expect(geometry.rect.width).toBeCloseTo(geometry.viewport.width, 0);
        expect(geometry.rect.height).toBeCloseTo(geometry.viewport.height, 0);
        expect(geometry.overflow).toBe(false);
        const screenshot = await page.screenshot({
            scale: "css",
            ...(capture ? { path: testInfo.outputPath(capture) } : {}),
        });
        const { data, info } = await sharp(screenshot)
            .extract({
                left: geometry.left,
                top: geometry.top,
                width: geometry.width,
                height: geometry.height,
            })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        const red = [240, 32, 32];
        const green = [32, 192, 32];
        const blue = [32, 32, 240];
        const yellow = [224, 224, 32];
        const colors = {
            0: [red, green, blue, yellow],
            90: [blue, red, yellow, green],
            180: [yellow, blue, green, red],
            270: [green, yellow, red, blue],
        }[rotation];
        for (const [index, [x, y]] of [
            [0.08, 0.08],
            [0.92, 0.08],
            [0.08, 0.92],
            [0.92, 0.92],
        ].entries()) {
            const offset =
                (Math.floor(y * info.height) * info.width +
                    Math.floor(x * info.width)) *
                info.channels;
            for (let channel = 0; channel < 3; channel++) {
                expect(
                    Math.abs(data[offset + channel] - colors[index][channel]),
                ).toBeLessThan(25);
            }
        }
    }
    await fitted(1, 0);
    for (const rotation of [90, 180, 270, 0] as const) {
        await rotate.click();
        await fitted(1, rotation);
    }
    await rotate.click();
    await fitted(1, 90, "gallery-rotated.png");
    if (isMobile) {
        await swipe(page, "left");
    } else {
        await page.keyboard.press("ArrowRight");
    }
    await fitted(2, 0);
    await rotate.click();
    await rotate.click();
    await fitted(2, 180);
    await page.keyboard.press("ArrowLeft");
    await fitted(1, 90);
    await page.keyboard.press("ArrowLeft");
    await expect(viewer).toHaveAccessibleName("Code 1: QRCode");
    await expect(rotate).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await fitted(1, 90);
    const viewport = page.viewportSize()!;
    await page.setViewportSize(
        viewport.width > viewport.height
            ? { width: 390, height: 844 }
            : { width: 844, height: 390 },
    );
    await fitted(1, 90, "gallery-rotated-resized.png");
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    expect(await page.evaluate(() => history.state.fooDialog)).toBe(
        `card:${card.id}:image:1`,
    );
    await viewer
        .getByRole("button", { name: "Close image", exact: true })
        .click();
    await expect(codeOpener).toBeFocused();
    const imageOpener = page.getByRole("button", {
        name: "Open image 1 full size",
        exact: true,
    });
    await imageOpener.click();
    await fitted(1, 0);
    await rotate.click();
    await page.keyboard.press("Escape");
    await imageOpener.click();
    await fitted(1, 0);
    await rotate.click();
    await page.goBack();
    await expect(imageOpener).toBeFocused();
    await page.goForward();
    await fitted(1, 0);
    await rotate.click();
    await page.reload();
    await fitted(1, 0);
    expect(writes).toEqual([]);
    expect(
        (await (await page.request.get(`/api/cards/${card.id}`)).json()).card
            .revision,
    ).toBe(card.revision);
    for (const [index, url] of urls.entries()) {
        expect(await (await page.request.get(url)).body()).toEqual(
            originalBytes[index],
        );
    }
});

test("rapid gallery wheel and swipes interrupt animations and retain browser Back", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await register(page.request);
    const card = await createCard(page, "Rapid gallery");
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Rapid gallery", exact: true })
        .click();
    const opener = page.getByRole("button", {
        name: "Open code 1 full size",
        exact: true,
    });
    await opener.click();
    const viewer = page.getByRole("dialog", {
        name: /^(Code [12]:|Image [12] of Rapid gallery)/,
    });
    const counter = viewer.getByRole("status", { name: /of 4$/ });
    const track = viewer.locator('[data-slot="gallery-track"]');
    await expect(
        viewer.getByRole("button", { name: "Close code", exact: true }),
    ).toBeFocused();
    const historyLength = await page.evaluate(() => history.length);
    // Keep every slide paused: later gestures must work without waiting for it.
    await viewer.evaluate((element) => {
        element.addEventListener("pointerup", () => {
            requestAnimationFrame(() => {
                element
                    .querySelector('[data-slot="gallery-track"]')
                    ?.getAnimations()
                    .forEach((animation) => animation.pause());
            });
        });
    });
    async function pausedAt(position: number) {
        await expect(counter).toHaveText(`${position}/4`);
        await expect
            .poll(() =>
                track.evaluate((element) =>
                    element
                        .getAnimations()
                        .map((animation) => animation.playState),
                ),
            )
            .toEqual(["paused"]);
    }
    await swipe(page, "left");
    await pausedAt(2);
    await swipe(page, "left");
    await pausedAt(3);
    await swipe(page, "right");
    await pausedAt(2);
    async function wheel(deltas: number[]) {
        await viewer.evaluate((element, deltas) => {
            for (const deltaY of deltas) {
                element.dispatchEvent(
                    new WheelEvent("wheel", {
                        deltaY,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        }, deltas);
    }
    // Same-frame events, tiny deltas, reversal, and bounds have no cooldown.
    await wheel([0.1, 0.1]);
    await expect(counter).toHaveText("4/4");
    await expect
        .poll(() => track.evaluate((element) => element.getAnimations().length))
        .toBe(0);
    await wheel([0, -0.1]);
    await expect(counter).toHaveText("3/4");
    await wheel([1, -1, -1]);
    await expect(counter).toHaveText("2/4");
    await wheel([-1, -1, -1, 1]);
    await expect(counter).toHaveText("2/4");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    expect(await page.evaluate(() => history.state.fooDialog)).toBe(
        `card:${card.id}:code:2`,
    );
    await page.goBack();
    await expect(viewer).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.goForward();
    await expect(counter).toHaveText("2/4");
});

test("desktop gallery controls animate without blocking rapid navigation", async ({
    page,
    isMobile,
}, testInfo) => {
    test.skip(isMobile, "Desktop controls are covered with a fine pointer.");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await register(page.request);
    await createCard(page, "Desktop animation");
    await page.goto("/");
    await page
        .getByRole("button", { name: "Open Desktop animation", exact: true })
        .click();
    const opener = page.getByRole("button", {
        name: "Open code 1 full size",
        exact: true,
    });
    await opener.click();
    const viewer = page.getByRole("dialog", {
        name: /^(Code [12]:|Image [12] of Desktop animation)/,
    });
    const counter = viewer.getByRole("status", { name: /of 4$/ });
    const track = viewer.locator('[data-slot="gallery-track"]');
    const next = viewer.getByRole("button", { name: "Next item", exact: true });
    const previous = viewer.getByRole("button", {
        name: "Previous item",
        exact: true,
    });
    await expect(
        viewer.getByRole("button", { name: "Close code", exact: true }),
    ).toBeFocused();
    const nextBox = await next.boundingBox();
    const historyLength = await page.evaluate(() => history.length);
    // Pause each animation as it is created so every next action interrupts it.
    await track.evaluate((element) => {
        const animate = element.animate.bind(element);
        element.animate = (...args) => {
            const animation = animate(...args);
            animation.pause();
            return animation;
        };
    });
    async function animatedAt(position: number, direction: number) {
        await expect(counter).toHaveText(`${position}/4`);
        await expect
            .poll(() =>
                track.evaluate((element) =>
                    element
                        .getAnimations()
                        .map((animation) => animation.playState),
                ),
            )
            .toEqual(["paused"]);
        const offsets = await track.evaluate((element) =>
            (element.getAnimations()[0].effect as KeyframeEffect)
                .getKeyframes()
                .map(
                    (frame) =>
                        new DOMMatrixReadOnly(String(frame.transform)).m41,
                ),
        );
        expect(offsets).toEqual([direction * page.viewportSize()!.width, 0]);
        expect(await next.boundingBox()).toEqual(nextBox);
        await expect(viewer.getByRole("img")).toHaveCount(1);
    }
    await next.click();
    await animatedAt(2, 1);
    await previous.click();
    await animatedAt(1, -1);
    await page.keyboard.press("ArrowRight");
    await animatedAt(2, 1);
    await page.keyboard.press("ArrowDown");
    await animatedAt(3, 1);
    await track.evaluate((element) => {
        element.getAnimations()[0].currentTime = 110;
    });
    await page.screenshot({
        path: testInfo.outputPath("desktop-gallery-slide.png"),
        scale: "css",
    });
    await page.keyboard.press("ArrowLeft");
    await animatedAt(2, -1);
    async function wheel(deltas: number[]) {
        await viewer.evaluate((element, deltas) => {
            for (const deltaY of deltas) {
                element.dispatchEvent(
                    new WheelEvent("wheel", {
                        deltaY,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        }, deltas);
    }
    await wheel([1]);
    await animatedAt(3, 1);
    await wheel([-1]);
    await animatedAt(2, -1);
    // A same-frame reversal returns to the same item with a fresh animation.
    await wheel([1, -1]);
    await animatedAt(2, -1);
    await wheel([1, 1]);
    await animatedAt(4, 1);
    await wheel([1]);
    await expect(counter).toHaveText("4/4");
    expect(
        await track.evaluate((element) => element.getAnimations().length),
    ).toBe(0);
    await previous.click();
    await animatedAt(3, -1);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await opener.click();
    await next.click();
    await expect(counter).toHaveText("2/4");
    expect(
        await track.evaluate((element) => element.getAnimations().length),
    ).toBe(0);
    await expect(track.locator('[data-slot="gallery-slide"]')).toHaveCount(1);
});

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
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, -120);
        await at("code", 1);
        await page.keyboard.press("ArrowLeft");
        await at("code", 1);
        // Every event in one uninterrupted burst advances, stopping at the end.
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
        await at("image", 2);
        for (let index = 0; index < 3; index++) {
            await page.keyboard.press("ArrowLeft");
        }
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
    const value = viewer.getByRole("code");
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
    await page
        .getByRole("dialog", { name: "Code 2: Code128", exact: true })
        .evaluate((element) => {
            for (const deltaY of [-1, 1, -1, 1]) {
                element.dispatchEvent(
                    new WheelEvent("wheel", {
                        deltaY,
                        bubbles: true,
                        cancelable: true,
                    }),
                );
            }
        });
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
