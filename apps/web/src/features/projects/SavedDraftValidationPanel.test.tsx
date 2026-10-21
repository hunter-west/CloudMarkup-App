import {
  ApiClientError,
  type CloudMarkupClient,
  type CurrentPrincipalV1,
  type ProjectV1,
  type ValidationRunV1,
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
import { SavedDraftValidationPanel } from "./SavedDraftValidationPanel.js";

const organizationId = "org_validation_ui";
const project: ProjectV1 = {
  createdAt: "2026-09-05T09:00:00.000Z",
  currentDraft: { id: "draft_validation_ui", version: 4 },
  environmentCount: 0,
  id: "project_validation_ui",
  lifecycleStatus: "active",
  name: "Validation UI project",
  organizationId,
  updatedAt: "2026-09-05T09:00:00.000Z",
};
const principal: CurrentPrincipalV1 = {
  displayName: "Validation Architect",
  id: "principal_validation_ui",
  organizationContexts: [
    {
      capabilities: ["projects.read", "validation.run"],
      isOwner: false,
      membershipId: "membership_validation_ui",
      organizationId,
      role: "editor",
    },
  ],
  resourceVersion: 1,
};
function run(overrides: Partial<ValidationRunV1> = {}): ValidationRunV1 {
  return {
    createdAt: "2026-09-05T09:01:00.000Z",
    completedAt: "2026-09-05T09:01:01.000Z",
    id: "validation_ui_1",
    input: { kind: "draft", draftId: project.currentDraft.id, draftVersion: 4 },
    projectId: project.id,
    status: "succeeded",
    target: "draft",
    summary: {
      complete: true,
      findingCounts: {
        error: 0,
        securityError: 0,
        warning: 0,
        costWarning: 0,
        recommendation: 0,
        educationalNote: 0,
      },
      findings: [],
      reportId: "validation_ui_1",
    },
    ...overrides,
  };
}
function setup(request = vi.fn(), actor = principal, initialProject = project) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = {
    request,
    requestWithMetadata: vi.fn(),
  } as unknown as CloudMarkupClient;
  const onReloadProject = vi.fn().mockResolvedValue(undefined);
  const tree = (nextProject: ProjectV1) => (
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <SavedDraftValidationPanel
        organizationId={organizationId}
        principal={actor}
        project={nextProject}
        onReloadProject={onReloadProject}
      />
    </CloudMarkupQueryProvider>
  );
  const view = render(tree(initialProject));
  return {
    request,
    onReloadProject,
    rerenderProject: (next: ProjectV1) => {
      view.rerender(tree(next));
    },
  };
}

