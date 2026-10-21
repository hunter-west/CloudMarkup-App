import { createContext, useContext } from "react";

import type { ModePreference } from "./mode-preference.js";

export const ModePreferenceContext = createContext<ModePreference | null>(null);

export function useModePreference(): ModePreference {
  const preference = useContext(ModePreferenceContext);

  if (preference === null) {
    throw new Error(
      "useModePreference must be used within a ModePreferenceProvider.",
    );
  }

  return preference;
}
