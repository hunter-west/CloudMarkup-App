import {
  staffAccessResponseV1Schema,
  staffAccountListResponseSchema,
  staffAccountListResponseV1Schema,
  staffAccountSearchV1Schema,
  staffAccountDetailResponseSchema,
  staffAccountDetailResponseV1Schema,
  staffAccountActionV1Schema,
  staffActionReceiptResponseV1Schema,
} from "./staff-accounts.js";
import {
  createGitlabExportReviewV1Schema,
  advanceGitlabExportV1Schema,
  gitlabExportCollectionPathV1Schema,
  gitlabExportPathV1Schema,
  gitlabExportResponseV1Schema,
  gitlabExportPreviewResponseV1Schema,
} from "./gitlab-exports.js";
import {
  gitlabProjectDiscoveryResponseV1Schema,
  gitlabProjectDiscoveryQueryV1Schema,
  gitlabProjectSelectionListResponseV1Schema,
  gitlabProjectSelectionListQueryV1Schema,
  gitlabProjectSelectionPathV1Schema,
  gitlabProjectSelectionResponseV1Schema,
  updateGitlabProjectSelectionV1Schema,
} from "./gitlab-projects.js";
import {
  createGitlabLinkIntentV1Schema,
  completeGitlabLinkV1Schema,
  disconnectGitlabConnectionV1Schema,
  gitlabConnectionCollectionPathV1Schema,
  gitlabConnectionPathV1Schema,
  gitlabConnectionListQueryV1Schema,
  gitlabConnectionListResponseV1Schema,
  gitlabConnectionResponseV1Schema,
  gitlabLinkIntentResponseV1Schema,
} from "./gitlab-connections.js";
import {
  creditOverviewResponseV1Schema,
  creditOverviewQueryV1Schema,
} from "./credit-overview.js";
import {
  accountAuthenticatorStateResponseV1Schema,
  accountAuthenticatorStartResponseV1Schema,
  accountAuthenticatorChangeResponseV1Schema,
  startAccountAuthenticatorV1Schema,
  changeAccountAuthenticatorV1Schema,
} from "./account-authenticator.js";
import {
  accountCredentialHeadersV1Schema,
  accountCredentialStateResponseV1Schema,
  accountCredentialResultResponseV1Schema,
  changeAccountCredentialsV1Schema,
} from "./account-credentials.js";
import {
  accountSessionListResponseV1Schema,
  accountSessionListQueryV1Schema,
  changeAccountSessionsV1Schema,
  accountSessionChangeResponseV1Schema,
} from "./account-sessions.js";
import {
  organizationMemberResponseV1Schema,
  organizationMemberListResponseV1Schema,
  organizationMemberListQueryV1Schema,
  changeOrganizationMembershipV1Schema,
  organizationMembershipReceiptResponseV1Schema,
} from "./organization-members.js";
import {
  createRecipientOrganizationInvitationV1Schema,
  recipientOrganizationInvitationResponseV1Schema,
  recipientOrganizationInvitationListResponseV1Schema,
  recipientOrganizationInvitationListQueryV1Schema,
  decideRecipientOrganizationInvitationV1Schema,
} from "./recipient-organization-invitations.js";
import {
  accountProfileResponseV1Schema,
  updateAccountProfileV1Schema,
} from "./account-profile.js";
import {
  accountPhotoResponseV1Schema,
  updateAccountPhotoV1Schema,
} from "./account-photo.js";
import {
  accountWorkspaceResponseV1Schema,
  accountWorkspaceListResponseV1Schema,
  accountWorkspaceListQueryV1Schema,
  createAccountOrganizationV1Schema,
  createPersonalWorkspaceV1Schema,
} from "./account-workspaces.js";
import {
  creditTopUpWorkspaceResponseV1Schema,
  createCreditTopUpV1Schema,
} from "./credit-top-ups.js";
import {
  createBetaInfrastructureProposalV1Schema,
  betaInfrastructureProposalResponseV1Schema,
  betaInfrastructureJobResponseV1Schema,
  betaInfrastructureJobCreditsResponseV1Schema,
  betaInfrastructureJobPathV1Schema,
} from "./beta-infrastructure.js";
import {
  acceptAiIntentPreviewV1Schema,
  acceptedIntentPathV1Schema,
  acceptedIntentResponseV1Schema,
  aiIntentPreviewAcceptanceHeadersV1Schema,
  aiIntentPreviewAcceptanceQueryV1Schema,
} from "./ai-intent-preview-acceptance.js";
import type { z } from "zod";
import { aiIntentPreviewFrameV1Schema } from "./ai-intent-preview-stream.js";
import {
  createAiIntentPreviewV1Schema,
  aiIntentPreviewRequestHeadersV1Schema,
  aiIntentPreviewRequestQueryV1Schema,
  aiIntentPreviewResponseHeadersV1Schema,
} from "./ai-intent-preview-request.js";
import {
  acknowledgeAiIntentPreviewV1Schema,
  aiIntentPreviewAcknowledgementQueryV1Schema,
  aiIntentPreviewAcknowledgementResponseV1Schema,
} from "./ai-intent-preview-acknowledgement.js";
import {
  acceptOrganizationInvitationV1Schema,
  acceptedOrganizationInvitationResponseV1Schema,
  createOrganizationInvitationV1Schema,
  organizationInvitationPathV1Schema,
  organizationInvitationManagementPathV1Schema,
  organizationInvitationResponseV1Schema,
} from "./organization-invitations.js";
import {
  acquireProjectEditingLeaseV1Schema,
  mutateProjectEditingLeaseV1Schema,
  projectEditingLeaseResponseV1Schema,
} from "./project-editing-leases.js";

import {
  billingWorkspaceResponseV1Schema,
  createBillingCheckoutV1Schema,
  createBillingPortalV1Schema,
  hostedBillingSessionResponseV1Schema,
} from "./billing.js";

