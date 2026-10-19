"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cardImageUrl, type Card } from "@/lib/cards";

export function ImageViewer({
    card,
    position,
    onClose,
}: {
    card: Card;
    position: number;
    onClose: () => void;
}) {
    const closeButton = useRef<HTMLButtonElement>(null);
    const [failed, setFailed] = useState(false);

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
                finalFocus={() =>
                    document.getElementById(
                        `card-${card.id}-image-${position}`,
                    ) ?? false
                }
                className="fixed inset-0 top-0 left-0 block h-dvh w-dvw max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white ring-0 duration-0 data-open:animate-none data-closed:animate-none sm:max-w-none"
            >
                <DialogTitle className="sr-only">
                    Image {position} of {card.label}
                </DialogTitle>
                {failed ? (
                    <p
                        role="alert"
                        className="flex h-full items-center justify-center p-16 text-center"
                    >
                        Couldn&apos;t load this image. Close it and try again.
                    </p>
                ) : (
                    <img
                        src={cardImageUrl(card, position)}
                        alt={`Image ${position} of ${card.label}`}
                        className="h-full w-full object-contain"
                        onError={() => setFailed(true)}
                    />
                )}
                <Button
                    ref={closeButton}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] size-11 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                    aria-label="Close image"
                    onClick={onClose}
                >
                    <X aria-hidden="true" />
                </Button>
            </DialogContent>
        </Dialog>
    );
}
