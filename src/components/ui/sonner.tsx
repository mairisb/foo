"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
    return (
        <Sonner
            theme="light"
            position="top-center"
            style={{ pointerEvents: "none" }}
            toastOptions={{
                style: { pointerEvents: "none" },
                classNames: {
                    toast: "!border-border !bg-popover !text-popover-foreground !font-sans",
                },
            }}
        />
    );
}
