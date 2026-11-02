import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useOptionalPresentationPreferencesRemote } from "../api/index.js";
import {
  DEFAULT_EXPERIENCE_PREFERENCE,
  getExperiencePreferenceStorageKey,
  getEditorWalkthroughStepStorageKey,
  normalizeDefaultRegion,
  parseStoredExperiencePreference,
  parseEditorWalkthroughStep,
  serializeExperiencePreference,
  type CompleteFirstUseInput,
  type ExperiencePreference,
  type ExperiencePreferenceState,
  type ExperiencePreferenceStorage,
  type ExperiencePreferenceStorageStatus,
  type NotesApiWalkthroughStatus,
  type EditorWalkthroughStepId,
} from "./experience-preference.js";
import { LOCAL_MOCK_ACTOR_ID } from "./mode-preference.js";
import { ExperiencePreferenceContext } from "./experience-preference-context.js";

export interface ExperiencePreferenceProviderProps {
  readonly actorId?: string;
  readonly children: ReactNode;
  readonly storage?: ExperiencePreferenceStorage | null;
}

interface StoredPreferenceState {
  readonly preference: ExperiencePreferenceState;
  readonly storageStatus: ExperiencePreferenceStorageStatus;
}

interface ExperiencePreferenceScopeProps {
  readonly actorId: string;
  readonly children: ReactNode;
  readonly remote: ReturnType<typeof useOptionalPresentationPreferencesRemote>;
  readonly storage: ExperiencePreferenceStorage | null;
  readonly storageKey: string;
}

function getBrowserStorage(): ExperiencePreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function copyDefaultPreference(): ExperiencePreferenceState {
  return { ...DEFAULT_EXPERIENCE_PREFERENCE };
}

function readStoredPreference(
  storage: ExperiencePreferenceStorage | null,
  storageKey: string,
): StoredPreferenceState {
  if (storage === null) {
    return {
      preference: copyDefaultPreference(),
      storageStatus: "read-failed",
    };
  }

  try {
    const serialized = storage.getItem(storageKey);
    if (serialized === null) {
      return {
        preference: copyDefaultPreference(),
        storageStatus: "available",
      };
    }

    const stored = parseStoredExperiencePreference(serialized);
    if (stored === null) {
      return {
        preference: copyDefaultPreference(),
        storageStatus: "read-failed",
      };
    }

    return {
      preference: {
        contextualTeachingEnabled: stored.contextualTeachingEnabled,
        defaultRegion: stored.defaultRegion,
        firstUseStatus: stored.firstUseStatus,
        notesApiWalkthrough: stored.notesApiWalkthrough,
        preferredProvider: stored.preferredProvider,
        startChoice: stored.startChoice,
      },
      storageStatus: "available",
    };
  } catch {
    return {
      preference: copyDefaultPreference(),
      storageStatus: "read-failed",
    };
  }
}

function writeStoredPreference(
  storage: ExperiencePreferenceStorage | null,
  storageKey: string,
  preference: ExperiencePreferenceState,
): ExperiencePreferenceStorageStatus {
  try {
    if (storage === null) {
      throw new Error("Experience preference storage is unavailable.");
    }
    storage.setItem(storageKey, serializeExperiencePreference(preference));
    return "available";
  } catch {
    return "write-failed";
  }
}

