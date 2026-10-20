"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import type { Card } from "@/lib/cards";
import { authClient } from "@/lib/auth-client";
import { DialogPendingContext, useDialogHistory } from "@/lib/dialog-history";
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
    const navigation = useDialogHistory();
    const [mode, cardId] = navigation.view.split(":");
    const selected = cards.find((card) => card.id === cardId) ?? null;
    const editing = mode === "edit" ? selected : null;
    const adding = mode === "add";
    const imagePosition =
        mode === "card" && navigation.view.includes(":image:")
            ? Number(navigation.view.split(":")[3])
            : null;
    const codePosition = navigation.view.includes(":code:")
        ? Number(navigation.view.split(":").at(-1))
        : null;
    const adjustingId =
        navigation.view.match(/:scan:((saved|new)-\d+)(:preview)?$/)?.[1] ??
        null;
    const previewing = navigation.view.endsWith(":preview");
    const scannerView = adjustingId
        ? adding
            ? (`add:scan:${adjustingId}` as const)
            : (`edit:${cardId}:scan:${adjustingId}` as const)
        : null;
    const { open: openDialog, close: closeDialog, setPending } = navigation;
    const closeAdjustment = useCallback(() => {
        setPending(false);
        closeDialog();
    }, [closeDialog, setPending]);
    const openPreview = useCallback(() => {
        if (!scannerView) {
            return;
        }
        setPending(false);
        openDialog(`${scannerView}:preview`);
    }, [scannerView, openDialog, setPending]);
    const [error, setError] = useState("");
    const [signingOut, setSigningOut] = useState(false);
    const addButton = useRef<HTMLButtonElement>(null);
    const restoreAddFocus = useRef(false);

    useEffect(() => {
        if (restoreAddFocus.current && !navigation.view) {
            addButton.current?.focus();
            restoreAddFocus.current = false;
        }
    }, [cards, navigation.view]);

    function save(card: Card) {
        setCards((old) => [card, ...old]);
        navigation.setPending(false);
        navigation.close();
    }
    function remove(id: string) {
        restoreAddFocus.current = true;
        setCards((old) => old.filter((card) => card.id !== id));
        navigation.setPending(false);
        navigation.close(true);
    }
    function edit(card: Card) {
        setCards((old) =>
            old.map((current) => (current.id === card.id ? card : current)),
        );
        navigation.setPending(false);
        navigation.open(`edit:${card.id}`);
    }
    function saveChanges(card: Card) {
        setCards((old) =>
            old.map((current) => (current.id === card.id ? card : current)),
        );
        navigation.setPending(false);
        navigation.close();
    }
    async function signOut() {
        setSigningOut(true);
        setError("");
        try {
            const result = await authClient.signOut();
            if (result.error) {
                throw new Error(result.error.message);
            }
            // Reload server-rendered account data after the session changes.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/login");
        } catch {
            setError("Couldn't sign out. Please try again.");
            setSigningOut(false);
        }
    }

    return (
        <DialogPendingContext.Provider value={navigation.setPending}>
            <div className="mx-auto w-full max-w-2xl px-4 py-6">
                <header className="mb-6 flex items-center gap-3 border-b pb-4">
                    <Brand />
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {userName}
                    </span>
                    <Button
                        variant="outline"
                        className="h-11"
                        onClick={signOut}
                        disabled={signingOut}
                    >
                        Sign out
                    </Button>
                </header>
                <main>
                    <div className="mb-6 flex flex-wrap items-center gap-3">
                        <h1 className="flex-1 text-xl font-semibold">
                            My cards ({cards.length})
                        </h1>
                        <Button
                            ref={addButton}
                            className="h-11"
                            onClick={() => navigation.open("add")}
                        >
                            Add card
                        </Button>
                    </div>
                    {error && <FieldError className="mb-4">{error}</FieldError>}
                    {cards.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No cards yet.
                        </p>
                    ) : (
                        <ul className="grid grid-cols-1 gap-3">
                            {cards.map((card) => (
                                <li key={card.id}>
                                    <Button
                                        variant="outline"
                                        className="h-auto min-h-11 w-full flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal"
                                        onClick={() =>
                                            navigation.open(`card:${card.id}`)
                                        }
                                        aria-label={`Open ${card.label}`}
                                    >
                                        <strong className="w-full break-words font-medium">
                                            {card.label}
                                        </strong>
                                        {card.cardNumber ? (
                                            <code className="w-full break-all font-normal text-muted-foreground">
                                                {card.cardNumber}
                                            </code>
                                        ) : (
                                            <span className="font-normal text-muted-foreground">
                                                {card.imageCount}{" "}
                                                {card.imageCount === 1
                                                    ? "image"
                                                    : "images"}
                                            </span>
                                        )}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </main>
                {adding && (
                    <CardForm
                        codePosition={codePosition}
                        onOpenCode={(position) =>
                            navigation.open(`add:code:${position}`)
                        }
                        onCloseCode={closeDialog}
                        onNavigateCode={(position) =>
                            navigation.replace(`add:code:${position}`)
                        }
                        adjustingId={adjustingId}
                        previewing={previewing}
                        onOpenPreview={openPreview}
                        onClosePreview={closeAdjustment}
                        onAdjustImage={(id) =>
                            navigation.open(`add:scan:${id}`)
                        }
                        onCloseAdjustment={closeAdjustment}
                        onSave={save}
                        onClose={() => navigation.close()}
                    />
                )}
                {editing && (
                    <CardForm
                        key={`${editing.id}:${editing.revision}`}
                        card={editing}
                        codePosition={codePosition}
                        onOpenCode={(position) =>
                            navigation.open(
                                `edit:${editing.id}:code:${position}`,
                            )
                        }
                        onCloseCode={closeDialog}
                        onNavigateCode={(position) =>
                            navigation.replace(
                                `edit:${editing.id}:code:${position}`,
                            )
                        }
                        adjustingId={adjustingId}
                        previewing={previewing}
                        onOpenPreview={openPreview}
                        onClosePreview={closeAdjustment}
                        onAdjustImage={(id) =>
                            navigation.open(`edit:${editing.id}:scan:${id}`)
                        }
                        onCloseAdjustment={closeAdjustment}
                        onSave={saveChanges}
                        onClose={() => navigation.close()}
                    />
                )}
                {selected && !editing && (
                    <CardDetail
                        key={`${selected.id}:${selected.revision}`}
                        card={selected}
                        codePosition={codePosition}
                        onOpenCode={(position) =>
                            navigation.open(
                                `card:${selected.id}:code:${position}`,
                            )
                        }
                        onCloseCode={closeDialog}
                        onNavigateMedia={({ kind, position }) =>
                            navigation.replace(
                                `card:${selected.id}:${kind}:${position}`,
                            )
                        }
                        onClose={() => navigation.close()}
                        onDelete={remove}
                        onEdit={edit}
                        imagePosition={imagePosition}
                        onOpenImage={(position) =>
                            navigation.open(
                                `card:${selected.id}:image:${position}`,
                            )
                        }
                        onCloseImage={() => navigation.close()}
                    />
                )}
            </div>
        </DialogPendingContext.Provider>
    );
}