import {
  creditBalanceResponseV1Schema,
  currentPlanEntitlementsResponseV1Schema,
} from "./commercial.js";
import {
  continuousConformanceDiagramResponseV1Schema,
  continuousConformancePathV1Schema,
  continuousConformanceReviewActionResponseV1Schema,
  continuousConformanceResponseV1Schema,
  exportContinuousConformanceDiagramV1Schema,
  reviewContinuousConformanceActionV1Schema,
  type ContinuousConformanceResponseV1,
} from "./continuous-conformance.js";
import {
  consequentialMutationHeadersV1Schema,
  idempotencyHeadersV1Schema,
  preconditionHeadersV1Schema,
} from "./common.js";
import {
  completeGithubAppInstallationLinkV1Schema,
  createGithubAppInstallationLinkIntentV1Schema,
  createGithubExportPreviewV1Schema,
  executeGithubExportV1Schema,
  githubBranchListResponseV1Schema,
  githubExportPreviewResponseV1Schema,
  githubInstallationLinkIntentResponseV1Schema,
  githubExportReceiptResponseV1Schema,
  githubInstallationListResponseV1Schema,
  githubInstallationPathV1Schema,
  githubInstallationResponseV1Schema,
  githubIntegrationPathV1Schema,
  githubRepositoryListResponseV1Schema,
  githubRepositoryPathV1Schema,
} from "./github-exports.js";
import {
  createGithubRepositoryImportV1Schema,
  discoverGithubRepositoryV1Schema,
  githubRepositoryDiscoveryResponseV1Schema,
  createGithubRepositoryRefreshSubscriptionV1Schema,
  githubRepositoryImportListQueryV1Schema,
  githubRepositoryImportListResponseV1Schema,
  githubRepositoryImportPathV1Schema,
  githubRepositoryImportResponseV1Schema,
  githubRepositoryReconciliationReviewResponseV1Schema,
  githubRepositoryRefreshSubscriptionResponseV1Schema,
  reviewGithubRepositoryImportV1Schema,
} from "./github-imports.js";
import {
  applyDraftCommandResponseV1Schema,
  applyDraftCommandV1Schema,
  archiveProjectV1Schema,
  artifactListQueryV1Schema,
  artifactListResponseV1Schema,
  artifactPathV1Schema,
  artifactResponseV1Schema,
  auditEventListQueryV1Schema,
  auditEventSummaryListResponseV1Schema,
  createExportJobV1Schema,
  createGenerationJobV1Schema,
  createProjectEnvironmentV1Schema,
  createProjectResponseV1Schema,
  createProjectV1Schema,
  createRevisionV1Schema,
  createValidationRunV1Schema,
  currentPrincipalResponseV1Schema,
  downloadListQueryV1Schema,
  downloadableArtifactListResponseV1Schema,
  draftArchitectureDocumentResponseV1Schema,
  environmentListQueryV1Schema,
  environmentPathV1Schema,
  exportJobPathV1Schema,
  exportJobResponseV1Schema,
  generationJobPathV1Schema,
  generationJobResponseV1Schema,
  healthResponseV1Schema,
  integrationListQueryV1Schema,
  integrationListResponseV1Schema,
  membershipListQueryV1Schema,
  membershipListResponseV1Schema,
  organizationListQueryV1Schema,
  organizationListResponseV1Schema,
  organizationPathV1Schema,
  organizationResponseV1Schema,
  presentationPreferencesResponseV1Schema,
  projectEnvironmentListResponseV1Schema,
  projectEnvironmentResponseV1Schema,
  projectListQueryV1Schema,
  projectListResponseV1Schema,
  projectPathV1Schema,
  projectResponseV1Schema,
  readinessResponseV1Schema,
  renameProjectV1Schema,
  revisionListQueryV1Schema,
  revisionListResponseV1Schema,
  revisionPathV1Schema,
  revisionResponseV1Schema,
  saveDraftResponseV1Schema,
  saveDraftV1Schema,
  updatePresentationPreferencesV1Schema,
  updateProjectEnvironmentV1Schema,
  validationRunPathV1Schema,
  validationRunResponseV1Schema,
} from "./resources.js";
import {
  createSolutionRevisionV1Schema,
  solutionRevisionListQueryV1Schema,
  solutionRevisionListResponseV1Schema,
  solutionRevisionPathV1Schema,
  solutionRevisionResponseV1Schema,
} from "./solution-revisions.js";
import {
  cancelSolutionExportJobV1Schema,
  createSolutionExportDownloadGrantV1Schema,
  createSolutionExportJobV1Schema,
  solutionExportArtifactDiffResponseV1Schema,
  solutionExportArtifactFilePathV1Schema,
  solutionExportArtifactPathV1Schema,
  solutionExportArtifactResponseV1Schema,
  solutionExportDownloadContentV1Schema,
  solutionExportDownloadGrantResponseV1Schema,
  solutionExportDownloadGrantPathV1Schema,
  solutionExportDownloadResponseHeadersV1Schema,
  solutionExportFilePreviewResponseV1Schema,
  solutionExportJobPathV1Schema,
  solutionExportJobResponseV1Schema,
} from "./solution-exports.js";

export type ApiHttpMethod = "DELETE" | "GET" | "POST" | "PUT";
export type ApiSecurity = "public" | "principal";

export interface ApiOperationDefinition {
  readonly bodySchema?: z.ZodType;
  readonly etagResponse?: boolean;
  readonly headerSchema?: z.ZodType;
  readonly method: ApiHttpMethod;
  readonly path: string;
  readonly pathSchema?: z.ZodType;
  readonly querySchema?: z.ZodType;
  readonly responseSchema: z.ZodType;
  readonly responseHeaderSchema?: z.ZodType;
  readonly responseKind?: "json" | "binary" | "sse";
  readonly responseMediaType?: string;
  readonly security: ApiSecurity;
  readonly successStatus: number;
  readonly summary: string;
  readonly tag: string;
}

function defineOperation<const TOperation extends ApiOperationDefinition>(
  operation: TOperation,
): TOperation {
  return operation;
}

export interface ContinuousConformanceApiOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance";
  readonly pathSchema: typeof continuousConformancePathV1Schema;
  readonly responseSchema: z.ZodType<ContinuousConformanceResponseV1>;
  readonly security: "principal";
  readonly successStatus: 200;
  readonly summary: string;
  readonly tag: "Continuous Conformance";
}

const continuousConformanceOperation: ContinuousConformanceApiOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance",
    pathSchema: continuousConformancePathV1Schema,
    responseSchema: continuousConformanceResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get six-state revision-bound conformance evidence",
    tag: "Continuous Conformance",
  });

export interface AcceptIntentApiOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/projects/:projectId/ai-intent-previews/acceptance";
  readonly pathSchema: typeof projectPathV1Schema;
  readonly querySchema: typeof aiIntentPreviewAcceptanceQueryV1Schema;
  readonly headerSchema: typeof aiIntentPreviewAcceptanceHeadersV1Schema;
  readonly bodySchema: typeof acceptAiIntentPreviewV1Schema;
  readonly responseSchema: typeof acceptedIntentResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
export interface ReadAcceptedIntentApiOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/projects/:projectId/accepted-intents/:acceptedIntentId";
  readonly pathSchema: typeof acceptedIntentPathV1Schema;
  readonly querySchema: typeof aiIntentPreviewAcceptanceQueryV1Schema;
  readonly responseSchema: typeof acceptedIntentResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}

const acceptIntentOperation: AcceptIntentApiOperationV1 = defineOperation({
  method: "POST",
  path: "/v1/projects/:projectId/ai-intent-previews/acceptance",
  pathSchema: projectPathV1Schema,
  querySchema: aiIntentPreviewAcceptanceQueryV1Schema,
  headerSchema: aiIntentPreviewAcceptanceHeadersV1Schema,
  bodySchema: acceptAiIntentPreviewV1Schema,
  responseSchema: acceptedIntentResponseV1Schema,
  security: "principal",
  successStatus: 200,
  summary:
    "Explicitly accept exact preview requirements under the original editing authority",
  tag: "AI previews",
});

const readAcceptedIntentOperation: ReadAcceptedIntentApiOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/accepted-intents/:acceptedIntentId",
    pathSchema: acceptedIntentPathV1Schema,
    querySchema: aiIntentPreviewAcceptanceQueryV1Schema,
    responseSchema: acceptedIntentResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read immutable accepted requirements from the authorized project",
    tag: "AI previews",
  });

export interface BetaInfrastructureApiOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/projects/:projectId/beta-infrastructure-proposals";
  readonly pathSchema: typeof projectPathV1Schema;
  readonly headerSchema: typeof preconditionHeadersV1Schema;
  readonly bodySchema: typeof createBetaInfrastructureProposalV1Schema;
  readonly responseSchema: typeof betaInfrastructureProposalResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const betaInfrastructureOperation: BetaInfrastructureApiOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/projects/:projectId/beta-infrastructure-proposals",
    pathSchema: projectPathV1Schema,
    headerSchema: preconditionHeadersV1Schema,
    bodySchema: createBetaInfrastructureProposalV1Schema,
    responseSchema: betaInfrastructureProposalResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Preview one beta infrastructure proposal without saving the design",
    tag: "AI previews",
  });

export interface BetaInfrastructureJobCreateOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/projects/:projectId/beta-infrastructure-jobs";
  readonly pathSchema: typeof projectPathV1Schema;
  readonly responseSchema: typeof betaInfrastructureJobResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 202;
  readonly headerSchema: typeof consequentialMutationHeadersV1Schema;
  readonly bodySchema: typeof createBetaInfrastructureProposalV1Schema;
}
const betaInfrastructureJobCreateOperation: BetaInfrastructureJobCreateOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/projects/:projectId/beta-infrastructure-jobs",
    pathSchema: projectPathV1Schema,
    headerSchema: consequentialMutationHeadersV1Schema,
    bodySchema: createBetaInfrastructureProposalV1Schema,
    responseSchema: betaInfrastructureJobResponseV1Schema,
    security: "principal",
    successStatus: 202,
    summary: "Queue a draft-bound AI diagram proposal",
    tag: "AI previews",
  });
export interface BetaInfrastructureJobGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId";
  readonly pathSchema: typeof betaInfrastructureJobPathV1Schema;
  readonly responseSchema: typeof betaInfrastructureJobResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const betaInfrastructureJobGetOperation: BetaInfrastructureJobGetOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId",
    pathSchema: betaInfrastructureJobPathV1Schema,
    responseSchema: betaInfrastructureJobResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read an authorized AI diagram job",
    tag: "AI previews",
  });
