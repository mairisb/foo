"use client";

import {
    useEffect,
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { ChevronRightIcon, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function canScrollValue(target: EventTarget | null, delta: number) {
    const value =
        target instanceof Element
            ? target.closest<HTMLElement>("[data-viewer-scroll]")
            : null;
    return Boolean(
        value &&
        delta !== 0 &&
        (delta > 0
            ? value.scrollTop + value.clientHeight < value.scrollHeight - 1
            : value.scrollTop > 0),
    );
}

export function FullScreenViewer({
    title,
    closeLabel,
    triggerId,
    onClose,
    children,
    onPrevious,
    onNext,
    position,
    count,
}: {
    title: string;
    closeLabel: string;
    triggerId: string;
    onClose: () => void;
    children: React.ReactNode;
    onPrevious?: () => void;
    onNext?: () => void;
    position: number;
    count: number;
}) {
    const positionLabel = `${position}/${count}`;
    const closeButton = useRef<HTMLButtonElement>(null);
    const [content, setContent] = useState<HTMLDivElement | null>(null);
    const returnFocusId = useRef(triggerId);
    const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
    useLayoutEffect(() => {
        if (content && !content.contains(document.activeElement)) {
            closeButton.current?.focus();
        }
    }, [content, positionLabel]);
    const wheelNavigate = useEffectEvent((direction: number) => {
        if (direction > 0) {
            onNext?.();
        } else {
            onPrevious?.();
        }
    });

    useEffect(() => {
        const element = content;
        if (!element) {
            return;
        }
        let total = 0;
        let changed = false;
        let idle = 0;
        function wheel(event: WheelEvent) {
            if (
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                canScrollValue(event.target, event.deltaY)
            ) {
                return;
            }
            event.preventDefault();
            clearTimeout(idle);
            idle = window.setTimeout(() => {
                total = 0;
                changed = false;
            }, 180);
            if (changed) {
                return;
            }
            const delta =
                Math.abs(event.deltaX) > Math.abs(event.deltaY)
                    ? event.deltaX
                    : event.deltaY;
            const scale =
                event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? element!.clientHeight
                      : 1;
            total += delta * scale;
            if (Math.abs(total) >= 40) {
                changed = true;
                wheelNavigate(total);
            }
        }
        element.addEventListener("wheel", wheel, { passive: false });
        return () => {
            element.removeEventListener("wheel", wheel);
            clearTimeout(idle);
        };
    }, [content]);

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                ref={setContent}
                showCloseButton={false}
                initialFocus={closeButton}
                finalFocus={() =>
                    document.getElementById(returnFocusId.current) ?? false
                }
                style={{ touchAction: "pan-y pinch-zoom" }}
                onKeyDownCapture={(event) => {
                    if (
                        event.defaultPrevented ||
                        event.altKey ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                    ) {
                        return;
                    }
                    const target = event.target as HTMLElement;
                    if (
                        target.closest(
                            "input, textarea, select, [contenteditable=true]",
                        )
                    ) {
                        return;
                    }
                    const previous =
                        event.key === "ArrowLeft" || event.key === "ArrowUp";
                    const next =
                        event.key === "ArrowRight" || event.key === "ArrowDown";
                    if (
                        (!previous && !next) ||
                        ((event.key === "ArrowUp" ||
                            event.key === "ArrowDown") &&
                            canScrollValue(target, previous ? -1 : 1))
                    ) {
                        return;
                    }
                    event.preventDefault();
                    if (previous) {
                        onPrevious?.();
                    } else {
                        onNext?.();
                    }
                }}
                onPointerDown={(event) => {
                    if (
                        event.pointerType !== "touch" &&
                        event.pointerType !== "pen"
                    ) {
                        return;
                    }
                    if (!event.isPrimary) {
                        gesture.current = null;
                        return;
                    }
                    if (
                        (event.target as Element).closest(
                            "button, a, input, textarea, select",
                        )
                    ) {
                        return;
                    }
                    gesture.current = {
                        id: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerUp={(event) => {
                    const start = gesture.current;
                    gesture.current = null;
                    if (!start || start.id !== event.pointerId) {
                        return;
                    }
                    const dx = event.clientX - start.x;
                    const dy = event.clientY - start.y;
                    if (
                        Math.abs(dx) < 50 ||
                        Math.abs(dx) < Math.abs(dy) * 1.25
                    ) {
                        return;
                    }
                    if (dx < 0) {
                        onNext?.();
                    } else {
                        onPrevious?.();
                    }
                }}
                onPointerCancel={() => {
                    gesture.current = null;
                }}
                className="fixed inset-0 top-0 left-0 block h-dvh w-dvw max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white ring-0 duration-0 data-open:animate-none data-closed:animate-none sm:max-w-none"
            >
                <DialogTitle className="sr-only">{title}</DialogTitle>
                {children}
                <span
                    className="pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 flex h-11 -translate-x-1/2 items-center rounded-lg bg-black/70 px-3 text-sm text-white tabular-nums"
                    role="status"
                    aria-live="polite"
                    aria-label={`${position} of ${count}`}
                >
                    {positionLabel}
                </span>
                {(onPrevious || onNext) && (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="full-screen-navigation absolute top-1/2 left-[max(0.75rem,env(safe-area-inset-left))] size-11 -translate-y-1/2 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                            aria-label="Previous item"
                            disabled={!onPrevious}
                            focusableWhenDisabled
                            onClick={onPrevious}
                        >
                            <ChevronRightIcon className="rotate-180" />
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="full-screen-navigation absolute top-1/2 right-[max(0.75rem,env(safe-area-inset-right))] size-11 -translate-y-1/2 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                            aria-label="Next item"
                            disabled={!onNext}
                            focusableWhenDisabled
                            onClick={onNext}
                        >
                            <ChevronRightIcon />
                        </Button>
                    </>
                )}
                <Button
                    ref={closeButton}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] size-11 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                    aria-label={closeLabel}
                    onClick={onClose}
                >
                    <X aria-hidden="true" />
                </Button>
            </DialogContent>
        </Dialog>
    );
}
