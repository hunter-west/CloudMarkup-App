import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { BetaInfrastructureAccessDeniedError } from "../generation/beta-infrastructure-client.js";
import { loadBlankAwsEditorArchitectureDocument } from "../../provider-catalog/aws-editor-fixture.js";
import {
  readProjectCreationProposal,
  forgetProjectCreationProposal,
} from "../generation/project-creation-proposal.js";
import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
  BetaInfrastructureJobCreditsV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import { ExperiencePreferenceProvider } from "../../preferences/ExperiencePreferenceProvider.js";
import { RouterProvider } from "../../routing/index.js";
import { NewProjectPage, ProjectIntentPage } from "./ProjectPages.js";

const ai = vi.hoisted(() => ({ request: vi.fn(), draft: vi.fn() }));
vi.mock(
  "../generation/beta-infrastructure-client.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../generation/beta-infrastructure-client.js")
    >()),
    requestBetaInfrastructureProposal: ai.request,
  }),
);
const principal: CurrentPrincipalV1 = {
  displayName: "Setup Architect",
  id: "principal_setup",
  organizationContexts: [
    {
      capabilities: ["organizations.read", "projects.read", "projects.create"],
      isOwner: false,
      membershipId: "membership_setup",
      organizationId: "org_setup",
      role: "editor",
    },
  ],
  resourceVersion: 1,
};

function renderSetup(page: "new" | "intent", search = "", actor = principal) {
  const request = vi.fn();
  const client = {
    request,
    requestWithMetadata: ai.draft,
  } as unknown as CloudMarkupClient;
  window.history.replaceState(
    null,
    "",
    `/organizations/org_setup/projects/${page === "new" ? "new" : "project_setup/intent"}${search}`,
  );
  render(
    <CloudMarkupQueryProvider
      client={client}
      queryClient={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <ExperiencePreferenceProvider storage={null}>
        <RouterProvider>
          {page === "new" ? (
            <NewProjectPage organizationId="org_setup" principal={actor} />
          ) : (
            <ProjectIntentPage
              organizationId="org_setup"
              principal={actor}
              projectId="project_setup"
            />
          )}
        </RouterProvider>
      </ExperiencePreferenceProvider>
    </CloudMarkupQueryProvider>,
  );
  return request;
}

describe("compact project setup", () => {
  it("offers an AI starting point and tutorial without making a model request", () => {
    const request = renderSetup("new");
    expect(screen.getByText("Describe with AI")).toBeVisible();
    expect(
      screen.getByRole("radio", { name: /^Describe with AI/u }),
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Show me around the editor" }),
    ).toBeChecked();
    expect(request).not.toHaveBeenCalled();
  });

  it("creates an empty project before opening the GitHub import review", async () => {
    const importPrincipal: CurrentPrincipalV1 = {
      ...principal,
      organizationContexts: principal.organizationContexts.map((context) => ({
        ...context,
        capabilities: [...context.capabilities, "integrations.read"],
      })),
    };
    const request = renderSetup("new", "?start=import", importPrincipal);
    request.mockResolvedValue({
      data: { project: { id: "project_import", organizationId: "org_setup" } },
    });
    expect(
      screen.getByRole("radio", { name: /^Import existing code/u }),
    ).toBeChecked();
    expect(
      screen.getByText(/Local file upload and automatic conversion/u),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: /^Project name/u }), {
      target: { value: "Existing API" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        "/organizations/org_setup/projects/project_import/editor?tool=import",
      );
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "projects.create",
      expect.objectContaining({
        body: { creationMode: "blank", name: "Existing API" },
        path: { organizationId: "org_setup" },
      }),
    );
  });

  it("does not let an import URL bypass integration access", () => {
    const request = renderSetup("new", "?start=import");
    expect(
      screen.getByRole("radio", { name: /^Import existing code/u }),
    ).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Blank canvas/u })).toBeChecked();
    expect(
      screen.getByText(
        /Ask an organization owner for GitHub integration access/u,
      ),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps project creation separate from AI generation", () => {
    const request = renderSetup("new");
    expect(screen.getByRole("radio", { name: /^Blank canvas/u })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Start from a template/u }),
    ).toHaveAttribute("href", "/organizations/org_setup/templates");
    expect(
      screen.getByRole("textbox", { name: /^Description/u }),
    ).toHaveAttribute("rows", "3");
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /generate|extract/iu }),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps template identity visible and explains its scope only on demand without losing the draft", async () => {
    const request = renderSetup("new", "?template=queue-consumer-with-dlq");
    const name = await screen.findByRole("textbox", { name: /^Project name/u });
    fireEvent.change(name, { target: { value: "Customer queue" } });
    const disclosure = screen.getByText("What the template includes");
    expect(disclosure.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(disclosure);
    expect(
      screen.getByText(
        /Includes the reviewed resources, connections, and workload contracts/u,
      ),
    ).toBeVisible();
    expect(name).toHaveValue("Customer queue");
    expect(request).not.toHaveBeenCalled();
  });

  it("requires editing permission before starting a preview and retains the tenant-scoped return", () => {
    const request = renderSetup("intent");
    expect(
      screen.getByRole("heading", { level: 1, name: "Intent review" }),
    ).toHaveFocus();
    expect(
      screen.getByText(
        "Current project editing access is required to preview requirements.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to project" }),
    ).toHaveAttribute(
      "href",
      "/organizations/org_setup/projects/project_setup",
    );
    expect(
      screen.queryByRole("button", { name: /preview|accept/iu }),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});

