import { createContext, useContext } from "react";

export type EditorStartRegionSource =
  "fixture" | "local-fallback" | "preference" | "server";

export const EditorStartContext =
  createContext<EditorStartRegionSource>("fixture");
export function editorStartRegionSourceLabel(
  source: EditorStartRegionSource,
): string {
  switch (source) {
    case "local-fallback":
      return "local fallback (no saved Region preference)";
    case "preference":
      return "local first-use preference";
    case "fixture":
      return "loaded local fixture";
    case "server":
      return "authenticated server draft";
  }
}

/** Presentation-only provenance for the effective new-start Region. */
export function useEditorStartRegionSource(): EditorStartRegionSource {
  return useContext(EditorStartContext);
}
