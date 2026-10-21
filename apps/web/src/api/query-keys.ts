const apiRoot = ["cloudmarkup", "api", "v1"] as const;

function selector(label: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new TypeError(`${label} must be a bounded non-empty selector.`);
  }
  return normalized;
}

/**
 * Browser cache partitioning only. These selectors never establish identity,
 * membership, ownership, or authorization; the API derives those from its
 * verified principal context on every request.
 */
export const cloudMarkupQueryKeys = Object.freeze({
  root: apiRoot,
  currentPrincipal() {
    return [...apiRoot, "session", "current-principal"] as const;
  },
  principal(principalId: string) {
    return [
      ...apiRoot,
      "principal",
      selector("principalId", principalId),
    ] as const;
  },
  accountProfile(principalId: string) {
    return [...this.principal(principalId), "account-profile"] as const;
  },
  accountPhoto(principalId: string) {
    return [...this.principal(principalId), "account-photo"] as const;
  },
  presentationPreferences(principalId: string) {
    return [
      ...this.principal(principalId),
      "presentation-preferences",
    ] as const;
  },
  organizations(principalId: string) {
    return [...this.principal(principalId), "organizations"] as const;
  },
  organization(principalId: string, organizationId: string) {
    return [
      ...this.principal(principalId),
      "organization",
      selector("organizationId", organizationId),
    ] as const;
  },
  memberships(principalId: string, organizationId: string) {
    return [
      ...this.organization(principalId, organizationId),
      "memberships",
    ] as const;
  },
  githubInstallations(principalId: string, organizationId: string) {
    return [
      ...this.organization(principalId, organizationId),
      "github-app-installations",
    ] as const;
  },
  githubRepositories(
    principalId: string,
    organizationId: string,
    integrationId: string,
  ) {
    return [
      ...this.githubInstallations(principalId, organizationId),
      selector("integrationId", integrationId),
      "repositories",
    ] as const;
  },
  githubRepositoryBranches(
    principalId: string,
    organizationId: string,
    integrationId: string,
    repositoryId: number,
  ) {
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
      throw new TypeError("repositoryId must be a positive safe integer.");
    }
    return [
      ...this.githubRepositories(principalId, organizationId, integrationId),
      String(repositoryId),
      "branches",
    ] as const;
  },
  projects(principalId: string, organizationId: string) {
    return [
      ...this.organization(principalId, organizationId),
      "projects",
    ] as const;
  },
  project(principalId: string, organizationId: string, projectId: string) {
    return [
      ...this.organization(principalId, organizationId),
      "project",
      selector("projectId", projectId),
    ] as const;
  },
  githubRepositoryImports(
    principalId: string,
    organizationId: string,
    projectId: string,
    repositoryId?: number,
  ) {
    if (
      repositoryId !== undefined &&
      (!Number.isSafeInteger(repositoryId) || repositoryId <= 0)
    ) {
      throw new TypeError("repositoryId must be a positive safe integer.");
    }
    return [
      ...this.project(principalId, organizationId, projectId),
      "github-repository-imports",
      ...(repositoryId === undefined ? [] : [String(repositoryId)]),
    ] as const;
  },
  draft(principalId: string, organizationId: string, projectId: string) {
    return [
      ...this.project(principalId, organizationId, projectId),
      "draft",
    ] as const;
  },
  revisions(principalId: string, organizationId: string, projectId: string) {
    return [
      ...this.project(principalId, organizationId, projectId),
      "solution-revisions",
    ] as const;
  },
  revision(
    principalId: string,
    organizationId: string,
    projectId: string,
    revisionId: string,
  ) {
    return [
      ...this.revisions(principalId, organizationId, projectId),
      selector("revisionId", revisionId),
    ] as const;
  },
  solutionExportJob(
    principalId: string,
    organizationId: string,
    projectId: string,
    exportJobId: string,
  ) {
    return [
      ...this.project(principalId, organizationId, projectId),
      "solution-export-job",
      selector("exportJobId", exportJobId),
    ] as const;
  },
  solutionExportArtifact(
    principalId: string,
    organizationId: string,
    projectId: string,
    artifactId: string,
  ) {
    return [
      ...this.project(principalId, organizationId, projectId),
      "solution-export-artifact",
      selector("artifactId", artifactId),
    ] as const;
  },
  solutionExportArtifactFile(
    principalId: string,
    organizationId: string,
    projectId: string,
    artifactId: string,
    fileId: string,
  ) {
    return [
      ...this.solutionExportArtifact(
        principalId,
        organizationId,
        projectId,
        artifactId,
      ),
      "file",
      selector("fileId", fileId),
    ] as const;
  },
  solutionExportArtifactDiff(
    principalId: string,
    organizationId: string,
    projectId: string,
    artifactId: string,
  ) {
    return [
      ...this.solutionExportArtifact(
        principalId,
        organizationId,
        projectId,
        artifactId,
      ),
      "diff",
    ] as const;
  },
  commercialSummary(principalId: string, organizationId: string) {
    return [
      ...this.organization(principalId, organizationId),
      "commercial-summary",
    ] as const;
  },
});

export type CloudMarkupQueryKey = ReturnType<
  (typeof cloudMarkupQueryKeys)[
    | "commercialSummary"
    | "currentPrincipal"
    | "githubInstallations"
    | "githubRepositories"
    | "githubRepositoryBranches"
    | "draft"
    | "githubRepositoryImports"
    | "memberships"
    | "organization"
    | "organizations"
    | "presentationPreferences"
    | "principal"
    | "project"
    | "projects"
    | "revision"
    | "revisions"
    | "solutionExportArtifact"
    | "solutionExportArtifactDiff"
    | "solutionExportArtifactFile"
    | "solutionExportJob"]
>;
