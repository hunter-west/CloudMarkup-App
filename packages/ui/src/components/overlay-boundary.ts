import { createContext, useContext, type RefObject } from "react";

export const OverlayBoundaryContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

export function useOverlayBoundary(): RefObject<HTMLElement | null> | null {
  return useContext(OverlayBoundaryContext);
}
