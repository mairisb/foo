import { test, expect } from "@playwright/test";
import { cleanUp, origin, register, sampleCard, syntheticImage, cardForm } from "./helpers";
import { getAppOrigins } from "../src/server/origins";
import { maxImageBytes } from "../src/lib/cards";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

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
  expect(getAppOrigins("https://foo.example", "production", lanOrigin)).toEqual(
    ["https://foo.example"],
  );
});
test("only the owner can list, read, and display their cards", async ({
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
    const created = await owner.post("/api/cards", { multipart: cardForm(sampleCard.label, [await syntheticImage(), await syntheticImage("Back")]) });
    expect(created.status()).toBe(201);
    const { card } = await created.json();
    expect(card.imageCount).toBe(2);
    const ownCards = await owner.get("/api/cards");
    expect((await ownCards.json()).cards).toHaveLength(1);
    expect(ownCards.headers()["cache-control"]).toContain("no-store");
    expect((await (await other.get("/api/cards")).json()).cards).toHaveLength(
      0,
    );
    for (const suffix of ["", "/images/1", "/images/2"]) {
      expect((await other.get(`/api/cards/${card.id}${suffix}`)).status()).toBe(
        404,
      );
      expect(
        (await anonymous.get(`/api/cards/${card.id}${suffix}`)).status(),
      ).toBe(401);
    }
    expect((await owner.get(`/api/cards/${card.id}`)).status()).toBe(200);
    for (const position of [1, 2]) {
      const image = await owner.get(`/api/cards/${card.id}/images/${position}`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/jpeg");
      expect(image.headers()["cache-control"]).toContain("no-store");
      expect(image.headers()["x-content-type-options"]).toBe("nosniff");
      expect((await sharp(await image.body()).metadata()).format).toBe("jpeg");
    }
    expect((await owner.get(`/api/cards/${card.id}/images/3`)).status()).toBe(404);
    expect((await owner.get(`/api/cards/${card.id}/barcode`)).status()).toBe(404);
    expect(
      (
        await owner.patch(`/api/cards/${card.id}`, { data: sampleCard })
      ).status(),
    ).toBe(405);
    expect((await owner.delete(`/api/cards/${card.id}`)).status()).toBe(405);
    expect((await owner.post(`/api/cards/${card.id}/shares`)).status()).toBe(
      404,
    );
    expect((await owner.post("/api/shared")).status()).toBe(404);
  } finally {
    await owner.dispose();
    await other.dispose();
    await anonymous.dispose();
  }
});

test("image cards validate uploads and accept zero, one, or two images", async ({
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
  expect(
    (
      await request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Too many images", [await syntheticImage(), await syntheticImage(), await syntheticImage()]),
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/cards", {
        headers: { origin },
        multipart: cardForm("Invalid image", [{ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not an image") }]),
      })
    ).status(),
  ).toBe(400);
  for (const badImage of [
    { name: "card.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') },
    { name: "empty.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(0) },
  ]) {
    expect((await request.post("/api/cards", { headers: { origin }, multipart: cardForm("Bad image", [badImage]) })).status()).toBe(400);
  }
  expect((await request.post("/api/cards", {
    headers: { origin },
    multipart: cardForm("Oversized", [{ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(maxImageBytes + 1) }]),
  })).status()).toBe(413);
  expect((await request.post("/api/cards", {
    headers: { origin },
    multipart: cardForm("Oversized request", [1, 2].map(() => ({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024) }))),
  })).status()).toBe(413);
  const extraField = cardForm("Unexpected field");
  extraField.set("owner_id", "someone-else");
  expect((await request.post("/api/cards", { headers: { origin }, multipart: extraField })).status()).toBe(400);
  expect((await request.get("/api/cards")).status()).toBe(200);
  expect((await (await request.get("/api/cards")).json()).cards).toHaveLength(0);

  const png = await syntheticImage();
  const jpeg = await syntheticImage("Front", "jpeg");
  const oriented = { ...jpeg, buffer: await sharp(jpeg.buffer).withMetadata({ orientation: 6 }).jpeg().toBuffer() };
  const webp = await syntheticImage("Back", "webp");
  for (const images of [[], [png], [oriented, webp]]) {
    const response = await request.post("/api/cards", {
      headers: { origin },
      multipart: cardForm(`${images.length} images`, images),
    });
    expect(response.status()).toBe(201);
    const { card } = await response.json();
    expect(card.imageCount).toBe(images.length);
    expect(card.cardNumber).toBeUndefined();
    expect(card.barcodeFormat).toBeUndefined();
    for (let position = 1; position <= images.length; position++) {
      const response = await request.get(`/api/cards/${card.id}/images/${position}`);
      expect(response.status()).toBe(200);
      const metadata = await sharp(await response.body()).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.exif).toBeUndefined();
      if (images.length === 2 && position === 1) {
        expect(metadata.width).toBe(400);
        expect(metadata.height).toBe(640);
      }
    }
    expect((await request.get(`/api/cards/${card.id}/images/${images.length + 1}`)).status()).toBe(404);
  }
});

test("existing number cards remain readable", async ({ request }) => {
  const ownerId = await register(request);
  const legacyId = randomUUID();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("INSERT INTO cards (id,owner_id,label,card_number,barcode_format) VALUES ($1,$2,$3,$4,$5)",
      [legacyId, ownerId, "Legacy synthetic card", "001234567890", "code128"]);
    const response = await request.get(`/api/cards/${legacyId}`);
    expect(response.status()).toBe(200);
    expect((await response.json()).card).toMatchObject({ imageCount: 0, cardNumber: "001234567890", barcodeFormat: "code128" });
    const barcode = await request.get(`/api/cards/${legacyId}/barcode`);
    expect(barcode.status()).toBe(200);
    expect(await barcode.text()).toContain("<svg");
  } finally {
    await pool.end();
  }
});
