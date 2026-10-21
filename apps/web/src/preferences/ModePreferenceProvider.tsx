import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useOptionalPresentationPreferencesRemote } from "../api/index.js";
import {
  getModePreferenceStorageKey,
  LOCAL_MOCK_ACTOR_ID,
  MODE_SWITCH_ANNOUNCEMENTS,
  isExperienceMode,
} from "./mode-preference.js";
import type {
  ExperienceMode,
  ModePreference,
  ModePreferenceStorage,
  PreferenceStorageStatus,
} from "./mode-preference.js";
import { ModePreferenceContext } from "./mode-preference-context.js";

export interface ModePreferenceProviderProps {
  readonly actorId?: string;
  readonly children: ReactNode;
  readonly storage?: ModePreferenceStorage | null;
}

interface StoredModePreference {
  readonly mode: ExperienceMode;
  readonly storageStatus: PreferenceStorageStatus;
}

interface ModePreferenceScopeProps {
  readonly actorId: string;
  readonly children: ReactNode;
  readonly remote: ReturnType<typeof useOptionalPresentationPreferencesRemote>;
  readonly storage: ModePreferenceStorage | null;
  readonly storageKey: string;
}

function getBrowserStorage(): ModePreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredPreference(
  storage: ModePreferenceStorage | null,
  storageKey: string,
): StoredModePreference {
  if (storage === null) {
    return {
      mode: "guided",
      storageStatus: "read-failed",
    };
  }

  try {
    const storedMode = storage.getItem(storageKey);

    if (storedMode === null) {
      return {
        mode: "guided",
        storageStatus: "available",
      };
    }

    if (!isExperienceMode(storedMode)) {
      return {
        mode: "guided",
        storageStatus: "read-failed",
      };
    }

    return {
      mode: storedMode,
      storageStatus: "available",
    };
  } catch {
    return {
      mode: "guided",
      storageStatus: "read-failed",
    };
  }
}

function writeStoredPreference(
  storage: ModePreferenceStorage | null,
  storageKey: string,
  mode: ExperienceMode,
): PreferenceStorageStatus {
  try {
    if (storage === null) {
      throw new Error("Preference storage is unavailable.");
    }
    storage.setItem(storageKey, mode);
    return "available";
  } catch {
    return "write-failed";
  }
}

function ModePreferenceScope({
  actorId,
  children,
  remote,
  storage,
  storageKey,
}: ModePreferenceScopeProps) {
  const [preference, setPreference] = useState<StoredModePreference>(() =>
    readStoredPreference(storage, storageKey),
  );
  const [announcement, setAnnouncement] = useState("");
  const explicitChoiceVersion = useRef(0);
  const pendingRemoteMode = useRef<ExperienceMode | null>(null);

  const synchronizeMode = useCallback(
    (mode: ExperienceMode) => {
      if (remote === null) {
        return;
      }
      pendingRemoteMode.current = mode;
      void remote.update(actorId, { experienceMode: mode }).then(
        () => {
          if (pendingRemoteMode.current === mode) {
            pendingRemoteMode.current = null;
          }
        },
        () => {
          // The actor-scoped local choice remains the offline fallback. A
          // failed CAS is not silently replayed while the browser is online.
        },
      );
    },
    [actorId, remote],
  );

  const restoreServerMode = useCallback(() => {
    if (remote === null) {
      return;
    }
    const choiceVersion = explicitChoiceVersion.current;
    void remote.load(actorId).then(
      (snapshot) => {
        if (
          choiceVersion !== explicitChoiceVersion.current ||
          pendingRemoteMode.current !== null
        ) {
          return;
        }
        const mode = snapshot.preferences.experienceMode;
        setPreference({
          mode,
          storageStatus: writeStoredPreference(storage, storageKey, mode),
        });
      },
      () => {
        // Loading failure leaves the local recovery value visible.
      },
    );
  }, [actorId, remote, storage, storageKey]);

  useEffect(() => {
    restoreServerMode();
  }, [restoreServerMode]);

  useEffect(() => {
    if (remote === null) {
      return;
    }
    const handleOnline = () => {
      const pending = pendingRemoteMode.current;
      if (pending === null) {
        restoreServerMode();
      } else {
        synchronizeMode(pending);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [remote, restoreServerMode, synchronizeMode]);

  useEffect(() => {
    const root = document.documentElement;

    root.dataset["mode"] = preference.mode;

    return () => {
      if (root.dataset["mode"] === preference.mode) {
        delete root.dataset["mode"];
      }
    };
  }, [preference.mode]);

  const setMode = useCallback(
    (mode: ExperienceMode) => {
      explicitChoiceVersion.current += 1;
      setPreference({
        mode,
        storageStatus: writeStoredPreference(storage, storageKey, mode),
      });
      setAnnouncement(MODE_SWITCH_ANNOUNCEMENTS[mode]);
      synchronizeMode(mode);
    },
    [storage, storageKey, synchronizeMode],
  );

  const value = useMemo<ModePreference>(
    () => ({
      mode: preference.mode,
      setMode,
      storageStatus: preference.storageStatus,
      announcement,
    }),
    [announcement, preference, setMode],
  );

  return (
    <ModePreferenceContext.Provider value={value}>
      {children}
    </ModePreferenceContext.Provider>
  );
}

export function ModePreferenceProvider({
  actorId = LOCAL_MOCK_ACTOR_ID,
  children,
  storage,
}: ModePreferenceProviderProps) {
  const remote = useOptionalPresentationPreferencesRemote();
  const storageKey = getModePreferenceStorageKey(actorId);
  const resolvedStorage = storage === undefined ? getBrowserStorage() : storage;

  return (
    <ModePreferenceScope
      actorId={actorId}
      key={storageKey}
      remote={remote}
      storage={resolvedStorage}
      storageKey={storageKey}
    >
      {children}
    </ModePreferenceScope>
  );
}
