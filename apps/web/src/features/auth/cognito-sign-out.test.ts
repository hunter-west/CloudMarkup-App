import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE } from "../../preferences/experience-preference.js";
import { MODE_PREFERENCE_STORAGE_NAMESPACE } from "../../preferences/mode-preference.js";
import { NAVIGATION_PREFERENCE_STORAGE_NAMESPACE } from "../../shell/navigation-preference.js";
import { EDITOR_RECOVERY_INDEXED_DB_NAME } from "../editor/persistence/indexeddb-editor-recovery-store.js";
import type { CognitoBrowserAuthSession } from "./cognito-browser-auth.js";
import {
  performCognitoSignOut,
  type CognitoSignOutBrowserEnvironment,
} from "./cognito-sign-out-action.js";

function authSession(logoutUrl = "https://cognito.example.test/logout") {
  const clearSession = vi.fn();
  const createLogoutUrl = vi.fn().mockResolvedValue(logoutUrl);
  return {
    clearSession,
    createLogoutUrl,
    session: {
      clearSession,
      createLogoutUrl,
    } as unknown as CognitoBrowserAuthSession,
  };
}

function browserEnvironment({
  confirmClear = false,
  indexedDb,
}: {
  readonly confirmClear?: boolean;
  readonly indexedDb?: IDBFactory;
} = {}) {
  return {
    assignLocation: vi.fn(),
    confirmClear: vi.fn(() => confirmClear),
    indexedDb,
    localStorage: window.localStorage,
    publishSignOut: vi.fn(),
  } satisfies CognitoSignOutBrowserEnvironment;
}

