import {
  acceptedIntentIdV1Schema,
  acceptedIntentV1Schema,
  type AcceptedIntentV1,
} from "@cloudmarkup/api-contract";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { useEffect, useState } from "react";
import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { IntentRequirementsDetails } from "../generation/IntentRequirementsDetails.js";
import type { ProjectRoutePageProps } from "./ProjectPages.js";

/** Reads only a persisted accepted record under current project authorization.
 * An opaque URL selector is not authority; no prompt, preview or editing proof
 * is recovered from local storage or a client query cache. */
export function SavedAcceptedIntent({
  organizationId,
  projectId,
  principal,
  acceptedIntentId,
}: ProjectRoutePageProps & { readonly acceptedIntentId: string }) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "ready"; record: AcceptedIntentV1 }
  >({ kind: "loading" });
  const permitted =
    runtime !== null &&
    !runtime.sessionExpired &&
    principal?.organizationContexts.some(
      (c) =>
        c.organizationId === organizationId &&
        c.capabilities.includes("projects.read"),
    ) === true;
  const selected = acceptedIntentIdV1Schema.safeParse(acceptedIntentId);
  const selectedId = selected.success ? selected.data : undefined;
  useEffect(() => {
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    if (
      !permitted ||
      organizationId === undefined ||
      selectedId === undefined
    ) {
      return () => {
        controller.abort();
      };
    }
    void (async () => {
      try {
        const project = (
          await runtime.client.request("projects.get", { path: { projectId } })
        ).data;
        if (!active()) return;
        if (
          project.id !== projectId ||
          project.organizationId !== organizationId ||
          !["active", "archived"].includes(project.lifecycleStatus)
        )
          throw Error("Unavailable project");
        const result = await runtime.client.request("accepted-intents.get", {
          path: { projectId, acceptedIntentId: selectedId },
          query: {},
        });
        if (!active()) return;
        const record = acceptedIntentV1Schema.parse(result.data);
        if (
          record.projectId !== projectId ||
          record.acceptedIntentId !== selectedId ||
          digestCanonicalValue(record.intentDocument) !== record.intentDigest
        )
          throw Error("Unavailable record");
        setState({ kind: "ready", record });
      } catch {
        if (active()) setState({ kind: "unavailable" });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [selectedId, organizationId, permitted, projectId, runtime]);
  if (!permitted || selectedId === undefined || state.kind === "unavailable")
    return (
      <p role="status">
        Accepted requirements are unavailable for this project and session.
      </p>
    );
  if (state.kind === "loading")
    return <p role="status">Loading accepted requirements…</p>;
  return (
    <section aria-label="Saved requirements">
      <h2>Accepted requirements</h2>
      <p>
        These requirements are saved to this project. Canvas changes require a
        separate review.
      </p>
      <IntentRequirementsDetails intent={state.record.intentDocument} />
      <AppLink
        className="button button--primary"
        to={
          "/organizations/" +
          encodeRouteSelector(organizationId ?? "") +
          "/projects/" +
          encodeRouteSelector(projectId) +
          "/editor?acceptedIntent=" +
          encodeRouteSelector(state.record.acceptedIntentId)
        }
      >
        Open canvas with these requirements
      </AppLink>
      <AppLink
        className="button button--secondary"
        to={`/organizations/${encodeRouteSelector(organizationId ?? "")}/projects/${encodeRouteSelector(projectId)}/intent`}
      >
        Preview new requirements
      </AppLink>
    </section>
  );
}
