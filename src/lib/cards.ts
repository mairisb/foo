import { z } from "zod";

export const barcodeFormats = ["code128", "ean13", "qrcode"] as const;
export type BarcodeFormat = (typeof barcodeFormats)[number];
export const maxImageBytes = 10 * 1024 * 1024;
export const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"];
export const imageRotation = z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
]);
export type ImageRotation = z.infer<typeof imageRotation>;
export const cardInput = z
    .object({
        label: z.string().trim().min(1, "Give your card a name.").max(80),
    })
    .strict();
export type CardInput = z.infer<typeof cardInput>;
export const cardEditInput = cardInput.extend({
    revision: z.number().int().min(0).max(2147483647),
    removeImages: z
        .array(z.number().int().min(1).max(2147483647))
        .refine(
            (positions) => new Set(positions).size === positions.length,
            "Choose each image only once.",
        ),
    // Final destinations for retained images, listed in original position order.
    // Newly uploaded files fill the other positions in upload order.
    imageOrder: z
        .array(z.number().int().min(1).max(2147483647))
        .refine(
            (positions) => new Set(positions).size === positions.length,
            "Choose each image position only once.",
        )
        .optional(),
    rotateImages: z
        .array(
            z
                .object({
                    position: z.number().int().min(1).max(2147483647),
                    rotation: imageRotation,
                })
                .strict(),
        )
        .refine(
            (images) =>
                new Set(images.map((image) => image.position)).size ===
                images.length,
            "Choose each image rotation only once.",
        )
        .optional(),
});
export type CardEditInput = z.infer<typeof cardEditInput>;
export type Card = CardInput & {
    id: string;
    createdAt: string;
    revision: number;
    imageCount: number;
    // Only older cards have these values. New cards use images.
    cardNumber?: string;
    barcodeFormat?: BarcodeFormat;
};
export const cardImageUrl = (card: Card, position: number) =>
    `/api/cards/${card.id}/images/${position}?v=${card.revision}`;
export const formatNames: Record<BarcodeFormat, string> = {
    code128: "Code 128",
    ean13: "EAN-13",
    qrcode: "QR code",
};
