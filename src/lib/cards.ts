import { z } from "zod";

export const barcodeFormats = ["code128", "ean13", "qrcode"] as const;
export type BarcodeFormat = (typeof barcodeFormats)[number];
export const maxCardImages = 2;
export const maxImageBytes = 10 * 1024 * 1024;
export const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"];
export const cardInput = z
  .object({
    label: z.string().trim().min(1, "Give your card a name.").max(80),
  })
  .strict();
export type CardInput = z.infer<typeof cardInput>;
export type Card = CardInput & {
  id: string;
  createdAt: string;
  imageCount: number;
  // Only older cards have these values. New cards use images.
  cardNumber?: string;
  barcodeFormat?: BarcodeFormat;
};
export const formatNames: Record<BarcodeFormat, string> = {
  code128: "Code 128",
  ean13: "EAN-13",
  qrcode: "QR code",
};
