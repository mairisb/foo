"use client";

import { useState } from "react";
import { cardImageUrl, type Card } from "@/lib/cards";
import { FullScreenViewer } from "./full-screen-viewer";

export function ImageViewer({
    card,
    position,
    onClose,
}: {
    card: Card;
    position: number;
    onClose: () => void;
}) {
    const [failed, setFailed] = useState(false);

    return (
        <FullScreenViewer
            title={`Image ${position} of ${card.label}`}
            closeLabel="Close image"
            triggerId={`card-${card.id}-image-${position}`}
            onClose={onClose}
        >
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
        </FullScreenViewer>
    );
}
