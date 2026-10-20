"use client";

import { useRef } from "react";
import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function FullScreenViewer({
    title,
    closeLabel,
    triggerId,
    onClose,
    children,
}: {
    title: string;
    closeLabel: string;
    triggerId: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const closeButton = useRef<HTMLButtonElement>(null);

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                showCloseButton={false}
                initialFocus={closeButton}
                finalFocus={() => document.getElementById(triggerId) ?? false}
                className="fixed inset-0 top-0 left-0 block h-dvh w-dvw max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white ring-0 duration-0 data-open:animate-none data-closed:animate-none sm:max-w-none"
            >
                <DialogTitle className="sr-only">{title}</DialogTitle>
                {children}
                <Button
                    ref={closeButton}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] size-11 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                    aria-label={closeLabel}
                    onClick={onClose}
                >
                    <X aria-hidden="true" />
                </Button>
            </DialogContent>
        </Dialog>
    );
}
