import { test, expect } from "@playwright/test";
import {
    cleanUp,
    origin,
    register,
    sampleCard,
    syntheticImage,
    cardForm,
    editForm,
} from "./helpers";
import { getAppOrigins } from "../src/server/origins";
import { maxImageBytes } from "../src/lib/cards";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

test.afterAll(cleanUp);
test("local aliases are restricted to development and the configured port", () => {
    const local = getAppOrigins("http://localhost:3000", "development", "");
    expect(local).toContain("http://localhost:3000");
    expect(local).toContain("http://127.0.0.1:3000");
    expect(local).not.toContain("http://127.0.0.1:3001");
    expect(local).not.toContain("https://localhost:3000");
    expect(getAppOrigins("http://127.0.0.1:4000", "development", "")).toContain(
        "http://localhost:4000",
    );
    expect(getAppOrigins("http://localhost:3000", "production", "")).toEqual([
        "http://localhost:3000",
    ]);
    for (const environment of ["development", "production"] as const) {
        expect(getAppOrigins("https://foo.example", environment, "")).toEqual([
            "https://foo.example",
        ]);
    }
    const lanOrigin = "http://192.168.0.10:3000";
    expect(
        getAppOrigins("http://localhost:3000", "development", lanOrigin),
    ).toContain(lanOrigin);
    expect(
        getAppOrigins("https://foo.example", "production", lanOrigin),
    ).toEqual(["https://foo.example"]);
});
test("only the owner can read and delete their cards and images", async ({
    playwright,
}) => {
    const owner = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
    });
    const other = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
    });
    const anonymous = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
    });
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
    });
    try {
        expect((await anonymous.get("/api/cards")).status()).toBe(401);
        expect(
            (
                await anonymous.post("/api/auth/sign-up/email", {
                    headers: { origin: "https://untrusted.example" },
                    data: {
                        name: "Blocked synthetic request",
                        email: "blocked-origin@example.com",
                        password: "Synthetic-Test-Only!42",
                    },
                })
            ).status(),
        ).toBe(403);
        await register(owner);
        await register(other);
        const created = await owner.post("/api/cards", {
            multipart: cardForm(sampleCard.label, [
                await syntheticImage(),
                await syntheticImage("Back"),
                await syntheticImage("Extra"),
            ]),
        });
        expect(created.status()).toBe(201);
        const { card } = await created.json();
        expect(card.imageCount).toBe(3);
        const ownCards = await owner.get("/api/cards");
        expect((await ownCards.json()).cards).toHaveLength(1);
        expect(ownCards.headers()["cache-control"]).toContain("no-store");
        expect(
            (await (await other.get("/api/cards")).json()).cards,
        ).toHaveLength(0);
        for (const suffix of ["", "/images/1", "/images/2", "/images/3"]) {
            expect(
                (await other.get(`/api/cards/${card.id}${suffix}`)).status(),
            ).toBe(404);
            expect(
                (
                    await anonymous.get(`/api/cards/${card.id}${suffix}`)
                ).status(),
            ).toBe(401);
        }
        expect((await owner.get(`/api/cards/${card.id}`)).status()).toBe(200);
        for (const position of [1, 2, 3]) {
            const image = await owner.get(
                `/api/cards/${card.id}/images/${position}`,
            );
            expect(image.status()).toBe(200);
            expect(image.headers()["content-type"]).toBe("image/jpeg");
            expect(image.headers()["cache-control"]).toContain("no-store");
            expect(image.headers()["x-content-type-options"]).toBe("nosniff");
            expect((await sharp(await image.body()).metadata()).format).toBe(
                "jpeg",
            );
        }
        for (const position of [
            "4",
            "0",
            "-1",
            "01",
            "1.5",
            "invalid",
            "2147483648",
        ]) {
            expect(
                (
                    await owner.get(`/api/cards/${card.id}/images/${position}`)
                ).status(),
            ).toBe(404);
        }
        expect(
            (await owner.get(`/api/cards/${card.id}/barcode`)).status(),
        ).toBe(404);
        expect(
            (
                await owner.patch(`/api/cards/${card.id}`, { data: sampleCard })
            ).status(),
        ).toBe(415);
        expect((await other.delete(`/api/cards/${card.id}`)).status()).toBe(
            404,
        );
        expect((await anonymous.delete(`/api/cards/${card.id}`)).status()).toBe(
            401,
        );
        for (const blockedOrigin of ["https://untrusted.example", ""]) {
            expect(
                (
                    await owner.delete(`/api/cards/${card.id}`, {
                        headers: { origin: blockedOrigin },
                    })
                ).status(),
            ).toBe(403);
        }
        expect((await owner.delete("/api/cards/not-a-uuid")).status()).toBe(
            400,
        );
        expect(
            (await owner.delete(`/api/cards/${randomUUID()}`)).status(),
        ).toBe(404);
        expect((await owner.get(`/api/cards/${card.id}`)).status()).toBe(200);
        expect(
            (await owner.post(`/api/cards/${card.id}/shares`)).status(),
        ).toBe(404);
        expect((await owner.post("/api/shared")).status()).toBe(404);
        const otherCardResponse = await other.post("/api/cards", {
            multipart: cardForm("Other owner's card"),
        });
        expect(otherCardResponse.status()).toBe(201);
        const { card: otherCard } = await otherCardResponse.json();
        expect(
            (
                await pool.query(
                    "SELECT position FROM card_images WHERE card_id=$1",
                    [card.id],
                )
            ).rows,
        ).toHaveLength(3);
        const deleted = await owner.delete(`/api/cards/${card.id}`);
        expect(deleted.status()).toBe(200);
        expect(await deleted.json()).toEqual({ deleted: true });
        expect(deleted.headers()["cache-control"]).toContain("no-store");
        expect((await owner.delete(`/api/cards/${card.id}`)).status()).toBe(
            404,
        );
        expect(
            (await (await owner.get("/api/cards")).json()).cards,
        ).toHaveLength(0);
        for (const suffix of ["", "/images/1", "/images/2", "/images/3"]) {
            expect(
                (await owner.get(`/api/cards/${card.id}${suffix}`)).status(),
            ).toBe(404);
        }
        expect(
            (
                await pool.query(
                    "SELECT position FROM card_images WHERE card_id=$1",
                    [card.id],
                )
            ).rows,
        ).toHaveLength(0);
        expect((await other.get(`/api/cards/${otherCard.id}`)).status()).toBe(
            200,
        );
    } finally {
        await pool.end();
        await owner.dispose();
        await other.dispose();
        await anonymous.dispose();
    }
});

