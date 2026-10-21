import { useEffect, useState } from "react";

const OVERLAY_EXIT_DURATION_MS = 160;

function reducedMotionRequested(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }

  const matchMedia = Reflect.get(window, "matchMedia") as
    ((query: string) => MediaQueryList) | undefined;

  return (
    document.documentElement.dataset["cmReducedMotion"] === "true" ||
    (matchMedia?.call(window, "(prefers-reduced-motion: reduce)").matches ??
      false)
  );
}

/**
 * Keeps a closed overlay mounted only long enough for its shared exit motion.
 * Consumers must make the lingering surface inert and hidden immediately so
 * focus and keyboard state never wait for animation completion.
 */
export function useOverlayPresence(open: boolean): {
  readonly present: boolean;
  readonly state: "closed" | "open";
} {
  const [lingering, setLingering] = useState(open);

  /* eslint-disable react-hooks/set-state-in-effect -- Presence mirrors an
     external visibility prop so a closed, immediately inert surface can
     finish the design-system exit animation before it unmounts. */
  useEffect(() => {
    if (open) {
      setLingering(true);
      return undefined;
    }

    const timeout = window.setTimeout(
      () => {
        setLingering(false);
      },
      reducedMotionRequested() ? 0 : OVERLAY_EXIT_DURATION_MS,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    present: open || lingering,
    state: open ? "open" : "closed",
  };
}
