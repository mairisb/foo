"use client";
import { useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/cards";
import { cardImageUrl, formatNames } from "@/lib/cards";
import { Dialog } from "./dialog";
import { FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EllipsisVertical } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { CardCodes } from "./card-codes";
import { ImageViewer } from "./image-viewer";

function CardImage({
    card,
    position,
    onOpen,
    disabled,
}: {
    card: Card;
    position: number;
    onOpen: () => void;
    disabled: boolean;
}) {
    const [failed, setFailed] = useState(false);
    const url = cardImageUrl(card, position);
    if (failed) {
        return (
            <FieldError>
                Couldn&apos;t load image {position}. Close this card and try
                again.
            </FieldError>
        );
    }
    return (
        <Button
            id={`card-${card.id}-image-${position}`}
            type="button"
            variant="ghost"
            className="h-auto w-full p-0 hover:bg-transparent"
            disabled={disabled}
            onClick={onOpen}
            aria-label={`Open image ${position} full size`}
        >
            <img
                className="max-h-96 w-full rounded-lg border bg-white object-contain"
                src={url}
                alt={`Image ${position} of ${card.label}`}
                onError={() => setFailed(true)}
            />
        </Button>
    );
}

export function CardDetail({
    card,
    onClose,
    onDelete,
    onEdit,
    imagePosition,
    onOpenImage,
    onCloseImage,
}: {
    card: Card;
    onClose: () => void;
    onDelete: (id: string) => void;
    onEdit: (card: Card) => void;
    imagePosition: number | null;
    onOpenImage: (position: number) => void;
    onCloseImage: () => void;
}) {
    const [barcodeFailed, setBarcodeFailed] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");
    const [loadingEdit, setLoadingEdit] = useState(false);
    const actionsButton = useRef<HTMLButtonElement>(null);
    const cancelDeleteButton = useRef<HTMLButtonElement>(null);
    const restoreActionsFocus = useRef(false);
    const validImage =
        imagePosition !== null &&
        Number.isSafeInteger(imagePosition) &&
        imagePosition >= 1 &&
        imagePosition <= card.imageCount;

    useEffect(() => {
        if (imagePosition !== null && !validImage) {
            onCloseImage();
        }
    }, [imagePosition, validImage, onCloseImage]);

    useEffect(() => {
        if (confirming) {
            cancelDeleteButton.current?.focus();
        } else if (restoreActionsFocus.current) {
            actionsButton.current?.focus();
            restoreActionsFocus.current = false;
        }
    }, [confirming]);

    async function remove() {
        setDeleting(true);
        setError("");
        try {
            await api(`/api/cards/${card.id}`, { method: "DELETE" });
            onDelete(card.id);
        } catch (error) {
            setError((error as Error).message);
            setDeleting(false);
        }
    }

    async function edit() {
        setLoadingEdit(true);
        setError("");
        try {
            const result = await api<{ card: Card }>(`/api/cards/${card.id}`);
            onEdit(result.card);
        } catch (error) {
            setError((error as Error).message);
            setLoadingEdit(false);
        }
    }

    if (confirming) {
        return (
            <Dialog
                title="Delete card?"
                onClose={onClose}
                closeDisabled={deleting}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button
                            ref={cancelDeleteButton}
                            variant="outline"
                            className="h-11"
                            disabled={deleting}
                            onClick={() => {
                                restoreActionsFocus.current = true;
                                setConfirming(false);
                                setError("");
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            className="h-11"
                            disabled={deleting}
                            onClick={remove}
                        >
                            {deleting ? "Deleting..." : "Delete card"}
                        </Button>
                    </div>
                }
            >
                <p className="break-words">
                    Delete &ldquo;{card.label}&rdquo; and its images? This
                    cannot be undone.
                </p>
                {error && <FieldError>{error}</FieldError>}
            </Dialog>
        );
    }

    return (
        <Dialog
            title={card.label}
            onClose={onClose}
            closeDisabled={loadingEdit}
            headerActions={
                <DropdownMenu>
                    <DropdownMenuTrigger
                        ref={actionsButton}
                        aria-label="Card actions"
                        disabled={loadingEdit}
                        render={
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-11 shrink-0"
                            />
                        }
                    >
                        <EllipsisVertical aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="min-w-40"
                        finalFocus={() => actionsButton.current ?? false}
                    >
                        <DropdownMenuItem
                            className="min-h-11"
                            disabled={loadingEdit}
                            onClick={edit}
                        >
                            Edit card
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="min-h-11"
                            variant="destructive"
                            disabled={loadingEdit}
                            onClick={() => setConfirming(true)}
                        >
                            Delete card
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
            footer={
                <div className="flex justify-end">
                    <Button
                        variant="outline"
                        className="h-11"
                        disabled={loadingEdit}
                        onClick={onClose}
                    >
                        Close
                    </Button>
                </div>
            }
        >
            {error && <FieldError>{error}</FieldError>}
            <CardCodes codes={card.codes ?? []} />
            {Array.from({ length: card.imageCount }, (_, index) => (
                <CardImage
                    key={index}
                    card={card}
                    position={index + 1}
                    disabled={loadingEdit}
                    onOpen={() => onOpenImage(index + 1)}
                />
            ))}
            {card.imageCount === 0 && !card.cardNumber && (
                <p className="text-muted-foreground">No images.</p>
            )}
            {card.cardNumber && card.barcodeFormat && (
                <dl className="grid gap-2">
                    <dt className="font-medium">Card number</dt>
                    <dd className="mb-2">
                        <code className="break-all">{card.cardNumber}</code>
                    </dd>
                    <dt className="font-medium">Barcode format</dt>
                    <dd>{formatNames[card.barcodeFormat]}</dd>
                </dl>
            )}
            {card.cardNumber && card.barcodeFormat && !barcodeFailed && (
                <img
                    className={`w-full bg-white object-contain ${card.barcodeFormat === "qrcode" ? "h-40" : "h-24"}`}
                    src={`/api/cards/${card.id}/barcode`}
                    alt={`${formatNames[card.barcodeFormat]} barcode for ${card.label}`}
                    onError={() => setBarcodeFailed(true)}
                />
            )}
            {barcodeFailed && (
                <FieldError>
                    Couldn&apos;t load the barcode. Close this card and try
                    again.
                </FieldError>
            )}
            {validImage && imagePosition !== null && (
                <ImageViewer
                    key={imagePosition}
                    card={card}
                    position={imagePosition}
                    onClose={onCloseImage}
                />
            )}
        </Dialog>
    );
}
