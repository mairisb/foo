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
  const [images, setImages] = useState<Array<{ id: number; file: File }>>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const nextImageId = useRef(0);

  function chooseImages(files: File[]) {
    let message = "";
    if (files.some(file => file.size > maxImageBytes)) message = "Each image must be 10 MB or smaller.";
    else if (files.some(file => file.type && !imageMimeTypes.includes(file.type))) message = "Choose JPG, PNG, or WebP images.";
    if (imageInput.current) imageInput.current.value = "";
    if (!message) {
      const added = files.map(file => ({ id: nextImageId.current++, file }));
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
    for (const image of images) upload.append("images", image.file);
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
    <Dialog title="Add card" onClose={onClose} closeDisabled={busy}>
      <Form onSubmit={submit} className="grid gap-5">
        <BaseField.Root name="label" render={<Field />}>
          <BaseField.Label render={<FieldLabel />}>Card name</BaseField.Label>
          <Input className="h-11" maxLength={80} required disabled={busy} />
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
                <p className="break-all text-sm text-muted-foreground">{image.file.name}</p>
                <ImagePreview file={image.file} position={index + 1} />
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
        <Button className="h-11" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save card"}
        </Button>
      </Form>
    </Dialog>
  );
}
