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
    const [rotations, setRotations] = useState<Record<number, number>>({});
    function rotateImage() {
        setRotations((current) => ({
            ...current,
            [item.position]: ((current[item.position] ?? 0) + 90) % 360,
        }));
    }
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
            onNavigate={(position) => navigate(position - 1)}
            onRotate={item.kind === "image" ? rotateImage : undefined}
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
                        active={position === index + 1}
                        rotation={rotations[position - codes.length] ?? 0}
                    />
                )
            }
        />
    );
}

function ImageContent({
    card,
    position,
    active,
    rotation,
}: {
    card: Card;
    position: number;
    active: boolean;
    rotation: number;
}) {
    const [status, setStatus] = useState({ active, failed: false });
    // Retry a failed preview when it becomes the selected slide again.
    if (active !== status.active) {
        setStatus({ active, failed: active ? false : status.failed });
    }
    const sideways = rotation === 90 || rotation === 270;

    return (
        <div className="flex h-full w-full items-center justify-center [container-type:size]">
            {status.failed ? (
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
                    className="h-full w-full max-w-none shrink-0 object-contain"
                    style={{
                        width: sideways ? "100cqh" : "100%",
                        height: sideways ? "100cqw" : "100%",
                        transform: `rotate(${rotation}deg)`,
                    }}
                    draggable={false}
                    onError={() => setStatus({ active, failed: true })}
                />
            )}
        </div>
    );
}
