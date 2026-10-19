"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, LoaderCircle, Undo2 } from "@/components/icons";
import type { CornerEditor } from "scanic";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { maxImageBytes, type ImageRotation } from "@/lib/cards";

export function PerspectiveEditor({
    file,
    src,
    rotation,
    position,
    header,
    footer,
    previewing,
    onOpenPreview,
    onClosePreview,
    onApply,
    onCancel,
    onBusyChange,
}: {
    file?: File;
    src?: string;
    rotation: ImageRotation;
    position: number;
    header: HTMLDivElement | null;
    footer: HTMLDivElement | null;
    previewing: boolean;
    onOpenPreview: () => void;
    onClosePreview: () => void;
    onApply: (file: File) => void;
    onCancel: () => void;
    onBusyChange: (busy: boolean) => void;
}) {
    const host = useRef<HTMLDivElement>(null);
    const preview = useRef<HTMLCanvasElement>(null);
    const previewButton = useRef<HTMLButtonElement>(null);
    const showingPreview = useRef(previewing);
    const editor = useRef<CornerEditor | null>(null);
    const extract = useRef<((apply: boolean) => Promise<void>) | null>(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [hasPreview, setHasPreview] = useState(false);

    useEffect(() => {
        if (!previewing && showingPreview.current) {
            previewButton.current?.focus();
        }
        if (previewing || header) {
            showingPreview.current = previewing;
        }
    }, [previewing, header, footer]);

    useEffect(() => {
        if (previewing && ready && !hasPreview) {
            void extract.current?.(false);
        }
    }, [previewing, ready, hasPreview]);

    useEffect(() => {
        let disposed = false;
        let working = false;
        let instance: CornerEditor | undefined;
        const sourceUrl = file ? URL.createObjectURL(file) : src;
        async function initialize() {
            if (!sourceUrl) {
                throw new Error("Couldn't load this image.");
            }
            const scanic = await import("scanic");
            const image = new Image();
            image.src = sourceUrl;
            await image.decode();
            if (disposed || !host.current) {
                return;
            }
            if (
                image.naturalWidth < 2 ||
                image.naturalHeight < 2 ||
                image.naturalWidth * image.naturalHeight > 60_000_000
            ) {
                throw new Error(
                    "This image is too small or too large to adjust.",
                );
            }
            const scale = Math.min(
                1,
                2000 / Math.max(image.naturalWidth, image.naturalHeight),
            );
            const width = Math.max(2, Math.round(image.naturalWidth * scale));
            const height = Math.max(2, Math.round(image.naturalHeight * scale));
            const sideways = rotation === 90 || rotation === 270;
            const source = document.createElement("canvas");
            source.width = sideways ? height : width;
            source.height = sideways ? width : height;
            const context = source.getContext("2d");
            if (!context) {
                throw new Error(
                    "Couldn't prepare the image. Please try again.",
                );
            }
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, source.width, source.height);
            context.translate(source.width / 2, source.height / 2);
            context.rotate((rotation * Math.PI) / 180);
            context.drawImage(image, -width / 2, -height / 2, width, height);

            async function transform(apply: boolean) {
                if (disposed || working || !instance) {
                    return;
                }
                working = true;
                setBusy(true);
                onBusyChange(true);
                setError("");
                try {
                    const result = await scanic.extractDocument(
                        source,
                        instance.getCorners(),
                        { output: "canvas" },
                    );
                    if (
                        !result.success ||
                        !(result.output instanceof HTMLCanvasElement)
                    ) {
                        throw new Error(
                            "Couldn't straighten this selection. Adjust the corners and try again.",
                        );
                    }
                    const output = result.output;
                    const exportScale = Math.min(
                        1,
                        2000 / Math.max(output.width, output.height),
                    );
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(
                        2,
                        Math.round(output.width * exportScale),
                    );
                    canvas.height = Math.max(
                        2,
                        Math.round(output.height * exportScale),
                    );
                    const outputContext = canvas.getContext("2d");
                    if (!outputContext) {
                        throw new Error(
                            "Couldn't prepare the preview. Please try again.",
                        );
                    }
                    outputContext.drawImage(
                        output,
                        0,
                        0,
                        canvas.width,
                        canvas.height,
                    );
                    if (apply) {
                        const blob = await new Promise<Blob | null>((resolve) =>
                            canvas.toBlob(resolve, "image/jpeg", 0.95),
                        );
                        if (!blob || blob.size > maxImageBytes) {
                            throw new Error(
                                "Couldn't prepare the adjusted image. Try a smaller selection.",
                            );
                        }
                        if (!disposed) {
                            onApply(
                                new File([blob], "adjusted-image.jpg", {
                                    type: "image/jpeg",
                                }),
                            );
                        }
                    } else if (!disposed && preview.current) {
                        preview.current.width = canvas.width;
                        preview.current.height = canvas.height;
                        preview.current
                            .getContext("2d")
                            ?.drawImage(canvas, 0, 0);
                        setHasPreview(true);
                        onOpenPreview();
                    }
                } catch (failure) {
                    if (!disposed) {
                        setError((failure as Error).message);
                    }
                } finally {
                    working = false;
                    if (!disposed) {
                        setBusy(false);
                        onBusyChange(false);
                    }
                }
            }
            extract.current = transform;
            instance = scanic.createCornerEditor({
                container: host.current,
                image: source,
                magnifier: { zoom: 1 },
                toolbar: { enabled: false },
                handleHitArea: 44,
                theme: {
                    accent: "#171717",
                    handleRingColor: "#171717",
                    edgeColor: "#ffffff",
                },
                onChange: () => setHasPreview(false),
                onConfirm: () => {
                    void transform(true);
                },
                onCancel,
            });
            editor.current = instance;
            setReady(true);
            if (!showingPreview.current) {
                host.current
                    .querySelector<HTMLButtonElement>(".scanic-handle")
                    ?.focus();
            }
        }
        void initialize().catch((failure: Error) => {
            if (!disposed) {
                setError(
                    failure.message ||
                        "Couldn't open the corner editor. Please try again.",
                );
            }
        });
        return () => {
            disposed = true;
            instance?.destroy();
            editor.current = null;
            extract.current = null;
            if (file && sourceUrl) {
                URL.revokeObjectURL(sourceUrl);
            }
        };
    }, [file, src, rotation, onApply, onCancel, onBusyChange, onOpenPreview]);

    return (
        <section
            aria-label={
                previewing
                    ? `Image ${position} preview`
                    : `Adjust image ${position} corners`
            }
            className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
            onKeyDownCapture={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!busy) {
                        if (previewing) {
                            onClosePreview();
                        } else {
                            onCancel();
                        }
                    }
                } else if (
                    event.key === "Enter" &&
                    (event.target as HTMLElement).matches(".scanic-handle")
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    editor.current?.confirm();
                }
            }}
        >
            <p role="status" className="sr-only">
                {busy
                    ? "Straightening image..."
                    : ready
                      ? "Move the four corners into place."
                      : "Loading image..."}
            </p>
            <fieldset
                disabled={busy}
                inert={previewing}
                aria-hidden={previewing}
                className={`absolute inset-0 min-h-0 min-w-0 ${previewing ? "invisible" : ""}`}
            >
                <div
                    ref={host}
                    data-slot="perspective-editor"
                    className="relative h-full w-full min-w-0 bg-muted"
                />
            </fieldset>
            {header &&
                !previewing &&
                createPortal(
                    <fieldset disabled={busy} className="flex gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label="Reset corners"
                            title="Reset corners"
                            disabled={!ready}
                            onClick={() => {
                                editor.current?.reset();
                                setError("");
                            }}
                        >
                            <Undo2 aria-hidden="true" />
                        </Button>
                        <Button
                            ref={previewButton}
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label="Preview"
                            title="Preview"
                            disabled={!ready}
                            onClick={() => {
                                void extract.current?.(false);
                            }}
                        >
                            <Eye aria-hidden="true" />
                        </Button>
                    </fieldset>,
                    header,
                )}
            {footer &&
                !previewing &&
                createPortal(
                    <fieldset
                        disabled={busy}
                        className="flex justify-end gap-2"
                    >
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11"
                            onClick={onCancel}
                            aria-label="Cancel corner adjustment"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            className="h-11"
                            disabled={!ready}
                            onClick={() => {
                                void extract.current?.(true);
                            }}
                        >
                            Apply
                        </Button>
                    </fieldset>,
                    footer,
                )}
            {(!ready || busy) && !error && (
                <LoaderCircle
                    aria-hidden="true"
                    className="pointer-events-none absolute top-3 left-3 size-5 animate-spin"
                />
            )}
            {error && (
                <FieldError className="absolute inset-x-4 top-4 rounded-lg bg-popover p-3">
                    {error}
                </FieldError>
            )}
            <div hidden={!previewing} className="absolute inset-0 p-4">
                <canvas
                    ref={preview}
                    role="img"
                    aria-label="Straightened preview"
                    hidden={!hasPreview}
                    className="h-full w-full object-contain"
                />
            </div>
        </section>
    );
}