describe("Cognito browser sign-out", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps local recovery and preferences during ordinary sign-out", async () => {
    const preferenceKey = `${MODE_PREFERENCE_STORAGE_NAMESPACE}:principal_beta`;
    window.localStorage.setItem(preferenceKey, "guided");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenant", "beta"], { sensitive: true });
    const auth = authSession();
    const deleteDatabase = vi.fn();
    const environment = browserEnvironment({
      indexedDb: { deleteDatabase } as unknown as IDBFactory,
    });

    await expect(
      performCognitoSignOut({
        environment,
        queryClient,
        session: auth.session,
      }),
    ).resolves.toBe(true);

    expect(auth.clearSession).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(["tenant", "beta"])).toBeUndefined();
    expect(window.localStorage.getItem(preferenceKey)).toBe("guided");
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(environment.confirmClear).not.toHaveBeenCalled();
    expect(environment.publishSignOut).toHaveBeenCalledOnce();
    expect(environment.assignLocation).toHaveBeenCalledWith(
      "https://cognito.example.test/logout",
    );
  });

  it("cancels permanent local-recovery deletion without changing the session", async () => {
    const preferenceKey = `${EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE}:principal_beta`;
    window.localStorage.setItem(preferenceKey, "preference");
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenant", "beta"], { sensitive: true });
    const auth = authSession();
    const deleteDatabase = vi.fn();
    const environment = browserEnvironment({
      confirmClear: false,
      indexedDb: { deleteDatabase } as unknown as IDBFactory,
    });

    await expect(
      performCognitoSignOut({
        clearLocalRecovery: true,
        environment,
        queryClient,
        session: auth.session,
      }),
    ).resolves.toBe(false);

    expect(environment.confirmClear).toHaveBeenCalledOnce();
    expect(auth.createLogoutUrl).not.toHaveBeenCalled();
    expect(auth.clearSession).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["tenant", "beta"])).toEqual({
      sensitive: true,
    });
    expect(window.localStorage.getItem(preferenceKey)).toBe("preference");
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(environment.publishSignOut).not.toHaveBeenCalled();
    expect(environment.assignLocation).not.toHaveBeenCalled();
  });

  it("clears only CloudMarkup recovery after separate confirmation", async () => {
    const modeKey = `${MODE_PREFERENCE_STORAGE_NAMESPACE}:principal_beta`;
    const experienceKey = `${EXPERIENCE_PREFERENCE_STORAGE_NAMESPACE}:principal_beta`;
    const navigationKey = `${NAVIGATION_PREFERENCE_STORAGE_NAMESPACE}:principal_beta`;
    window.localStorage.setItem(modeKey, "guided");
    window.localStorage.setItem(experienceKey, "preference");
    window.localStorage.setItem(navigationKey, "collapsed");
    window.localStorage.setItem("unrelated", "keep");
    const deleteRequest = {
      onblocked: null,
      onerror: null,
      onsuccess: null,
    } as unknown as IDBOpenDBRequest;
    const deleteDatabase = vi.fn(() => {
      queueMicrotask(() => {
        deleteRequest.onsuccess?.(new Event("success"));
      });
      return deleteRequest;
    });
    const environment = browserEnvironment({
      confirmClear: true,
      indexedDb: { deleteDatabase } as unknown as IDBFactory,
    });

    await expect(
      performCognitoSignOut({
        clearLocalRecovery: true,
        environment,
        queryClient: new QueryClient(),
        session: authSession().session,
      }),
    ).resolves.toBe(true);

    expect(window.localStorage.getItem(modeKey)).toBeNull();
    expect(window.localStorage.getItem(experienceKey)).toBeNull();
    expect(window.localStorage.getItem(navigationKey)).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(deleteDatabase).toHaveBeenCalledWith(
      EDITOR_RECOVERY_INDEXED_DB_NAME,
    );
    expect(environment.assignLocation).toHaveBeenCalledOnce();
    expect(environment.publishSignOut).toHaveBeenCalledOnce();
  });

  it.each(["blocked", "error"] as const)(
    "leaves the session, query cache, preferences, and navigation unchanged when IndexedDB deletion is %s",
    async (failure) => {
      const preferenceKey = `${MODE_PREFERENCE_STORAGE_NAMESPACE}:principal_beta`;
      window.localStorage.setItem(preferenceKey, "guided");
      const queryClient = new QueryClient();
      queryClient.setQueryData(["tenant", "beta"], { sensitive: true });
      const auth = authSession();
      const deleteRequest = {
        onblocked: null,
        onerror: null,
        onsuccess: null,
      } as unknown as IDBOpenDBRequest;
      const deleteDatabase = vi.fn(() => {
        queueMicrotask(() => {
          if (failure === "blocked") {
            deleteRequest.onblocked?.(
              new Event("blocked") as IDBVersionChangeEvent,
            );
          } else {
            deleteRequest.onerror?.(new Event("error"));
          }
        });
        return deleteRequest;
      });
      const environment = browserEnvironment({
        confirmClear: true,
        indexedDb: { deleteDatabase } as unknown as IDBFactory,
      });

      await expect(
        performCognitoSignOut({
          clearLocalRecovery: true,
          environment,
          queryClient,
          session: auth.session,
        }),
      ).rejects.toThrow(
        failure === "blocked"
          ? "Close other CloudMarkup tabs"
          : "could not clear editor recovery",
      );

      expect(deleteDatabase).toHaveBeenCalledWith(
        EDITOR_RECOVERY_INDEXED_DB_NAME,
      );
      expect(auth.clearSession).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(["tenant", "beta"])).toEqual({
        sensitive: true,
      });
      expect(window.localStorage.getItem(preferenceKey)).toBe("guided");
      expect(environment.assignLocation).not.toHaveBeenCalled();
      expect(environment.publishSignOut).not.toHaveBeenCalled();
    },
  );

  it("keeps local authority cleared and completes redirect when cross-tab publishing fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tenant", "beta"], { sensitive: true });
    const auth = authSession();
    const environment = browserEnvironment();
    environment.publishSignOut.mockImplementation(() => {
      throw new TypeError("BroadcastChannel failed.");
    });

    await expect(
      performCognitoSignOut({
        environment,
        queryClient,
        session: auth.session,
      }),
    ).resolves.toBe(true);

    expect(auth.clearSession).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(["tenant", "beta"])).toBeUndefined();
    expect(environment.publishSignOut).toHaveBeenCalledOnce();
    expect(environment.assignLocation).toHaveBeenCalledWith(
      "https://cognito.example.test/logout",
    );
  });
});
