import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

export async function GET() {
    const bytes = await readFile(
        join(
            process.cwd(),
            "node_modules/zxing-wasm/dist/full/zxing_full.wasm",
        ),
    );
    return new Response(bytes, {
        headers: {
            "Content-Type": "application/wasm",
            "Cache-Control": "public, max-age=0, must-revalidate",
        },
    });
}
