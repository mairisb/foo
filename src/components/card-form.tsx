"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { cn } from "cn";
import {
    ArrowDown,
    ArrowUp,
    BarcodeScannerIcon,
    Loader2,
    RotateCcw,
    RotateCw,
    RoundedCornerIcon,
} from "@/components/icons";
import { toast } from "sonner";
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
    type ImageRotation,
} from "@/lib/cards";
import { api } from "@/lib/api-client";
import { Dialog } from "./dialog";
import { PerspectiveEditor } from "./perspective-editor";
import { CardCodes } from "./card-codes";
import { codeKey, maxCardCodes, type CardCode } from "@/lib/card-codes";
import { scanImageCodes } from "@/lib/barcode-scanner";

function ImagePreview({
    file,
    src,
    position,
    rotation,
}: {
    file?: File;
    src?: string;
    position: number;
    rotation: ImageRotation;
}) {
    const imageElement = useRef<HTMLImageElement>(null);
    const [failed, setFailed] = useState(false);
    const [sourceRatio, setSourceRatio] = useState(1);
    const sideways = rotation === 90 || rotation === 270;
    const aspectRatio = sideways ? 1 / sourceRatio : sourceRatio;

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
        <div className="flex justify-center rounded-lg border bg-white">
            <div
                className="relative w-full"
                style={{ aspectRatio, maxWidth: `${aspectRatio * 192}px` }}
            >
                <img
                    ref={imageElement}
                    src={src}
                    alt={`Preview of image ${position}`}
                    className="absolute top-1/2 left-1/2 object-contain"
                    style={{
                        width: sideways ? `${100 / aspectRatio}%` : "100%",
                        height: sideways ? `${100 * aspectRatio}%` : "100%",
                        maxWidth: "none",
                        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    }}
                    onLoad={(event) =>
                        setSourceRatio(
                            event.currentTarget.naturalWidth /
                                event.currentTarget.naturalHeight,
                        )
                    }
                    onError={() => setFailed(true)}
                />
            </div>
        </div>
    );
}

type DraftImage = { rotation: ImageRotation } & (
    | { kind: "saved"; id: string; position: number; src: string }
    | { kind: "new"; id: string; file: File }
);

