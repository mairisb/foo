"use client";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
    Dialog as ShadcnDialog,
    DialogClose,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export function Dialog({
    title,
    footer,
    children,
    onClose,
    closeDisabled = false,
}: {
    title: string;
    footer?: React.ReactNode;
    children: React.ReactNode;
    onClose: () => void;
    closeDisabled?: boolean;
}) {
    return (
        <ShadcnDialog
            open
            onOpenChange={(open) => {
                if (!open && !closeDisabled) {
                    onClose();
                }
            }}
        >
            <DialogContent
                showCloseButton={false}
                className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0"
            >
                <DialogHeader className="shrink-0 gap-2 border-b bg-popover px-4 py-2">
                    <div className="flex items-start gap-3">
                        <DialogTitle className="min-w-0 flex-1 py-3 leading-snug break-words">
                            {title}
                        </DialogTitle>
                        <DialogClose
                            aria-label="Close dialog"
                            disabled={closeDisabled}
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-11 shrink-0"
                                />
                            }
                        >
                            <X aria-hidden="true" />
                        </DialogClose>
                    </div>
                </DialogHeader>
                <div
                    data-slot="dialog-body"
                    className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-4"
                >
                    {children}
                </div>
                {footer && (
                    <div
                        data-slot="dialog-footer"
                        className="shrink-0 border-t bg-popover p-4"
                    >
                        {footer}
                    </div>
                )}
            </DialogContent>
        </ShadcnDialog>
    );
}
