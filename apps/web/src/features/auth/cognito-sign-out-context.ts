import { createContext, useContext } from "react";

export interface CognitoSignOutActions {
  readonly signOut: () => Promise<boolean>;
  readonly signOutAndClearLocalRecovery: () => Promise<boolean>;
}

export const CognitoSignOutContext =
  createContext<CognitoSignOutActions | null>(null);

export function useOptionalCognitoSignOut(): CognitoSignOutActions | null {
  return useContext(CognitoSignOutContext);
}
