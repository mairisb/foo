"use client";

import { useState } from "react";
import { cardImageUrl, type Card } from "@/lib/cards";
import { FullScreenViewer } from "./full-screen-viewer";
import { CodeViewerContent } from "./card-codes";

export type CardMediaPosition = { kind: "code" | "image"; position: number };

export function CardMediaViewer({
    card,
    item,
    onNavigate,
    onClose,
}: {
    card: Card;
    item: CardMediaPosition;
    onNavigate: (item: CardMediaPosition) => void;
    onClose: () => void;
}) {
    const codes = card.codes ?? [];
    const index =
        item.kind === "code"
            ? item.position - 1
            : codes.length + item.position - 1;
    const count = codes.length + card.imageCount;
    function navigate(next: number) {
        onNavigate(
            next < codes.length
                ? { kind: "code", position: next + 1 }
                : { kind: "image", position: next - codes.length + 1 },
        );
    }
    return (
        <FullScreenViewer
            title={
                item.kind === "code"
                    ? `Code ${item.position}: ${codes[item.position - 1].format}`
                    : `Image ${item.position} of ${card.label}`
            }
            closeLabel={item.kind === "code" ? "Close code" : "Close image"}
            triggerId={`card-${card.id}-${item.kind}-${item.position}`}
            onClose={onClose}
            onPrevious={index > 0 ? () => navigate(index - 1) : undefined}
            onNext={index < count - 1 ? () => navigate(index + 1) : undefined}
            position={index + 1}
            count={count}
            renderItem={(position) =>
                position <= codes.length ? (
                    <CodeViewerContent
                        key={`code:${position}`}
                        code={codes[position - 1]}
                        index={position - 1}
                    />
                ) : (
                    <ImageContent
                        key={`image:${position - codes.length}`}
                        card={card}
                        position={position - codes.length}
                    />
                )
            }
        />
    );
}

function ImageContent({ card, position }: { card: Card; position: number }) {
    const [failed, setFailed] = useState(false);

    return (
        <>
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
                    draggable={false}
                    onError={() => setFailed(true)}
                />
            )}
        </>
    );
}
