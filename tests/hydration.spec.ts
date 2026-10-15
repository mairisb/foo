import { test, expect } from "@playwright/test";

for (const browserTheme of [false, true]) {
    test(`account page hydrates ${browserTheme ? "with browser theme attributes" : "normally"}`, async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") {
                errors.push(message.text());
            }
        });
        page.on("pageerror", (error) => errors.push(error.message));

        if (browserTheme) {
            // Reproduce the document-start changes reported by Dark Reader in the
            // development log, before React hydrates the server-rendered document.
            await page.addInitScript(() => {
                function applyBrowserTheme() {
                    const root = document.documentElement;
                    if (!root) {
                        return false;
                    }
                    root.setAttribute("data-darkreader-mode", "dynamic");
                    root.setAttribute("data-darkreader-scheme", "dark");
                    root.classList.add("foo-synthetic-browser-theme");
                    return true;
                }
                if (!applyBrowserTheme()) {
                    const observer = new MutationObserver(() => {
                        if (applyBrowserTheme()) {
                            observer.disconnect();
                        }
                    });
                    observer.observe(document, {
                        childList: true,
                        subtree: true,
                    });
                }
            });
        }

        await page.goto("/login");
        // This transition verifies that hydration attached the event handlers.
        await page.getByRole("button", { name: "Create an account" }).click();
        await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Back to sign in" }).click();
        await expect(
            page.getByRole("heading", { name: "Sign in", exact: true }),
        ).toBeVisible();

        if (browserTheme) {
            await expect(page.locator("html")).toHaveAttribute(
                "data-darkreader-mode",
                "dynamic",
            );
            await expect(page.locator("html")).toHaveClass(
                /foo-synthetic-browser-theme/,
            );
        }
        expect(errors).toEqual([]);
    });
}
