import { describe, expect, it } from "vitest";

import { cloudMarkupQueryKeys } from "./query-keys.js";

describe("tenant-safe CloudMarkup query keys", () => {
  it("partitions tenant records by verified principal and organization", () => {
    const first = cloudMarkupQueryKeys.draft(
      "principal_alpha",
      "org_alpha",
      "project_shared",
    );
    const otherPrincipal = cloudMarkupQueryKeys.draft(
      "principal_beta",
      "org_alpha",
      "project_shared",
    );
    const otherOrganization = cloudMarkupQueryKeys.draft(
      "principal_alpha",
      "org_beta",
      "project_shared",
    );

    expect(first).not.toEqual(otherPrincipal);
    expect(first).not.toEqual(otherOrganization);
    expect(first).toEqual([
      "cloudmarkup",
      "api",
      "v1",
      "principal",
      "principal_alpha",
      "organization",
      "org_alpha",
      "project",
      "project_shared",
      "draft",
    ]);
  });

  it("makes organization and project prefixes safe invalidation boundaries", () => {
    const organization = cloudMarkupQueryKeys.organization(
      "principal_alpha",
      "org_alpha",
    );
    const project = cloudMarkupQueryKeys.project(
      "principal_alpha",
      "org_alpha",
      "project_notes",
    );
    const revision = cloudMarkupQueryKeys.revision(
      "principal_alpha",
      "org_alpha",
      "project_notes",
      "revision_one",
    );

    expect(project.slice(0, organization.length)).toEqual(organization);
    expect(revision.slice(0, project.length)).toEqual(project);
  });

  it("keeps membership rosters inside the verified organization scope", () => {
    const organization = cloudMarkupQueryKeys.organization(
      "principal_alpha",
      "org_alpha",
    );
    const memberships = cloudMarkupQueryKeys.memberships(
      "principal_alpha",
      "org_alpha",
    );

    expect(memberships).toEqual([...organization, "memberships"]);
    expect(
      cloudMarkupQueryKeys.memberships("principal_alpha", "org_beta"),
    ).not.toEqual(memberships);
  });

  it("partitions export jobs, artifacts, previews, and diffs by verified tenant scope", () => {
    const job = cloudMarkupQueryKeys.solutionExportJob(
      "principal_alpha",
      "org_alpha",
      "project_notes",
      "export_one",
    );
    const artifact = cloudMarkupQueryKeys.solutionExportArtifact(
      "principal_alpha",
      "org_alpha",
      "project_notes",
      "artifact_one",
    );
    const file = cloudMarkupQueryKeys.solutionExportArtifactFile(
      "principal_alpha",
      "org_alpha",
      "project_notes",
      "artifact_one",
      "file_main",
    );
    const diff = cloudMarkupQueryKeys.solutionExportArtifactDiff(
      "principal_alpha",
      "org_alpha",
      "project_notes",
      "artifact_one",
    );

    expect(job).toEqual([
      ...cloudMarkupQueryKeys.project(
        "principal_alpha",
        "org_alpha",
        "project_notes",
      ),
      "solution-export-job",
      "export_one",
    ]);
    expect(file.slice(0, artifact.length)).toEqual(artifact);
    expect(diff.slice(0, artifact.length)).toEqual(artifact);
    expect(
      cloudMarkupQueryKeys.solutionExportJob(
        "principal_beta",
        "org_alpha",
        "project_notes",
        "export_one",
      ),
    ).not.toEqual(job);
  });
});
