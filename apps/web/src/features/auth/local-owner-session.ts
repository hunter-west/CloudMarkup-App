import { createContext, useContext } from "react";
import type { LocalOwnerBrowserSession } from "./local-owner-browser-auth.js";
export interface LocalOwnerActions {
  readonly session: LocalOwnerBrowserSession;
  readonly signOut: () => Promise<void>;
  readonly reauthenticate: (signal?: AbortSignal) => Promise<void>;
}
export const LocalOwnerSessionContext = createContext<LocalOwnerActions | null>(
  null,
);
export function useOptionalLocalOwnerSession(): LocalOwnerActions | null {
  return useContext(LocalOwnerSessionContext);
}