test("image cards validate uploads and accept multiple images without a count cap", async ({
    request,
}) => {
    await register(request);
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin: "https://untrusted.example" },
                multipart: cardForm(sampleCard.label),
            })
        ).status(),
    ).toBe(403);
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: cardForm(""),
            })
        ).status(),
    ).toBe(400);
    const temporaryBefore = new Set(await readdir(tmpdir()));
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: cardForm("Invalid image", [
                    {
                        name: "fake.png",
                        mimeType: "image/png",
                        buffer: Buffer.from("not an image"),
                    },
                ]),
            })
        ).status(),
    ).toBe(400);
    for (const badImage of [
        {
            name: "card.svg",
            mimeType: "image/svg+xml",
            buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        },
        { name: "empty.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(0) },
    ]) {
        expect(
            (
                await request.post("/api/cards", {
                    headers: { origin },
                    multipart: cardForm("Bad image", [badImage]),
                })
            ).status(),
        ).toBe(400);
    }
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: cardForm("Oversized", [
                    {
                        name: "large.png",
                        mimeType: "image/png",
                        buffer: Buffer.alloc(maxImageBytes + 1),
                    },
                ]),
            })
        ).status(),
    ).toBe(413);
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: cardForm(
                    "Oversized request",
                    [1, 2].map(() => ({
                        name: "large.png",
                        mimeType: "image/png",
                        buffer: Buffer.alloc(11 * 1024 * 1024),
                    })),
                ),
            })
        ).status(),
    ).toBe(413);
    const extraField = cardForm("Unexpected field");
    extraField.set("owner_id", "someone-else");
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: extraField,
            })
        ).status(),
    ).toBe(400);
    expect((await request.get("/api/cards")).status()).toBe(200);
    expect((await (await request.get("/api/cards")).json()).cards).toHaveLength(
        0,
    );

    const png = await syntheticImage();
    const jpeg = await syntheticImage("Front", "jpeg");
    const oriented = {
        ...jpeg,
        buffer: await sharp(jpeg.buffer)
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer(),
    };
    const webp = await syntheticImage("Back", "webp");
    const padded = Buffer.alloc(7 * 1024 * 1024);
    png.buffer.copy(padded);
    const large = { ...png, buffer: padded };
    const exactLimit = Buffer.alloc(maxImageBytes);
    png.buffer.copy(exactLimit);
    for (const images of [
        [],
        [png],
        [oriented, webp],
        Array.from({ length: 20 }, () => png),
        [large, large, large],
        [{ ...png, buffer: exactLimit }],
    ]) {
        const response = await request.post("/api/cards", {
            headers: { origin },
            multipart: cardForm(`${images.length} images`, images),
        });
        expect(response.status()).toBe(201);
        const { card } = await response.json();
        expect(card.imageCount).toBe(images.length);
        expect(card.cardNumber).toBeUndefined();
        expect(card.barcodeFormat).toBeUndefined();
        for (const [index, source] of images.entries()) {
            const expectedImage = await sharp(source.buffer)
                .rotate()
                .flatten({ background: "#ffffff" })
                .jpeg({ quality: 85 })
                .toBuffer();
            expect(
                await (
                    await request.get(
                        `/api/cards/${card.id}/images/${index + 1}`,
                    )
                ).body(),
            ).toEqual(expectedImage);
        }
        for (let position = 1; position <= images.length; position++) {
            const response = await request.get(
                `/api/cards/${card.id}/images/${position}`,
            );
            expect(response.status()).toBe(200);
            const metadata = await sharp(await response.body()).metadata();
            expect(metadata.format).toBe("jpeg");
            expect(metadata.exif).toBeUndefined();
            if (images.length === 2 && position === 1) {
                expect(metadata.width).toBe(400);
                expect(metadata.height).toBe(640);
            }
        }
        expect(
            (
                await request.get(
                    `/api/cards/${card.id}/images/${images.length + 1}`,
                )
            ).status(),
        ).toBe(404);
        expect(
            (
                await request.delete(`/api/cards/${card.id}`, {
                    headers: { origin },
                })
            ).status(),
        ).toBe(200);
        expect((await request.get(`/api/cards/${card.id}`)).status()).toBe(404);
    }
    const laterInvalid = cardForm("Invalid later image", [
        png,
        png,
        png,
        { ...png, buffer: Buffer.from("invalid image") },
    ]);
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: laterInvalid,
            })
        ).status(),
    ).toBe(400);
    expect((await (await request.get("/api/cards")).json()).cards).toHaveLength(
        0,
    );
    const nameLast = new FormData();
    nameLast.append(
        "images",
        new Blob([new Uint8Array(png.buffer)], { type: png.mimeType }),
        png.name,
    );
    nameLast.set("label", "Name after image");
    const lastFieldCard = await request.post("/api/cards", {
        headers: { origin },
        multipart: nameLast,
    });
    expect(lastFieldCard.status()).toBe(201);
    expect((await lastFieldCard.json()).card.imageCount).toBe(1);
    const duplicate = cardForm("Repeated name");
    duplicate.append("label", "Another name");
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: duplicate,
            })
        ).status(),
    ).toBe(400);
    const invalidLaterField = new FormData();
    for (let index = 0; index < 20; index++) {
        invalidLaterField.append(
            "images",
            new Blob([new Uint8Array(png.buffer)], { type: png.mimeType }),
            png.name,
        );
    }
    invalidLaterField.append("label", "Valid name");
    invalidLaterField.append("label", "Repeated name");
    expect(
        (
            await request.post("/api/cards", {
                headers: { origin },
                multipart: invalidLaterField,
            })
        ).status(),
    ).toBe(400);
    expect((await (await request.get("/api/cards")).json()).cards).toHaveLength(
        1,
    );
    expect(
        (
            await request.post("/api/cards", {
                headers: {
                    origin,
                    "content-type": "multipart/form-data; boundary=unfinished",
                },
                data: '--unfinished\r\nContent-Disposition: form-data; name="images"; filename="broken.png"\r\nContent-Type: image/png\r\n\r\nnot a complete form',
            })
        ).status(),
    ).toBe(400);
    const temporaryAfter = (await readdir(tmpdir())).filter(
        (name) => name.startsWith("foo-upload-") && !temporaryBefore.has(name),
    );
    expect(temporaryAfter).toEqual([]);
});

