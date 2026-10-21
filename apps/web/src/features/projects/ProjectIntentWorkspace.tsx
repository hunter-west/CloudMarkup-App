import { useCallback, useContext, useState } from "react";
import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { ModePreferenceContext } from "../../preferences/mode-preference-context.js";
import { getCognitoAccessToken } from "../auth/cognito-browser-auth.js";
import { useProjectEditingLease } from "../editor/use-project-editing-lease.js";
import { AiIntentPreviewPanel } from "../generation/AiIntentPreviewPanel.js";
import { SavedAcceptedIntent } from "./SavedAcceptedIntent.js";
import type { ProjectRoutePageProps } from "./ProjectPages.js";

/** Reuses the ordinary project editing lease and reads its actual saved head.
 * The view identity is browser-local cancellation scope, never server identity. */
export function ProjectIntentWorkspace({
  organizationId,
  principal,
  projectId,
  acceptedIntentId,
  onAccepted,
}: ProjectRoutePageProps & {
  readonly acceptedIntentId?: string;
  readonly onAccepted?: (id: string) => void;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const mode = useContext(ModePreferenceContext)?.mode ?? "guided";
  const [viewSessionId] = useState(() => globalThis.crypto.randomUUID());
  const permitted =
    principal?.organizationContexts.some(
      (organization) =>
        organization.organizationId === organizationId &&
        organization.capabilities.includes("projects.mutate"),
    ) === true;
  const readHead = useCallback(async () => {
    if (runtime === null || organizationId === undefined)
      throw new Error("Project access unavailable.");
    const project = (
      await runtime.client.request("projects.get", { path: { projectId } })
    ).data;
    if (
      project.id !== projectId ||
      project.organizationId !== organizationId ||
      project.lifecycleStatus !== "active"
    )
      throw new Error("Project access unavailable.");
    const response = await runtime.client.requestWithMetadata("drafts.get", {
      path: { projectId },
    });
    if (
      response.data.data.projectId !== projectId ||
      response.data.data.id !== project.currentDraft.id
    )
      throw new Error("Current draft unavailable.");
    return { etag: response.metadata.etag };
  }, [organizationId, projectId, runtime]);
  const lease = useProjectEditingLease({
    client: runtime?.client ?? null,
    enabled:
      acceptedIntentId === undefined &&
      permitted &&
      runtime !== null &&
      !runtime.sessionExpired,
    projectId,
    readHead,
  });
  if (acceptedIntentId !== undefined)
    return (
      <SavedAcceptedIntent
        key={JSON.stringify([
          principal?.id,
          organizationId,
          projectId,
          acceptedIntentId,
        ])}
        acceptedIntentId={acceptedIntentId}
        {...(organizationId === undefined ? {} : { organizationId })}
        {...(principal === undefined ? {} : { principal })}
        projectId={projectId}
      />
    );
  if (!permitted || runtime === null || runtime.sessionExpired)
    return (
      <p role="status">
        Current project editing access is required to preview requirements.
      </p>
    );
  const notice =
    lease.status === "owned" ? null : (
      <section role="status">
        <p>
          {lease.status === "checking"
            ? "Checking editing access and the current saved draft…"
            : lease.status === "held"
              ? "Another session is editing this project. Finish that session before previewing requirements here."
              : "Editing access is unavailable. Reconnect before starting a preview."}
        </p>
        {lease.status === "checking" ? null : (
          <button
            className="button button--secondary"
            type="button"
            onClick={lease.retry}
          >
            Try editing
          </button>
        )}
      </section>
    );
  if (lease.status !== "owned" && lease.retained === null) return notice;
  return (
    <>
      {notice}
      <AiIntentPreviewPanel
        key={viewSessionId}
        editingAvailable={lease.status === "owned"}
        projectId={projectId}
        requestedMode={mode}
        onAccepted={(record) => onAccepted?.(record.acceptedIntentId)}
        onAccept={async (body, headers) =>
          (
            await runtime.client.request("ai-intent-previews.accept", {
              path: { projectId },
              query: {},
              body,
              headers,
            })
          ).data
        }
        currentAuthority={() => {
          const proof = lease.getProof();
          const token = getCognitoAccessToken();
          return lease.status !== "owned" ||
            proof === null ||
            token === undefined ||
            runtime.sessionExpired
            ? undefined
            : {
                principalId: principal.id,
                sessionId: viewSessionId,
                projectId,
                draftEtag: lease.head.etag,
                editingProof: proof,
                accessToken: token,
              };
        }}
      />
    </>
  );
}
