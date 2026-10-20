"use client";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { codeKey, type CardCode } from "@/lib/card-codes";
import { renderCardCode } from "@/lib/barcode-scanner";
import { FullScreenViewer } from "./full-screen-viewer";

function useRenderedCode(code: CardCode) {
    const [src, setSrc] = useState("");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let disposed = false;
        void renderCardCode(code)
            .then((url) => {
                if (!disposed) {
                    setSrc(url);
                }
            })
            .catch(() => {
                if (!disposed) {
                    setFailed(true);
                }
            });
        return () => {
            disposed = true;
        };
    }, [code]);
    return { src, failed, setFailed };
}

function CodeCard({
    code,
    index,
    triggerId,
    disabled,
    onOpen,
}: {
    code: CardCode;
    index: number;
    triggerId: string;
    disabled: boolean;
    onOpen: () => void;
}) {
    const { src, failed, setFailed } = useRenderedCode(code);
    return (
        <>
            <Button
                id={triggerId}
                type="button"
                variant="outline"
                className="flex aspect-[8560/5398] h-auto min-h-0 w-full min-w-0 flex-col items-start gap-3 overflow-hidden rounded-lg border p-4 text-left font-normal whitespace-normal"
                aria-label={`Open code ${index + 1} full size`}
                disabled={disabled}
                onClick={onOpen}
            >
                {src ? (
                    <img
                        src={src}
                        alt={`Code ${index + 1}: ${code.format}`}
                        className="min-h-0 w-full flex-1 bg-white object-contain"
                        draggable={false}
                        onError={() => setFailed(true)}
                    />
                ) : (
                    <span aria-hidden="true" className="min-h-0 flex-1" />
                )}
                <span className="shrink-0 text-sm text-muted-foreground">
                    {code.format}
                </span>
                <code className="max-h-1/4 max-w-full shrink-0 overflow-hidden text-sm break-all whitespace-pre-wrap">
                    {code.text}
                </code>
            </Button>
            {failed && (
                <FieldError>
                    Couldn&apos;t display this code. Close and reopen the card
                    to retry.
                </FieldError>
            )}
        </>
    );
}

export function CardCodes({
    codes,
    onRemove,
    disabled = false,
    codePosition,
    onOpenCode,
    onCloseCode,
    onNavigateCode,
    showViewer = true,
    triggerPrefix,
}: {
    codes: CardCode[];
    onRemove?: (index: number) => void;
    disabled?: boolean;
    codePosition: number | null;
    onOpenCode: (position: number) => void;
    onCloseCode: () => void;
    onNavigateCode: (position: number) => void;
    showViewer?: boolean;
    triggerPrefix?: string;
}) {
    const generatedId = useId();
    const id = triggerPrefix ?? generatedId;
    useEffect(() => {
        if (
            codePosition !== null &&
            (!Number.isSafeInteger(codePosition) ||
                codePosition < 1 ||
                codePosition > codes.length)
        ) {
            onCloseCode();
        }
    }, [codePosition, codes.length, onCloseCode]);
    const selectedCode =
        codePosition !== null ? codes[codePosition - 1] : undefined;
    if (codes.length === 0) {
        return null;
    }
    return (
        <section aria-label="Extracted codes" className="grid min-w-0 gap-3">
            {codes.map((code, index) => (
                <div
                    key={codeKey(code)}
                    className="grid min-w-0 justify-items-start gap-2"
                >
                    <CodeCard
                        code={code}
                        index={index}
                        triggerId={`${id}-code-${index + 1}`}
                        disabled={disabled}
                        onOpen={() => onOpenCode(index + 1)}
                    />
                    {onRemove && (
                        <Button
                            type="button"
                            variant="ghost"
                            className="h-11"
                            disabled={disabled}
                            onClick={() => onRemove(index)}
                        >
                            Remove code {index + 1}
                        </Button>
                    )}
                </div>
            ))}
            {showViewer && selectedCode && codePosition !== null && (
                <FullScreenViewer
                    title={`Code ${codePosition}: ${selectedCode.format}`}
                    closeLabel="Close code"
                    triggerId={`${id}-code-${codePosition}`}
                    onClose={onCloseCode}
                    onPrevious={
                        codePosition > 1
                            ? () => onNavigateCode(codePosition - 1)
                            : undefined
                    }
                    onNext={
                        codePosition < codes.length
                            ? () => onNavigateCode(codePosition + 1)
                            : undefined
                    }
                    positionLabel={`${codePosition} of ${codes.length}`}
                >
                    <CodeViewerContent
                        key={codeKey(selectedCode)}
                        code={selectedCode}
                        index={codePosition - 1}
                    />
                </FullScreenViewer>
            )}
        </section>
    );
}

export function CodeViewerContent({
    code,
    index,
}: {
    code: CardCode;
    index: number;
}) {
    const { src, failed, setFailed } = useRenderedCode(code);
    return (
        <div className="flex h-full w-full items-center justify-center [container-type:size]">
            <div
                data-slot="full-screen-code-card"
                className="flex aspect-[8560/5398] w-full max-w-[calc(100cqh*8560/5398)] min-h-0 flex-col gap-3 rounded-lg border bg-white p-4 text-black"
            >
                {failed ? (
                    <p
                        role="alert"
                        className="flex min-h-0 flex-1 items-center justify-center text-center"
                    >
                        Couldn&apos;t display this code. Close and reopen the
                        card to retry.
                    </p>
                ) : src ? (
                    <img
                        src={src}
                        alt={`Code ${index + 1}: ${code.format}`}
                        className="min-h-0 w-full flex-1 object-contain"
                        draggable={false}
                        onError={() => setFailed(true)}
                    />
                ) : (
                    <p
                        role="status"
                        className="flex min-h-0 flex-1 items-center justify-center"
                    >
                        Loading code...
                    </p>
                )}
                <p className="shrink-0 text-sm text-muted-foreground">
                    {code.format}
                </p>
                <code
                    data-viewer-scroll
                    tabIndex={0}
                    className="max-h-1/4 shrink-0 overflow-auto text-sm break-all whitespace-pre-wrap"
                >
                    {code.text}
                </code>
            </div>
        </div>
    );
}