describe("saved draft server validation", () => {
  afterEach(cleanup);

  it("validates only the explicit saved draft without saving canvas changes", async () => {
    const { request } = setup(vi.fn().mockResolvedValue({ data: run() }));
    expect(request).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Unsaved canvas changes are excluded/u),
    ).toBeVisible();
    fireEvent.click(screen.getByText("Validation context"));
    fireEvent.change(
      screen.getByRole("combobox", { name: "Environment for checks" }),
      { target: { value: "production" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate saved draft" }),
    );
    expect(await screen.findByText("Validation completed.")).toBeVisible();
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "validation-runs.create",
      expect.objectContaining({
        body: {
          contractVersion: 1,
          environment: "production",
          input: {
            kind: "draft",
            draftId: project.currentDraft.id,
            draftVersion: 4,
          },
          target: "draft",
        },
        path: { projectId: project.id },
      }),
    );
    expect(request.mock.calls[0]?.[1]).toHaveProperty(
      "headers.idempotency-key",
      expect.stringMatching(/^validation:/u),
    );
  });

  it("retries the original POST and key after uncertainty even if the saved draft advances", async () => {
    const { request, rerenderProject } = setup(
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Raw network failure"))
        .mockResolvedValueOnce({ data: run() }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate saved draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Retry the same validation",
    );
    const initial = request.mock.calls[0];
    rerenderProject({
      ...project,
      currentDraft: { ...project.currentDraft, version: 5 },
    });
    expect(screen.getByText(/current saved draft is version 5/u)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry same validation" }),
    );
    expect(await screen.findByText("Validation completed.")).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(initial);
    expect(screen.queryByText("Raw network failure")).not.toBeInTheDocument();
  });

  it("refreshes only the exact recorded run and preserves POST recovery while running", async () => {
    const pending = run({ status: "running", summary: undefined });
    const { request } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({ data: pending })
        .mockResolvedValueOnce({ data: run() }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate saved draft" }),
    );
    expect(
      await screen.findByText("Validation status: running."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Retry same validation" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh validation status" }),
    );
    expect(await screen.findByText("Validation completed.")).toBeVisible();
    expect(request).toHaveBeenNthCalledWith(2, "validation-runs.get", {
      path: { projectId: project.id, validationRunId: "validation_ui_1" },
    });
  });

  it.each(["project", "draft", "summary"])(
    "withholds a mismatched %s response",
    async (mismatch) => {
      const original = run();
      const invalid =
        mismatch === "project"
          ? { ...original, projectId: "project_other" }
          : mismatch === "draft"
            ? {
                ...original,
                input: {
                  kind: "draft",
                  draftId: project.currentDraft.id,
                  draftVersion: 5,
                },
              }
            : {
                ...original,
                summary: { ...original.summary, reportId: "validation_other" },
              };
      setup(vi.fn().mockResolvedValue({ data: invalid }));
      fireEvent.click(
        screen.getByRole("button", { name: "Validate saved draft" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "could not be confirmed",
      );
      expect(
        screen.queryByText("Validation completed."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Validation response did not match/u),
      ).not.toBeInTheDocument();
    },
  );

  it("does not replace the recorded report with another run returned by GET", async () => {
    const { request } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({ data: run() })
        .mockResolvedValueOnce({ data: run({ id: "validation_other" }) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate saved draft" }),
    );
    await screen.findByText("Validation completed.");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh validation status" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be confirmed",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps incomplete evidence visibly distinct from a clean result", async () => {
    const value = run();
    if (value.summary === undefined) throw new Error("Missing test summary.");
    setup(
      vi.fn().mockResolvedValue({
        data: { ...value, summary: { ...value.summary, complete: false } },
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate saved draft" }),
    );
    expect(
      await screen.findByText(/Do not treat this as a clean result/u),
    ).toBeVisible();
    expect(screen.queryByText("Validation completed.")).not.toBeInTheDocument();
  });

  it.each(["viewer", "other-organization", "archived"])(
    "does not offer validation for %s",
    (scenario) => {
      const actor =
        scenario === "viewer"
          ? {
              ...principal,
              organizationContexts: principal.organizationContexts.map(
                (context) => ({
                  ...context,
                  capabilities: ["projects.read"],
                  role: "viewer" as const,
                }),
              ),
            }
          : scenario === "other-organization"
            ? { ...principal, organizationContexts: [] }
            : principal;
      const { request } = setup(
        vi.fn(),
        actor,
        scenario === "archived"
          ? { ...project, lifecycleStatus: "archived" }
          : project,
      );
      expect(
        screen.queryByRole("button", { name: "Validate saved draft" }),
      ).not.toBeInTheDocument();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("requires refreshing a stale saved draft before starting a new validation", async () => {
    const stale = new ApiClientError(412, {
      apiVersion: "v1",
      error: {
        code: "precondition_failed",
        message: "Internal source details",
        correlationId: "correlation_validation_ui",
      },
    });
    const { onReloadProject } = setup(vi.fn().mockRejectedValue(stale));
    fireEvent.click(
      screen.getByRole("button", { name: "Validate saved draft" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "saved draft changed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload project" }));
    await waitFor(() => {
      expect(onReloadProject).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByRole("button", { name: "Validate saved draft" }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Internal source details"),
    ).not.toBeInTheDocument();
  });
});
