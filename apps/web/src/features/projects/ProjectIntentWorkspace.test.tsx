import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import * as auth from "../auth/cognito-browser-auth.js";
import { ProjectIntentWorkspace } from "./ProjectIntentWorkspace.js";

const principal: CurrentPrincipalV1 = {
  id: "principal_preview",
  displayName: "Synthetic reviewer",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: "org_preview",
      membershipId: "membership_preview",
      role: "editor",
      isOwner: false,
      capabilities: ["projects.read", "projects.mutate"],
    },
  ],
};
function fixture(
  change: "none" | "cross-tenant" | "closed" | "wrong-draft" | "held" = "none",
) {
  const request = vi
    .fn<(operation: string) => Promise<unknown>>()
    .mockImplementation((operation) => {
      if (operation === "project-editing-leases.acquire")
        return Promise.resolve({
          data: {
            contractVersion: 1,
            projectId: "project_preview",
            state: change === "held" ? "held" : "owned",
            ...(change === "held"
              ? {}
              : {
                  leaseId: "projectlease_00000000-0000-4000-8000-000000000001",
                }),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
      if (operation === "projects.get")
        return Promise.resolve({
          data: {
            id: "project_preview",
            organizationId:
              change === "cross-tenant" ? "org_other" : "org_preview",
            lifecycleStatus: change === "closed" ? "archived" : "active",
            currentDraft: { id: "draft_preview" },
          },
        });
      if (operation === "project-editing-leases.release")
        return Promise.resolve({
          data: {
            contractVersion: 1,
            projectId: "project_preview",
            state: "available",
          },
        });
      return Promise.reject(new Error("Unexpected synthetic request"));
    });
  const requestWithMetadata = vi.fn().mockResolvedValue({
    data: {
      data: {
        projectId: "project_preview",
        id: change === "wrong-draft" ? "draft_other" : "draft_preview",
      },
    },
    metadata: { etag: '"draft:draft_preview:v1"' },
  });
  const client = {
    request,
    requestWithMetadata,
  } as unknown as CloudMarkupClient;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <ProjectIntentWorkspace
        organizationId="org_preview"
        principal={principal}
        projectId="project_preview"
      />
    </CloudMarkupQueryProvider>,
  );
  return { ...view, request, requestWithMetadata, queryClient };
}
afterEach(() => {
  vi.restoreAllMocks();
});
describe("authenticated project requirements workspace", () => {
  it("acquires editing access before reading the actual project and draft without automatically invoking AI", async () => {
    vi.spyOn(auth, "getCognitoAccessToken").mockReturnValue(
      "synthetic-session-token",
    );
    const fetcher = vi.spyOn(window, "fetch");
    const f = fixture();
    expect(
      await screen.findByRole("textbox", {
        name: "What do you want to build?",
      }),
    ).toBeVisible();
    expect(f.request.mock.calls.map(([operation]) => operation)).toEqual([
      "project-editing-leases.acquire",
      "projects.get",
    ]);
    expect(f.requestWithMetadata).toHaveBeenCalledWith("drafts.get", {
      path: { projectId: "project_preview" },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.queryClient.getQueryCache().getAll()).toHaveLength(0);
    f.unmount();
    await waitFor(() => {
      expect(f.request).toHaveBeenCalledWith(
        "project-editing-leases.release",
        expect.anything(),
      );
    });
  });
  it.each(["cross-tenant", "closed", "wrong-draft", "held"] as const)(
    "does not expose a prompt when %s prevents a verified editable head",
    async (change) => {
      vi.spyOn(auth, "getCognitoAccessToken").mockReturnValue(
        "synthetic-session-token",
      );
      const fetcher = vi.spyOn(window, "fetch");
      const f = fixture(change);
      await screen.findByRole("button", { name: "Try editing" });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(fetcher).not.toHaveBeenCalled();
      if (change === "held")
        expect(screen.getByRole("status")).toHaveTextContent("Another session");
      if (change === "cross-tenant" || change === "closed")
        expect(f.requestWithMetadata).not.toHaveBeenCalled();
    },
  );
});
