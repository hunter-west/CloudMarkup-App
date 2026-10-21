import { useSyncExternalStore } from "react";
export const NAVIGATION_PREFERENCE_STORAGE_NAMESPACE =
  "cloudmarkup.navigation.v1";
const prefix = NAVIGATION_PREFERENCE_STORAGE_NAMESPACE + ":";
const eventName = "cloudmarkup-navigation-change";
const memory = new Map<string, boolean>();
function read(actorId: string): boolean {
  try {
    return (
      window.localStorage.getItem(prefix + encodeURIComponent(actorId)) !==
      "collapsed"
    );
  } catch {
    return memory.get(actorId) ?? true;
  }
}
function subscribe(listener: () => void): () => void {
  const storage = () => {
    memory.clear();
    listener();
  };
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", storage);
  };
}
export function useNavigationPreference(actorId: string) {
  const expanded = useSyncExternalStore(
    subscribe,
    () => read(actorId),
    () => true,
  );
  return {
    expanded,
    toggle() {
      const next = !read(actorId);
      memory.set(actorId, next);
      try {
        window.localStorage.setItem(
          prefix + encodeURIComponent(actorId),
          next ? "expanded" : "collapsed",
        );
      } catch {
        /* Keep this session usable. */
      }
      window.dispatchEvent(new Event(eventName));
    },
  };
}
