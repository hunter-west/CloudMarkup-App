import { regionIdentifierSchema } from "@cloudmarkup/schemas";

import { localMockIdentity } from "../mock/local-mock-context.js";

export const EXPERIENCE_PREFERENCE_SCHEMA_VERSION = 1 as const;

export const EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE =
  "cloudmarkup.web.experience-preferences.v1";

export const EXPERIENCE_PREFERENCE_MAX_SERIALIZED_LENGTH = 2_048;

export type FirstUseStatus = "pending" | "completed" | "skipped";

export type ProjectStartChoice = "prompt" | "template" | "blank";

export type NotesApiWalkthroughStatus =
  "not-started" | "dismissed" | "completed";

const editorWalkthroughSteps = [
  "add",
  "configure",
  "learn",
  "connect",
  "permissions",
  "assistant",
  "validation",
  "revision",
  "import",
  "export",
] as const;
export type EditorWalkthroughStepId = (typeof editorWalkthroughSteps)[number];

export function parseEditorWalkthroughStep(
  value: string | null,
): EditorWalkthroughStepId {
  return editorWalkthroughSteps.find((step) => step === value) ?? "add";
}

export function getEditorWalkthroughStepStorageKey(actorId?: string): string {
  return `${getExperiencePreferenceStorageKey(actorId)}:editor-tour-step.v1`;
}

export type ExperiencePreferenceStorageStatus =
  "available" | "read-failed" | "write-failed";

export interface ExperiencePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ExperiencePreferenceState {
  readonly contextualTeachingEnabled: boolean;
  readonly defaultRegion: string | null;
  readonly firstUseStatus: FirstUseStatus;
  readonly notesApiWalkthrough: NotesApiWalkthroughStatus;
  readonly preferredProvider: "aws";
  readonly startChoice: ProjectStartChoice;
}

export interface StoredExperiencePreference extends ExperiencePreferenceState {
  readonly schemaVersion: typeof EXPERIENCE_PREFERENCE_SCHEMA_VERSION;
}

export interface CompleteFirstUseInput {
  readonly contextualTeachingEnabled: boolean;
  readonly defaultRegion: string | null;
  readonly preferredProvider: "aws";
  readonly startChoice: ProjectStartChoice;
}

export interface ExperiencePreference extends ExperiencePreferenceState {
  readonly storageStatus: ExperiencePreferenceStorageStatus;
  readonly editorWalkthroughStep: EditorWalkthroughStepId;
  completeFirstUse(
    input: CompleteFirstUseInput,
  ): ExperiencePreferenceStorageStatus;
  restartFirstUse(): void;
  restartWalkthrough(): void;
  setContextualTeachingEnabled(enabled: boolean): void;
  setWalkthroughStatus(status: NotesApiWalkthroughStatus): void;
  setEditorWalkthroughStep(step: EditorWalkthroughStepId): void;
  skipFirstUse(): ExperiencePreferenceStorageStatus;
}

export const DEFAULT_EXPERIENCE_PREFERENCE: ExperiencePreferenceState =
  Object.freeze({
    contextualTeachingEnabled: true,
    defaultRegion: null,
    firstUseStatus: "pending",
    notesApiWalkthrough: "not-started",
    preferredProvider: "aws",
    startChoice: "blank",
  });

const storedPreferenceKeys = Object.freeze([
  "contextualTeachingEnabled",
  "defaultRegion",
  "firstUseStatus",
  "notesApiWalkthrough",
  "preferredProvider",
  "schemaVersion",
  "startChoice",
] as const);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactStoredPreferenceKeys(
  value: Readonly<Record<string, unknown>>,
): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...storedPreferenceKeys].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

export function isFirstUseStatus(value: unknown): value is FirstUseStatus {
  return value === "pending" || value === "completed" || value === "skipped";
}

export function isProjectStartChoice(
  value: unknown,
): value is ProjectStartChoice {
  return value === "prompt" || value === "template" || value === "blank";
}

export function isNotesApiWalkthroughStatus(
  value: unknown,
): value is NotesApiWalkthroughStatus {
  return (
    value === "not-started" || value === "dismissed" || value === "completed"
  );
}

/**
 * Normalizes one optional provider Region preference without treating it as an
 * Architecture Document value. Invalid, empty, or overlong input fails closed
 * to no preferred Region.
 */
export function normalizeDefaultRegion(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  const parsed = regionIdentifierSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

export function getExperiencePreferenceStorageKey(
  actorId = localMockIdentity.actorId,
): string {
  const normalizedActorId = actorId.trim() || localMockIdentity.actorId;
  return `${EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE}:${encodeURIComponent(normalizedActorId)}`;
}

export function isStoredExperiencePreference(
  value: unknown,
): value is StoredExperiencePreference {
  if (!isRecord(value) || !hasExactStoredPreferenceKeys(value)) {
    return false;
  }

  return (
    value["schemaVersion"] === EXPERIENCE_PREFERENCE_SCHEMA_VERSION &&
    isFirstUseStatus(value["firstUseStatus"]) &&
    value["preferredProvider"] === "aws" &&
    (value["defaultRegion"] === null ||
      (typeof value["defaultRegion"] === "string" &&
        normalizeDefaultRegion(value["defaultRegion"]) ===
          value["defaultRegion"])) &&
    isProjectStartChoice(value["startChoice"]) &&
    typeof value["contextualTeachingEnabled"] === "boolean" &&
    isNotesApiWalkthroughStatus(value["notesApiWalkthrough"])
  );
}

export function parseStoredExperiencePreference(
  serialized: string,
): StoredExperiencePreference | null {
  if (
    serialized.length === 0 ||
    serialized.length > EXPERIENCE_PREFERENCE_MAX_SERIALIZED_LENGTH
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    return isStoredExperiencePreference(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeExperiencePreference(
  preference: ExperiencePreferenceState,
): string {
  const record: StoredExperiencePreference = {
    contextualTeachingEnabled: preference.contextualTeachingEnabled,
    defaultRegion: normalizeDefaultRegion(preference.defaultRegion),
    firstUseStatus: preference.firstUseStatus,
    notesApiWalkthrough: preference.notesApiWalkthrough,
    preferredProvider: "aws",
    schemaVersion: EXPERIENCE_PREFERENCE_SCHEMA_VERSION,
    startChoice: preference.startChoice,
  };
  const serialized = JSON.stringify(record);
  if (serialized.length > EXPERIENCE_PREFERENCE_MAX_SERIALIZED_LENGTH) {
    throw new Error("The local experience preference exceeds its size limit.");
  }
  return serialized;
}
