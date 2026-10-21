import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
/** Place a tour beside its live target, choosing a free side before clamping. */
export function placeTour(
  target: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 16;
  const gap = 18;
  const candidates = [
    { left: target.right + gap, top: target.top, side: "right" },
    { left: target.left - card.width - gap, top: target.top, side: "left" },
    { left: target.left, top: target.bottom + gap, side: "below" },
    { left: target.left, top: target.top - card.height - gap, side: "above" },
  ];
  const overflow = (p: { left: number; top: number }) =>
    Math.max(0, margin - p.left) +
    Math.max(0, p.left + card.width + margin - viewport.width) +
    Math.max(0, margin - p.top) +
    Math.max(0, p.top + card.height + margin - viewport.height);
  const best = candidates.toSorted((a, b) => overflow(a) - overflow(b))[0] ?? {
    left: 16,
    top: 16,
    side: "below",
  };
  return {
    left: Math.max(
      margin,
      Math.min(best.left, viewport.width - card.width - margin),
    ),
    top: Math.max(
      margin,
      Math.min(best.top, viewport.height - card.height - margin),
    ),
    side: best.side,
  };
}

export function useTourAnchor(selector: string, enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof placeTour> | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let target: HTMLElement | undefined;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    function update() {
      frame = 0;
      const card = ref.current;
      if (!card) return;
      const nextTarget = selector
        .split(",")
        .flatMap((part) => [
          ...document.querySelectorAll<HTMLElement>(part.trim()),
        ])
        .find((item) => {
          const bounds = item.getBoundingClientRect();
          return (
            bounds.width > 0 &&
            bounds.height > 0 &&
            item.closest('[hidden], [inert], [aria-hidden="true"]') === null
          );
        });
      if (target !== nextTarget) {
        target?.removeAttribute("data-tour-target");
        if (target) observer?.unobserve(target);
        target = nextTarget;
        target?.setAttribute("data-tour-target", "true");
        if (target) observer?.observe(target);
      }
      if (!target) {
        setPosition(null);
        return;
      }
      const next = placeTour(
        target.getBoundingClientRect(),
        card.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPosition((current) =>
        current?.left === next.left &&
        current.top === next.top &&
        current.side === next.side
          ? current
          : next,
      );
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "inert", "data-expanded"],
    });
    if (ref.current) observer?.observe(ref.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      target?.removeAttribute("data-tour-target");
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [selector, enabled]);
  return {
    ref,
    side: position?.side,
    style:
      position === null
        ? undefined
        : ({
            inset: "auto",
            left: position.left,
            top: position.top,
          } as CSSProperties),
  };
}