it("collects an AI prompt and waits for a proposal before opening the editor without Assistant", async () => {
  ai.request.mockReset();
  ai.draft.mockReset();
  const request = renderSetup("new");
  const architectureDocument = loadBlankAwsEditorArchitectureDocument();
  request.mockResolvedValue({
    data: { project: { id: "project_ai", organizationId: "org_setup" } },
  });
  ai.draft.mockResolvedValue({
    data: { data: { projectId: "project_ai", architectureDocument } },
    metadata: { etag: '"draft-1"' },
  });
  let finish: (value: unknown) => void = () => undefined;
  ai.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("radio", { name: /^Describe with AI/u }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Project name/u }), {
    target: { value: "AI application" },
  });
  expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to build?" }),
    { target: { value: "An S3 bucket for uploads" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => {
    expect(ai.request).toHaveBeenCalledOnce();
  });
  expect(window.location.pathname).toBe(
    "/organizations/org_setup/projects/new",
  );
  expect(
    screen.getByRole("progressbar", { name: "Generating project diagram" }),
  ).toBeVisible();
  const onCredits = (
    ai.request.mock.calls[0]?.[0] as {
      onCredits: (receipt: BetaInfrastructureJobCreditsV1) => void;
    }
  ).onCredits;
  act(() => {
    onCredits({
      contractVersion: 1,
      jobId: "job_setup",
      state: "reserved",
      estimatedCreditUnits: "3",
      maximumCreditUnits: "100",
    });
  });
  expect(
    screen.getByText(/Estimated 3 credits; up to 100 temporarily reserved/u),
  ).toBeVisible();
  act(() => {
    onCredits({
      contractVersion: 1,
      jobId: "job_setup",
      state: "settled",
      estimatedCreditUnits: "3",
      maximumCreditUnits: "100",
      actualCreditUnits: "2",
    });
  });
  finish({
    architectureDigest: digestCanonicalValue(architectureDocument),
    proposal: {
      contractVersion: 1,
      summary: "An upload bucket",
      resources: [
        {
          key: "uploads",
          serviceType: "aws.s3.bucket",
          label: "Uploads",
          parentKey: null,
        },
      ],
      connections: [],
      limitations: [],
    },
  });
  await waitFor(() => {
    expect(window.location.pathname + window.location.search).toBe(
      "/organizations/org_setup/projects/project_ai/editor",
    );
  });
  expect(
    readProjectCreationProposal("project_ai")?.proposal.resources,
  ).toHaveLength(1);
  expect(request).toHaveBeenCalledOnce();
  expect(ai.request.mock.calls[0]?.[0]).toMatchObject({
    projectId: "project_ai",
    request: { proposalVersion: 5, requirements: "An S3 bucket for uploads" },
  });
  expect(readProjectCreationProposal("project_ai")?.credits).toMatchObject({
    state: "settled",
    actualCreditUnits: "2",
  });
  forgetProjectCreationProposal("project_ai");
});

