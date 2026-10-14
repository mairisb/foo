import "server-only";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import busboy from "busboy";
import sharp from "sharp";
import { cardInput, imageMimeTypes, maxImageBytes, type CardInput } from "@/lib/cards";
import { HttpError } from "./http";

const maxStoredBytes = 3 * 1024 * 1024;
type UploadFile = { path: string; emptyName: boolean };

async function prepareImage(path: string) {
  const source = await readFile(path);
  if (source.length === 0) throw new HttpError(400, "Choose an image that isn't empty.");
  try {
    const image = sharp(source, {
      limitInputPixels: 60_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new HttpError(400, "Choose JPG, PNG, or WebP images.");
    }
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

export async function readCardUpload<T>(
  request: Request,
  save: (input: CardInput, images: AsyncIterable<Buffer>) => Promise<T>,
) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new HttpError(415, "Send the card as a form with optional images.");
  }
  if (!request.body) throw new HttpError(400, "The card form is empty.");
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      limits: { fileSize: maxImageBytes + 1, fieldSize: 320, fields: 1 },
    });
  } catch {
    throw new HttpError(400, "Couldn't read the card form. Please try again.");
  }

  // Stream raw files to a private temporary directory instead of buffering the
  // whole request. Normalize and insert them one at a time in the card transaction.
  const directory = await mkdtemp(join(tmpdir(), "foo-upload-"));
  const files: UploadFile[] = [];
  const writes: Promise<void>[] = [];
  const pendingWrites = new Set<Promise<void>>();
  let writing = Promise.resolve();
  let label: string | undefined;
  let failure: unknown;
  function fail(error: Error) {
    failure ??= error;
  }
  parser.on("field", (name, value, info) => {
    if (name !== "label" || info.nameTruncated || info.valueTruncated || label !== undefined) {
      fail(new HttpError(400, "The card form has an invalid or repeated field."));
      return;
    }
    label = value;
  });
  parser.on("fieldsLimit", () => fail(new HttpError(400, "The card form has an unexpected or repeated field.")));
  parser.on("file", (name, stream, info) => {
    stream.on("error", () => {}); // The parser and write pipeline report the failure.
    if (failure || name !== "images" || (info.filename !== "" && !imageMimeTypes.includes(info.mimeType))) {
      stream.resume();
      fail(new HttpError(400, name === "images" ? "Choose JPG, PNG, or WebP images." : "The card form has an unexpected field."));
      return;
    }
    stream.on("limit", () => fail(new HttpError(413, "Each image must be 10 MB or smaller.")));
    const file = { path: join(directory, randomUUID()), emptyName: info.filename === "" };
    files.push(file);
    const write = writing.then(async () => {
      if (failure) stream.resume();
      else await pipeline(stream, createWriteStream(file.path, { flags: "wx", mode: 0o600 }));
    })
      .catch(error => {
        fail(error);
        parser.destroy(error);
      });
    writing = write;
    writes.push(write);
    pendingWrites.add(write);
    void write.then(() => pendingWrites.delete(write));
  });

  const reader = request.body.getReader();
  let parseError: unknown;
  const parserDone = finished(parser, { cleanup: true }).catch(error => { parseError = error; });
  try {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let offset = 0; offset < value.byteLength; offset += 64 * 1024) {
          if (parseError) throw parseError;
          await new Promise<void>((resolve, reject) => {
            parser.write(value.subarray(offset, offset + 64 * 1024), error => error ? reject(error) : resolve());
          });
          // Earlier files have complete data once later files are emitted.
          // Let their writes finish before reading more, including tiny images.
          while (pendingWrites.size > 8) await pendingWrites.values().next().value;
        }
      }
      parser.end();
      await parserDone;
      if (parseError) throw parseError;
      await Promise.all(writes);
      if (failure) throw failure;
    } catch (error) {
      parser.destroy(error instanceof Error ? error : new Error("Invalid form."));
      // Keep the connection usable for a JSON error response on malformed forms.
      try { while (!(await reader.read()).done) {} } catch {}
      await parserDone;
      if (failure instanceof HttpError) throw failure;
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "Couldn't read the card form. Please try again.");
    }
    if (label === undefined) throw new HttpError(400, "Give your card a name.");
    const input = cardInput.parse({ label });
    async function* images() {
      for (const file of files) {
        if (file.emptyName && (await stat(file.path)).size === 0) continue;
        yield await prepareImage(file.path);
      }
    }
    return await save(input, images());
  } finally {
    reader.releaseLock();
    await Promise.allSettled(writes);
    // Upload filenames are never used. Remove only this request's generated
    // files individually, then remove its empty temporary directory.
    for (const file of files) await rm(file.path, { force: true });
    await rmdir(directory);
  }
}
