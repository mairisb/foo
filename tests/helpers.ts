import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { expect, type APIRequestContext } from "@playwright/test";
import type { ImageRotation } from "../src/lib/cards";

export const origin = "http://localhost:3000";
export const password = "Synthetic-Test-Only!42";
export const sampleCard = {
    label: "Weekly groceries",
};
export const retrySeconds = (headers: Record<string, string>) =>
    Math.min(
        10,
        Math.max(
            1,
            Number(headers["x-retry-after"] ?? headers["retry-after"] ?? 10) ||
                10,
        ),
    );
export const testEmails: string[] = [];
export function email() {
    const value = `foo-e2e-${randomUUID()}@example.com`;
    testEmails.push(value);
    return value;
}
export async function register(request: APIRequestContext) {
    const accountEmail = email();
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request.post("/api/auth/sign-up/email", {
            headers: { origin },
            data: { name: "Test Wallet", email: accountEmail, password },
        });
        if (response.status() !== 429 || attempt === 2) {
            expect(response.status()).toBe(200);
            return (await response.json()).user.id as string;
        }
        // Respect the real authentication limiter instead of disabling it for tests.
        const seconds = retrySeconds(response.headers());
        await new Promise((resolve) =>
            setTimeout(resolve, (seconds + 1) * 1000),
        );
    }
}

export async function syntheticImage(
    side = "Front",
    format: "png" | "jpeg" | "webp" = "png",
) {
    const source =
        Buffer.from(`<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="640" height="400" fill="${side === "Back" ? "#e9e4da" : "#d9e7d3"}"/>
    <text x="40" y="100" font-family="sans-serif" font-size="36" fill="#111">Test card — ${side}</text>
    <text x="40" y="160" font-family="sans-serif" font-size="24" fill="#444">Synthetic image</text>
  </svg>`);
    return {
        name: `${side.toLowerCase()}.${format}`,
        mimeType: `image/${format}`,
        buffer: await sharp(source).toFormat(format).toBuffer(),
    };
}

export function cardForm(
    label: string,
    images: Array<{
        name: string;
        mimeType: string;
        buffer: Buffer;
        rotation?: ImageRotation;
    }> = [],
) {
    const form = new FormData();
    form.set("label", label);
    for (const image of images) {
        form.append(
            image.rotation ? `images:${image.rotation}` : "images",
            new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
            image.name,
        );
    }
    return form;
}
export function editForm(
    label: string,
    revision: number,
    removeImages: number[] = [],
    images: Parameters<typeof cardForm>[1] = [],
    imageOrder?: number[],
    rotateImages?: Array<{ position: number; rotation: ImageRotation }>,
) {
    const form = cardForm(label, images);
    form.set("revision", String(revision));
    form.set("removeImages", JSON.stringify(removeImages));
    if (imageOrder !== undefined) {
        form.set("imageOrder", JSON.stringify(imageOrder));
    }
    if (rotateImages !== undefined) {
        form.set("rotateImages", JSON.stringify(rotateImages));
    }
    return form;
}

export async function rotationImage() {
    const source =
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160">
        <path fill="#f02020" d="M0 0h120v80H0z"/>
        <path fill="#20c020" d="M120 0h120v80H120z"/>
        <path fill="#2020f0" d="M0 80h120v80H0z"/>
        <path fill="#e0e020" d="M120 80h120v80H120z"/>
    </svg>`);
    return {
        name: "rotation.png",
        mimeType: "image/png",
        buffer: await sharp(source).png().toBuffer(),
    };
}

export async function expectImageRotation(
    bytes: Buffer,
    rotation: ImageRotation,
) {
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.orientation).toBeUndefined();
    const sideways = rotation === 90 || rotation === 270;
    const { data, info } = await sharp(bytes)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual(
        sideways ? [160, 240] : [240, 160],
    );
    const red = [240, 32, 32];
    const green = [32, 192, 32];
    const blue = [32, 32, 240];
    const yellow = [224, 224, 32];
    const expected = {
        0: [red, green, blue, yellow],
        90: [blue, red, yellow, green],
        180: [yellow, blue, green, red],
        270: [green, yellow, red, blue],
    }[rotation];
    for (const [index, [x, y]] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
    ].entries()) {
        const offset =
            (Math.floor(y * info.height) * info.width +
                Math.floor(x * info.width)) *
            info.channels;
        for (let channel = 0; channel < 3; channel++) {
            expect(
                Math.abs(data[offset + channel] - expected[index][channel]),
            ).toBeLessThan(25);
        }
    }
}

export async function cleanUp() {
    const cleanupPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
    });
    try {
        if (testEmails.length) {
            await cleanupPool.query(
                'DELETE FROM "user" WHERE email=ANY($1::text[])',
                [testEmails],
            );
        }
        testEmails.length = 0;
    } finally {
        await cleanupPool.end();
    }
}