it("retries generation in the already-created project without creating another project", async () => {
  ai.request.mockReset();
  ai.draft.mockReset();
  const request = renderSetup("new");
  const architectureDocument = loadBlankAwsEditorArchitectureDocument();
  request.mockResolvedValue({
    data: { project: { id: "project_ai_retry", organizationId: "org_setup" } },
  });
  ai.draft.mockResolvedValue({
    data: { data: { projectId: "project_ai_retry", architectureDocument } },
    metadata: { etag: '"draft-1"' },
  });
  ai.request.mockRejectedValue(new Error("Temporary failure"));
  fireEvent.click(screen.getByRole("radio", { name: /^Describe with AI/u }));
  fireEvent.change(screen.getByRole("textbox", { name: /^Project name/u }), {
    target: { value: "AI application" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to build?" }),
    { target: { value: "An S3 bucket for uploads" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry diagram" }));
  await waitFor(() => {
    expect(ai.request).toHaveBeenCalledTimes(2);
  });
  expect(request).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("link", { name: "Open saved project" }),
  ).toHaveAttribute(
    "href",
    "/organizations/org_setup/projects/project_ai_retry/editor",
  );
});

it.each([false, true])(
  "provides scoped billing and permitted usage recovery after AI denial (usage access: %s)",
  async (canReadUsage) => {
    ai.request.mockReset();
    ai.draft.mockReset();
    const actor: CurrentPrincipalV1 = {
      ...principal,
      organizationContexts: principal.organizationContexts.map((context) => ({
        ...context,
        capabilities: [
          ...context.capabilities,
          ...(canReadUsage ? ["commercial.summary.read" as const] : []),
        ],
      })),
    };
    const request = renderSetup("new", "?start=prompt", actor);
    request.mockResolvedValue({
      data: {
        project: { id: "project_ai_denied", organizationId: "org_setup" },
      },
    });
    ai.draft.mockResolvedValue({
      data: {
        data: {
          projectId: "project_ai_denied",
          architectureDocument: loadBlankAwsEditorArchitectureDocument(),
        },
      },
      metadata: { etag: '"draft-1"' },
    });
    ai.request.mockRejectedValue(new BetaInfrastructureAccessDeniedError());
    fireEvent.change(screen.getByRole("textbox", { name: /^Project name/u }), {
      target: { value: "AI application" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "What would you like to build?" }),
      {
        target: { value: "An S3 bucket for uploads" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your workspace permissions, subscription and available credits before retrying.",
    );
    expect(screen.getByRole("link", { name: "View billing" })).toHaveAttribute(
      "href",
      "/organizations/org_setup/billing",
    );
    const usage = screen.queryByRole("link", { name: "View usage" });
    if (canReadUsage)
      expect(usage).toHaveAttribute("href", "/organizations/org_setup/usage");
    else expect(usage).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open saved project" }),
    ).toHaveAttribute(
      "href",
      "/organizations/org_setup/projects/project_ai_denied/editor",
    );
    expect(request).toHaveBeenCalledOnce();
    expect(ai.request).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Retry diagram" }));
    await waitFor(() => {
      expect(ai.request).toHaveBeenCalledTimes(2);
    });
    expect(request).toHaveBeenCalledOnce();
    expect(ai.request.mock.calls[1]?.[0]).toMatchObject({
      projectId: "project_ai_denied",
    });
  },
);

it("explains canceled generation and retains the saved project for manual editing", async () => {
  ai.request.mockReset();
  ai.draft.mockReset();
  const request = renderSetup("new", "?start=prompt");
  request.mockResolvedValue({
    data: {
      project: { id: "project_ai_canceled", organizationId: "org_setup" },
    },
  });
  ai.draft.mockResolvedValue({
    data: {
      data: {
        projectId: "project_ai_canceled",
        architectureDocument: loadBlankAwsEditorArchitectureDocument(),
      },
    },
    metadata: { etag: '"draft-1"' },
  });
  ai.request.mockImplementation(
    (input: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        input.signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Cancelled", "AbortError"));
          },
          { once: true },
        );
      }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: /^Project name/u }), {
    target: { value: "AI application" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to build?" }),
    {
      target: { value: "An S3 bucket for uploads" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel generation" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Diagram generation was canceled. Your project is saved; open it to continue manually or retry in this same project.",
  );
  expect(
    screen.getByRole("link", { name: "Open saved project" }),
  ).toHaveAttribute(
    "href",
    "/organizations/org_setup/projects/project_ai_canceled/editor",
  );
  expect(request).toHaveBeenCalledOnce();
  expect(ai.request).toHaveBeenCalledOnce();
});
