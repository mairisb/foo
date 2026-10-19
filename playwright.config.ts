import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";
export default defineConfig({
    testDir: "./tests",
    timeout: 60000,
    expect: { timeout: 12000 },
    fullyParallel: false,
    workers: 1,
    reporter: "list",
    use: {
        baseURL: "http://localhost:3000",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "desktop",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1440, height: 1000 },
            },
        },
        {
            name: "mobile",
            testMatch: [
                "**/wallet.spec.ts",
                "**/codes.spec.ts",
                "**/hydration.spec.ts",
            ],
            use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
        },
        {
            name: "android",
            testMatch: "**/wallet.spec.ts",
            grep: /browser Back|Scanic/,
            use: {
                ...devices["Pixel 7"],
                defaultBrowserType: "chromium",
                baseURL: process.env.DEV_APP_ORIGIN ?? "http://localhost:3000",
            },
        },
        {
            name: "loopback",
            testMatch: "**/wallet.spec.ts",
            use: {
                ...devices["Desktop Chrome"],
                baseURL: "http://127.0.0.1:3000",
            },
        },
        ...(process.env.DEV_APP_ORIGIN
            ? [
                  {
                      name: "lan",
                      testMatch: [
                          "**/wallet.spec.ts",
                          "**/codes.spec.ts",
                          "**/hydration.spec.ts",
                      ],
                      use: {
                          ...devices["iPhone 13"],
                          defaultBrowserType: "chromium" as const,
                          baseURL: process.env.DEV_APP_ORIGIN,
                      },
                  },
              ]
            : []),
    ],
    webServer: {
        command: "npm run dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
    },
});
