import {
  acceptedIntentIdV1Schema,
  acceptedIntentV1Schema,
  type AcceptedIntentV1,
} from "@cloudmarkup/api-contract";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { useEffect, useState } from "react";
import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { useAppLocation } from "../../routing/index.js";

type Selection =
  | { readonly kind: "none" | "loading" | "unavailable" }
  | { readonly kind: "ready"; readonly record: AcceptedIntentV1 };

/** The editor already verified this project and principal. The URL selects one
 * persisted record; the API still authorizes the read. Content stays in RAM. */
export function useAcceptedIntentSelection(scope: {
  readonly principalId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly draftId: string;
  readonly draftVersion: number;
}): Selection {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const location = useAppLocation();
  const values = new URLSearchParams(location.search).getAll("acceptedIntent");
  const selected = acceptedIntentIdV1Schema.safeParse(
    values.length === 1 ? values[0] : undefined,
  );
  const selectedId = selected.success ? selected.data : undefined;
  const key = JSON.stringify([
    scope.principalId,
    scope.organizationId,
    scope.projectId,
    selectedId,
  ]);
  const [loaded, setLoaded] = useState<{
    readonly key: string;
    readonly selection: Selection;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    if (runtime === null || runtime.sessionExpired || selectedId === undefined)
      return;
    void (async () => {
      try {
        const result = await runtime.client.request("accepted-intents.get", {
          path: { projectId: scope.projectId, acceptedIntentId: selectedId },
          query: {},
        });
        if (!active()) return;
        const record = acceptedIntentV1Schema.parse(result.data);
        if (
          record.projectId !== scope.projectId ||
          record.acceptedIntentId !== selectedId ||
          digestCanonicalValue(record.intentDocument) !== record.intentDigest
        )
          throw Error("Unavailable requirements");
        setLoaded({ key, selection: { kind: "ready", record } });
      } catch {
        if (active()) setLoaded({ key, selection: { kind: "unavailable" } });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [key, runtime, scope.projectId, selectedId]);
  if (values.length === 0) return { kind: "none" };
  if (selectedId === undefined || runtime === null || runtime.sessionExpired)
    return { kind: "unavailable" };
  if (loaded?.key !== key) return { kind: "loading" };
  const selection = loaded.selection;
  if (
    selection.kind === "ready" &&
    (selection.record.sourceDraftId !== scope.draftId ||
      selection.record.sourceDraftVersion > scope.draftVersion)
  )
    return { kind: "unavailable" };
  return selection;
}
