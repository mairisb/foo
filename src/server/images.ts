import "server-only";
import sharp from "sharp";
import type { ImageRotation } from "@/lib/cards";
import { HttpError } from "./http";

const maxStoredBytes = 3 * 1024 * 1024;

export async function prepareCardImage(
    source: Buffer,
    rotation: ImageRotation = 0,
) {
    if (source.length === 0) {
        throw new HttpError(400, "Choose an image that isn't empty.");
    }
    try {
        const image = sharp(source, {
            limitInputPixels: 60_000_000,
            failOn: "warning",
        });
        const metadata = await image.metadata();
        if (
            !metadata.format ||
            !["jpeg", "png", "webp"].includes(metadata.format)
        ) {
            throw new HttpError(400, "Choose JPG, PNG, or WebP images.");
        }
        const data = await image
            .autoOrient()
            .rotate(rotation)
            .resize({
                width: 2000,
                height: 2000,
                fit: "inside",
                withoutEnlargement: true,
            })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 85 })
            .toBuffer();
        if (data.length > maxStoredBytes) {
            throw new HttpError(
                413,
                "That image is too large. Choose a smaller image.",
            );
        }
        return data;
    } catch (error) {
        if (error instanceof HttpError) {
            throw error;
        }
        throw new HttpError(
            400,
            "Couldn't read an image. Choose a valid JPG, PNG, or WebP image.",
        );
    }
}
