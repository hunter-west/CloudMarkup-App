import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import type { AuthenticatedBinaryDownloader } from "./authenticated-binary-download.js";
import type { QueryBackedPresentationPreferences } from "./presentation-preferences-remote.js";

import type { ExportCapabilitiesLoader } from "./export-capabilities-loader.js";

export interface CloudMarkupQueryRuntime {
  readonly loadExportCapabilities?: ExportCapabilitiesLoader;
  readonly loadAiCapabilities?: import("./ai-capabilities-loader.js").AiCapabilitiesLoader;
  readonly client: CloudMarkupClient;
  readonly downloadBinary: AuthenticatedBinaryDownloader;
  readonly expireSession: () => void;
  readonly presentationPreferences: QueryBackedPresentationPreferences;
  readonly queryClient: QueryClient;
  readonly resumeSession: () => void;
  readonly sessionExpired: boolean;
}

export const CloudMarkupQueryRuntimeContext =
  createContext<CloudMarkupQueryRuntime | null>(null);

export function useOptionalCloudMarkupQueryRuntime(): CloudMarkupQueryRuntime | null {
  return useContext(CloudMarkupQueryRuntimeContext);
}

export function useOptionalPresentationPreferencesRemote(): QueryBackedPresentationPreferences | null {
  return useOptionalCloudMarkupQueryRuntime()?.presentationPreferences ?? null;
}
