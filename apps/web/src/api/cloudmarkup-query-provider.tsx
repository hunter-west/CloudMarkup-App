import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AuthenticatedBinaryDownloader } from "./authenticated-binary-download.js";
import { isApiErrorCode } from "./api-errors.js";
import {
  CloudMarkupQueryRuntimeContext,
  type CloudMarkupQueryRuntime,
} from "./cloudmarkup-query-context.js";
import { QueryBackedPresentationPreferences } from "./presentation-preferences-remote.js";
import { cloudMarkupQueryKeys } from "./query-keys.js";

const defaultQueryClientConfiguration: QueryClientConfig = {
  defaultOptions: {
    mutations: { retry: false },
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 15_000,
    },
  },
};
const unavailableBinaryDownloader: AuthenticatedBinaryDownloader = () =>
  Promise.reject(
    new TypeError("The authenticated download client is unavailable."),
  );

import type { ExportCapabilitiesLoader } from "./export-capabilities-loader.js";

export interface CloudMarkupQueryProviderProps {
  readonly loadExportCapabilities?: ExportCapabilitiesLoader;
  readonly loadAiCapabilities?: import("./ai-capabilities-loader.js").AiCapabilitiesLoader;
  readonly children: ReactNode;
  readonly client?: CloudMarkupClient;
  readonly downloadBinary?: AuthenticatedBinaryDownloader;
  readonly queryClient?: QueryClient;
}

export function CloudMarkupQueryProvider({
  children,
  client,
  downloadBinary = unavailableBinaryDownloader,
  loadExportCapabilities,
  loadAiCapabilities,
  queryClient,
}: CloudMarkupQueryProviderProps) {
  const [ownedQueryClient] = useState(
    () => queryClient ?? new QueryClient(defaultQueryClientConfiguration),
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  const expireSession = useCallback(() => {
    setSessionExpired(true);
  }, []);
  const resumeSession = useCallback(() => {
    ownedQueryClient.removeQueries({ queryKey: cloudMarkupQueryKeys.root });
    setSessionExpired(false);
  }, [ownedQueryClient]);
  const presentationPreferences = useMemo(
    () =>
      client === undefined
        ? null
        : new QueryBackedPresentationPreferences(
            client,
            ownedQueryClient,
            expireSession,
          ),
    [client, expireSession, ownedQueryClient],
  );

  useEffect(() => {
    const inspectError = (error: unknown) => {
      if (isApiErrorCode(error, "authentication_required")) {
        expireSession();
      }
    };
    const unsubscribeQueries = ownedQueryClient
      .getQueryCache()
      .subscribe((event) => {
        if (event.type === "updated") {
          inspectError(event.query.state.error);
        }
      });
    const unsubscribeMutations = ownedQueryClient
      .getMutationCache()
      .subscribe((event) => {
        if (event.type === "updated") {
          inspectError(event.mutation.state.error);
        }
      });
    return () => {
      unsubscribeMutations();
      unsubscribeQueries();
    };
  }, [expireSession, ownedQueryClient]);

  useEffect(() => {
    if (sessionExpired) {
      ownedQueryClient.removeQueries({ queryKey: cloudMarkupQueryKeys.root });
    }
  }, [ownedQueryClient, sessionExpired]);

  const runtime = useMemo<CloudMarkupQueryRuntime | null>(
    () =>
      client === undefined || presentationPreferences === null
        ? null
        : {
            client,
            downloadBinary,
            ...(loadExportCapabilities === undefined
              ? {}
              : { loadExportCapabilities }),
            ...(loadAiCapabilities === undefined ? {} : { loadAiCapabilities }),
            expireSession,
            presentationPreferences,
            queryClient: ownedQueryClient,
            resumeSession,
            sessionExpired,
          },
    [
      client,
      downloadBinary,
      loadExportCapabilities,
      loadAiCapabilities,
      expireSession,
      ownedQueryClient,
      presentationPreferences,
      resumeSession,
      sessionExpired,
    ],
  );

  return (
    <QueryClientProvider client={ownedQueryClient}>
      <CloudMarkupQueryRuntimeContext.Provider value={runtime}>
        {children}
      </CloudMarkupQueryRuntimeContext.Provider>
    </QueryClientProvider>
  );
}
