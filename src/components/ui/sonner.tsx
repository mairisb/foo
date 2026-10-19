"use client";
import { Toaster as Sonner } from "sonner";
import {
    CheckCircleIcon,
    ErrorIcon,
    InfoIcon,
    LoaderCircle,
    WarningIcon,
} from "@/components/icons";

export function Toaster() {
    return (
        <Sonner
            theme="light"
            position="top-center"
            style={{ pointerEvents: "none" }}
            icons={{
                success: <CheckCircleIcon />,
                error: <ErrorIcon />,
                info: <InfoIcon />,
                warning: <WarningIcon />,
                loading: <LoaderCircle className="animate-spin" />,
            }}
            toastOptions={{
                style: { pointerEvents: "none" },
                classNames: {
                    toast: "!border-border !bg-popover !text-popover-foreground !font-sans",
                },
            }}
        />
    );
}