export interface BetaInfrastructureJobCancelOperationV1 extends ApiOperationDefinition {
  readonly method: "DELETE";
  readonly path: "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId";
  readonly pathSchema: typeof betaInfrastructureJobPathV1Schema;
  readonly responseSchema: typeof betaInfrastructureJobResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const betaInfrastructureJobCancelOperation: BetaInfrastructureJobCancelOperationV1 =
  defineOperation({
    method: "DELETE",
    path: "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId",
    pathSchema: betaInfrastructureJobPathV1Schema,
    responseSchema: betaInfrastructureJobResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Cancel an AI diagram job",
    tag: "AI previews",
  });

const betaInfrastructureJobCreditsGetOperation = defineOperation({
  method: "GET",
  path: "/v1/projects/:projectId/beta-infrastructure-jobs/:jobId/credits",
  pathSchema: betaInfrastructureJobPathV1Schema,
  responseSchema: betaInfrastructureJobCreditsResponseV1Schema,
  security: "principal",
  successStatus: 200,
  summary:
    "Read estimated and settled credits for an authorized AI diagram job",
  tag: "AI previews",
});

export interface CreditOverviewGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/organizations/:organizationId/commercial/credit-overview";
  readonly pathSchema: typeof organizationPathV1Schema;
  readonly responseSchema: typeof creditOverviewResponseV1Schema;
  readonly querySchema: typeof creditOverviewQueryV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const creditOverviewGetOperation: CreditOverviewGetOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/commercial/credit-overview",
    pathSchema: organizationPathV1Schema,
    responseSchema: creditOverviewResponseV1Schema,
    querySchema: creditOverviewQueryV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read available credits by funding kind and their next expiration",
    tag: "Commercial",
  });

export interface AccountAuthenticatorGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/account/authenticator";
  readonly responseSchema: typeof accountAuthenticatorStateResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const accountAuthenticatorGetOperation: AccountAuthenticatorGetOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/account/authenticator",
    responseSchema: accountAuthenticatorStateResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read the current account authenticator and pending setup",
    tag: "Identity",
  });
export interface AccountAuthenticatorStartOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/account/authenticator-enrollments";
  readonly responseSchema: typeof accountAuthenticatorStartResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
  readonly headerSchema: typeof accountCredentialHeadersV1Schema;
  readonly bodySchema: typeof startAccountAuthenticatorV1Schema;
}
const accountAuthenticatorStartOperation: AccountAuthenticatorStartOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/account/authenticator-enrollments",
    headerSchema: accountCredentialHeadersV1Schema,
    bodySchema: startAccountAuthenticatorV1Schema,
    responseSchema: accountAuthenticatorStartResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Start an actor-bound authenticator enrollment with a transient setup key",
    tag: "Identity",
  });
export interface AccountAuthenticatorChangeOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/account/authenticator-changes";
  readonly responseSchema: typeof accountAuthenticatorChangeResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
  readonly headerSchema: typeof accountCredentialHeadersV1Schema;
  readonly bodySchema: typeof changeAccountAuthenticatorV1Schema;
}
const accountAuthenticatorChangeOperation: AccountAuthenticatorChangeOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/account/authenticator-changes",
    headerSchema: accountCredentialHeadersV1Schema,
    bodySchema: changeAccountAuthenticatorV1Schema,
    responseSchema: accountAuthenticatorChangeResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Verify, cancel or disable the current account authenticator",
    tag: "Identity",
  });

const staffActionHeadersV1Schema = preconditionHeadersV1Schema.extend(
  idempotencyHeadersV1Schema.shape,
);
export interface StaffAccessGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/staff/access";
  readonly security: "principal";
  readonly successStatus: 200;
  readonly responseSchema: typeof staffAccessResponseV1Schema;
}
const staffOperation0: StaffAccessGetOperationV1 = defineOperation({
  method: "GET",
  path: "/v1/staff/access",
  responseSchema: staffAccessResponseV1Schema,
  security: "principal",
  successStatus: 200,
  summary: "Read canonical platform staff permissions",
  tag: "Staff",
});
export interface StaffAccountsListOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/staff/accounts";
  readonly security: "principal";
  readonly successStatus: 200;
  readonly querySchema: typeof staffAccountSearchV1Schema;
  readonly responseSchema: typeof staffAccountListResponseV1Schema;
}
const staffOperation1: StaffAccountsListOperationV1 = defineOperation({
  method: "GET",
  path: "/v1/staff/accounts",
  querySchema: staffAccountSearchV1Schema,
  responseSchema: staffAccountListResponseV1Schema,
  security: "principal",
  successStatus: 200,
  summary: "Search billing accounts with current platform staff authority",
  tag: "Staff",
});
export interface StaffAccountsGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/staff/accounts/:organizationId";
  readonly security: "principal";
  readonly successStatus: 200;
  readonly pathSchema: typeof organizationPathV1Schema;
  readonly responseSchema: typeof staffAccountDetailResponseV1Schema;
}
const staffOperation2: StaffAccountsGetOperationV1 = defineOperation({
  method: "GET",
  path: "/v1/staff/accounts/:organizationId",
  pathSchema: organizationPathV1Schema,
  responseSchema: staffAccountDetailResponseV1Schema,
  etagResponse: true,
  security: "principal",
  successStatus: 200,
  summary: "Read account credits and staff action history",
  tag: "Staff",
});
export interface StaffWorkspacesListOperationV2 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/staff/workspaces";
  readonly security: "principal";
  readonly successStatus: 200;
  readonly querySchema: typeof staffAccountSearchV1Schema;
  readonly responseSchema: typeof staffAccountListResponseSchema;
}
const staffWorkspacesListOperation: StaffWorkspacesListOperationV2 =
  defineOperation({
    method: "GET",
    path: "/v1/staff/workspaces",
    querySchema: staffAccountSearchV1Schema,
    responseSchema: staffAccountListResponseSchema,
    security: "principal",
    successStatus: 200,
    summary: "Search staff workspace previews including unprovisioned billing",
    tag: "Staff",
  });
export interface StaffWorkspacesGetOperationV2 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/staff/workspaces/:organizationId";
  readonly security: "principal";
  readonly successStatus: 200;
  readonly pathSchema: typeof organizationPathV1Schema;
  readonly responseSchema: typeof staffAccountDetailResponseSchema;
}
const staffWorkspacesGetOperation: StaffWorkspacesGetOperationV2 =
  defineOperation({
    method: "GET",
    path: "/v1/staff/workspaces/:organizationId",
    pathSchema: organizationPathV1Schema,
    responseSchema: staffAccountDetailResponseSchema,
    etagResponse: true,
    security: "principal",
    successStatus: 200,
    summary:
      "Review an account or an unprovisioned staff workspace without writes",
    tag: "Staff",
  });
export interface StaffAccountsActOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/staff/accounts/:organizationId/actions";
  readonly security: "principal";
  readonly successStatus: 200;
  readonly pathSchema: typeof organizationPathV1Schema;
  readonly responseSchema: typeof staffActionReceiptResponseV1Schema;
  readonly bodySchema: typeof staffAccountActionV1Schema;
  readonly headerSchema: typeof staffActionHeadersV1Schema;
}
const staffOperation3: StaffAccountsActOperationV1 = defineOperation({
  method: "POST",
  path: "/v1/staff/accounts/:organizationId/actions",
  pathSchema: organizationPathV1Schema,
  headerSchema: staffActionHeadersV1Schema,
  bodySchema: staffAccountActionV1Schema,
  responseSchema: staffActionReceiptResponseV1Schema,
  security: "principal",
  successStatus: 200,
  summary:
    "Apply a bounded staff credit or operations action with immutable audit",
  tag: "Staff",
});

export interface GitlabExportPreviewOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/projects/:projectId/gitlab-exports";
  readonly pathSchema: typeof gitlabExportCollectionPathV1Schema;
  readonly responseSchema: typeof gitlabExportPreviewResponseV1Schema;
  readonly bodySchema: typeof createGitlabExportReviewV1Schema;
  readonly successStatus: 201;
  readonly security: "principal";
}
const GitlabExportPreviewOperation: GitlabExportPreviewOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/projects/:projectId/gitlab-exports",
    pathSchema: gitlabExportCollectionPathV1Schema,
    responseSchema: gitlabExportPreviewResponseV1Schema,
    bodySchema: createGitlabExportReviewV1Schema,
    successStatus: 201,
    security: "principal",
    summary: "Review an immutable artifact for a selected GitLab project",
    tag: "GitLab Exports",
  });
