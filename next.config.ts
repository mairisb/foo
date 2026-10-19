import type { NextConfig } from "next";
import { getAppOrigins } from "./src/server/origins";

const nextConfig: NextConfig = {
    agentRules: false,
    poweredByHeader: false,
    outputFileTracingIncludes: {
        "/barcode-engine.wasm": [
            "./node_modules/zxing-wasm/dist/full/zxing_full.wasm",
        ],
    },
    allowedDevOrigins: getAppOrigins().map(
        (origin) => new URL(origin).hostname,
    ),
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "no-referrer" },
                    { key: "X-Frame-Options", value: "DENY" },
                ],
            },
        ];
    },
};
export default nextConfig;
