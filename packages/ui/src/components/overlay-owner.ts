import { createContext, useContext, type RefObject } from "react";

export const OverlayOwnerContext =
  createContext<RefObject<HTMLElement | null> | null>(null);

export function useOverlayOwner(): RefObject<HTMLElement | null> | null {
  return useContext(OverlayOwnerContext);
}