export interface GitlabExportGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/projects/:projectId/gitlab-exports/:reviewId";
  readonly pathSchema: typeof gitlabExportPathV1Schema;
  readonly responseSchema: typeof gitlabExportResponseV1Schema;
  readonly successStatus: 200;
  readonly security: "principal";
}
const GitlabExportGetOperation: GitlabExportGetOperationV1 = defineOperation({
  method: "GET",
  path: "/v1/projects/:projectId/gitlab-exports/:reviewId",
  pathSchema: gitlabExportPathV1Schema,
  responseSchema: gitlabExportResponseV1Schema,
  successStatus: 200,
  security: "principal",
  summary: "Read current actor-owned GitLab export progress",
  tag: "GitLab Exports",
});
export interface GitlabExportAdvanceOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/projects/:projectId/gitlab-exports/:reviewId/advance";
  readonly pathSchema: typeof gitlabExportPathV1Schema;
  readonly responseSchema: typeof gitlabExportResponseV1Schema;
  readonly bodySchema: typeof advanceGitlabExportV1Schema;
  readonly successStatus: 200;
  readonly security: "principal";
}
const GitlabExportAdvanceOperation: GitlabExportAdvanceOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/projects/:projectId/gitlab-exports/:reviewId/advance",
    pathSchema: gitlabExportPathV1Schema,
    responseSchema: gitlabExportResponseV1Schema,
    bodySchema: advanceGitlabExportV1Schema,
    successStatus: 200,
    security: "principal",
    summary:
      "Advance one approved GitLab export or recover its acknowledgement",
    tag: "GitLab Exports",
  });

export interface GitlabProjectDiscoveryOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/projects";
  readonly pathSchema: typeof gitlabConnectionPathV1Schema;
  readonly responseSchema: typeof gitlabProjectDiscoveryResponseV1Schema;
  readonly querySchema: typeof gitlabProjectDiscoveryQueryV1Schema;
  readonly successStatus: 200;
  readonly security: "principal";
}
const GitlabProjectDiscoveryOperation: GitlabProjectDiscoveryOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/projects",
    pathSchema: gitlabConnectionPathV1Schema,
    responseSchema: gitlabProjectDiscoveryResponseV1Schema,
    querySchema: gitlabProjectDiscoveryQueryV1Schema,
    successStatus: 200,
    security: "principal",
    summary: "Browse projects available to an actor-owned GitLab connection",
    tag: "GitLab Connections",
  });
export interface GitlabProjectSelectionListOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/project-selections";
  readonly pathSchema: typeof gitlabConnectionPathV1Schema;
  readonly responseSchema: typeof gitlabProjectSelectionListResponseV1Schema;
  readonly querySchema: typeof gitlabProjectSelectionListQueryV1Schema;
  readonly successStatus: 200;
  readonly security: "principal";
}
const GitlabProjectSelectionListOperation: GitlabProjectSelectionListOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/project-selections",
    pathSchema: gitlabConnectionPathV1Schema,
    responseSchema: gitlabProjectSelectionListResponseV1Schema,
    querySchema: gitlabProjectSelectionListQueryV1Schema,
    successStatus: 200,
    security: "principal",
    summary: "Read selected GitLab project access",
    tag: "GitLab Connections",
  });
export interface GitlabProjectSelectionUpdateOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/project-selections/:projectId";
  readonly pathSchema: typeof gitlabProjectSelectionPathV1Schema;
  readonly responseSchema: typeof gitlabProjectSelectionResponseV1Schema;
  readonly bodySchema: typeof updateGitlabProjectSelectionV1Schema;
  readonly successStatus: 200;
  readonly security: "principal";
}
const GitlabProjectSelectionUpdateOperation: GitlabProjectSelectionUpdateOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/project-selections/:projectId",
    pathSchema: gitlabProjectSelectionPathV1Schema,
    responseSchema: gitlabProjectSelectionResponseV1Schema,
    bodySchema: updateGitlabProjectSelectionV1Schema,
    successStatus: 200,
    security: "principal",
    summary: "Change one selected GitLab project with an exact version",
    tag: "GitLab Connections",
  });
export interface GitlabLinkIntentOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/link-intents";
  readonly pathSchema: typeof gitlabConnectionCollectionPathV1Schema;
  readonly responseSchema: typeof gitlabLinkIntentResponseV1Schema;
  readonly bodySchema: typeof createGitlabLinkIntentV1Schema;
  readonly security: "principal";
  readonly successStatus: 201;
}
const gitlabLinkIntentOperation: GitlabLinkIntentOperationV1 = defineOperation({
  method: "POST",
  path: "/v1/organizations/:organizationId/gitlab-connections/link-intents",
  pathSchema: gitlabConnectionCollectionPathV1Schema,
  responseSchema: gitlabLinkIntentResponseV1Schema,
  bodySchema: createGitlabLinkIntentV1Schema,
  security: "principal",
  successStatus: 201,
  summary: "Start an actor-owned GitLab connection",
  tag: "GitLab Connections",
});

export interface GitlabLinkCompletionOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/link-completions";
  readonly pathSchema: typeof gitlabConnectionCollectionPathV1Schema;
  readonly responseSchema: typeof gitlabConnectionResponseV1Schema;
  readonly bodySchema: typeof completeGitlabLinkV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const gitlabLinkCompletionOperation: GitlabLinkCompletionOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/gitlab-connections/link-completions",
    pathSchema: gitlabConnectionCollectionPathV1Schema,
    responseSchema: gitlabConnectionResponseV1Schema,
    bodySchema: completeGitlabLinkV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Complete a session-bound GitLab connection",
    tag: "GitLab Connections",
  });

export interface GitlabConnectionListOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections";
  readonly pathSchema: typeof gitlabConnectionCollectionPathV1Schema;
  readonly responseSchema: typeof gitlabConnectionListResponseV1Schema;
  readonly querySchema: typeof gitlabConnectionListQueryV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const gitlabConnectionListOperation: GitlabConnectionListOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/gitlab-connections",
    pathSchema: gitlabConnectionCollectionPathV1Schema,
    responseSchema: gitlabConnectionListResponseV1Schema,
    querySchema: gitlabConnectionListQueryV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List actor-owned GitLab connections",
    tag: "GitLab Connections",
  });

export interface GitlabConnectionGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId";
  readonly pathSchema: typeof gitlabConnectionPathV1Schema;
  readonly responseSchema: typeof gitlabConnectionResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const gitlabConnectionGetOperation: GitlabConnectionGetOperationV1 =
  defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId",
    pathSchema: gitlabConnectionPathV1Schema,
    responseSchema: gitlabConnectionResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read an actor-owned GitLab connection",
    tag: "GitLab Connections",
  });

export interface GitlabConnectionDisconnectOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/disconnect";
  readonly pathSchema: typeof gitlabConnectionPathV1Schema;
  readonly responseSchema: typeof gitlabConnectionResponseV1Schema;
  readonly bodySchema: typeof disconnectGitlabConnectionV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const gitlabConnectionDisconnectOperation: GitlabConnectionDisconnectOperationV1 =
  defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/gitlab-connections/:connectionId/disconnect",
    pathSchema: gitlabConnectionPathV1Schema,
    responseSchema: gitlabConnectionResponseV1Schema,
    bodySchema: disconnectGitlabConnectionV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Disconnect an actor-owned GitLab connection",
    tag: "GitLab Connections",
  });

export interface GithubRepositoryDiscoveryOperationV1 extends ApiOperationDefinition {
  readonly method: "POST";
  readonly path: "/v1/projects/:projectId/github-repository-discovery";
  readonly bodySchema: typeof discoverGithubRepositoryV1Schema;
  readonly pathSchema: typeof projectPathV1Schema;
  readonly responseSchema: typeof githubRepositoryDiscoveryResponseV1Schema;
  readonly security: "principal";
  readonly successStatus: 200;
}
const githubRepositoryDiscoveryOperation: GithubRepositoryDiscoveryOperationV1 =
  defineOperation({
    bodySchema: discoverGithubRepositoryV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/github-repository-discovery",
    pathSchema: projectPathV1Schema,
    responseSchema: githubRepositoryDiscoveryResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Discover eligible files at an exact authorized GitHub commit without reading contents",
    tag: "GitHub Repository Import",
  });

