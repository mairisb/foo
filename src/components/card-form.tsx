"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
} from "@/components/ui/field";
import {
    type Card,
    cardImageUrl,
    imageMimeTypes,
    maxImageBytes,
} from "@/lib/cards";
import { api } from "@/lib/api-client";
import { Dialog } from "./dialog";

function ImagePreview({
    file,
    src,
    position,
}: {
    file?: File;
    src?: string;
    position: number;
}) {
    const imageElement = useRef<HTMLImageElement>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!file || !imageElement.current) {
            return;
        }
        const url = URL.createObjectURL(file);
        imageElement.current.src = url;
        return () => URL.revokeObjectURL(url);
    }, [file]);

    if (failed) {
        return (
            <FieldError>
                Couldn&apos;t preview image {position}. Try another image.
            </FieldError>
        );
    }
    return (
        <img
            ref={imageElement}
            src={src}
            alt={`Preview of image ${position}`}
            className="max-h-48 w-full rounded-lg border bg-white object-contain"
            onError={() => setFailed(true)}
        />
    );
}

type DraftImage =
    | { kind: "saved"; id: string; position: number; src: string }
    | { kind: "new"; id: string; file: File };

export function CardForm({
    card,
    onSave,
    onClose,
}: {
    card?: Card;
    onSave: (card: Card) => void;
    onClose: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [images, setImages] = useState<DraftImage[]>(() =>
        card
            ? Array.from({ length: card.imageCount }, (_, index) => ({
                  kind: "saved",
                  id: `saved-${index + 1}`,
                  position: index + 1,
                  src: cardImageUrl(card, index + 1),
              }))
            : [],
    );
    const imageInput = useRef<HTMLInputElement>(null);
    const formId = useId();
    const nextImageId = useRef(0);
    const [orderMessage, setOrderMessage] = useState("");

    function moveImage(index: number, direction: -1 | 1) {
        const destination = index + direction;
        if (destination < 0 || destination >= images.length) {
            return;
        }
        setImages((current) => {
            const reordered = [...current];
            [reordered[index], reordered[destination]] = [
                reordered[destination],
                reordered[index],
            ];
            return reordered;
        });
        setOrderMessage(
            `Image ${index + 1} moved to position ${destination + 1} of ${images.length}.`,
        );
    }

    function chooseImages(files: File[]) {
        let message = "";
        if (files.some((file) => file.size > maxImageBytes)) {
            message = "Each image must be 10 MB or smaller.";
        } else if (
            files.some(
                (file) => file.type && !imageMimeTypes.includes(file.type),
            )
        ) {
            message = "Choose JPG, PNG, or WebP images.";
        }
        if (imageInput.current) {
            imageInput.current.value = "";
        }
        if (!message) {
            const added: DraftImage[] = files.map((file) => ({
                kind: "new",
                id: `new-${nextImageId.current++}`,
                file,
            }));
            setImages((old) => [...old, ...added]);
        }
        setError(message);
    }
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        const upload = new FormData();
        upload.set("label", String(form.get("label")));
        if (card) {
            const kept = new Set(
                images
                    .filter((image) => image.kind === "saved")
                    .map((image) => image.position),
            );
            upload.set("revision", String(card.revision));
            upload.set(
                "removeImages",
                JSON.stringify(
                    Array.from(
                        { length: card.imageCount },
                        (_, index) => index + 1,
                    ).filter((position) => !kept.has(position)),
                ),
            );
            // Destinations of retained images in their original order. New files are
            // uploaded in draft order and fill the remaining positions.
            upload.set(
                "imageOrder",
                JSON.stringify(
                    images
                        .flatMap((image, index) =>
                            image.kind === "saved"
                                ? [
                                      {
                                          position: image.position,
                                          destination: index + 1,
                                      },
                                  ]
                                : [],
                        )
                        .sort((a, b) => a.position - b.position)
                        .map((image) => image.destination),
                ),
            );
        }
        for (const image of images) {
            if (image.kind === "new") {
                upload.append("images", image.file);
            }
        }
        try {
            const result = await api<{ card: Card }>(
                card ? `/api/cards/${card.id}` : "/api/cards",
                {
                    method: card ? "PATCH" : "POST",
                    body: upload,
                },
            );
            onSave(result.card);
        } catch (error) {
            setError((error as Error).message);
            setBusy(false);
        }
    }
    return (
        <Dialog
            title={card ? "Edit card" : "Add card"}
            onClose={onClose}
            closeDisabled={busy}
            footer={
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        disabled={busy}
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        className="h-11"
                        type="submit"
                        form={formId}
                        disabled={busy}
                    >
                        {busy
                            ? "Saving..."
                            : card
                              ? "Save changes"
                              : "Save card"}
                    </Button>
                </div>
            }
        >
            <Form id={formId} onSubmit={submit} className="grid gap-5">
                <BaseField.Root name="label" render={<Field />}>
                    <BaseField.Label render={<FieldLabel />}>
                        Card name
                    </BaseField.Label>
                    <Input
                        className="h-11"
                        maxLength={80}
                        required
                        disabled={busy}
                        defaultValue={card?.label ?? ""}
                    />
                    <BaseField.Error render={<FieldError />} />
                </BaseField.Root>
                <Field>
                    <FieldLabel htmlFor="card-images">
                        Images (optional)
                    </FieldLabel>
                    <Input
                        id="card-images"
                        ref={imageInput}
                        className="hidden"
                        type="file"
                        multiple
                        accept={imageMimeTypes.join(",")}
                        disabled={busy}
                        onChange={(event) =>
                            chooseImages(
                                Array.from(event.currentTarget.files ?? []),
                            )
                        }
                    />
                    <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-fit"
                        disabled={busy}
                        onClick={() => imageInput.current?.click()}
                    >
                        Add images
                    </Button>
                    <FieldDescription>
                        Choose one or more images. Choose again to add more. Use
                        the arrows to change their order. JPG, PNG or WebP, up
                        to 10 MB each.
                    </FieldDescription>
                </Field>
                {images.length > 0 && (
                    <ul className="grid gap-4">
                        {images.map((image, index) => (
                            <li key={image.id} className="grid gap-2">
                                <p className="break-all text-sm text-muted-foreground">
                                    {image.kind === "new"
                                        ? image.file.name
                                        : `Image ${index + 1}`}
                                </p>
                                <ImagePreview
                                    file={
                                        image.kind === "new"
                                            ? image.file
                                            : undefined
                                    }
                                    src={
                                        image.kind === "saved"
                                            ? image.src
                                            : undefined
                                    }
                                    position={index + 1}
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="size-11"
                                        aria-label={`Move image ${index + 1} up`}
                                        disabled={busy || index === 0}
                                        onClick={() => moveImage(index, -1)}
                                    >
                                        <ArrowUp aria-hidden="true" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="size-11"
                                        aria-label={`Move image ${index + 1} down`}
                                        disabled={
                                            busy || index === images.length - 1
                                        }
                                        onClick={() => moveImage(index, 1)}
                                    >
                                        <ArrowDown aria-hidden="true" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-11 w-fit"
                                        disabled={busy}
                                        onClick={() => {
                                            setImages((old) =>
                                                old.filter(
                                                    (current) =>
                                                        current.id !== image.id,
                                                ),
                                            );
                                            setError("");
                                        }}
                                    >
                                        Remove image {index + 1}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                <p role="status" className="sr-only">
                    {orderMessage}
                </p>
                {error && <FieldError>{error}</FieldError>}
            </Form>
        </Dialog>
    );
}
