import { useContext } from "react";
import { useStore } from "zustand";

import {
  EditorDocumentSessionContext,
  EditorDocumentIndexContext,
  EditorSessionStoreContext,
  type EditorDocumentSession,
} from "./editor-session-context.js";
import type {
  EditorSessionState,
  EditorSessionStore,
} from "./editor-session-store.js";

export function useEditorDocumentIndex() {
  return useContext(EditorDocumentIndexContext);
}

export function useEditorSessionStoreApi(): EditorSessionStore {
  const store = useContext(EditorSessionStoreContext);

  if (store === null) {
    throw new Error(
      "useEditorSessionStoreApi must be used within an EditorSessionProvider.",
    );
  }

  return store;
}

export function useEditorSessionState<T>(
  selector: (state: EditorSessionState) => T,
): T {
  return useStore(useEditorSessionStoreApi(), selector);
}

export function useEditorDocumentSession(): EditorDocumentSession {
  const session = useContext(EditorDocumentSessionContext);

  if (session === null) {
    throw new Error(
      "useEditorDocumentSession must be used within an EditorSessionProvider.",
    );
  }

  return session;
}
