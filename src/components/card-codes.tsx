"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { codeKey, type CardCode } from "@/lib/card-codes";
import { renderCardCode } from "@/lib/barcode-scanner";

function CodeImage({ code, index }: { code: CardCode; index: number }) {
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
    return (
        <>
            {src && (
                <img
                    src={src}
                    alt={`Code ${index + 1}: ${code.format}`}
                    className="max-h-48 max-w-full bg-white object-contain"
                    onError={() => setFailed(true)}
                />
            )}
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
}: {
    codes: CardCode[];
    onRemove?: (index: number) => void;
    disabled?: boolean;
}) {
    if (codes.length === 0) {
        return null;
    }
    return (
        <section aria-label="Extracted codes" className="grid min-w-0 gap-3">
            {codes.map((code, index) => (
                <div
                    key={codeKey(code)}
                    className="grid min-w-0 justify-items-start gap-2 rounded-lg border p-3"
                >
                    <CodeImage code={code} index={index} />
                    <p className="text-sm text-muted-foreground">
                        {code.format}
                    </p>
                    <code className="max-w-full text-sm break-all whitespace-pre-wrap">
                        {code.text}
                    </code>
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
        </section>
    );
}
