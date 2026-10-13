"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import type { Card } from "@/lib/cards";
import { authClient } from "@/lib/auth-client";
import { Brand } from "./brand";
import { CardForm } from "./card-form";
import { CardDetail } from "./card-detail";

export function Wallet({
  initialCards,
  userName,
}: {
  initialCards: Card[];
  userName: string;
}) {
  const [cards, setCards] = useState(initialCards);
  const [selected, setSelected] = useState<Card | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  function save(card: Card) {
    setCards((old) => [card, ...old]);
    setAdding(false);
  }
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      window.location.assign("/login");
    } catch {
      setError("Couldn't sign out. Please try again.");
      setSigningOut(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-6 flex items-center gap-3 border-b pb-4">
        <Brand />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{userName}</span>
        <Button variant="outline" className="h-11" onClick={signOut} disabled={signingOut}>
          Sign out
        </Button>
      </header>
      <main>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-xl font-semibold">My cards ({cards.length})</h1>
          <Button className="h-11" onClick={() => setAdding(true)}>Add card</Button>
        </div>
        {error && <FieldError className="mb-4">{error}</FieldError>}
        {cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cards yet.</p>
        ) : (
          <ul className="grid gap-3">
            {cards.map((card) => (
              <li key={card.id}>
                <Button
                  variant="outline"
                  className="h-auto min-h-11 w-full flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal"
                  onClick={() => setSelected(card)}
                  aria-label={`Open ${card.label}`}
                >
                  <strong className="w-full break-words font-medium">{card.label}</strong>
                  {card.cardNumber ? (
                    <code className="w-full break-all font-normal text-muted-foreground">{card.cardNumber}</code>
                  ) : (
                    <span className="font-normal text-muted-foreground">
                      {card.imageCount} {card.imageCount === 1 ? "image" : "images"}
                    </span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </main>
      {adding && <CardForm onSave={save} onClose={() => setAdding(false)} />}
      {selected && (
        <CardDetail card={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
