"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog as ShadcnDialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <ShadcnDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle className="min-w-0 break-words">{title}</DialogTitle>
          <DialogClose
            aria-label="Close dialog"
            render={<Button variant="ghost" className="h-11" />}
          >
            Close
          </DialogClose>
        </DialogHeader>
        {children}
      </DialogContent>
    </ShadcnDialog>
  );
}