export interface AccountPhotoGetOperationV1 extends ApiOperationDefinition {
  readonly method: "GET";
  readonly path: "/v1/account/photo";
  readonly responseSchema: typeof accountPhotoResponseV1Schema;
  readonly etagResponse: true;
  readonly security: "principal";
  readonly successStatus: 200;
}
const accountPhotoGetOperation: AccountPhotoGetOperationV1 = defineOperation({
  method: "GET",
  path: "/v1/account/photo",
  responseSchema: accountPhotoResponseV1Schema,
  etagResponse: true,
  security: "principal",
  successStatus: 200,
  summary: "Read the private verified account photo",
  tag: "Identity",
});
export interface AccountPhotoUpdateOperationV1 extends ApiOperationDefinition {
  readonly method: "PUT";
  readonly path: "/v1/account/photo";
  readonly responseSchema: typeof accountPhotoResponseV1Schema;
  readonly bodySchema: typeof updateAccountPhotoV1Schema;
  readonly headerSchema: typeof preconditionHeadersV1Schema;
  readonly etagResponse: true;
  readonly security: "principal";
  readonly successStatus: 200;
}
const accountPhotoUpdateOperation: AccountPhotoUpdateOperationV1 =
  defineOperation({
    method: "PUT",
    path: "/v1/account/photo",
    responseSchema: accountPhotoResponseV1Schema,
    bodySchema: updateAccountPhotoV1Schema,
    headerSchema: preconditionHeadersV1Schema,
    etagResponse: true,
    security: "principal",
    successStatus: 200,
    summary: "Change or remove the private account photo with an exact version",
    tag: "Identity",
  });