export function CardForm({
    card,
    onSave,
    onClose,
    adjustingId,
    previewing,
    onOpenPreview,
    onClosePreview,
    onAdjustImage,
    onCloseAdjustment,
    codePosition,
    onOpenCode,
    onCloseCode,
}: {
    card?: Card;
    onSave: (card: Card) => void;
    onClose: () => void;
    adjustingId: string | null;
    previewing: boolean;
    onOpenPreview: () => void;
    onClosePreview: () => void;
    onAdjustImage: (id: string) => void;
    onCloseAdjustment: () => void;
    codePosition: number | null;
    onOpenCode: (position: number) => void;
    onCloseCode: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [codes, setCodes] = useState<CardCode[]>(card?.codes ?? []);
    const [decodingImageId, setDecodingImageId] = useState<string | null>(null);
    const mounted = useRef(true);
    const [error, setError] = useState("");
    const [images, setImages] = useState<DraftImage[]>(() =>
        card
            ? Array.from({ length: card.imageCount }, (_, index) => ({
                  kind: "saved",
                  id: `saved-${index + 1}`,
                  position: index + 1,
                  src: cardImageUrl(card, index + 1),
                  rotation: 0,
              }))
            : [],
    );
    const imageInput = useRef<HTMLInputElement>(null);
    const dragDepth = useRef(0);
    const [draggingImages, setDraggingImages] = useState(false);
    const formId = useId();
    const nextImageId = useRef(0);
    const [orderMessage, setOrderMessage] = useState("");
    const [scanFooter, setScanFooter] = useState<HTMLDivElement | null>(null);
    const [scanHeader, setScanHeader] = useState<HTMLDivElement | null>(null);
    const [adjustingBusy, setAdjustingBusy] = useState(false);
    const adjustmentButton = useRef<HTMLButtonElement | null>(null);
    const restoreAdjustmentFocus = useRef(false);
    const controlsDisabled =
        busy || decodingImageId !== null || adjustingId !== null;
    const adjustingIndex = images.findIndex(
        (image) => image.id === adjustingId,
    );
    const adjustingImage = images[adjustingIndex];

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    async function scanCodes(image: DraftImage) {
        if (controlsDisabled) {
            return;
        }
        setDecodingImageId(image.id);
        try {
            let blob: Blob;
            if (image.kind === "new") {
                blob = image.file;
            } else {
                const response = await fetch(image.src);
                if (!response.ok) {
                    throw new Error(
                        "Couldn't load this image. Close and reopen the card to retry.",
                    );
                }
                blob = await response.blob();
            }
            const found = await scanImageCodes(blob);
            if (!mounted.current) {
                return;
            }
            if (found.length === 0) {
                toast.error(
                    "No barcode or QR code found. Try a clearer image or adjust its corners.",
                    { id: "card-image-scan" },
                );
                return;
            }
            const existing = new Set(codes.map(codeKey));
            const added = found.filter((code) => !existing.has(codeKey(code)));
            if (codes.length + added.length > maxCardCodes) {
                toast.error(
                    `A card can have up to ${maxCardCodes} codes. Remove a code before scanning again.`,
                    { id: "card-image-scan" },
                );
                return;
            }
            setCodes((current) => [...current, ...added]);
            toast.success(
                added.length > 0
                    ? `Added ${added.length} ${added.length === 1 ? "code" : "codes"}. Save the card to keep ${added.length === 1 ? "it" : "them"}.`
                    : "These codes are already on the card.",
                { id: "card-image-scan" },
            );
        } catch {
            if (mounted.current) {
                toast.error("Couldn't scan this image. Please try again.", {
                    id: "card-image-scan",
                });
            }
        } finally {
            if (mounted.current) {
                setDecodingImageId(null);
            }
        }
    }

    useEffect(() => {
        function clearDrag() {
            dragDepth.current = 0;
            setDraggingImages(false);
        }
        function preventFileNavigation(event: DragEvent) {
            if (event.dataTransfer?.types.includes("Files")) {
                event.preventDefault();
                if (event.type === "drop") {
                    clearDrag();
                }
            }
        }
        window.addEventListener("dragover", preventFileNavigation);
        window.addEventListener("drop", preventFileNavigation);
        window.addEventListener("dragend", clearDrag);
        return () => {
            window.removeEventListener("dragover", preventFileNavigation);
            window.removeEventListener("drop", preventFileNavigation);
            window.removeEventListener("dragend", clearDrag);
        };
    }, []);

    useEffect(() => {
        if (adjustingId !== null) {
            restoreAdjustmentFocus.current = true;
        } else if (restoreAdjustmentFocus.current) {
            adjustmentButton.current?.focus();
            restoreAdjustmentFocus.current = false;
        }
    }, [adjustingId]);

    useEffect(() => {
        if (adjustingId !== null && !adjustingImage) {
            onCloseAdjustment();
        }
    }, [adjustingId, adjustingImage, onCloseAdjustment, previewing]);

    const cancelAdjustment = useCallback(() => {
        restoreAdjustmentFocus.current = true;
        setAdjustingBusy(false);
        onCloseAdjustment();
    }, [onCloseAdjustment]);

    const applyAdjustment = useCallback(
        (file: File) => {
            setImages((current) =>
                current.map((image) =>
                    image.id === adjustingId
                        ? { kind: "new", id: image.id, file, rotation: 0 }
                        : image,
                ),
            );
            setOrderMessage(
                "Image straightened. Save the card to keep your changes.",
            );
            restoreAdjustmentFocus.current = true;
            setAdjustingBusy(false);
            onCloseAdjustment();
        },
        [adjustingId, onCloseAdjustment],
    );

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

    function rotateImage(index: number, direction: -90 | 90) {
        setImages((current) =>
            current.map((image, position) =>
                position === index
                    ? {
                          ...image,
                          rotation: ((image.rotation + direction + 360) %
                              360) as ImageRotation,
                      }
                    : image,
            ),
        );
        setOrderMessage(
            `Image ${index + 1} rotated ${direction === 90 ? "right" : "left"} by 90 degrees.`,
        );
    }

    function chooseImages(files: File[]) {
        if (controlsDisabled || files.length === 0) {
            return;
        }
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
                rotation: 0,
            }));
            setImages((old) => [...old, ...added]);
        }
        setError(message);
    }
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (controlsDisabled) {
            return;
        }
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        const upload = new FormData();
        upload.set("label", String(form.get("label")));
        upload.set("codes", JSON.stringify(codes));
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
            upload.set(
                "rotateImages",
                JSON.stringify(
                    images.flatMap((image) =>
                        image.kind === "saved" && image.rotation !== 0
                            ? [
                                  {
                                      position: image.position,
                                      rotation: image.rotation,
                                  },
                              ]
                            : [],
                    ),
                ),
            );
        }
        for (const image of images) {
            if (image.kind === "new") {
                upload.append(
                    image.rotation === 0
                        ? "images"
                        : `images:${image.rotation}`,
                    image.file,
                );
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
            title={
                adjustingImage
                    ? previewing
                        ? `Image ${adjustingIndex + 1} preview`
                        : `Adjust image ${adjustingIndex + 1} corners`
                    : card
                      ? "Edit card"
                      : "Add card"
            }
            onClose={
                adjustingImage
                    ? previewing
                        ? onClosePreview
                        : cancelAdjustment
                    : onClose
            }
            closeDisabled={busy || adjustingBusy || decodingImageId !== null}
            closeLabel={
                adjustingImage && previewing ? "Close preview" : "Close"
            }
            focusClose={Boolean(adjustingImage && previewing)}
            onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter(
                    (file) => file.type.startsWith("image/"),
                );
                if (files.length > 0) {
                    event.preventDefault();
                    chooseImages(files);
                }
            }}
            className={
                adjustingImage
                    ? "h-[calc(100dvh-2rem)] sm:max-w-2xl"
                    : undefined
            }
            bodyClassName={
                adjustingImage ? "flex flex-1 overflow-hidden p-0" : undefined
            }
            headerActions={
                adjustingImage ? <div ref={setScanHeader} /> : undefined
            }
            footer={
                adjustingImage ? (
                    previewing ? undefined : (
                        <div ref={setScanFooter} />
                    )
                ) : (
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11"
                            disabled={
                                busy ||
                                adjustingBusy ||
                                decodingImageId !== null
                            }
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="h-11"
                            type="submit"
                            form={formId}
                            disabled={controlsDisabled}
                        >
                            {busy
                                ? "Saving..."
                                : card
                                  ? "Save changes"
                                  : "Save card"}
                        </Button>
                    </div>
                )
            }
        >
            <div hidden={Boolean(adjustingImage)}>
                <Form id={formId} onSubmit={submit} className="grid gap-5">
                    <BaseField.Root name="label" render={<Field />}>
                        <BaseField.Label render={<FieldLabel />}>
                            Card name
                        </BaseField.Label>
                        <Input
                            className="h-11"
                            maxLength={80}
                            required
                            disabled={controlsDisabled}
                            defaultValue={card?.label ?? ""}
                        />
                        <BaseField.Error render={<FieldError />} />
                    </BaseField.Root>
                    <CardCodes
                        codes={codes}
                        disabled={controlsDisabled}
                        codePosition={codePosition}
                        onOpenCode={onOpenCode}
                        onCloseCode={onCloseCode}
                        onRemove={(index) =>
                            setCodes((current) =>
                                current.filter(
                                    (_, position) => position !== index,
                                ),
                            )
                        }
                    />
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
                            disabled={controlsDisabled}
                            onChange={(event) =>
                                chooseImages(
                                    Array.from(event.currentTarget.files ?? []),
                                )
                            }
                        />
                        <div
                            role="group"
                            aria-label="Image upload"
                            aria-disabled={controlsDisabled}
                            data-dragging={draggingImages && !controlsDisabled}
                            className={cn(
                                "grid gap-3 rounded-lg border border-dashed p-4",
                                draggingImages &&
                                    !controlsDisabled &&
                                    "border-ring bg-muted",
                            )}
                            onDragEnter={(event) => {
                                if (
                                    !event.dataTransfer.types.includes("Files")
                                ) {
                                    return;
                                }
                                event.preventDefault();
                                dragDepth.current++;
                                if (!controlsDisabled) {
                                    setDraggingImages(true);
                                }
                            }}
                            onDragOver={(event) => {
                                if (
                                    event.dataTransfer.types.includes("Files")
                                ) {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect =
                                        controlsDisabled ? "none" : "copy";
                                }
                            }}
                            onDragLeave={(event) => {
                                if (
                                    event.dataTransfer.types.includes("Files")
                                ) {
                                    event.preventDefault();
                                    dragDepth.current = Math.max(
                                        0,
                                        dragDepth.current - 1,
                                    );
                                    if (dragDepth.current === 0) {
                                        setDraggingImages(false);
                                    }
                                }
                            }}
                            onDrop={(event) => {
                                if (
                                    event.dataTransfer.types.includes("Files")
                                ) {
                                    event.preventDefault();
                                    dragDepth.current = 0;
                                    setDraggingImages(false);
                                    chooseImages(
                                        Array.from(event.dataTransfer.files),
                                    );
                                }
                            }}
                        >
                            <p className="text-sm text-muted-foreground">
                                Drop or paste images, or use Add images.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                className="h-11 w-fit"
                                disabled={controlsDisabled}
                                onClick={() => imageInput.current?.click()}
                            >
                                Add images
                            </Button>
                        </div>
                        <FieldDescription>
                            Choose one or more images. Choose again to add more.
                            Use the arrows to reorder or rotate them. JPG, PNG
                            or WebP, up to 10 MB each. Use Adjust corners to
                            straighten a photographed card.
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
                                        rotation={image.rotation}
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="size-11"
                                            aria-label={`Move image ${index + 1} up`}
                                            disabled={
                                                controlsDisabled || index === 0
                                            }
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
                                                controlsDisabled ||
                                                index === images.length - 1
                                            }
                                            onClick={() => moveImage(index, 1)}
                                        >
                                            <ArrowDown aria-hidden="true" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="size-11"
                                            aria-label={`Rotate image ${index + 1} left`}
                                            disabled={controlsDisabled}
                                            onClick={() =>
                                                rotateImage(index, -90)
                                            }
                                        >
                                            <RotateCcw aria-hidden="true" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="size-11"
                                            aria-label={`Rotate image ${index + 1} right`}
                                            disabled={controlsDisabled}
                                            onClick={() =>
                                                rotateImage(index, 90)
                                            }
                                        >
                                            <RotateCw aria-hidden="true" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="size-11"
                                            disabled={controlsDisabled}
                                            aria-label={`Scan image ${index + 1} for codes`}
                                            title="Scan codes"
                                            aria-busy={
                                                decodingImageId === image.id
                                            }
                                            onClick={() => {
                                                void scanCodes(image);
                                            }}
                                        >
                                            {decodingImageId === image.id ? (
                                                <Loader2
                                                    aria-hidden="true"
                                                    className="animate-spin"
                                                />
                                            ) : (
                                                <BarcodeScannerIcon />
                                            )}
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="size-11"
                                            disabled={controlsDisabled}
                                            aria-label={`Adjust image ${index + 1} corners`}
                                            title="Adjust corners"
                                            onClick={(event) => {
                                                adjustmentButton.current =
                                                    event.currentTarget;
                                                onAdjustImage(image.id);
                                            }}
                                        >
                                            <RoundedCornerIcon />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="h-11 w-fit"
                                            disabled={controlsDisabled}
                                            onClick={() => {
                                                setImages((old) =>
                                                    old.filter(
                                                        (current) =>
                                                            current.id !==
                                                            image.id,
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
            </div>
            {adjustingImage && (
                <PerspectiveEditor
                    key={adjustingImage.id}
                    file={
                        adjustingImage.kind === "new"
                            ? adjustingImage.file
                            : undefined
                    }
                    src={
                        adjustingImage.kind === "saved"
                            ? adjustingImage.src
                            : undefined
                    }
                    rotation={adjustingImage.rotation}
                    position={adjustingIndex + 1}
                    header={scanHeader}
                    footer={scanFooter}
                    previewing={previewing}
                    onOpenPreview={onOpenPreview}
                    onClosePreview={onClosePreview}
                    onApply={applyAdjustment}
                    onCancel={cancelAdjustment}
                    onBusyChange={setAdjustingBusy}
                />
            )}
        </Dialog>
    );
}
