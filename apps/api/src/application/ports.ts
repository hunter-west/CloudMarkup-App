import type {
  ApplyDraftCommandResultV1,
  ApplyDraftCommandV1,
  ArchiveProjectV1,
  ArtifactSummaryV1,
  ArtifactV1,
  AuditEventSummaryV1,
  CreateExportJobV1,
  CreateGenerationJobV1,
  CreateProjectEnvironmentV1,
  CreateProjectResultV1,
  CreateProjectV1,
  CreateValidationRunV1,
  CreditBalanceV1,
  CreditOverviewV1,
  CurrentPlanEntitlementsV1,
  CreateRevisionV1,
  CreateSolutionRevisionV1,
  CurrentPrincipalV1,
  DownloadableArtifactV1,
  DraftArchitectureDocumentV1,
  ExportJobV1,
  GenerationJobV1,
  IntegrationV1,
  MembershipV1,
  OrganizationV1,
  PresentationPreferencesV1,
  ProjectEnvironmentV1,
  ProjectSummaryV1,
  ProjectV1,
  RenameProjectV1,
  RevisionSummaryV1,
  RevisionV1,
  SaveDraftV1,
  SolutionRevisionSummaryV1,
  SolutionRevisionV1,
  UpdatePresentationPreferencesV1,
  UpdateProjectEnvironmentV1,
  ValidationRunV1,
} from "@cloudmarkup/api-contract";

import type { Principal } from "./identity.js";

export interface PrincipalContext extends Principal {
  readonly correlationId: string;
}
export type { PrincipalResolver } from "./identity.js";

export interface PageOptions {
  readonly cursor?: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly limit: number;
  readonly sort?: string;
}

export interface PageResult<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: string;
}

export interface VersionedResult<TValue> {
  readonly etag: string;
  readonly value: TValue;
}

export interface CloudMarkupApplication {
  getCurrentPrincipal(principal: PrincipalContext): Promise<CurrentPrincipalV1>;
  getPresentationPreferences(
    principal: PrincipalContext,
  ): Promise<VersionedResult<PresentationPreferencesV1>>;
  updatePresentationPreferences(
    principal: PrincipalContext,
    input: UpdatePresentationPreferencesV1,
    expectedEtag: string,
  ): Promise<VersionedResult<PresentationPreferencesV1>>;
  listOrganizations(
    principal: PrincipalContext,
    options: PageOptions,
  ): Promise<PageResult<OrganizationV1>>;
  getOrganization(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<VersionedResult<OrganizationV1>>;
  deleteOrganization(
    principal: PrincipalContext,
    organizationId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<OrganizationV1>>;
  listMemberships(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<MembershipV1>>;
  getCreditOverview(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CreditOverviewV1>;
  getCreditBalance(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CreditBalanceV1>;
  getCurrentPlanEntitlements(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CurrentPlanEntitlementsV1>;
  listProjects(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<ProjectSummaryV1>>;
  createProject(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateProjectV1,
    idempotencyKey: string,
  ): Promise<CreateProjectResultV1>;
  getProject(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<VersionedResult<ProjectV1>>;
  renameProject(
    principal: PrincipalContext,
    projectId: string,
    input: RenameProjectV1,
    expectedEtag: string,
  ): Promise<VersionedResult<ProjectV1>>;
  archiveProject(
    principal: PrincipalContext,
    projectId: string,
    input: ArchiveProjectV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectV1>>;
  deleteProject(
    principal: PrincipalContext,
    projectId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectV1>>;
  listProjectEnvironments(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<ProjectEnvironmentV1>>;
  createProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    input: CreateProjectEnvironmentV1,
    idempotencyKey: string,
  ): Promise<ProjectEnvironmentV1>;
  getProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    environmentId: string,
  ): Promise<VersionedResult<ProjectEnvironmentV1>>;
  updateProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    environmentId: string,
    input: UpdateProjectEnvironmentV1,
    expectedEtag: string,
  ): Promise<VersionedResult<ProjectEnvironmentV1>>;
  deleteProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    environmentId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectEnvironmentV1>>;
  getDraft(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<VersionedResult<DraftArchitectureDocumentV1>>;
  saveDraft(
    principal: PrincipalContext,
    projectId: string,
    input: SaveDraftV1,
    expectedEtag: string,
  ): Promise<VersionedResult<DraftArchitectureDocumentV1>>;
  applyDraftCommand(
    principal: PrincipalContext,
    projectId: string,
    input: ApplyDraftCommandV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ApplyDraftCommandResultV1>>;
  createRevision(
    principal: PrincipalContext,
    projectId: string,
    input: CreateRevisionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<RevisionV1>;
  listRevisions(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<RevisionSummaryV1>>;
  getRevision(
    principal: PrincipalContext,
    projectId: string,
    revisionId: string,
  ): Promise<RevisionV1>;
  createSolutionRevision(
    principal: PrincipalContext,
    projectId: string,
    input: CreateSolutionRevisionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<SolutionRevisionV1>;
  listSolutionRevisions(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<SolutionRevisionSummaryV1>>;
  getSolutionRevision(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
  ): Promise<SolutionRevisionV1>;
  createValidationRun(
    principal: PrincipalContext,
    projectId: string,
    input: CreateValidationRunV1,
    idempotencyKey: string,
  ): Promise<ValidationRunV1>;
  getValidationRun(
    principal: PrincipalContext,
    projectId: string,
    validationRunId: string,
  ): Promise<ValidationRunV1>;
  createGenerationJob(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGenerationJobV1,
    idempotencyKey: string,
  ): Promise<GenerationJobV1>;
  getGenerationJob(
    principal: PrincipalContext,
    projectId: string,
    generationJobId: string,
  ): Promise<GenerationJobV1>;
  createExportJob(
    principal: PrincipalContext,
    projectId: string,
    input: CreateExportJobV1,
    idempotencyKey: string,
  ): Promise<ExportJobV1>;
  getExportJob(
    principal: PrincipalContext,
    projectId: string,
    exportJobId: string,
  ): Promise<ExportJobV1>;
  listArtifacts(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<ArtifactSummaryV1>>;
  getArtifact(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactV1>;
  listDownloads(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    options: PageOptions,
  ): Promise<PageResult<DownloadableArtifactV1>>;
  listIntegrations(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<IntegrationV1>>;
  listAuditEvents(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<AuditEventSummaryV1>>;
}

export interface ReadinessProbe {
  check(): Promise<
    readonly { readonly name: string; readonly ready: boolean }[]
  >;
}