export const apiOperationsV1 = {
  "staff.access.get": staffOperation0,
  "staff.accounts.list": staffOperation1,
  "staff.accounts.get": staffOperation2,
  "staff.accounts.act": staffOperation3,
  "staff.workspaces.list": staffWorkspacesListOperation,
  "staff.workspaces.get": staffWorkspacesGetOperation,
  "account.authenticator.get": accountAuthenticatorGetOperation,
  "account.authenticator.start": accountAuthenticatorStartOperation,
  "account.authenticator.change": accountAuthenticatorChangeOperation,
  "account.credentials.get": defineOperation({
    method: "GET",
    path: "/v1/account/credentials",
    responseSchema: accountCredentialStateResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read verified provider-owned account security state",
    tag: "Identity",
  }),
  "account.credentials.change": defineOperation({
    method: "POST",
    path: "/v1/account/credential-changes",
    headerSchema: accountCredentialHeadersV1Schema,
    bodySchema: changeAccountCredentialsV1Schema,
    responseSchema: accountCredentialResultResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Change the verified account password or email with one audited attempt",
    tag: "Identity",
  }),
  "account.sessions.list": defineOperation({
    method: "GET",
    path: "/v1/account/sessions",
    querySchema: accountSessionListQueryV1Schema,
    responseSchema: accountSessionListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read the verified account browser sessions",
    tag: "Identity",
  }),
  "account.sessions.change": defineOperation({
    method: "POST",
    path: "/v1/account/session-changes",
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: changeAccountSessionsV1Schema,
    responseSchema: accountSessionChangeResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "End selected or all CloudMarkup sessions with immutable actor-bound retry evidence",
    tag: "Identity",
  }),
  "organization-members.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/members",
    pathSchema: organizationPathV1Schema,
    querySchema: organizationMemberListQueryV1Schema,
    responseSchema: organizationMemberListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Read versioned organization members under current manager authority",
    tag: "Organizations",
  }),
  "account.membership.get": defineOperation({
    method: "GET",
    path: "/v1/account/workspaces/:organizationId/membership",
    pathSchema: organizationPathV1Schema,
    responseSchema: organizationMemberResponseV1Schema,
    etagResponse: true,
    security: "principal",
    successStatus: 200,
    summary:
      "Read the verified account's retained membership and current status",
    tag: "Identity",
  }),
  "organization-members.change": defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/membership-changes",
    pathSchema: organizationPathV1Schema,
    headerSchema: consequentialMutationHeadersV1Schema,
    bodySchema: changeOrganizationMembershipV1Schema,
    responseSchema: organizationMembershipReceiptResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Apply a conditional role, removal, leave or ownership change with current action-specific authority",
    tag: "Organizations",
  }),
  "organization-member-invitations.create": defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/member-invitations",
    pathSchema: organizationPathV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: createRecipientOrganizationInvitationV1Schema,
    responseSchema: recipientOrganizationInvitationResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Invite one exact existing user to the organization",
    tag: "Organizations",
  }),
  "organization-member-invitations.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/member-invitations",
    pathSchema: organizationPathV1Schema,
    querySchema: recipientOrganizationInvitationListQueryV1Schema,
    responseSchema: recipientOrganizationInvitationListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List recipient-bound organization invitations",
    tag: "Organizations",
  }),
  "account.invitations.list": defineOperation({
    method: "GET",
    path: "/v1/account/invitations",
    querySchema: recipientOrganizationInvitationListQueryV1Schema,
    responseSchema: recipientOrganizationInvitationListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List invitations addressed to the verified account",
    tag: "Identity",
  }),
  "account.invitations.accept": defineOperation({
    method: "POST",
    path: "/v1/account/invitations/:invitationId/accept",
    pathSchema: organizationInvitationPathV1Schema,
    bodySchema: decideRecipientOrganizationInvitationV1Schema,
    responseSchema: acceptedOrganizationInvitationResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Accept an invitation addressed to the verified account",
    tag: "Identity",
  }),
  "account.invitations.decline": defineOperation({
    method: "POST",
    path: "/v1/account/invitations/:invitationId/decline",
    pathSchema: organizationInvitationPathV1Schema,
    bodySchema: decideRecipientOrganizationInvitationV1Schema,
    responseSchema: recipientOrganizationInvitationResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Decline an invitation addressed to the verified account",
    tag: "Identity",
  }),
  "account.profile.get": defineOperation({
    method: "GET",
    path: "/v1/account/profile",
    responseSchema: accountProfileResponseV1Schema,
    etagResponse: true,
    security: "principal",
    successStatus: 200,
    summary: "Read the verified account profile",
    tag: "Identity",
  }),
  "account.photo.get": accountPhotoGetOperation,
  "account.photo.update": accountPhotoUpdateOperation,
  "account.profile.update": defineOperation({
    method: "PUT",
    path: "/v1/account/profile",
    headerSchema: preconditionHeadersV1Schema,
    bodySchema: updateAccountProfileV1Schema,
    responseSchema: accountProfileResponseV1Schema,
    etagResponse: true,
    security: "principal",
    successStatus: 200,
    summary: "Update the verified account profile with an exact version",
    tag: "Identity",
  }),
  "account.workspaces.get": defineOperation({
    method: "GET",
    path: "/v1/account/workspaces/:organizationId",
    pathSchema: organizationPathV1Schema,
    responseSchema: accountWorkspaceResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read an actor-authorized workspace identity",
    tag: "Organizations",
  }),
  "account.workspaces.list": defineOperation({
    method: "GET",
    path: "/v1/account/workspaces",
    querySchema: accountWorkspaceListQueryV1Schema,
    responseSchema: accountWorkspaceListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List the verified actor's personal and organization workspaces",
    tag: "Organizations",
  }),
  "account.organizations.create": defineOperation({
    method: "POST",
    path: "/v1/account/organizations",
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: createAccountOrganizationV1Schema,
    responseSchema: accountWorkspaceResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create an organization owned by the verified actor",
    tag: "Organizations",
  }),
  "account.personal-workspace.create": defineOperation({
    method: "POST",
    path: "/v1/account/personal-workspace",
    bodySchema: createPersonalWorkspaceV1Schema,
    responseSchema: accountWorkspaceResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Provision the verified actor's independent personal workspace",
    tag: "Organizations",
  }),
  "beta-infrastructure-jobs.credits.get":
    betaInfrastructureJobCreditsGetOperation,
  "beta-infrastructure-proposals.create": betaInfrastructureOperation,
  "beta-infrastructure-jobs.create": betaInfrastructureJobCreateOperation,
  "beta-infrastructure-jobs.get": betaInfrastructureJobGetOperation,
  "beta-infrastructure-jobs.cancel": betaInfrastructureJobCancelOperation,
  "ai-intent-previews.accept": acceptIntentOperation,
  "accepted-intents.get": readAcceptedIntentOperation,
  "ai-intent-previews.create": defineOperation({
    method: "POST",
    path: "/v1/projects/:projectId/ai-intent-previews",
    pathSchema: projectPathV1Schema,
    querySchema: aiIntentPreviewRequestQueryV1Schema,
    headerSchema: aiIntentPreviewRequestHeadersV1Schema,
    bodySchema: createAiIntentPreviewV1Schema,
    responseSchema: aiIntentPreviewFrameV1Schema,
    responseHeaderSchema: aiIntentPreviewResponseHeadersV1Schema,
    responseKind: "sse",
    responseMediaType: "text/event-stream",
    security: "principal",
    successStatus: 200,
    summary:
      "Stream one reviewed memory-only Intent preview for the current saved draft",
    tag: "AI previews",
  }),
  "ai-intent-previews.acknowledge": defineOperation({
    method: "POST",
    path: "/v1/projects/:projectId/ai-intent-previews/acknowledgement",
    pathSchema: projectPathV1Schema,
    querySchema: aiIntentPreviewAcknowledgementQueryV1Schema,
    bodySchema: acknowledgeAiIntentPreviewV1Schema,
    responseSchema: aiIntentPreviewAcknowledgementResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary:
      "Acknowledge complete memory-only preview delivery without accepting its content",
    tag: "AI previews",
  }),
  "organization-invitations.create": defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/invitations",
    pathSchema: organizationPathV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: createOrganizationInvitationV1Schema,
    responseSchema: organizationInvitationResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create a one-use organization invitation",
    tag: "Organizations",
  }),
  "organization-invitations.revoke": defineOperation({
    method: "DELETE",
    path: "/v1/organizations/:organizationId/invitations/:invitationId",
    pathSchema: organizationInvitationManagementPathV1Schema,
    responseSchema: organizationInvitationResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Revoke a pending organization invitation",
    tag: "Organizations",
  }),
  "organization-invitations.accept": defineOperation({
    method: "POST",
    path: "/v1/organization-invitations/:invitationId/accept",
    pathSchema: organizationInvitationPathV1Schema,
    bodySchema: acceptOrganizationInvitationV1Schema,
    responseSchema: acceptedOrganizationInvitationResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Accept an invitation as the verified current principal",
    tag: "Organizations",
  }),
  "billing.workspace.get": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/billing",
    pathSchema: organizationPathV1Schema,
    responseSchema: billingWorkspaceResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get sandbox plan choices and verified subscription status",
    tag: "Billing",
  }),
  "billing.checkout.create": defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/billing/checkout-sessions",
    pathSchema: organizationPathV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: createBillingCheckoutV1Schema,
    responseSchema: hostedBillingSessionResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create one server-configured sandbox Checkout session",
    tag: "Billing",
  }),
  "billing.top-ups.get": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/billing/credit-top-ups",
    pathSchema: organizationPathV1Schema,
    responseSchema: creditTopUpWorkspaceResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get approved credit packs and verified purchase status",
    tag: "Billing",
  }),
  "billing.top-ups.checkout.create": defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/billing/credit-top-ups/checkout-sessions",
    pathSchema: organizationPathV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: createCreditTopUpV1Schema,
    responseSchema: hostedBillingSessionResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create one account-bound sandbox credit purchase",
    tag: "Billing",
  }),
  "billing.portal.create": defineOperation({
    method: "POST",
    path: "/v1/organizations/:organizationId/billing/portal-sessions",
    pathSchema: organizationPathV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    bodySchema: createBillingPortalV1Schema,
    responseSchema: hostedBillingSessionResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create one short-lived sandbox billing Portal session",
    tag: "Billing",
  }),
  "artifacts.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/artifacts/:artifactId",
    pathSchema: artifactPathV1Schema,
    responseSchema: artifactResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get an immutable artifact",
    tag: "Artifacts",
  }),
  "artifacts.list": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/artifacts",
    pathSchema: projectPathV1Schema,
    querySchema: artifactListQueryV1Schema,
    responseSchema: artifactListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List immutable artifacts",
    tag: "Artifacts",
  }),
  "audit-events.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/audit-events",
    pathSchema: organizationPathV1Schema,
    querySchema: auditEventListQueryV1Schema,
    responseSchema: auditEventSummaryListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List safe audit-event summaries",
    tag: "Audit",
  }),
  "commercial.credit-overview.get": creditOverviewGetOperation,
  "commercial.credit-balance.get": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/commercial/credit-balance",
    pathSchema: organizationPathV1Schema,
    responseSchema: creditBalanceResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get the authorized organization credit balance",
    tag: "Commercial",
  }),
  "commercial.current-plan.get": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/commercial/current-plan",
    pathSchema: organizationPathV1Schema,
    responseSchema: currentPlanEntitlementsResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get the authorized organization current plan and entitlements",
    tag: "Commercial",
  }),
  "downloads.list": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/artifacts/:artifactId/downloads",
    pathSchema: artifactPathV1Schema,
    querySchema: downloadListQueryV1Schema,
    responseSchema: downloadableArtifactListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List downloadable representations for an artifact",
    tag: "Artifacts",
  }),
  "project-editing-leases.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/editing-lease",
    pathSchema: projectPathV1Schema,
    responseSchema: projectEditingLeaseResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Read shared-project editing availability without holder identity",
    tag: "Drafts",
  }),
  "project-editing-leases.acquire": defineOperation({
    bodySchema: acquireProjectEditingLeaseV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/editing-lease",
    pathSchema: projectPathV1Schema,
    responseSchema: projectEditingLeaseResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Acquire one tab-scoped editing lease without forced takeover",
    tag: "Drafts",
  }),
  "project-editing-leases.renew": defineOperation({
    bodySchema: mutateProjectEditingLeaseV1Schema,
    method: "PUT",
    path: "/v1/projects/:projectId/editing-lease",
    pathSchema: projectPathV1Schema,
    responseSchema: projectEditingLeaseResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Renew the exact active editing lease",
    tag: "Drafts",
  }),
  "project-editing-leases.release": defineOperation({
    bodySchema: mutateProjectEditingLeaseV1Schema,
    method: "DELETE",
    path: "/v1/projects/:projectId/editing-lease",
    pathSchema: projectPathV1Schema,
    responseSchema: projectEditingLeaseResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Release the exact editing lease without changing saved content",
    tag: "Drafts",
  }),
  "drafts.apply-command": defineOperation({
    bodySchema: applyDraftCommandV1Schema,
    etagResponse: true,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/draft/commands",
    pathSchema: projectPathV1Schema,
    responseSchema: applyDraftCommandResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Apply one versioned graph command to the current draft",
    tag: "Drafts",
  }),
  "drafts.get": defineOperation({
    etagResponse: true,
    method: "GET",
    path: "/v1/projects/:projectId/draft",
    pathSchema: projectPathV1Schema,
    responseSchema: draftArchitectureDocumentResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get the current mutable draft Architecture Document",
    tag: "Drafts",
  }),
  "drafts.save": defineOperation({
    bodySchema: saveDraftV1Schema,
    etagResponse: true,
    headerSchema: preconditionHeadersV1Schema,
    method: "PUT",
    path: "/v1/projects/:projectId/draft",
    pathSchema: projectPathV1Schema,
    responseSchema: saveDraftResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Autosave the current mutable draft with optimistic concurrency",
    tag: "Drafts",
  }),
  "environments.create": defineOperation({
    bodySchema: createProjectEnvironmentV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/environments",
    pathSchema: projectPathV1Schema,
    responseSchema: projectEnvironmentResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create a project environment",
    tag: "Projects",
  }),
  "environments.delete": defineOperation({
    etagResponse: true,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "DELETE",
    path: "/v1/projects/:projectId/environments/:environmentId",
    pathSchema: environmentPathV1Schema,
    responseSchema: projectEnvironmentResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Tombstone a project environment",
    tag: "Projects",
  }),
  "environments.get": defineOperation({
    etagResponse: true,
    method: "GET",
    path: "/v1/projects/:projectId/environments/:environmentId",
    pathSchema: environmentPathV1Schema,
    responseSchema: projectEnvironmentResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get one project environment",
    tag: "Projects",
  }),
  "environments.list": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/environments",
    pathSchema: projectPathV1Schema,
    querySchema: environmentListQueryV1Schema,
    responseSchema: projectEnvironmentListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List project environments",
    tag: "Projects",
  }),
  "environments.update": defineOperation({
    bodySchema: updateProjectEnvironmentV1Schema,
    etagResponse: true,
    headerSchema: preconditionHeadersV1Schema,
    method: "PUT",
    path: "/v1/projects/:projectId/environments/:environmentId",
    pathSchema: environmentPathV1Schema,
    responseSchema: projectEnvironmentResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Replace mutable project-environment metadata",
    tag: "Projects",
  }),
  "export-jobs.create": defineOperation({
    bodySchema: createExportJobV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/export-jobs",
    pathSchema: projectPathV1Schema,
    responseSchema: exportJobResponseV1Schema,
    security: "principal",
    successStatus: 202,
    summary: "Queue export of one exact reviewed artifact",
    tag: "Jobs",
  }),
  "export-jobs.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/export-jobs/:exportJobId",
    pathSchema: exportJobPathV1Schema,
    responseSchema: exportJobResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get export job status",
    tag: "Jobs",
  }),
  "generation-jobs.create": defineOperation({
    bodySchema: createGenerationJobV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/generation-jobs",
    pathSchema: projectPathV1Schema,
    responseSchema: generationJobResponseV1Schema,
    security: "principal",
    successStatus: 202,
    summary: "Queue generation from one immutable revision",
    tag: "Jobs",
  }),
  "generation-jobs.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/generation-jobs/:generationJobId",
    pathSchema: generationJobPathV1Schema,
    responseSchema: generationJobResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get generation job status",
    tag: "Jobs",
  }),
  "health.get": defineOperation({
    method: "GET",
    path: "/health",
    responseSchema: healthResponseV1Schema,
    security: "public",
    successStatus: 200,
    summary: "Report process health",
    tag: "Operations",
  }),
  "integrations.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/integrations",
    pathSchema: organizationPathV1Schema,
    querySchema: integrationListQueryV1Schema,
    responseSchema: integrationListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List authorized organization integrations",
    tag: "Integrations",
  }),
  "gitlab-export-reviews.create": GitlabExportPreviewOperation,
  "gitlab-exports.get": GitlabExportGetOperation,
  "gitlab-exports.advance": GitlabExportAdvanceOperation,
  "gitlab-projects.discover": GitlabProjectDiscoveryOperation,
  "gitlab-project-selections.list": GitlabProjectSelectionListOperation,
  "gitlab-project-selections.update": GitlabProjectSelectionUpdateOperation,
  "gitlab-link-intents.create": gitlabLinkIntentOperation,
  "gitlab-link-completions.create": gitlabLinkCompletionOperation,
  "gitlab-connections.list": gitlabConnectionListOperation,
  "gitlab-connections.get": gitlabConnectionGetOperation,
  "gitlab-connections.disconnect": gitlabConnectionDisconnectOperation,
  "github-installation-link-intents.create": defineOperation({
    bodySchema: createGithubAppInstallationLinkIntentV1Schema,
    method: "POST",
    path: "/v1/organizations/:organizationId/github-app-installation-link-intents",
    pathSchema: githubInstallationPathV1Schema,
    responseSchema: githubInstallationLinkIntentResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create a short-lived GitHub App installation link",
    tag: "GitHub Exports",
  }),
  "github-installation-link-completions.create": defineOperation({
    bodySchema: completeGithubAppInstallationLinkV1Schema,
    method: "POST",
    path: "/v1/organizations/:organizationId/github-app-installation-link-completions",
    pathSchema: githubInstallationPathV1Schema,
    responseSchema: githubInstallationResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Complete a verified GitHub App installation link",
    tag: "GitHub Exports",
  }),
  "github-installations.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/github-app-installations",
    pathSchema: githubInstallationPathV1Schema,
    responseSchema: githubInstallationListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List linked GitHub App installations",
    tag: "GitHub Exports",
  }),
  "github-repositories.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/github-app-installations/:integrationId/repositories",
    pathSchema: githubIntegrationPathV1Schema,
    responseSchema: githubRepositoryListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Discover repositories authorized to the GitHub App installation",
    tag: "GitHub Exports",
  }),
  "github-repository-branches.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/github-app-installations/:integrationId/repositories/:repositoryId/branches",
    pathSchema: githubRepositoryPathV1Schema,
    responseSchema: githubBranchListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Discover branches in an authorized GitHub repository",
    tag: "GitHub Exports",
  }),
  "github-repository-discovery.read": githubRepositoryDiscoveryOperation,
  "github-repository-imports.create": defineOperation({
    bodySchema: createGithubRepositoryImportV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/github-repository-imports",
    pathSchema: projectPathV1Schema,
    responseSchema: githubRepositoryImportResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Import one exact GitHub repository commit as observed evidence",
    tag: "GitHub Repository Import",
  }),
  "github-repository-imports.list": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/github-repository-imports",
    pathSchema: projectPathV1Schema,
    querySchema: githubRepositoryImportListQueryV1Schema,
    responseSchema: githubRepositoryImportListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List immutable GitHub repository import history",
    tag: "GitHub Repository Import",
  }),
  "github-repository-import-reviews.create": defineOperation({
    bodySchema: reviewGithubRepositoryImportV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/github-repository-imports/:importId/reviews",
    pathSchema: githubRepositoryImportPathV1Schema,
    responseSchema: githubRepositoryReconciliationReviewResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Review one repository reconciliation operation",
    tag: "GitHub Repository Import",
  }),
  "github-repository-refresh-subscriptions.create": defineOperation({
    bodySchema: createGithubRepositoryRefreshSubscriptionV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/github-repository-import-refresh-subscriptions",
    pathSchema: projectPathV1Schema,
    responseSchema: githubRepositoryRefreshSubscriptionResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Configure optional allow-listed GitHub push refresh",
    tag: "GitHub Repository Import",
  }),
  "github-export-previews.create": defineOperation({
    bodySchema: createGithubExportPreviewV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/github-repository-export-previews",
    pathSchema: projectPathV1Schema,
    responseSchema: githubExportPreviewResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Calculate the complete GitHub repository diff without mutation",
    tag: "GitHub Exports",
  }),
  "github-exports.create": defineOperation({
    bodySchema: executeGithubExportV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/github-repository-exports",
    pathSchema: projectPathV1Schema,
    responseSchema: githubExportReceiptResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary:
      "Create a feature branch, commit, and pull request for an approved package",
    tag: "GitHub Exports",
  }),
  "memberships.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/memberships",
    pathSchema: organizationPathV1Schema,
    querySchema: membershipListQueryV1Schema,
    responseSchema: membershipListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List organization memberships",
    tag: "Organizations",
  }),
  "organizations.get": defineOperation({
    etagResponse: true,
    method: "GET",
    path: "/v1/organizations/:organizationId",
    pathSchema: organizationPathV1Schema,
    responseSchema: organizationResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get one authorized organization",
    tag: "Organizations",
  }),
  "organizations.delete": defineOperation({
    etagResponse: true,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "DELETE",
    path: "/v1/organizations/:organizationId",
    pathSchema: organizationPathV1Schema,
    responseSchema: organizationResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Request organization-data deletion",
    tag: "Organizations",
  }),
  "organizations.list": defineOperation({
    method: "GET",
    path: "/v1/organizations",
    querySchema: organizationListQueryV1Schema,
    responseSchema: organizationListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List organizations for the current principal",
    tag: "Organizations",
  }),
  "preferences.get": defineOperation({
    etagResponse: true,
    method: "GET",
    path: "/v1/me/presentation-preferences",
    responseSchema: presentationPreferencesResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get actor-owned presentation preferences",
    tag: "Identity",
  }),
  "preferences.update": defineOperation({
    bodySchema: updatePresentationPreferencesV1Schema,
    etagResponse: true,
    headerSchema: preconditionHeadersV1Schema,
    method: "PUT",
    path: "/v1/me/presentation-preferences",
    responseSchema: presentationPreferencesResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Replace actor-owned presentation preferences",
    tag: "Identity",
  }),
  "principal.get": defineOperation({
    method: "GET",
    path: "/v1/me",
    responseSchema: currentPrincipalResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get the current verified principal",
    tag: "Identity",
  }),
  "projects.archive": defineOperation({
    bodySchema: archiveProjectV1Schema,
    etagResponse: true,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/archive",
    pathSchema: projectPathV1Schema,
    responseSchema: projectResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Archive an active project",
    tag: "Projects",
  }),
  "projects.create": defineOperation({
    bodySchema: createProjectV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/organizations/:organizationId/projects",
    pathSchema: organizationPathV1Schema,
    responseSchema: createProjectResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create a blank project and initial draft atomically",
    tag: "Projects",
  }),
  "projects.delete": defineOperation({
    etagResponse: true,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "DELETE",
    path: "/v1/projects/:projectId",
    pathSchema: projectPathV1Schema,
    responseSchema: projectResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Tombstone a project for deletion",
    tag: "Projects",
  }),
  "projects.get": defineOperation({
    etagResponse: true,
    method: "GET",
    path: "/v1/projects/:projectId",
    pathSchema: projectPathV1Schema,
    responseSchema: projectResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get one authorized project",
    tag: "Projects",
  }),
  "projects.list": defineOperation({
    method: "GET",
    path: "/v1/organizations/:organizationId/projects",
    pathSchema: organizationPathV1Schema,
    querySchema: projectListQueryV1Schema,
    responseSchema: projectListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List authorized projects in an organization",
    tag: "Projects",
  }),
  "projects.rename": defineOperation({
    bodySchema: renameProjectV1Schema,
    etagResponse: true,
    headerSchema: preconditionHeadersV1Schema,
    method: "PUT",
    path: "/v1/projects/:projectId",
    pathSchema: projectPathV1Schema,
    responseSchema: projectResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Rename an active or archived project",
    tag: "Projects",
  }),
  "readiness.get": defineOperation({
    method: "GET",
    path: "/ready",
    responseSchema: readinessResponseV1Schema,
    security: "public",
    successStatus: 200,
    summary: "Report application readiness",
    tag: "Operations",
  }),
  "solution-revisions.create": defineOperation({
    bodySchema: createSolutionRevisionV1Schema,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/solution-revisions",
    pathSchema: projectPathV1Schema,
    responseSchema: solutionRevisionResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Freeze exact project documents as an immutable Solution Revision",
    tag: "Solution Revisions",
  }),
  "solution-revisions.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-revisions/:solutionRevisionId",
    pathSchema: solutionRevisionPathV1Schema,
    responseSchema: solutionRevisionResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get an immutable Solution Revision",
    tag: "Solution Revisions",
  }),
  "solution-revisions.list": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-revisions",
    pathSchema: projectPathV1Schema,
    querySchema: solutionRevisionListQueryV1Schema,
    responseSchema: solutionRevisionListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List immutable Solution Revisions",
    tag: "Solution Revisions",
  }),
  "continuous-conformance.get": continuousConformanceOperation,
  "continuous-conformance.export-diagram": defineOperation({
    bodySchema: exportContinuousConformanceDiagramV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance/diagram-exports",
    pathSchema: continuousConformancePathV1Schema,
    responseSchema: continuousConformanceDiagramResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Export one server-reconstructed conformance diagram",
    tag: "Continuous Conformance",
  }),
  "continuous-conformance.review-action": defineOperation({
    bodySchema: reviewContinuousConformanceActionV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/solution-revisions/:solutionRevisionId/environments/:environmentId/conformance/review-actions",
    pathSchema: continuousConformancePathV1Schema,
    responseSchema: continuousConformanceReviewActionResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Execute one server-known reviewed conformance action",
    tag: "Continuous Conformance",
  }),
  "revisions.create": defineOperation({
    bodySchema: createRevisionV1Schema,
    headerSchema: consequentialMutationHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/revisions",
    pathSchema: projectPathV1Schema,
    responseSchema: revisionResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Freeze one validated draft version as an immutable revision",
    tag: "Revisions",
  }),
  "revisions.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/revisions/:revisionId",
    pathSchema: revisionPathV1Schema,
    responseSchema: revisionResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get one immutable revision",
    tag: "Revisions",
  }),
  "revisions.list": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/revisions",
    pathSchema: projectPathV1Schema,
    querySchema: revisionListQueryV1Schema,
    responseSchema: revisionListResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "List immutable revisions",
    tag: "Revisions",
  }),
  "solution-export-artifacts.diff": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/diff",
    pathSchema: solutionExportArtifactPathV1Schema,
    responseSchema: solutionExportArtifactDiffResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Compare one verified export with its fixed predecessor",
    tag: "Solution Exports",
  }),
  "solution-export-artifacts.file-preview": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/files/:solutionExportArtifactFileId/preview",
    pathSchema: solutionExportArtifactFilePathV1Schema,
    responseSchema: solutionExportFilePreviewResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Preview one bounded text file in a verified export",
    tag: "Solution Exports",
  }),
  "solution-export-artifacts.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId",
    pathSchema: solutionExportArtifactPathV1Schema,
    responseSchema: solutionExportArtifactResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Review one verified Solution Revision export artifact",
    tag: "Solution Exports",
  }),
  "solution-export-download-grants.create": defineOperation({
    bodySchema: createSolutionExportDownloadGrantV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/download-grants",
    pathSchema: solutionExportArtifactPathV1Schema,
    responseSchema: solutionExportDownloadGrantResponseV1Schema,
    security: "principal",
    successStatus: 201,
    summary: "Create a principal-bound short-lived artifact download grant",
    tag: "Solution Exports",
  }),
  "solution-export-download-grants.consume": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-export-artifacts/:solutionExportArtifactId/download-grants/:solutionExportDownloadGrantId/content",
    pathSchema: solutionExportDownloadGrantPathV1Schema,
    responseHeaderSchema: solutionExportDownloadResponseHeadersV1Schema,
    responseKind: "binary",
    responseMediaType: "application/zip",
    responseSchema: solutionExportDownloadContentV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Consume a principal-bound short-lived artifact download grant",
    tag: "Solution Exports",
  }),
  "solution-export-jobs.cancel": defineOperation({
    bodySchema: cancelSolutionExportJobV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/solution-export-jobs/:solutionExportJobId/cancel",
    pathSchema: solutionExportJobPathV1Schema,
    responseSchema: solutionExportJobResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Request cancellation of an exact Solution Revision export",
    tag: "Solution Exports",
  }),
  "solution-export-jobs.create": defineOperation({
    bodySchema: createSolutionExportJobV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/solution-export-jobs",
    pathSchema: projectPathV1Schema,
    responseSchema: solutionExportJobResponseV1Schema,
    security: "principal",
    successStatus: 202,
    summary: "Queue export of an exact immutable Solution Revision",
    tag: "Solution Exports",
  }),
  "solution-export-jobs.credits.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-export-jobs/:solutionExportJobId/credits",
    pathSchema: solutionExportJobPathV1Schema,
    responseSchema: betaInfrastructureJobCreditsResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get the metered AI source credit receipt for one export",
    tag: "Solution Exports",
  }),
  "solution-export-jobs.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/solution-export-jobs/:solutionExportJobId",
    pathSchema: solutionExportJobPathV1Schema,
    responseSchema: solutionExportJobResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get Solution Revision export progress and evidence",
    tag: "Solution Exports",
  }),
  "validation-runs.create": defineOperation({
    bodySchema: createValidationRunV1Schema,
    headerSchema: idempotencyHeadersV1Schema,
    method: "POST",
    path: "/v1/projects/:projectId/validation-runs",
    pathSchema: projectPathV1Schema,
    responseSchema: validationRunResponseV1Schema,
    security: "principal",
    successStatus: 202,
    summary: "Queue validation for an exact draft or revision input",
    tag: "Validation",
  }),
  "validation-runs.get": defineOperation({
    method: "GET",
    path: "/v1/projects/:projectId/validation-runs/:validationRunId",
    pathSchema: validationRunPathV1Schema,
    responseSchema: validationRunResponseV1Schema,
    security: "principal",
    successStatus: 200,
    summary: "Get validation run status and summary",
    tag: "Validation",
  }),
} as const;

export type ApiOperationId = keyof typeof apiOperationsV1;
export type ApiOperationV1 = (typeof apiOperationsV1)[ApiOperationId];
