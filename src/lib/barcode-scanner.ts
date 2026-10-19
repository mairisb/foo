import { cardCode, codeFormats, codeKey, type CardCode } from "./card-codes";

let enginePromise: Promise<typeof import("zxing-wasm")> | undefined;

function barcodeEngine() {
    enginePromise ??= (async () => {
        const engine = await import("zxing-wasm");
        const response = await fetch("/barcode-engine.wasm", {
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
            throw new Error(
                "Couldn't load the barcode scanner. Please try again.",
            );
        }
        await engine.prepareZXingModule({
            overrides: { wasmBinary: await response.arrayBuffer() },
            fireImmediately: true,
        });
        return engine;
    })().catch((error: unknown) => {
        enginePromise = undefined;
        throw error;
    });
    return enginePromise;
}

export async function scanImageCodes(blob: Blob): Promise<CardCode[]> {
    const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
    });
    try {
        if (bitmap.width * bitmap.height > 60_000_000) {
            throw new Error("Choose an image with 60 megapixels or fewer.");
        }
        const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Couldn't read this image. Try another image.");
        }
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const engine = await barcodeEngine();
        const results = await engine.readBarcodes(
            context.getImageData(0, 0, canvas.width, canvas.height),
            {
                formats: [
                    "QRCode",
                    "EANUPC",
                    "Code128",
                    "Code39",
                    "Code93",
                    "Codabar",
                    "ITF",
                    "DataMatrix",
                    "PDF417",
                    "Aztec",
                ],
                tryHarder: true,
                tryRotate: true,
                tryInvert: true,
                textMode: "HRI",
                maxNumberOfSymbols: 0,
            },
        );
        const found: CardCode[] = [];
        const seen = new Set<string>();
        for (const result of results) {
            if (!result.isValid || result.bytes.length === 0) {
                continue;
            }
            const format =
                result.symbology === "QRCode" &&
                result.format.startsWith("QRCodeModel")
                    ? "QRCode"
                    : result.format;
            if (!codeFormats.includes(format as CardCode["format"])) {
                continue;
            }
            const parsed = cardCode.safeParse({
                format,
                text: result.text,
                bytes: btoa(String.fromCharCode(...result.bytes)),
                gs1: result.contentType === "GS1",
            });
            if (parsed.success && !seen.has(codeKey(parsed.data))) {
                found.push(parsed.data);
                seen.add(codeKey(parsed.data));
            }
        }
        return found;
    } finally {
        bitmap.close();
    }
}

export async function renderCardCode(code: CardCode) {
    const engine = await barcodeEngine();
    const result = await engine.writeBarcode(
        code.gs1
            ? code.text
            : Uint8Array.from(atob(code.bytes), (character) =>
                  character.charCodeAt(0),
              ),
        {
            format: code.format,
            options: code.gs1 ? "gs1" : "",
            scale: 3,
            addQuietZones: true,
        },
    );
    if (result.error || !result.svg) {
        throw new Error("Couldn't display this code.");
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
}
