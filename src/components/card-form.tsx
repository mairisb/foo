"use client";
import { useEffect, useRef, useState } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import {
  type Card,
  imageMimeTypes,
  maxCardImages,
  maxImageBytes,
} from "@/lib/cards";
import { api } from "@/lib/api-client";
import { Dialog } from "./dialog";

function ImagePreview({ file, position }: { file: File; position: number }) {
  const [preview, setPreview] = useState({ url: "", failed: false });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview({ url, failed: false });
    return () => URL.revokeObjectURL(url);
  }, [file]);

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

export function CardForm({
  onSave,
  onClose,
}: {
  onSave: (card: Card) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<Array<File | null>>([null, null]);
  const imageInputs = useRef<Array<HTMLInputElement | null>>([]);

  function chooseImage(index: number, file: File | null) {
    let message = "";
    if (file && file.size > maxImageBytes) message = "Each image must be 10 MB or smaller.";
    else if (file?.type && !imageMimeTypes.includes(file.type)) message = "Choose JPG, PNG, or WebP images.";
    if (message) {
      if (imageInputs.current[index]) imageInputs.current[index]!.value = "";
      file = null;
    }
    setImages(old => old.map((current, slot) => slot === index ? file : current));
    setError(message);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const upload = new FormData();
    upload.set("label", String(form.get("label")));
    for (const image of images) if (image) upload.append("images", image);
    try {
      const result = await api<{ card: Card }>("/api/cards", {
        method: "POST",
        body: upload,
      });
      onSave(result.card);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add card" onClose={onClose}>
      <Form onSubmit={submit} className="grid gap-5">
        <BaseField.Root name="label" render={<Field />}>
          <BaseField.Label render={<FieldLabel />}>Card name</BaseField.Label>
          <Input className="h-11" maxLength={80} required disabled={busy} />
          <BaseField.Error render={<FieldError />} />
        </BaseField.Root>
        {Array.from({ length: maxCardImages }, (_, index) => (
          <Field key={index}>
            <FieldLabel htmlFor={`card-image-${index}`}>Image {index + 1} (optional)</FieldLabel>
            <Input
              id={`card-image-${index}`}
              ref={element => { imageInputs.current[index] = element; }}
              className="h-11 py-2"
              type="file"
              accept={imageMimeTypes.join(",")}
              disabled={busy}
              onChange={event => chooseImage(index, event.currentTarget.files?.[0] ?? null)}
            />
            {images[index] && (
              <ImagePreview file={images[index]} position={index + 1} />
            )}
            {images[index] && (
              <Button type="button" variant="ghost" className="h-11 w-fit" disabled={busy}
                onClick={() => {
                  if (imageInputs.current[index]) imageInputs.current[index]!.value = "";
                  chooseImage(index, null);
                }}>
                Clear image {index + 1}
              </Button>
            )}
          </Field>
        ))}
        <FieldDescription>JPG, PNG or WebP. Up to 10 MB per image.</FieldDescription>
        {error && <FieldError>{error}</FieldError>}
        <Button className="h-11" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save card"}
        </Button>
      </Form>
    </Dialog>
  );
}