function ExperiencePreferenceScope({
  actorId,
  children,
  remote,
  storage,
  storageKey,
}: ExperiencePreferenceScopeProps) {
  const [storedState, setStoredState] = useState<StoredPreferenceState>(() =>
    readStoredPreference(storage, storageKey),
  );
  const storedStateReference = useRef(storedState);
  const stepStorageKey = getEditorWalkthroughStepStorageKey(actorId);
  const [editorWalkthroughStep, setEditorStep] = useState(() => {
    try {
      return parseEditorWalkthroughStep(
        storage?.getItem(stepStorageKey) ?? null,
      );
    } catch {
      return "add" as const;
    }
  });
  const setEditorWalkthroughStep = useCallback(
    (step: EditorWalkthroughStepId) => {
      setEditorStep(step);
      try {
        storage?.setItem(stepStorageKey, step);
      } catch {
        // Tour progress remains available in this session when local storage fails.
      }
    },
    [storage, stepStorageKey],
  );
  const explicitContextVersion = useRef(0);
  const pendingRemoteContext = useRef<boolean | null>(null);

  const synchronizeContextualPreference = useCallback(
    (enabled: boolean) => {
      if (remote === null) {
        return;
      }
      pendingRemoteContext.current = enabled;
      void remote.update(actorId, { contextualLearningEnabled: enabled }).then(
        () => {
          if (pendingRemoteContext.current === enabled) {
            pendingRemoteContext.current = null;
          }
        },
        () => {
          // Keep the local fallback; only a browser reconnect retries it.
        },
      );
    },
    [actorId, remote],
  );

  const restoreServerContextualPreference = useCallback(() => {
    if (remote === null) {
      return;
    }
    const contextVersion = explicitContextVersion.current;
    void remote.load(actorId).then(
      (snapshot) => {
        if (
          contextVersion !== explicitContextVersion.current ||
          pendingRemoteContext.current !== null
        ) {
          return;
        }
        const preference = {
          ...storedStateReference.current.preference,
          contextualTeachingEnabled:
            snapshot.preferences.contextualLearningEnabled,
        };
        const nextState = {
          preference,
          storageStatus: writeStoredPreference(storage, storageKey, preference),
        };
        storedStateReference.current = nextState;
        setStoredState(nextState);
      },
      () => {
        // Loading failure leaves the actor-scoped recovery value visible.
      },
    );
  }, [actorId, remote, storage, storageKey]);

  useEffect(() => {
    restoreServerContextualPreference();
  }, [restoreServerContextualPreference]);

  useEffect(() => {
    if (remote === null) {
      return;
    }
    const handleOnline = () => {
      const pending = pendingRemoteContext.current;
      if (pending === null) {
        restoreServerContextualPreference();
      } else {
        synchronizeContextualPreference(pending);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [
    remote,
    restoreServerContextualPreference,
    synchronizeContextualPreference,
  ]);

  const updatePreference = useCallback(
    (
      update: (current: ExperiencePreferenceState) => ExperiencePreferenceState,
      synchronizeContextual = false,
    ) => {
      const preference = update(storedStateReference.current.preference);
      const storageStatus = writeStoredPreference(
        storage,
        storageKey,
        preference,
      );
      const nextState = { preference, storageStatus };
      storedStateReference.current = nextState;
      setStoredState(nextState);
      if (synchronizeContextual) {
        explicitContextVersion.current += 1;
        synchronizeContextualPreference(preference.contextualTeachingEnabled);
      }
      return storageStatus;
    },
    [storage, storageKey, synchronizeContextualPreference],
  );

  const completeFirstUse = useCallback(
    (input: CompleteFirstUseInput) => {
      return updatePreference(
        (current) => ({
          ...current,
          contextualTeachingEnabled: input.contextualTeachingEnabled,
          defaultRegion: normalizeDefaultRegion(input.defaultRegion),
          firstUseStatus: "completed",
          preferredProvider: "aws",
          startChoice: input.startChoice,
        }),
        true,
      );
    },
    [updatePreference],
  );

  const skipFirstUse = useCallback(() => {
    return updatePreference((current) => ({
      ...current,
      firstUseStatus: "skipped",
    }));
  }, [updatePreference]);

  const restartFirstUse = useCallback(() => {
    updatePreference((current) => ({
      ...current,
      firstUseStatus: "pending",
    }));
  }, [updatePreference]);

  const setContextualTeachingEnabled = useCallback(
    (enabled: boolean) => {
      updatePreference(
        (current) => ({
          ...current,
          contextualTeachingEnabled: enabled,
        }),
        true,
      );
    },
    [updatePreference],
  );

  const setWalkthroughStatus = useCallback(
    (status: NotesApiWalkthroughStatus) => {
      updatePreference((current) => ({
        ...current,
        notesApiWalkthrough: status,
      }));
      if (status !== "not-started") setEditorWalkthroughStep("add");
    },
    [updatePreference, setEditorWalkthroughStep],
  );

  const restartWalkthrough = useCallback(() => {
    setWalkthroughStatus("not-started");
    setEditorWalkthroughStep("add");
  }, [setWalkthroughStatus, setEditorWalkthroughStep]);

  const value = useMemo<ExperiencePreference>(
    () => ({
      ...storedState.preference,
      editorWalkthroughStep,
      completeFirstUse,
      restartFirstUse,
      restartWalkthrough,
      setContextualTeachingEnabled,
      setWalkthroughStatus,
      setEditorWalkthroughStep,
      skipFirstUse,
      storageStatus: storedState.storageStatus,
    }),
    [
      completeFirstUse,
      restartFirstUse,
      restartWalkthrough,
      setContextualTeachingEnabled,
      setWalkthroughStatus,
      skipFirstUse,
      storedState,
      editorWalkthroughStep,
      setEditorWalkthroughStep,
    ],
  );

  return (
    <ExperiencePreferenceContext.Provider value={value}>
      {children}
    </ExperiencePreferenceContext.Provider>
  );
}

export function ExperiencePreferenceProvider({
  actorId = LOCAL_MOCK_ACTOR_ID,
  children,
  storage,
}: ExperiencePreferenceProviderProps) {
  const remote = useOptionalPresentationPreferencesRemote();
  const storageKey = getExperiencePreferenceStorageKey(actorId);
  const resolvedStorage = storage === undefined ? getBrowserStorage() : storage;

  return (
    <ExperiencePreferenceScope
      actorId={actorId}
      key={storageKey}
      remote={remote}
      storage={resolvedStorage}
      storageKey={storageKey}
    >
      {children}
    </ExperiencePreferenceScope>
  );
}
