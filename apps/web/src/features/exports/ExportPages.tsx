export { GitHubExportPage } from "./GitHubExportPage.js";
export { SolutionExportPage } from "./SolutionExportPage.js";

import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import {
  CandidateReviewRoute,
  type CandidateReviewHostInputV1,
} from "../generation/index.js";

interface ExportPageProps {
  readonly projectId: string;
  readonly artifactId: string;
  readonly organizationId: string;
}
interface ArtifactReviewPageProps extends ExportPageProps {
  readonly candidateReview?: CandidateReviewHostInputV1 | undefined;
  readonly principalId: string;
}

function projectPath(organizationId: string, projectId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/projects/${encodeRouteSelector(projectId)}`;
}

export function ArtifactReviewPage({
  projectId,
  artifactId,
  candidateReview,
  organizationId,
  principalId,
}: ArtifactReviewPageProps) {
  if (candidateReview !== undefined) {
    return (
      <CandidateReviewRoute
        artifactId={artifactId}
        candidateReview={candidateReview}
        organizationId={organizationId}
        projectId={projectId}
        principalId={principalId}
      />
    );
  }

  return (
    <RoutePage
      title="Artifact review"
      eyebrow="Project files"
      description="Review generated files from a saved revision."
      routeKey={`artifact-${projectId}-${artifactId}`}
    >
      <section className="state-card">
        <p className="status-label">Artifact unavailable</p>
        <h2>This artifact is not available</h2>
        <p>
          Open revision history to find a completed export or start one from a
          saved revision.
        </p>
        <AppLink
          className="button button--secondary"
          to={`${projectPath(organizationId, projectId)}/revisions`}
        >
          Return to revision history
        </AppLink>
      </section>
    </RoutePage>
  );
}

interface ExportConfirmationPageProps extends ExportPageProps {
  readonly kind: "zip" | "github";
}

export function ExportConfirmationPage({
  projectId,
  artifactId,
  kind,
  organizationId,
}: ExportConfirmationPageProps) {
  const isZip = kind === "zip";

  return (
    <RoutePage
      title={isZip ? "ZIP export" : "GitHub export"}
      eyebrow="Project files"
      description={
        isZip
          ? "Download the reviewed files from a completed export."
          : "Review a completed export before sending its files to GitHub."
      }
      routeKey={`export-${kind}-${projectId}-${artifactId}`}
    >
      <section className="state-card state-card--readonly">
        <p className="status-label">Unavailable</p>
        <h2>Choose an export from revision history</h2>
        <p>
          An export becomes available after it finishes and its files are ready
          for review.
        </p>
        <AppLink
          className="button button--primary"
          to={`${projectPath(organizationId, projectId)}/revisions`}
        >
          Open revision history
        </AppLink>
        <AppLink
          className="button button--quiet"
          to={`${projectPath(organizationId, projectId)}/artifacts/${encodeRouteSelector(
            artifactId,
          )}/review`}
        >
          Return to artifact review
        </AppLink>
      </section>
    </RoutePage>
  );
}
