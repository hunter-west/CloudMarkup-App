import { createContext, useContext } from "react";

import type { ExperiencePreference } from "./experience-preference.js";

export const ExperiencePreferenceContext =
  createContext<ExperiencePreference | null>(null);

export function useExperiencePreference(): ExperiencePreference {
  const preference = useContext(ExperiencePreferenceContext);
  if (preference === null) {
    throw new Error(
      "useExperiencePreference must be used within an ExperiencePreferenceProvider.",
    );
  }
  return preference;
}
