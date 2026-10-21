import type { ReactNode, RefObject } from "react";

import { OverlayBoundaryContext } from "./overlay-boundary.js";

export function OverlayBoundaryProvider({
  boundaryRef,
  children,
}: {
  readonly boundaryRef: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}) {
  return (
    <OverlayBoundaryContext.Provider value={boundaryRef}>
      {children}
    </OverlayBoundaryContext.Provider>
  );
}
