"use client";
import { useEffect, useRef, useState } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  type Card,
  cardImageUrl,
  imageMimeTypes,
  maxImageBytes,
} from "@/lib/cards";
import { api } from "@/lib/api-client";
import { Dialog } from "./dialog";

function ImagePreview({ file, src, position }: { file?: File; src?: string; position: number }) {
  const [preview, setPreview] = useState({ url: src ?? "", failed: false });

  useEffect(() => {
    const url = file ? URL.createObjectURL(file) : src ?? "";
    setPreview({ url, failed: false });
    return () => { if (file) URL.revokeObjectURL(url); };
  }, [file, src]);

  if (preview.failed) return <FieldError>Couldn't preview image {position}. Try another image.</FieldError>;
  if (!preview.url) return null;
  return (
    <img
      src={preview.url}
      alt={`Preview of image ${position}`}
      className="max-h-48 w-full rounded-lg border bg-white object-contain"
      onError={() => setPreview(current => ({ ...current, failed: true }))}
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
  const [images, setImages] = useState<DraftImage[]>(() => card
    ? Array.from({ length: card.imageCount }, (_, index) => ({
      kind: "saved", id: `saved-${index + 1}`, position: index + 1, src: cardImageUrl(card, index + 1),
    }))
    : []);
  const imageInput = useRef<HTMLInputElement>(null);
  const nextImageId = useRef(0);

  function chooseImages(files: File[]) {
    let message = "";
    if (files.some(file => file.size > maxImageBytes)) message = "Each image must be 10 MB or smaller.";
    else if (files.some(file => file.type && !imageMimeTypes.includes(file.type))) message = "Choose JPG, PNG, or WebP images.";
    if (imageInput.current) imageInput.current.value = "";
    if (!message) {
      const added: DraftImage[] = files.map(file => ({ kind: "new", id: `new-${nextImageId.current++}`, file }));
      setImages(old => [...old, ...added]);
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
      const kept = new Set(images.filter(image => image.kind === "saved").map(image => image.position));
      upload.set("revision", String(card.revision));
      upload.set("removeImages", JSON.stringify(
        Array.from({ length: card.imageCount }, (_, index) => index + 1).filter(position => !kept.has(position)),
      ));
    }
    for (const image of images) if (image.kind === "new") upload.append("images", image.file);
    try {
      const result = await api<{ card: Card }>(card ? `/api/cards/${card.id}` : "/api/cards", {
        method: card ? "PATCH" : "POST",
        body: upload,
      });
      onSave(result.card);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title={card ? "Edit card" : "Add card"} onClose={onClose} closeDisabled={busy}>
      <Form onSubmit={submit} className="grid gap-5">
        <BaseField.Root name="label" render={<Field />}>
          <BaseField.Label render={<FieldLabel />}>Card name</BaseField.Label>
          <Input className="h-11" maxLength={80} required disabled={busy} defaultValue={card?.label ?? ""} />
          <BaseField.Error render={<FieldError />} />
        </BaseField.Root>
        <Field>
          <FieldLabel htmlFor="card-images">Images (optional)</FieldLabel>
          <Input
            id="card-images"
            ref={imageInput}
            className="hidden"
            type="file"
            multiple
            accept={imageMimeTypes.join(",")}
            disabled={busy}
            onChange={event => chooseImages(Array.from(event.currentTarget.files ?? []))}
          />
          <Button type="button" variant="outline" className="h-11 w-fit" disabled={busy}
            onClick={() => imageInput.current?.click()}>
            Add images
          </Button>
          <FieldDescription>Choose one or more images. Choose again to add more. JPG, PNG or WebP, up to 10 MB each.</FieldDescription>
        </Field>
        {images.length > 0 && (
          <ul className="grid gap-4">
            {images.map((image, index) => (
              <li key={image.id} className="grid gap-2">
                <p className="break-all text-sm text-muted-foreground">{image.kind === "new" ? image.file.name : `Image ${index + 1}`}</p>
                <ImagePreview
                  file={image.kind === "new" ? image.file : undefined}
                  src={image.kind === "saved" ? image.src : undefined}
                  position={index + 1}
                />
                <Button type="button" variant="ghost" className="h-11 w-fit" disabled={busy}
                  onClick={() => {
                    setImages(old => old.filter(current => current.id !== image.id));
                    setError("");
                  }}>
                  Remove image {index + 1}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <FieldError>{error}</FieldError>}
        {card && <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>Cancel</Button>}
        <Button className="h-11" type="submit" disabled={busy}>
          {busy ? "Saving..." : card ? "Save changes" : "Save card"}
        </Button>
      </Form>
    </Dialog>
  );
}