test("existing number cards remain readable and can be deleted", async ({
    request,
}) => {
    const ownerId = await register(request);
    const legacyId = randomUUID();
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
    });
    try {
        await pool.query(
            "INSERT INTO cards (id,owner_id,label,card_number,barcode_format) VALUES ($1,$2,$3,$4,$5)",
            [
                legacyId,
                ownerId,
                "Legacy synthetic card",
                "001234567890",
                "code128",
            ],
        );
        const response = await request.get(`/api/cards/${legacyId}`);
        expect(response.status()).toBe(200);
        expect((await response.json()).card).toMatchObject({
            imageCount: 0,
            cardNumber: "001234567890",
            barcodeFormat: "code128",
        });
        const barcode = await request.get(`/api/cards/${legacyId}/barcode`);
        expect(barcode.status()).toBe(200);
        const originalBarcode = await barcode.text();
        expect(originalBarcode).toContain("<svg");
        const edited = await request.patch(`/api/cards/${legacyId}`, {
            headers: { origin },
            multipart: editForm(
                "Renamed legacy card",
                0,
                [],
                [await syntheticImage()],
            ),
        });
        expect(edited.status()).toBe(200);
        expect((await edited.json()).card).toMatchObject({
            label: "Renamed legacy card",
            revision: 1,
            imageCount: 1,
            cardNumber: "001234567890",
            barcodeFormat: "code128",
        });
        expect(
            await (await request.get(`/api/cards/${legacyId}/barcode`)).text(),
        ).toBe(originalBarcode);
        expect(
            (
                await request.delete(`/api/cards/${legacyId}`, {
                    headers: { origin },
                })
            ).status(),
        ).toBe(200);
        expect(
            (await request.get(`/api/cards/${legacyId}/barcode`)).status(),
        ).toBe(404);
    } finally {
        await pool.end();
    }
});

