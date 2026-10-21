import type { QueryClient } from "@tanstack/react-query";

import { EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE } from "../../preferences/experience-preference.js";
import { MODE_PREFERENCE_STORAGE_NAMESPACE } from "../../preferences/mode-preference.js";
import { NAVIGATION_PREFERENCE_STORAGE_NAMESPACE } from "../../shell/navigation-preference.js";
import { EDITOR_RECOVERY_INDEXED_DB_NAME } from "../editor/persistence/indexeddb-editor-recovery-store.js";
import {
  browserCognitoAuthSession,
  type CognitoBrowserAuthSession,
} from "./cognito-browser-auth.js";
import { browserCognitoSignOutChannel } from "./cognito-sign-out-channel.js";

export interface CognitoSignOutBrowserEnvironment {
  readonly assignLocation: (url: string) => void;
  readonly confirmClear: (message: string) => boolean;
  readonly indexedDb: IDBFactory | undefined;
  readonly localStorage: Storage | undefined;
  readonly publishSignOut: () => void;
}

export interface PerformCognitoSignOutOptions {
  readonly clearLocalRecovery?: boolean;
  readonly environment?: CognitoSignOutBrowserEnvironment;
  readonly queryClient: QueryClient;
  readonly session?: CognitoBrowserAuthSession;
}

function browserEnvironment(): CognitoSignOutBrowserEnvironment {
  let localStorage: Storage | undefined;
  try {
    localStorage = window.localStorage;
  } catch {
    localStorage = undefined;
  }
  return {
    assignLocation: window.location.assign.bind(window.location),
    confirmClear: window.confirm.bind(window),
    indexedDb: window.indexedDB,
    localStorage,
    publishSignOut: () => {
      browserCognitoSignOutChannel.publish();
    },
  };
}

function clearPreferenceRecovery(storage: Storage | undefined): void {
  if (storage === undefined) return;
  const prefixes = [
    `${EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE}:`,
    `${MODE_PREFERENCE_STORAGE_NAMESPACE}:`,
    `${NAVIGATION_PREFERENCE_STORAGE_NAMESPACE}:`,
  ];
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  } catch {
    throw new TypeError(
      "CloudMarkup could not clear browser preference recovery before logout.",
    );
  }
}

function deleteEditorRecoveryDatabase(
  indexedDb: IDBFactory | undefined,
): Promise<void> {
  if (indexedDb === undefined) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDb.deleteDatabase(EDITOR_RECOVERY_INDEXED_DB_NAME);
    } catch {
      reject(
        new TypeError(
          "CloudMarkup could not clear editor recovery before logout.",
        ),
      );
      return;
    }
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(
        new TypeError(
          "CloudMarkup could not clear editor recovery before logout.",
        ),
      );
    };
    request.onblocked = () => {
      reject(
        new TypeError(
          "Close other CloudMarkup tabs before signing out so local recovery can be cleared.",
        ),
      );
    };
  });
}

export async function performCognitoSignOut({
  clearLocalRecovery = false,
  environment = browserEnvironment(),
  queryClient,
  session = browserCognitoAuthSession,
}: PerformCognitoSignOutOptions): Promise<boolean> {
  if (
    clearLocalRecovery &&
    !environment.confirmClear(
      "Sign out and permanently clear CloudMarkup local draft recovery and browser preferences on this device?",
    )
  ) {
    return false;
  }

  const logoutUrl = await session.createLogoutUrl();
  if (clearLocalRecovery) {
    await deleteEditorRecoveryDatabase(environment.indexedDb);
    clearPreferenceRecovery(environment.localStorage);
  }
  session.clearSession();
  queryClient.clear();
  try {
    environment.publishSignOut();
  } catch {
    // A broken cross-tab channel cannot restore this tab's cleared authority or
    // prevent the browser from completing the Cognito logout redirect.
  }
  environment.assignLocation(logoutUrl);
  return true;
}
