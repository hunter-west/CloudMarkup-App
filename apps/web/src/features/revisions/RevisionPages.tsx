import {
  ApiClientError,
  type CurrentPrincipalV1,
  type SolutionRevisionSummaryV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { SolutionExportCreatePanel } from "../exports/SolutionExportPage.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "./revisions.css";

type OrganizationContext = CurrentPrincipalV1["organizationContexts"][number];

export interface RevisionPageProps {
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
  readonly projectId: string;
  readonly revisionId?: string;
}

interface VerifiedRevisionContext {
  readonly organization: OrganizationContext;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}

const REVISION_RESPONSE_BINDING_ERROR =
  "The revision response did not match the requested project scope.";

class RevisionResponseBindingError extends Error {
  public constructor() {
    super(REVISION_RESPONSE_BINDING_ERROR);
    this.name = "RevisionResponseBindingError";
  }
}

function assertRevisionResponseBinding(
  response: {
    readonly projectId: string;
    readonly solutionRevisionId?: string;
  },
  projectId: string,
  solutionRevisionId?: string,
): void {
  if (
    response.projectId !== projectId ||
    (solutionRevisionId !== undefined &&
      response.solutionRevisionId !== solutionRevisionId)
  ) {
    throw new RevisionResponseBindingError();
  }
}

function projectPath(organizationId: string, projectId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/projects/${encodeRouteSelector(projectId)}`;
}

function coverageLabel(
  state: SolutionRevisionSummaryV1["generationCoverage"]["state"],
): string {
  switch (state) {
    case "infrastructure-only":
      return "Infrastructure-only";
    case "starter-application":
      return "Starter application coverage";
    case "complete-supported-pattern":
      return "Complete supported pattern";
    case "ai-assisted-custom-validated":
      return "AI-assisted custom, validated";
    case "custom-implementation-required":
      return "Custom implementation required";
    case "target-unsupported":
      return "Target unsupported";
  }
}

function remainingRequirementsText(count: number): string {
  if (count === 0) return "No missing requirements are recorded.";
  return count === 1
    ? "1 requirement still needs attention."
    : `${String(count)} requirements still need attention.`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function revisionErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return "CloudMarkup could not load immutable revision data from the server.";
  }
  switch (error.envelope.error.code) {
    case "authentication_required":
      return "Your session has expired. Sign in again to continue.";
    case "access_denied":
      return "You do not have permission to review this project's revisions.";
    case "not_found":
      return "The requested immutable Solution Revision is unavailable.";
    case "service_unavailable":
      return "The revision service is temporarily unavailable.";
    default:
      return "CloudMarkup could not load immutable revision data from the server.";
  }
}

function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof RevisionResponseBindingError) return false;
  if (
    error instanceof ApiClientError &&
    [
      "authentication_required",
      "access_denied",
      "not_found",
      "invalid_request",
    ].includes(error.envelope.error.code)
  ) {
    return false;
  }
  return failureCount < 1;
}

function verifiedContext(
  props: RevisionPageProps,
  runtime: CloudMarkupQueryRuntime | null,
): VerifiedRevisionContext | "unavailable" | "denied" | null {
  const usesBackend =
    props.principal !== undefined || props.organizationId !== undefined;
  if (!usesBackend) return null;
  if (
    runtime === null ||
    props.principal === undefined ||
    props.organizationId === undefined
  ) {
    return "unavailable";
  }
  const organization = props.principal.organizationContexts.find(
    (candidate) => candidate.organizationId === props.organizationId,
  );
  if (!organization?.capabilities.includes("projects.read")) {
    return "denied";
  }
  return {
    organization,
    organizationId: props.organizationId,
    principal: props.principal,
    runtime,
  };
}

function RevisionUnavailablePage({ denied }: { readonly denied: boolean }) {
  return (
    <RoutePage
      title="Access unavailable"
      eyebrow={denied ? "Permission denied" : "Backend unavailable"}
      description={
        denied
          ? "The verified session cannot read revisions in this organization."
          : "An authenticated API session is required."
      }
      routeKey={`revision-${denied ? "denied" : "unavailable"}`}
    >
      <section
        className={`state-card ${denied ? "state-card--permission" : "state-card--error"}`}
        role="alert"
      >
        <p className="status-label">
          {denied ? "Permission required" : "Service unavailable"}
        </p>
        <h2>No Solution Revision data is disclosed</h2>
        <p>
          Route selectors and local recovery records are not revision or tenant
          authority.
        </p>
      </section>
    </RoutePage>
  );
}

export function RevisionsPage(props: RevisionPageProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const context = verifiedContext(props, runtime);
  if (context === null)
    return <LegacyRevisionsPage projectId={props.projectId} />;
  if (context === "unavailable")
    return <RevisionUnavailablePage denied={false} />;
  if (context === "denied") return <RevisionUnavailablePage denied />;
  return (
    <AuthenticatedRevisionsPage context={context} projectId={props.projectId} />
  );
}

function AuthenticatedRevisionsPage({
  context,
  projectId,
}: {
  readonly context: VerifiedRevisionContext;
  readonly projectId: string;
}) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null,
  );
  const revisions = useQuery({
    queryKey: cloudMarkupQueryKeys.revisions(
      context.principal.id,
      context.organizationId,
      projectId,
    ),
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-revisions.list",
        {
          path: { projectId },
          query: { "page[limit]": "100", sort: "-createdAt" },
        },
      );
      for (const revision of response.data) {
        assertRevisionResponseBinding(revision, projectId);
      }
      return response.data;
    },
    retry: retryQuery,
  });
  const path = projectPath(context.organizationId, projectId);
  const selectedRevision =
    revisions.data?.find(
      (revision) => revision.solutionRevisionId === selectedRevisionId,
    ) ?? revisions.data?.[0];
  return (
    <RoutePage
      title="Export your project"
      eyebrow="Saved, exact-version package"
      description="Choose a saved revision. Infrastructure and diagrams are included by default; application source is an optional AI draft."
      routeKey={`revisions-${projectId}`}
    >
      {revisions.isPending ? (
        <section className="state-card" role="status" aria-live="polite">
          <p className="status-label">Loading</p>
          <h2>Loading immutable revisions</h2>
        </section>
      ) : revisions.isError ? (
        <section className="state-card state-card--error" role="alert">
          <p className="status-label">Could not load revisions</p>
          <h2>Solution Revision history unavailable</h2>
          <p>{revisionErrorMessage(revisions.error)}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void revisions.refetch()}
          >
            Try again
          </button>
        </section>
      ) : revisions.data.length === 0 ? (
        <section className="state-card" role="status">
          <p className="status-label">Empty history</p>
          <h2>No immutable Solution Revisions exist</h2>
          <p>
            Create one only from an authorized, persisted, valid draft with
            exact compatible document and contract versions.
          </p>
          <AppLink className="button button--secondary" to={`${path}/editor`}>
            Return to editor
          </AppLink>
        </section>
      ) : (
        <>
          <section
            className="feature-card revision-export-hub"
            aria-labelledby="revision-export-title"
          >
            <p className="status-label">Package setup</p>
            <h2 id="revision-export-title">Choose a saved revision</h2>
            <p>
              Infrastructure and diagrams are the default. Add review-required
              AI application source only when you need a draft for described
              Lambda workloads.
            </p>
            <label className="field">
              <span>Revision to export</span>
              <select
                value={selectedRevision?.solutionRevisionId ?? ""}
                onChange={(event) => {
                  setSelectedRevisionId(event.currentTarget.value);
                }}
              >
                {revisions.data.map((revision) => (
                  <option
                    key={revision.solutionRevisionId}
                    value={revision.solutionRevisionId}
                  >
                    {revision.name} · {formatTimestamp(revision.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            {selectedRevision ? (
              <p>
                Selected:{" "}
                {coverageLabel(selectedRevision.generationCoverage.state)} from
                draft v{selectedRevision.sourceDraftVersion}.{" "}
                <AppLink
                  className="text-link"
                  to={`${path}/revisions/${encodeRouteSelector(selectedRevision.solutionRevisionId)}`}
                >
                  Review revision details
                </AppLink>
              </p>
            ) : null}
          </section>
          {selectedRevision ? (
            <SolutionExportCreatePanel
              key={selectedRevision.solutionRevisionId}
              organizationId={context.organizationId}
              principal={context.principal}
              projectId={projectId}
              revisionId={selectedRevision.solutionRevisionId}
              revisionName={selectedRevision.name}
            />
          ) : null}
          <section
            className="section-stack"
            aria-labelledby="revision-list-title"
          >
            <div className="section-heading">
              <div>
                <p className="status-label">Read-only history</p>
                <h2 id="revision-list-title">Immutable Solution Revisions</h2>
              </div>
            </div>
            <ul className="card-grid" aria-label="Immutable Solution Revisions">
              {revisions.data.map((revision) => (
                <li className="project-card" key={revision.solutionRevisionId}>
                  <div className="project-card__status">
                    <span className="text-badge">
                      {coverageLabel(revision.generationCoverage.state)}
                    </span>
                    <span className="text-badge text-badge--neutral">
                      Draft v{revision.sourceDraftVersion}
                    </span>
                  </div>
                  <h3>{revision.name}</h3>
                  <p>
                    Created{" "}
                    <time dateTime={revision.createdAt}>
                      {formatTimestamp(revision.createdAt)}
                    </time>{" "}
                    by {revision.createdBy.displayName}.
                  </p>
                  <p>
                    {revision.generationCoverage.state === "infrastructure-only"
                      ? "Infrastructure-only: application-source generation is not in scope."
                      : `${String(revision.generationCoverage.workloads.length)} workload coverage record(s); ${String(revision.generationCoverage.missingRequirements.length)} missing solution requirement(s).`}
                  </p>
                  <AppLink
                    className="text-link"
                    to={`${path}/revisions/${encodeRouteSelector(revision.solutionRevisionId)}`}
                  >
                    View read-only revision
                  </AppLink>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </RoutePage>
  );
}

export function RevisionDetailPage(props: RevisionPageProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const context = verifiedContext(props, runtime);
  const revisionId = props.revisionId ?? "unknown";
  if (context === null)
    return (
      <LegacyRevisionDetailPage
        projectId={props.projectId}
        revisionId={revisionId}
      />
    );
  if (context === "unavailable")
    return <RevisionUnavailablePage denied={false} />;
  if (context === "denied") return <RevisionUnavailablePage denied />;
  return (
    <AuthenticatedRevisionDetailPage
      context={context}
      projectId={props.projectId}
      revisionId={revisionId}
    />
  );
}

function AuthenticatedRevisionDetailPage({
  context,
  projectId,
  revisionId,
}: {
  readonly context: VerifiedRevisionContext;
  readonly projectId: string;
  readonly revisionId: string;
}) {
  const revision = useQuery({
    queryKey: cloudMarkupQueryKeys.revision(
      context.principal.id,
      context.organizationId,
      projectId,
      revisionId,
    ),
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-revisions.get",
        {
          path: { projectId, solutionRevisionId: revisionId },
        },
      );
      assertRevisionResponseBinding(
        response.data.summary,
        projectId,
        revisionId,
      );
      return response.data;
    },
    retry: retryQuery,
  });
  const path = projectPath(context.organizationId, projectId);
  if (revision.isPending) {
    return (
      <RoutePage
        title="Loading revision"
        eyebrow="Immutable Solution Revision"
        description="Loading exact read-only bindings."
        routeKey={`revision-loading-${revisionId}`}
      >
        <section className="state-card" role="status" aria-live="polite">
          <p className="status-label">Loading</p>
          <h2>Loading immutable revision</h2>
        </section>
      </RoutePage>
    );
  }
  if (revision.isError) {
    return (
      <RoutePage
        title="Revision unavailable"
        eyebrow="Immutable Solution Revision"
        description="The read-only revision could not be loaded."
        routeKey={`revision-error-${revisionId}`}
      >
        <section className="state-card state-card--error" role="alert">
          <p className="status-label">Could not load revision</p>
          <h2>Immutable Solution Revision unavailable</h2>
          <p>{revisionErrorMessage(revision.error)}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void revision.refetch()}
          >
            Try again
          </button>
        </section>
      </RoutePage>
    );
  }

  const { manifest, summary } = revision.data;
  return (
    <RoutePage
      title={summary.name}
      eyebrow="Saved revision · read-only"
      description="A saved snapshot of your architecture, workloads, and coverage. This revision is read-only."
      routeKey={`revision-${projectId}-${revisionId}`}
      actions={
        <AppLink className="button button--secondary" to={`${path}/revisions`}>
          Return to revision history
        </AppLink>
      }
    >
      <div className="revision-detail">
        <section className="state-card state-card--readonly" role="status">
          <p className="status-label">Read-only</p>
          <h2>{coverageLabel(summary.generationCoverage.state)}</h2>
          <p>
            {summary.generationCoverage.state === "infrastructure-only"
              ? "This saved version includes infrastructure only. Application code has not been generated for it."
              : "Review each workload below to see its recorded coverage and what still needs attention."}
          </p>
        </section>
        <SolutionExportCreatePanel
          organizationId={context.organizationId}
          principal={context.principal}
          projectId={projectId}
          revisionId={revisionId}
          revisionName={summary.name}
        />
        <div className="metric-grid" aria-label="Immutable revision summary">
          <section className="metric-card">
            <h2>Source draft</h2>
            <p>Version {summary.sourceDraftVersion}</p>
          </section>
          <section className="metric-card">
            <h2>Architecture schema</h2>
            <p>Version {manifest.architecture.schemaVersion}</p>
          </section>
          <section className="metric-card">
            <h2>Workloads</h2>
            <p>{manifest.generationCoverage.workloads.length}</p>
          </section>
          <section className="metric-card">
            <h2>Unresolved decisions</h2>
            <p>{manifest.unresolvedDecisionIds.length}</p>
          </section>
        </div>
        <section className="feature-card" aria-labelledby="coverage-title">
          <p className="status-label">Generation coverage</p>
          <h2 id="coverage-title">What’s included</h2>
          {manifest.generationCoverage.workloads.length === 0 ? (
            <p>
              This revision contains infrastructure only; no application
              workloads are included.
            </p>
          ) : (
            <ul>
              {manifest.generationCoverage.workloads.map((workload) => (
                <li key={workload.workloadId}>
                  <code>{workload.workloadId}</code>:{" "}
                  {coverageLabel(workload.state)};{" "}
                  {remainingRequirementsText(
                    workload.missingRequirements.length,
                  )}
                </li>
              ))}
            </ul>
          )}
          <p>
            {remainingRequirementsText(
              manifest.generationCoverage.missingRequirements.length,
            )}
          </p>
        </section>
        <details className="revision-detail__technical">
          <summary>Technical revision details</summary>
          <div className="revision-detail__technical-content">
            <section
              className="revision-detail__metadata-section"
              aria-labelledby="binding-title"
            >
              <p className="status-label">Exact compatible bindings</p>
              <h2 id="binding-title">Frozen documents and contracts</h2>
              <dl>
                <dt>Solution Revision ID</dt>
                <dd>
                  <code>{manifest.solutionRevisionId}</code>
                </dd>
                <dt>Architecture Revision</dt>
                <dd>
                  <code>{manifest.architecture.revisionId}</code>
                </dd>
                <dt>Architecture document hash</dt>
                <dd>
                  <code>{manifest.architecture.documentHash}</code>
                </dd>
                <dt>Architecture semantic hash</dt>
                <dd>
                  <code>{manifest.architecture.contentHash}</code>
                </dd>
                <dt>Architecture visual hash</dt>
                <dd>
                  <code>{manifest.architecture.visualHash}</code>
                </dd>
                <dt>Workload Document</dt>
                <dd>
                  Contract v{manifest.workload.contractVersion} ·{" "}
                  <code>{manifest.workload.contentHash}</code>
                </dd>
                <dt>Application contracts</dt>
                <dd>
                  Contract v{manifest.contracts.contractVersion} ·{" "}
                  {manifest.contracts.recordHashes.length} record(s) ·{" "}
                  <code>{manifest.contracts.contentHash}</code>
                </dd>
                <dt>External resources</dt>
                <dd>
                  Contract v{manifest.externalResources.contractVersion} ·{" "}
                  <code>{manifest.externalResources.contentHash}</code>
                </dd>
              </dl>
            </section>
            <section
              className="revision-detail__metadata-section"
              aria-labelledby="freeze-title"
            >
              <p className="status-label">Freeze metadata</p>
              <h2 id="freeze-title">Review context at creation</h2>
              {manifest.intent.state === "included" ? (
                <p>
                  <AppLink
                    to={
                      path +
                      "/intent?acceptedIntent=" +
                      encodeURIComponent(manifest.intent.id)
                    }
                  >
                    Review the accepted requirements bound to this revision
                  </AppLink>
                </p>
              ) : (
                <p>No accepted requirements were selected for this revision.</p>
              )}
              <p>
                {manifest.assumptions.length} assumption(s),{" "}
                {manifest.unresolvedDecisionIds.length} unresolved decision(s),{" "}
                {manifest.issueIdsAtFreeze.length} active issue(s), and{" "}
                {manifest.evidenceIdsAtFreeze.length} Evidence reference(s) were
                bound at freeze time.
              </p>
              <p>
                Created{" "}
                <time dateTime={summary.createdAt}>
                  {formatTimestamp(summary.createdAt)}
                </time>{" "}
                by {summary.createdBy.displayName}.
              </p>
            </section>
          </div>
        </details>
      </div>
    </RoutePage>
  );
}

function LegacyRevisionsPage({ projectId }: { readonly projectId: string }) {
  const path = projectPath("local-org", projectId);
  return (
    <RoutePage
      title="Revision history"
      eyebrow="Immutable architecture history"
      description="Revision persistence and compilation are not connected in this shell build."
      routeKey={`revisions-${projectId}`}
    >
      <section className="state-card" role="status">
        <p className="status-label">Empty history</p>
        <h2>No immutable revisions exist</h2>
        <p>
          A future revision will be created only from an authorized, persisted,
          revalidated draft. This shell does not freeze local fixture data.
        </p>
        <AppLink className="button button--secondary" to={`${path}/editor`}>
          Return to editor shell
        </AppLink>
      </section>
    </RoutePage>
  );
}

function LegacyRevisionDetailPage({
  projectId,
  revisionId,
}: {
  readonly projectId: string;
  readonly revisionId: string;
}) {
  return (
    <RoutePage
      title="Immutable revision"
      eyebrow="Read-only lifecycle placeholder"
      description="The route identifies a revision selector, but no revision content or digest is loaded."
      routeKey={`revision-${projectId}-${revisionId}`}
    >
      <section className="state-card state-card--readonly">
        <p className="status-label">Read-only</p>
        <h2>This revision cannot be edited</h2>
        <p>
          No graph, validation evidence, version binding, artifact, or “start
          new draft work” operation is available. The route selector is not
          treated as proof that a revision exists.
        </p>
        <AppLink
          className="button button--secondary"
          to={`${projectPath("local-org", projectId)}/revisions`}
        >
          Return to revision history
        </AppLink>
      </section>
    </RoutePage>
  );
}
