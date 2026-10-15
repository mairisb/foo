"use client";

import { createContext, useState, useSyncExternalStore } from "react";

type DialogView = "" | "add" | `card:${string}` | `edit:${string}`;

export const DialogPendingContext = createContext<
    ((pending: boolean) => void) | null
>(null);

function readView(): DialogView {
    const view = window.history.state?.fooDialog;
    if (
        typeof view === "string" &&
        (view === "add" || /^(card|edit):[\da-f-]{36}$/i.test(view))
    ) {
        return view as DialogView;
    }
    return "";
}

function createDialogHistory() {
    let view: DialogView = typeof window === "undefined" ? "" : readView();
    let pending = false;
    const listeners = new Set<() => void>();

    function push(next: DialogView) {
        window.history.pushState(
            { ...window.history.state, fooDialog: next },
            "",
            window.location.href,
        );
    }

    function changed() {
        for (const listener of listeners) {
            listener();
        }
    }

    function popState() {
        const next = readView();
        if (pending && next !== view) {
            // Restore this entry without unmounting an in-flight form or delete.
            // A single Back returns to the entry immediately below this dialog.
            push(view);
            return;
        }
        view = next;
        changed();
    }

    return {
        getSnapshot: () => view,
        getServerSnapshot: () => "" as const,
        subscribe(listener: () => void) {
            listeners.add(listener);
            window.addEventListener("popstate", popState);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) {
                    window.removeEventListener("popstate", popState);
                }
            };
        },
        open(next: Exclude<DialogView, "">) {
            if (pending || next === view) {
                return;
            }
            push(next);
            view = next;
            changed();
        },
        close(forget = false) {
            if (pending || !view) {
                return;
            }
            if (forget) {
                // Forward must not reopen a card that was just deleted.
                window.history.replaceState(
                    { ...window.history.state, fooDialog: "" },
                    "",
                    window.location.href,
                );
            }
            window.history.back();
        },
        setPending(value: boolean) {
            pending = value;
        },
    };
}

export function useDialogHistory() {
    const [history] = useState(createDialogHistory);
    const view = useSyncExternalStore(
        history.subscribe,
        history.getSnapshot,
        history.getServerSnapshot,
    );
    return {
        view,
        open: history.open,
        close: history.close,
        setPending: history.setPending,
    };
}
