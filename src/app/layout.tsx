import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
    title: "foo",
    description: "Your loyalty cards.",
    applicationName: "foo",
    manifest: "/manifest.webmanifest",
    icons: {
        icon: [
            {
                url: "/favicon.ico?v=3",
                sizes: "16x16 32x32",
                type: "image/x-icon",
            },
            { url: "/icon.svg?v=3", sizes: "any", type: "image/svg+xml" },
        ],
        apple: {
            url: "/apple-touch-icon.png?v=4",
            sizes: "180x180",
            type: "image/png",
        },
    },
};
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: "#ffffff",
};
export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Browser theme extensions can add attributes to html before hydration.
    // Allow those differences on this element; descendants remain checked.
    return (
        <html
            lang="en"
            className={cn("font-sans", geist.variable)}
            suppressHydrationWarning
        >
            <body>
                <div className="app-root">{children}</div>
                <Toaster />
            </body>
        </html>
    );
}
