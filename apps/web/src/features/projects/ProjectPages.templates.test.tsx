import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CloudMarkupQueryProvider } from "../../api/index.js";
import * as templateFixtures from "../../provider-catalog/aws-event-template-fixture.js";
import { ExperiencePreferenceProvider } from "../../preferences/ExperiencePreferenceProvider.js";
import { RouterProvider } from "../../routing/index.js";
import { eventTemplateDefinitions } from "../templates/event-templates.js";
import { NewProjectPage } from "./ProjectPages.js";

const organizationId = "org_template_creation";
const projectId = "project_persisted_template";
const principal: CurrentPrincipalV1 = {
  displayName: "Template Architect",
  id: "principal_template_creation",
  organizationContexts: [
    {
      capabilities: ["organizations.read", "projects.read", "projects.create"],
      isOwner: false,
      membershipId: "membership_template_creation",
      organizationId,
      role: "editor",
    },
  ],
  resourceVersion: 1,
};

function renderCreation(search: string, request = vi.fn(), actor = principal) {
  window.history.replaceState(
    null,
    "",
    `/organizations/${organizationId}/projects/new${search}`,
  );
  const client = {
    request,
    requestWithMetadata: vi.fn(),
  } as unknown as CloudMarkupClient;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <ExperiencePreferenceProvider storage={null}>
        <RouterProvider>
          <NewProjectPage organizationId={organizationId} principal={actor} />
        </RouterProvider>
      </ExperiencePreferenceProvider>
    </CloudMarkupQueryProvider>,
  );
  return request;
}

function createdResponse(responseOrganizationId = organizationId) {
  return {
    data: {
      draft: { id: "draft_persisted_template", version: 1 },
      project: { id: projectId, organizationId: responseOrganizationId },
    },
  };
}

describe("persisted project templates", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(eventTemplateDefinitions)(
    "persists $id with its exact resource and workload identities",
    async (template) => {
      if (!templateFixtures.isAwsEventTemplateId(template.id))
        throw new Error("Invalid reviewed template fixture.");
      const source = templateFixtures.loadAwsEventTemplateArchitectureDocument(
        template.id,
      );
      const request = renderCreation(
        `?template=${template.id}`,
        vi.fn().mockResolvedValue(createdResponse()),
      );
      expect(
        await screen.findByRole("textbox", { name: /^Project name/u }),
      ).toHaveValue(template.title);
      expect(request).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Create project" }));
      await waitFor(() => {
        expect(window.location.pathname).toBe(
          `/organizations/${organizationId}/projects/${projectId}/editor`,
        );
      });
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "projects.create",
        expect.objectContaining({
          body: {
            architectureDocument: source,
            creationMode: "draft-copy",
            name: template.title,
          },
          path: { organizationId },
        }),
      );
      expect(request.mock.calls[0]?.[1]).toHaveProperty(
        "headers.idempotency-key",
        expect.stringMatching(/^project-create:/u),
      );
    },
  );

  it("retains the exact request and key after an uncertain response", async () => {
    const request = renderCreation(
      "?template=queue-consumer-with-dlq",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Lost response"))
        .mockResolvedValueOnce(createdResponse()),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Create project" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Creation not confirmed",
    );
    expect(
      screen.getByRole("textbox", { name: /^Project name/u }),
    ).toHaveAttribute("readonly");
    expect(screen.queryByText("Lost response")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The server may already have saved this project.",
    );
    expect(
      screen.queryByRole("link", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to projects" }),
    ).toHaveAttribute("href", `/organizations/${organizationId}/projects`);
    const initialRequest = request.mock.calls[0];
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm original request" }),
    );
    await waitFor(() => {
      expect(window.location.pathname).toContain(
        `/projects/${projectId}/editor`,
      );
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(initialRequest);
  });

  it("disables cancellation while saving and opens the single confirmed project", async () => {
    let finish: (value: ReturnType<typeof createdResponse>) => void = () =>
      undefined;
    const request = renderCreation(
      "?template=queue-consumer-with-dlq",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Create project" }),
    );
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Wait for confirmation; leaving this page/u),
    ).toHaveAttribute("role", "status");
    fireEvent.click(cancel);
    expect(window.location.pathname).toBe(
      `/organizations/${organizationId}/projects/new`,
    );
    expect(request).toHaveBeenCalledOnce();
    finish(createdResponse());
    await waitFor(() => {
      expect(window.location.pathname).toBe(
        `/organizations/${organizationId}/projects/${projectId}/editor`,
      );
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    "?template=unknown",
    "?template=queue-consumer-with-dlq&template=scheduled-workflow",
  ])(
    "rejects the malformed selector %s before any create request",
    async (search) => {
      const request = renderCreation(search);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Choose a reviewed template",
      );
      expect(
        screen.queryByRole("button", { name: "Create project" }),
      ).not.toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("fails closed when reviewed template parsing fails", async () => {
    vi.spyOn(
      templateFixtures,
      "loadAwsEventTemplateArchitectureDocument",
    ).mockImplementationOnce(() => {
      throw new TypeError("Invalid template structure");
    });
    const request = renderCreation("?template=scheduled-workflow");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No project was created",
    );
    expect(
      screen.queryByText("Invalid template structure"),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["viewer", "other-organization"])(
    "denies %s before any template create request",
    (scenario) => {
      const actor: CurrentPrincipalV1 = {
        ...principal,
        organizationContexts: principal.organizationContexts.map((context) => ({
          ...context,
          ...(scenario === "viewer"
            ? { capabilities: ["projects.read"], role: "viewer" as const }
            : { organizationId: "org_other" }),
        })),
      };
      const request = renderCreation(
        "?template=scheduled-workflow",
        vi.fn(),
        actor,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No project can be created",
      );
      expect(
        screen.queryByRole("textbox", { name: /^Project name/u }),
      ).not.toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects a creation response from another organization", async () => {
    renderCreation(
      "?template=scheduled-workflow",
      vi.fn().mockResolvedValue(createdResponse("org_other")),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Create project" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Creation not confirmed",
    );
    expect(window.location.pathname).toBe(
      `/organizations/${organizationId}/projects/new`,
    );
  });

  it("preserves blank project creation when no template is selected", async () => {
    const request = renderCreation(
      "",
      vi.fn().mockResolvedValue(createdResponse()),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /^Project name/u }), {
      target: { value: "Blank architecture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "projects.create",
        expect.objectContaining({
          body: { creationMode: "blank", name: "Blank architecture" },
        }),
      );
    });
  });
});
