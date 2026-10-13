import "server-only";
import sharp from "sharp";
import { cardInput, imageMimeTypes, maxCardImages, maxImageBytes } from "@/lib/cards";
import { HttpError } from "./http";

const maxRequestBytes = maxCardImages * maxImageBytes + 64 * 1024;
const maxStoredBytes = 3 * 1024 * 1024;

async function readMultipart(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new HttpError(415, "Send the card as a form with optional images.");
  }
  if (Number(request.headers.get("content-length")) > maxRequestBytes) {
    throw new HttpError(413, "Upload up to two images, 10 MB each.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "The card form is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        await reader.cancel();
        throw new HttpError(413, "Upload up to two images, 10 MB each.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "Couldn't read the card form. Please try again.");
  }
}

async function prepareImage(file: File) {
  if (file.size === 0) throw new HttpError(400, "Choose an image that isn't empty.");
  if (file.size > maxImageBytes) throw new HttpError(413, "Each image must be 10 MB or smaller.");
  if (file.type && !imageMimeTypes.includes(file.type)) {
    throw new HttpError(400, "Choose JPG, PNG, or WebP images.");
  }
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 60_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new HttpError(400, "Choose JPG, PNG, or WebP images.");
    }
    // Apply phone-camera orientation and strip metadata by re-encoding.
    const data = await image.rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (data.length > maxStoredBytes) throw new HttpError(413, "That image is too large. Choose a smaller image.");
    return data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Couldn't read an image. Choose a valid JPG, PNG, or WebP image.");
  }
}

export async function readCardUpload(request: Request) {
  const form = await readMultipart(request);
  for (const key of form.keys()) {
    if (key !== "label" && key !== "images") throw new HttpError(400, "The card form has an unexpected field.");
  }
  if (form.getAll("label").length !== 1) throw new HttpError(400, "Give your card a name.");
  const input = cardInput.parse({ label: form.get("label") });
  const files = form.getAll("images").filter(value => !(value instanceof File && value.name === "" && value.size === 0));
  if (files.length > maxCardImages) throw new HttpError(400, "Upload up to two images per card.");
  const images: Buffer[] = [];
  for (const file of files) {
    if (!(file instanceof File)) throw new HttpError(400, "Choose image files to upload.");
    images.push(await prepareImage(file));
  }
  return { input, images };
}
