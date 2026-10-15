"use client";
import { useContext, useLayoutEffect } from "react";
import { DialogPendingContext } from "@/lib/dialog-history";
import {
    Dialog as ShadcnDialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export function Dialog({
    title,
    headerActions,
    footer,
    children,
    onClose,
    closeDisabled = false,
}: {
    title: string;
    headerActions?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
    onClose: () => void;
    closeDisabled?: boolean;
}) {
    const setPending = useContext(DialogPendingContext);
    useLayoutEffect(() => {
        setPending?.(closeDisabled);
        return () => setPending?.(false);
    }, [closeDisabled, setPending]);

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
                        {headerActions}
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
