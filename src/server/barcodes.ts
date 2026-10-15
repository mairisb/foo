import bwipjs from "bwip-js/node";
import type { BarcodeFormat } from "@/lib/cards";

export function barcodeSvg(format: BarcodeFormat, payload: string) {
    return bwipjs.toSVG({
        bcid: format,
        text: payload,
        scale: 3,
        height: 16,
        padding: 10,
        backgroundcolor: "FFFFFF",
        includetext: false,
    });
}
