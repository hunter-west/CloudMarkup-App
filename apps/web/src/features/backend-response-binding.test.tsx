import { ExperiencePreferenceProvider } from "../preferences/ExperiencePreferenceProvider.js";
import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CloudMarkupQueryProvider,
  cloudMarkupQueryKeys,
} from "../api/index.js";
import { RouterProvider } from "../routing/index.js";
import { BillingPage } from "./billing/BillingUsagePages.js";
import { NewProjectPage, ProjectsPage } from "./projects/ProjectPages.js";
import { RevisionsPage } from "./revisions/RevisionPages.js";

const principal: CurrentPrincipalV1 = {
  displayName: "Response Binding Principal",
  id: "principal_response_binding",
  organizationContexts: [
    {
      capabilities: ["commercial.summary.read", "projects.read"],
      isOwner: false,
      membershipId: "membership_response_binding",
      organizationId: "organization_expected",
      role: "viewer",
    },
  ],
  resourceVersion: 1,
};

function clientReturning(response: unknown): CloudMarkupClient {
  return {
    request: vi.fn().mockResolvedValue(response),
    requestWithMetadata: vi.fn(),
  } as CloudMarkupClient;
}

function renderBackendPage(
  page: ReactNode,
  client: CloudMarkupClient,
  queryClient: QueryClient,
) {
  return render(
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <RouterProvider>{page}</RouterProvider>
    </CloudMarkupQueryProvider>,
  );
}

describe("backend response cache binding", () => {
  afterEach(() => {
    cleanup();
  });

  it("rejects and does not cache a project list from another organization", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderBackendPage(
      <ProjectsPage
        organizationId="organization_expected"
        principal={principal}
      />,
      clientReturning({
        apiVersion: "v1",
        data: [
          {
            id: "project_other",
            name: "Do not disclose this project",
            organizationId: "organization_other",
          },
        ],
      }),
      queryClient,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "CloudMarkup could not load projects from the server.",
    );
    expect(
      screen.queryByText("Do not disclose this project"),
    ).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.projects(principal.id, "organization_expected"),
      ),
    ).toBeUndefined();
  });

  it("rejects a created project response from another organization before navigation", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const projectCreator: CurrentPrincipalV1 = {
      displayName: principal.displayName,
      id: principal.id,
      organizationContexts: [
        {
          capabilities: ["projects.create", "projects.read"],
          isOwner: false,
          membershipId: "membership_response_binding",
          organizationId: "organization_expected",
          role: "editor",
        },
      ],
      resourceVersion: principal.resourceVersion,
    };
    window.history.replaceState(
      null,
      "",
      "/organizations/organization_expected/projects/new",
    );
    renderBackendPage(
      <ExperiencePreferenceProvider actorId="response-binding" storage={null}>
        <NewProjectPage
          organizationId="organization_expected"
          principal={projectCreator}
        />
      </ExperiencePreferenceProvider>,
      clientReturning({
        apiVersion: "v1",
        data: {
          project: {
            id: "project_other",
            name: "Do not navigate to this project",
            organizationId: "organization_other",
          },
        },
      }),
      queryClient,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Project name/u }), {
      target: { value: "Bound project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Creation not confirmed",
    );
    expect(window.location.pathname).toBe(
      "/organizations/organization_expected/projects/new",
    );
    expect(
      screen.queryByText("Do not navigate to this project"),
    ).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.project(
          principal.id,
          "organization_expected",
          "project_other",
        ),
      ),
    ).toBeUndefined();
  });

  it("rejects and does not cache a commercial summary from another organization", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderBackendPage(
      <BillingPage
        organizationId="organization_expected"
        principal={principal}
      />,
      clientReturning({
        apiVersion: "v1",
        data: { organizationId: "organization_other" },
      }),
      queryClient,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "CloudMarkup could not complete the billing request. Please try again.",
    );
    const billingQueries = queryClient.getQueryCache().findAll({
      queryKey: cloudMarkupQueryKeys.commercialSummary(
        principal.id,
        "organization_expected",
      ),
    });
    expect(billingQueries).toHaveLength(1);
    expect(billingQueries[0]?.state.data).toBeUndefined();
  });

  it("rejects and does not cache a revision list from another project", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderBackendPage(
      <RevisionsPage
        organizationId="organization_expected"
        principal={principal}
        projectId="project_expected"
      />,
      clientReturning({
        apiVersion: "v1",
        data: [
          {
            name: "Do not disclose this revision",
            projectId: "project_other",
          },
        ],
      }),
      queryClient,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "CloudMarkup could not load immutable revision data from the server.",
    );
    expect(
      screen.queryByText("Do not disclose this revision"),
    ).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        cloudMarkupQueryKeys.revisions(
          principal.id,
          "organization_expected",
          "project_expected",
        ),
      ),
    ).toBeUndefined();
  });
});
