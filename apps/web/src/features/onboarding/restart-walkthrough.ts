import type { UsabilityEventsAdapter } from "../../instrumentation/usability-events.js";
import type {
  ExperienceMode,
  ExperiencePreference,
} from "../../preferences/index.js";

interface RestartNotesApiWalkthroughInput {
  readonly experience: ExperiencePreference;
  readonly mode: ExperienceMode;
  readonly setMode: (mode: ExperienceMode) => void;
  readonly surface: "settings" | "walkthrough";
  readonly usabilityEvents: UsabilityEventsAdapter;
}

/**
 * Restarts the Guided-only walkthrough without touching architecture state.
 * Callers remain responsible for their surface-specific announcement.
 */
export function restartNotesApiWalkthrough({
  experience,
  mode,
  setMode,
  surface,
  usabilityEvents,
}: RestartNotesApiWalkthroughInput): boolean {
  experience.restartWalkthrough();
  experience.setContextualTeachingEnabled(true);
  if (mode === "guided") {
    return false;
  }

  usabilityEvents.record({
    from: "professional",
    surface,
    to: "guided",
    type: "mode_changed",
  });
  setMode("guided");
  return true;
}
