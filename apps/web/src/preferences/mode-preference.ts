import { localMockIdentity } from "../mock/local-mock-context.js";

export type ExperienceMode = "guided" | "professional";

export type PreferenceStorageStatus =
  "available" | "read-failed" | "write-failed";

export interface ModePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ModePreference {
  readonly mode: ExperienceMode;
  readonly setMode: (mode: ExperienceMode) => void;
  readonly storageStatus: PreferenceStorageStatus;
  readonly announcement: string;
}

export const LOCAL_MOCK_ACTOR_ID = localMockIdentity.actorId;

export const MODE_PREFERENCE_STORAGE_NAMESPACE =
  "cloudmarkup.web.preferences.v1";

export const MODE_SWITCH_ANNOUNCEMENTS: Readonly<
  Record<ExperienceMode, string>
> = Object.freeze({
  guided: "Guided presentation enabled. Architecture data did not change.",
  professional:
    "Professional presentation enabled. Architecture data did not change.",
});

export function getModePreferenceStorageKey(
  actorId = LOCAL_MOCK_ACTOR_ID,
): string {
  const normalizedActorId = actorId.trim() || LOCAL_MOCK_ACTOR_ID;

  return `${MODE_PREFERENCE_STORAGE_NAMESPACE}:${encodeURIComponent(normalizedActorId)}:experience-mode`;
}

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return value === "guided" || value === "professional";
}
