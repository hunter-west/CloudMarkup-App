import type {
  CloudMarkupClient,
  PresentationPreferencesV1,
} from "@cloudmarkup/api-contract";
import type { QueryClient } from "@tanstack/react-query";

import { isApiErrorCode } from "./api-errors.js";
import { cloudMarkupQueryKeys } from "./query-keys.js";

export interface PresentationPreferencesSnapshot {
  readonly etag: string;
  readonly preferences: PresentationPreferencesV1;
}

export type PresentationPreferencesPatch = Readonly<
  Partial<
    Pick<
      PresentationPreferencesV1,
      "contextualLearningEnabled" | "experienceMode"
    >
  >
>;

/**
 * Coordinates the actor-owned preference resource through one QueryClient.
 * Updates are serialized per principal so independent assistance controls do
 * not reuse an obsolete ETag. This service has no project/document API.
 */
export class QueryBackedPresentationPreferences {
  readonly #client: CloudMarkupClient;
  readonly #expireSession: () => void;
  readonly #queryClient: QueryClient;
  readonly #updatesByPrincipal = new Map<
    string,
    Promise<PresentationPreferencesSnapshot>
  >();

  public constructor(
    client: CloudMarkupClient,
    queryClient: QueryClient,
    expireSession: () => void = () => undefined,
  ) {
    this.#client = client;
    this.#expireSession = expireSession;
    this.#queryClient = queryClient;
  }

  public load(principalId: string): Promise<PresentationPreferencesSnapshot> {
    const queryKey = cloudMarkupQueryKeys.presentationPreferences(principalId);
    return this.#queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        const result = await this.#client.requestWithMetadata(
          "preferences.get",
          {},
        );
        return {
          etag: result.metadata.etag,
          preferences: result.data.data,
        };
      },
      retry: false,
      staleTime: 0,
    });
  }

  public update(
    principalId: string,
    patch: PresentationPreferencesPatch,
  ): Promise<PresentationPreferencesSnapshot> {
    if (
      patch.contextualLearningEnabled === undefined &&
      patch.experienceMode === undefined
    ) {
      return Promise.reject(
        new TypeError("A presentation-preference update cannot be empty."),
      );
    }

    const previous = this.#updatesByPrincipal.get(principalId);
    const waitForPrevious =
      previous === undefined
        ? Promise.resolve()
        : previous.then(
            () => undefined,
            () => undefined,
          );
    const update = waitForPrevious.then(() =>
      this.#performUpdate(principalId, patch),
    );
    this.#updatesByPrincipal.set(principalId, update);
    const removeCompletedUpdate = () => {
      if (this.#updatesByPrincipal.get(principalId) === update) {
        this.#updatesByPrincipal.delete(principalId);
      }
    };
    void update.then(removeCompletedUpdate, removeCompletedUpdate);
    return update;
  }

  public clear(principalId: string): void {
    this.#queryClient.removeQueries({
      exact: true,
      queryKey: cloudMarkupQueryKeys.presentationPreferences(principalId),
    });
  }

  async #performUpdate(
    principalId: string,
    patch: PresentationPreferencesPatch,
  ): Promise<PresentationPreferencesSnapshot> {
    const queryKey = cloudMarkupQueryKeys.presentationPreferences(principalId);
    const current =
      this.#queryClient.getQueryData<PresentationPreferencesSnapshot>(
        queryKey,
      ) ?? (await this.load(principalId));

    try {
      const result = await this.#client.requestWithMetadata(
        "preferences.update",
        {
          body: {
            contextualLearningEnabled:
              patch.contextualLearningEnabled ??
              current.preferences.contextualLearningEnabled,
            contractVersion: 1,
            experienceMode:
              patch.experienceMode ?? current.preferences.experienceMode,
          },
          headers: { "if-match": current.etag },
        },
      );
      const next = {
        etag: result.metadata.etag,
        preferences: result.data.data,
      } satisfies PresentationPreferencesSnapshot;
      this.#queryClient.setQueryData(queryKey, next);
      return next;
    } catch (error) {
      if (isApiErrorCode(error, "authentication_required")) {
        this.#expireSession();
      }
      // Never replay a failed CAS against a freshly loaded server value. The
      // user's local fallback remains usable and the next explicit load gets
      // authoritative server state.
      this.#queryClient.removeQueries({ exact: true, queryKey });
      throw error;
    }
  }
}
