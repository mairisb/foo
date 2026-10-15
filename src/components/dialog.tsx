"use client";
import { useContext, useLayoutEffect, useRef } from "react";
import { DialogPendingContext } from "@/lib/dialog-history";
import { cn } from "cn";
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
    className,
    bodyClassName,
}: {
    title: string;
    headerActions?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
    onClose: () => void;
    closeDisabled?: boolean;
    className?: string;
    bodyClassName?: string;
}) {
    const setPending = useContext(DialogPendingContext);
    const content = useRef<HTMLDivElement>(null);
    const body = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (body.current) {
            body.current.scrollTop = 0;
        }
    }, [title]);
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
                ref={content}
                initialFocus={content}
                showCloseButton={false}
                className={cn(
                    "flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0",
                    className,
                )}
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
                    ref={body}
                    data-slot="dialog-body"
                    className={cn(
                        "grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-4",
                        bodyClassName,
                    )}
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
