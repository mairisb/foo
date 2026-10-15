import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { expect, type APIRequestContext } from "@playwright/test";

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
      Number(headers["x-retry-after"] ?? headers["retry-after"] ?? 10) || 10,
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
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
  }
}

export async function syntheticImage(side = "Front", format: "png" | "jpeg" | "webp" = "png") {
  const source = Buffer.from(`<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="640" height="400" fill="${side === "Back" ? "#e9e4da" : "#d9e7d3"}"/>
    <text x="40" y="100" font-family="sans-serif" font-size="36" fill="#111">Test card — ${side}</text>
    <text x="40" y="160" font-family="sans-serif" font-size="24" fill="#444">Synthetic image</text>
  </svg>`);
  return { name: `${side.toLowerCase()}.${format}`, mimeType: `image/${format}`, buffer: await sharp(source).toFormat(format).toBuffer() };
}

export function cardForm(label: string, images: Array<{ name: string; mimeType: string; buffer: Buffer }> = []) {
  const form = new FormData();
  form.set("label", label);
  for (const image of images) form.append("images", new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }), image.name);
  return form;
}
export function editForm(
  label: string,
  revision: number,
  removeImages: number[] = [],
  images: Parameters<typeof cardForm>[1] = [],
) {
  const form = cardForm(label, images);
  form.set("revision", String(revision));
  form.set("removeImages", JSON.stringify(removeImages));
  return form;
}

export async function cleanUp() {
  const cleanupPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    if (testEmails.length)
      await cleanupPool.query(
        'DELETE FROM "user" WHERE email=ANY($1::text[])',
        [testEmails],
      );
    testEmails.length = 0;
  } finally {
    await cleanupPool.end();
  }
}