test("image reordering preserves bytes and rejects invalid or stale orders", async ({
    request,
}) => {
    await register(request);
    const front = await syntheticImage();
    const back = await syntheticImage("Back");
    const extra = await syntheticImage("Extra");
    const created = await request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Ordered card", [front, back, extra]),
    });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    const path = `/api/cards/${card.id}`;
    const original: Buffer[] = [];
    for (const position of [1, 2, 3]) {
        original.push(
            await (await request.get(`${path}/images/${position}`)).body(),
        );
    }
    async function expectImages(expected: Buffer[]) {
        for (const [index, bytes] of expected.entries()) {
            expect(
                await (await request.get(`${path}/images/${index + 1}`)).body(),
            ).toEqual(bytes);
        }
    }
    for (const order of [
        [1, 1, 2],
        [1, 2],
        [1, 2, 4],
        [0, 2, 3],
        [1, 2, 3, 4],
        [1, 2, "3"],
        "invalid",
    ]) {
        const form = editForm("Invalid order", 0);
        form.set("imageOrder", JSON.stringify(order));
        expect(
            (
                await request.patch(path, {
                    headers: { origin },
                    multipart: form,
                })
            ).status(),
        ).toBe(400);
    }
    // Validation after removal and upload must still roll back the entire edit.
    const invalid = await request.patch(path, {
        headers: { origin },
        multipart: editForm("Must roll back", 0, [1], [front], [1, 4]),
    });
    expect(invalid.status()).toBe(400);
    expect((await (await request.get(path)).json()).card).toEqual(card);
    await expectImages(original);

    const reversed = await request.patch(path, {
        headers: { origin },
        multipart: editForm("Ordered card", 0, [], [], [3, 2, 1]),
    });
    expect(reversed.status()).toBe(200);
    expect((await reversed.json()).card).toMatchObject({
        revision: 1,
        imageCount: 3,
        createdAt: card.createdAt,
    });
    await expectImages([original[2], original[1], original[0]]);
    expect(
        (
            await request.patch(path, {
                headers: { origin },
                multipart: editForm("Stale order", 0, [], [], [2, 1, 3]),
            })
        ).status(),
    ).toBe(409);
    await expectImages([original[2], original[1], original[0]]);

    // Retained images and newly uploaded files can be interleaved freely.
    const mixed = await request.patch(path, {
        headers: { origin },
        multipart: editForm("Mixed order", 1, [2], [back, extra], [4, 2]),
    });
    expect(mixed.status()).toBe(200);
    expect((await mixed.json()).card).toMatchObject({
        revision: 2,
        imageCount: 4,
    });
    await expectImages([original[1], original[0], original[2], original[2]]);
    expect((await request.get(`${path}/images/5`)).status()).toBe(404);

    const cleared = await request.patch(path, {
        headers: { origin },
        multipart: editForm("Empty card", 2, [1, 2, 3, 4], [], []),
    });
    expect(cleared.status()).toBe(200);
    expect((await cleared.json()).card.imageCount).toBe(0);
    const replaced = await request.patch(path, {
        headers: { origin },
        multipart: editForm("New images only", 3, [], [back, front], []),
    });
    expect(replaced.status()).toBe(200);
    await expectImages([original[1], original[0]]);
    // Swapping a retained image with a new image must not insert into a position
    // before the old row at that position has been removed.
    const swapped = await request.patch(path, {
        headers: { origin },
        multipart: editForm("Swapped pair", 4, [1], [extra], [2]),
    });
    expect(swapped.status()).toBe(200);
    expect((await swapped.json()).card).toMatchObject({
        revision: 5,
        imageCount: 2,
    });
    await expectImages([original[2], original[0]]);
});

