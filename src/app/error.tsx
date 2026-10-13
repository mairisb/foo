"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold">Unable to load cards</h1>
      <p className="mb-4 text-muted-foreground">Please try again.</p>
      <Button className="h-11" onClick={reset}>Try again</Button>
    </main>
  );
}
