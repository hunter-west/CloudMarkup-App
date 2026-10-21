import { RoutePage } from "../../shell/RoutePage.js";
import { CandidateReviewSurface } from "./CandidateReviewSurface.js";
import {
  createCandidateReviewPresentation,
  type CandidateReviewHostInputV1,
  type CandidateReviewPresentationV1,
} from "./candidate-review-adapter.js";

export interface CandidateReviewRouteProps {
  readonly artifactId: string;
  readonly candidateReview: CandidateReviewHostInputV1;
  readonly organizationId: string;
  readonly projectId: string;
  readonly principalId: string;
}

function CandidateReviewUnavailable() {
  return (
    <RoutePage
      title="Artifact review"
      eyebrow="Candidate unavailable"
      description="The route does not match an authorized candidate review."
      routeKey="candidate-review-unavailable"
    >
      <section className="state-card" role="status">
        <p className="status-label">Candidate unavailable</p>
        <h2>No authorized candidate can be shown</h2>
        <p>
          Return to the originating project and open the current candidate
          review again.
        </p>
      </section>
    </RoutePage>
  );
}

/**
 * Hosts the review-only candidate surface on the existing artifact-review
 * route. A mismatched, malformed, or stale composition fails closed without
 * rendering file contents or model diagnostics.
 */
export function CandidateReviewRoute(props: CandidateReviewRouteProps) {
  let presentation: CandidateReviewPresentationV1;
  try {
    presentation = createCandidateReviewPresentation(props.candidateReview);
  } catch {
    return <CandidateReviewUnavailable />;
  }

  if (
    presentation.authority.principalId !== props.principalId ||
    presentation.authority.organizationId !== props.organizationId ||
    presentation.authority.projectId !== props.projectId ||
    presentation.authority.artifactId !== props.artifactId
  ) {
    return <CandidateReviewUnavailable />;
  }

  return (
    <RoutePage
      title="Candidate review"
      eyebrow="AI-assisted custom candidate"
      description="Review the checked candidate and its remaining issues before creating a new immutable Solution Revision."
      routeKey={`candidate-review-${presentation.surfaceProps.candidate.candidateId}`}
    >
      <CandidateReviewSurface {...presentation.surfaceProps} />
    </RoutePage>
  );
}
