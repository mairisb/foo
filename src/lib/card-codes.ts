import { z } from "zod";

export const codeFormats = [
    "QRCode",
    "MicroQRCode",
    "RMQRCode",
    "Code128",
    "Code39",
    "Code39Std",
    "Code39Ext",
    "Code93",
    "Codabar",
    "ITF",
    "ITF14",
    "EAN13",
    "EAN8",
    "UPCA",
    "UPCE",
    "PDF417",
    "CompactPDF417",
    "MicroPDF417",
    "DataMatrix",
    "Aztec",
    "AztecCode",
] as const;
export const maxCardCodes = 64;
export const cardCode = z
    .object({
        format: z.enum(codeFormats),
        text: z.string().max(8192),
        bytes: z
            .string()
            .min(4)
            .max(10924)
            .regex(
                /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            ),
        gs1: z.boolean(),
    })
    .strict();
export type CardCode = z.infer<typeof cardCode>;
export function codeKey(code: CardCode) {
    return JSON.stringify([code.format, code.bytes, code.gs1]);
}
export const cardCodes = z
    .array(cardCode)
    .max(maxCardCodes)
    .refine(
        (codes) => new Set(codes.map(codeKey)).size === codes.length,
        "This card contains duplicate codes.",
    );
