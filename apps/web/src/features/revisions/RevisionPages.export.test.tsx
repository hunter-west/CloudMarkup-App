import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  SolutionRevisionSummaryV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { solutionRevisionIdSchema } from "@cloudmarkup/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { ModePreferenceProvider } from "../../preferences/ModePreferenceProvider.js";
import { RouterProvider } from "../../routing/index.js";
import { RevisionsPage } from "./RevisionPages.js";

const principal: CurrentPrincipalV1 = {
  displayName: "Export owner",
  id: "principal_export_owner",
  organizationContexts: [
    {
      capabilities: ["projects.read", "exports.run"],
      isOwner: true,
      membershipId: "membership_export_owner",
      organizationId: "org_export",
      role: "owner",
    },
  ],
  resourceVersion: 1,
};

function revision(
  id: string,
  name: string,
  createdAt: string,
): SolutionRevisionSummaryV1 {
  const digest = `sha256:${"a".repeat(64)}`;
  const revisionId = solutionRevisionIdSchema.parse(id);
  return {
    architectureRevisionId: "revision_export_1",
    contentDigest: digest,
    createdAt,
    createdBy: { displayName: "Export owner", id: principal.id },
    documentDigest: digest,
    generationCoverage: {
      contractVersion: 1,
      evidence: [],
      missingRequirements: [],
      solutionRevisionId: revisionId,
      state: "infrastructure-only",
      workloads: [],
    },
    name,
    projectId: "project_export",
    semanticDigest: digest,
    solutionRevisionId: revisionId,
    sourceDraftId: "draft_export",
    sourceDraftVersion: 2,
    visualDigest: digest,
  };
}

afterEach(() => {
  cleanup();
});

it("opens export setup on the latest saved revision and keeps AI source opt-in", async () => {
  const request = vi.fn().mockResolvedValue({
    apiVersion: "v1",
    data: [
      revision("solution_latest", "Latest design", "2026-09-28T12:00:00.000Z"),
      revision("solution_prior", "Earlier design", "2026-09-27T12:00:00.000Z"),
    ],
  });
  const client = {
    request,
    requestWithMetadata: vi.fn(),
  } as unknown as CloudMarkupClient;
  render(
    <ModePreferenceProvider actorId={principal.id}>
      <CloudMarkupQueryProvider
        client={client}
        queryClient={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RouterProvider>
          <RevisionsPage
            organizationId="org_export"
            principal={principal}
            projectId="project_export"
          />
        </RouterProvider>
      </CloudMarkupQueryProvider>
    </ModePreferenceProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "Export your project" }),
  ).toBeVisible();
  const selection = await screen.findByRole("combobox", {
    name: "Revision to export",
  });
  expect(selection).toHaveValue("solution_latest");
  expect(
    screen.getByText(/Selected: Infrastructure-only from draft v2/u),
  ).toBeVisible();
  expect(
    screen.getByRole("checkbox", {
      name: "Generate application source with AI",
    }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("link", { name: "Review revision details" }),
  ).toHaveAttribute(
    "href",
    "/organizations/org_export/projects/project_export/revisions/solution_latest",
  );

  fireEvent.change(selection, { target: { value: "solution_prior" } });
  expect(selection).toHaveValue("solution_prior");
  expect(
    screen.getByRole("link", { name: "Review revision details" }),
  ).toHaveAttribute(
    "href",
    "/organizations/org_export/projects/project_export/revisions/solution_prior",
  );
  expect(request).toHaveBeenCalledWith(
    "solution-revisions.list",
    expect.objectContaining({
      path: { projectId: "project_export" },
    }),
  );
});
