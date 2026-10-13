"use client";
import { useState } from "react";
import type { Card } from "@/lib/cards";
import { formatNames } from "@/lib/cards";
import { Dialog } from "./dialog";
import { FieldError } from "@/components/ui/field";

function CardImage({ card, position }: { card: Card; position: number }) {
  const [failed, setFailed] = useState(false);
  const url = `/api/cards/${card.id}/images/${position}`;
  if (failed) return <FieldError>Couldn't load image {position}. Close this card and try again.</FieldError>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open image ${position} full size`}>
      <img
        className="max-h-96 w-full rounded-lg border bg-white object-contain"
        src={url}
        alt={`Image ${position} of ${card.label}`}
        onError={() => setFailed(true)}
      />
    </a>
  );
}

export function CardDetail({
  card,
  onClose,
}: {
  card: Card;
  onClose: () => void;
}) {
  const [barcodeFailed, setBarcodeFailed] = useState(false);
  return (
    <Dialog title={card.label} onClose={onClose}>
      {Array.from({ length: card.imageCount }, (_, index) => (
        <CardImage key={index} card={card} position={index + 1} />
      ))}
      {card.imageCount === 0 && !card.cardNumber && <p className="text-muted-foreground">No images.</p>}
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
          Couldn't load the barcode. Close this card and try again.
        </FieldError>
      )}
    </Dialog>
  );
}
