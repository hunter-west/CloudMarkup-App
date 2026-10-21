import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
const storageKey = "cloudmarkup.appearance.v1";
const eventName = "cloudmarkup-appearance-change";
let memoryPreference: ThemePreference | undefined;

function preference(): ThemePreference {
  if (memoryPreference !== undefined) return memoryPreference;
  try {
    const value = window.localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
function systemDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
function snapshot(): string {
  return preference() + ":" + (systemDark() ? "dark" : "light");
}
function subscribe(listener: () => void): () => void {
  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const storageChanged = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      memoryPreference = undefined;
      listener();
    }
  };
  window.addEventListener(eventName, listener);
  window.addEventListener("storage", storageChanged);
  media?.addEventListener("change", listener);
  return () => {
    window.removeEventListener(eventName, listener);
    window.removeEventListener("storage", storageChanged);
    media?.removeEventListener("change", listener);
  };
}
export function applyDocumentTheme(): void {
  const value = preference();
  document.documentElement.dataset["theme"] =
    value === "system" ? (systemDark() ? "dark" : "light") : value;
}
export function useThemePreference() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "system:light");
  const selected = value.split(":")[0] as ThemePreference;
  const resolvedTheme =
    selected === "system"
      ? value.endsWith(":dark")
        ? "dark"
        : "light"
      : selected;
  return {
    preference: selected,
    resolvedTheme,
    setPreference(next: ThemePreference) {
      memoryPreference = next;
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* Keep working when browser storage is unavailable. */
      }
      applyDocumentTheme();
      window.dispatchEvent(new Event(eventName));
    },
  };
}
