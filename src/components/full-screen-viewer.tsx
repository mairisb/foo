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
    renderItem,
    onNavigate,
    position,
    count,
}: {
    title: string;
    closeLabel: string;
    triggerId: string;
    onClose: () => void;
    renderItem: (position: number) => React.ReactNode;
    onNavigate: (position: number) => void;
    position: number;
    count: number;
}) {
    const positionLabel = `${position}/${count}`;
    const closeButton = useRef<HTMLButtonElement>(null);
    const [content, setContent] = useState<HTMLDivElement | null>(null);
    const returnFocusId = useRef(triggerId);
    const track = useRef<HTMLDivElement>(null);
    const motion = useRef<Animation | null>(null);
    const offset = useRef(0);
    const cursor = useRef(position);
    const pendingOffset = useRef<number | null>(null);
    const hasPrevious = position > 1;
    const hasNext = position < count;
    const [swiping, setSwiping] = useState(false);
    const gesture = useRef<{
        id: number;
        x: number;
        y: number;
        animated: boolean;
    } | null>(null);

    function resetSwipe() {
        motion.current?.cancel();
        motion.current = null;
        pendingOffset.current = null;
        gesture.current = null;
        offset.current = 0;
        if (track.current) {
            track.current.style.transform = "";
        }
        setSwiping(false);
    }

    function navigate(direction: number) {
        const next = Math.max(
            1,
            Math.min(count, cursor.current + Math.sign(direction)),
        );
        resetSwipe();
        if (next !== cursor.current) {
            cursor.current = next;
            onNavigate(next);
        }
    }

    function animateSwipe(from: number, to: number) {
        const element = track.current;
        if (!element) {
            return;
        }
        motion.current?.cancel();
        element.style.transform = `translate3d(${from}px, 0, 0)`;
        const animation = element.animate(
            [
                { transform: `translate3d(${from}px, 0, 0)` },
                { transform: `translate3d(${to}px, 0, 0)` },
            ],
            {
                duration: 220,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                fill: "forwards",
            },
        );
        motion.current = animation;
        void animation.finished.then(
            () => {
                if (motion.current === animation) {
                    resetSwipe();
                }
            },
            () => {},
        );
    }

    function settleSwipe(direction: number) {
        const element = track.current;
        const next = Math.max(1, Math.min(count, cursor.current + direction));
        const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
        ).matches;
        if (!element || reduced) {
            navigate(direction);
            return;
        }
        if (next === cursor.current) {
            if (offset.current === 0) {
                resetSwipe();
            } else {
                animateSwipe(offset.current, 0);
            }
            return;
        }
        motion.current?.cancel();
        motion.current = null;
        pendingOffset.current =
            offset.current + direction * element.clientWidth;
        cursor.current = next;
        onNavigate(next);
    }

    const startPendingSwipe = useEffectEvent(() => {
        const from = pendingOffset.current;
        pendingOffset.current = null;
        if (from !== null) {
            animateSwipe(from, 0);
        }
    });
    useLayoutEffect(() => {
        cursor.current = position;
        startPendingSwipe();
    }, [position]);
    useEffect(() => () => motion.current?.cancel(), []);
    useLayoutEffect(() => {
        if (content && !content.contains(document.activeElement)) {
            closeButton.current?.focus();
        }
    }, [content, positionLabel]);
    const wheelNavigate = useEffectEvent((direction: number) => {
        navigate(direction);
    });

    useEffect(() => {
        const element = content;
        if (!element) {
            return;
        }
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
            const delta =
                Math.abs(event.deltaX) > Math.abs(event.deltaY)
                    ? event.deltaX
                    : event.deltaY;
            if (Number.isFinite(delta) && delta !== 0) {
                wheelNavigate(delta);
            }
        }
        element.addEventListener("wheel", wheel, { passive: false });
        return () => {
            element.removeEventListener("wheel", wheel);
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
                    navigate(previous ? -1 : 1);
                }}
                onPointerDown={(event) => {
                    if (
                        event.pointerType !== "touch" &&
                        event.pointerType !== "pen"
                    ) {
                        return;
                    }
                    if (!event.isPrimary) {
                        resetSwipe();
                        return;
                    }
                    if (
                        count < 2 ||
                        (window.visualViewport?.scale ?? 1) > 1 ||
                        (event.target as Element).closest(
                            "button, a, input, textarea, select",
                        )
                    ) {
                        return;
                    }
                    resetSwipe();
                    const animated = !window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                    ).matches;
                    gesture.current = {
                        id: event.pointerId,
                        x: event.clientX,
                        y: event.clientY,
                        animated,
                    };
                    setSwiping(animated);
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const start = gesture.current;
                    if (
                        !start ||
                        start.id !== event.pointerId ||
                        !start.animated
                    ) {
                        return;
                    }
                    const dx = event.clientX - start.x;
                    const dy = event.clientY - start.y;
                    if (
                        Math.abs(dx) < 10 ||
                        Math.abs(dx) < Math.abs(dy) * 1.25
                    ) {
                        return;
                    }
                    const available =
                        dx < 0 ? cursor.current < count : cursor.current > 1;
                    offset.current =
                        Math.max(
                            -event.currentTarget.clientWidth,
                            Math.min(event.currentTarget.clientWidth, dx),
                        ) * (available ? 1 : 0.2);
                    if (track.current) {
                        track.current.style.transform = `translate3d(${offset.current}px, 0, 0)`;
                    }
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
                        settleSwipe(0);
                        return;
                    }
                    settleSwipe(dx < 0 ? 1 : -1);
                }}
                onPointerCancel={() => {
                    gesture.current = null;
                    settleSwipe(0);
                }}
                className="fixed inset-0 top-0 left-0 block h-dvh w-dvw max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white ring-0 duration-0 data-open:animate-none data-closed:animate-none sm:max-w-none"
            >
                <DialogTitle className="sr-only">{title}</DialogTitle>
                <div
                    ref={track}
                    data-slot="gallery-track"
                    className="absolute inset-0"
                >
                    {(swiping
                        ? [position - 1, position, position + 1].filter(
                              (item) => item >= 1 && item <= count,
                          )
                        : [position]
                    ).map((item) => (
                        <div
                            key={item}
                            data-slot="gallery-slide"
                            aria-hidden={item !== position ? true : undefined}
                            inert={item !== position}
                            className="absolute inset-0 h-full w-full"
                            style={{
                                transform: `translateX(${(item - position) * 100}%)`,
                            }}
                        >
                            {renderItem(item)}
                        </div>
                    ))}
                </div>
                <span
                    className="pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 flex h-11 -translate-x-1/2 items-center rounded-lg bg-black/70 px-3 text-sm text-white tabular-nums"
                    role="status"
                    aria-live="polite"
                    aria-label={`${position} of ${count}`}
                >
                    {positionLabel}
                </span>
                {count > 1 && (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="full-screen-navigation absolute top-1/2 left-[max(0.75rem,env(safe-area-inset-left))] size-11 -translate-y-1/2 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                            aria-label="Previous item"
                            disabled={!hasPrevious}
                            focusableWhenDisabled
                            onClick={() => navigate(-1)}
                        >
                            <ChevronRightIcon className="rotate-180" />
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="full-screen-navigation absolute top-1/2 right-[max(0.75rem,env(safe-area-inset-right))] size-11 -translate-y-1/2 border-white/30 bg-black/70 text-white hover:bg-black hover:text-white focus-visible:ring-white"
                            aria-label="Next item"
                            disabled={!hasNext}
                            focusableWhenDisabled
                            onClick={() => navigate(1)}
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