test("card edits are private, atomic, and reject stale versions", async ({
    playwright,
}) => {
    const owner = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
    });
    const other = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
    });
    const anonymous = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
    });
    const temporaryBefore = new Set(await readdir(tmpdir()));
    try {
        await register(owner);
        await register(other);
        const front = await syntheticImage();
        const back = await syntheticImage("Back");
        const extra = await syntheticImage("Extra");
        const created = await owner.post("/api/cards", {
            multipart: cardForm("Original title", [front, back, extra]),
        });
        expect(created.status()).toBe(201);
        const { card } = await created.json();
        expect(card.revision).toBe(0);
        const originalImages: Buffer[] = [];
        for (const position of [1, 2, 3]) {
            originalImages.push(
                await (
                    await owner.get(`/api/cards/${card.id}/images/${position}`)
                ).body(),
            );
        }
        const path = `/api/cards/${card.id}`;
        expect(
            (
                await other.patch(path, {
                    multipart: editForm("Intruder", 0, [1]),
                })
            ).status(),
        ).toBe(404);
        expect(
            (
                await anonymous.patch(path, {
                    multipart: editForm("Anonymous", 0, [1]),
                })
            ).status(),
        ).toBe(401);
        for (const blockedOrigin of ["https://untrusted.example", ""]) {
            expect(
                (
                    await owner.patch(path, {
                        headers: { origin: blockedOrigin },
                        multipart: editForm("Blocked", 0, [1]),
                    })
                ).status(),
            ).toBe(403);
        }
        expect(
            (
                await owner.patch("/api/cards/not-a-uuid", {
                    multipart: editForm("Invalid", 0),
                })
            ).status(),
        ).toBe(400);
        expect(
            (
                await owner.patch(`/api/cards/${randomUUID()}`, {
                    multipart: editForm("Missing", 0),
                })
            ).status(),
        ).toBe(404);
        for (const form of [
            editForm("", 0),
            editForm("Invalid removal", 0, [4]),
            editForm("Repeated removal", 0, [1, 1]),
            editForm("Negative version", -1),
        ]) {
            expect(
                (await owner.patch(path, { multipart: form })).status(),
            ).toBe(400);
        }
        expect((await (await owner.get(path)).json()).card).toEqual(card);
        const renamed = await owner.patch(path, {
            multipart: editForm("Renamed only", 0),
        });
        expect(renamed.status()).toBe(200);
        expect((await renamed.json()).card).toMatchObject({
            label: "Renamed only",
            revision: 1,
            imageCount: 3,
            createdAt: card.createdAt,
        });
        for (const position of [1, 2, 3]) {
            expect(
                await (await owner.get(`${path}/images/${position}`)).body(),
            ).toEqual(originalImages[position - 1]);
        }
        const invalid = { ...extra, buffer: Buffer.from("not an image") };
        const failed = await owner.patch(path, {
            multipart: editForm("Must roll back", 1, [1, 2], [front, invalid]),
        });
        expect(failed.status()).toBe(400);
        expect((await (await owner.get(path)).json()).card).toMatchObject({
            label: "Renamed only",
            revision: 1,
            imageCount: 3,
        });
        for (const position of [1, 2, 3]) {
            expect(
                await (await owner.get(`${path}/images/${position}`)).body(),
            ).toEqual(originalImages[position - 1]);
        }
        const updated = await owner.patch(path, {
            multipart: editForm("Updated card", 1, [2], [back, front]),
        });
        expect(updated.status()).toBe(200);
        const changed = (await updated.json()).card;
        expect(changed).toMatchObject({
            label: "Updated card",
            revision: 2,
            imageCount: 4,
            createdAt: card.createdAt,
        });
        expect(updated.headers()["cache-control"]).toContain("no-store");
        const expected = [
            originalImages[0],
            originalImages[2],
            originalImages[1],
            originalImages[0],
        ];
        for (let index = 0; index < expected.length; index++) {
            expect(
                await (await owner.get(`${path}/images/${index + 1}`)).body(),
            ).toEqual(expected[index]);
        }
        expect(
            (
                await owner.patch(path, {
                    multipart: editForm("Stale edit", 1, [1]),
                })
            ).status(),
        ).toBe(409);
        expect((await (await owner.get(path)).json()).card).toEqual(changed);
        const cleared = await owner.patch(path, {
            multipart: editForm("No photos", 2, [1, 2, 3, 4]),
        });
        expect(cleared.status()).toBe(200);
        expect((await cleared.json()).card).toMatchObject({
            revision: 3,
            imageCount: 0,
        });
        for (const position of [1, 2, 3, 4]) {
            expect(
                (await owner.get(`${path}/images/${position}`)).status(),
            ).toBe(404);
        }
        const competing = await Promise.all([
            owner.patch(path, {
                multipart: editForm("First edit", 3, [], [front]),
            }),
            owner.patch(path, {
                multipart: editForm("Second edit", 3, [], [back]),
            }),
        ]);
        expect(competing.map((response) => response.status()).sort()).toEqual([
            200, 409,
        ]);
        const winner = competing.find((response) => response.status() === 200)!;
        expect((await (await owner.get(path)).json()).card).toEqual(
            (await winner.json()).card,
        );
        expect((await (await owner.get(path)).json()).card).toMatchObject({
            revision: 4,
            imageCount: 1,
        });
        expect((await other.get(`${path}/images/1`)).status()).toBe(404);
        expect((await anonymous.get(`${path}/images/1`)).status()).toBe(401);
        const temporaryAfter = (await readdir(tmpdir())).filter(
            (name) =>
                name.startsWith("foo-upload-") && !temporaryBefore.has(name),
        );
        expect(temporaryAfter).toEqual([]);
    } finally {
        await owner.dispose();
        await other.dispose();
        await anonymous.dispose();
    }
});
