import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
    ...nextVitals,
    ...nextTypescript,
    prettier,
    {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
        rules: {
            curly: ["error", "all"],
        },
    },
    {
        files: [
            "src/components/card-form.tsx",
            "src/components/card-detail.tsx",
            "src/components/card-codes.tsx",
        ],
        rules: {
            // Browser requests carry the session for private images and support
            // temporary blob URLs and generated code data URLs; these images must
            // bypass server optimization.
            "@next/next/no-img-element": "off",
        },
    },
    globalIgnores([
        ".next/**",
        "out/**",
        "build/**",
        "coverage/**",
        "test-results/**",
        "playwright-report/**",
        "next-env.d.ts",
    ]),
]);
