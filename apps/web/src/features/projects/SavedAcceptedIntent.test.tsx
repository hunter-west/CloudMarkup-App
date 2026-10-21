import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudMarkupQueryProvider } from "../../api/index.js";
import { RouterProvider } from "../../routing/index.js";
import { createSyntheticAiPreviewCandidate } from "../generation/ai-intent-preview-test-helpers.js";
import { ProjectIntentWorkspace } from "./ProjectIntentWorkspace.js";

const principal: CurrentPrincipalV1 = {
  id: "principal_preview",
  displayName: "Synthetic viewer",
  resourceVersion: 1,
  organizationContexts: [
    {
      organizationId: "org_preview",
      membershipId: "membership_preview",
      role: "viewer",
      isOwner: false,
      capabilities: ["projects.read"],
    },
  ],
};
const acceptedIntentId = "accepted_intent_" + "a".repeat(48);
function fixture(
  change:
    | "none"
    | "organization"
    | "id"
    | "digest"
    | "anonymous"
    | "malformed" = "none",
) {
  const candidate = createSyntheticAiPreviewCandidate(
    "preview_saved_synthetic",
  ).candidate;
  const intentDocument = parseIntentDocument(candidate.intentDocument);
  const record = {
    contractVersion: 1,
    acceptedIntentId:
      change === "id" ? "accepted_intent_other" : acceptedIntentId,
    projectId: "project_preview",
    createdAt: "2026-09-11T12:00:00.000Z",
    createdByPrincipalId: principal.id,
    sourceDraftId: "draft_preview",
    sourceDraftVersion: 1,
    invocationId: candidate.provenance.invocationId,
    outputDigest: digestCanonicalValue(candidate),
    intentDigest:
      change === "digest"
        ? "sha256:" + "0".repeat(64)
        : digestCanonicalValue(intentDocument),
    intentDocument,
  };
  const request = vi
    .fn<(operation: string) => Promise<unknown>>()
    .mockImplementation((operation) => {
      if (operation === "projects.get")
        return Promise.resolve({
          data: {
            id: "project_preview",
            organizationId:
              change === "organization" ? "org_other" : "org_preview",
            lifecycleStatus: "active",
          },
        });
      if (operation === "accepted-intents.get")
        return Promise.resolve({ apiVersion: "v1", data: record });
      return Promise.reject(Error("Unexpected operation"));
    });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = { request } as unknown as CloudMarkupClient;
  render(
    <RouterProvider>
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <ProjectIntentWorkspace
          organizationId="org_preview"
          projectId="project_preview"
          {...(change === "anonymous" ? {} : { principal })}
          acceptedIntentId={
            change === "malformed" ? "../other" : acceptedIntentId
          }
        />
      </CloudMarkupQueryProvider>
    </RouterProvider>,
  );
  return { request, queryClient };
}
afterEach(() => vi.restoreAllMocks());
describe("reopening saved accepted requirements", () => {
  it("allows current viewers to read the exact persisted record without preview requests, editing leases or cached bodies", async () => {
    const f = fixture();
    expect(
      await screen.findByRole("heading", { name: "Accepted requirements" }),
    ).toBeVisible();
    expect(f.request.mock.calls.map(([operation]) => operation)).toEqual([
      "projects.get",
      "accepted-intents.get",
    ]);
    expect(screen.getByRole("heading", { name: "Assumptions" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Open questions" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Who or what must initiate inbound communication? (blocking)",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open canvas with these requirements" }),
    ).toHaveAttribute(
      "href",
      "/organizations/org_preview/projects/project_preview/editor?acceptedIntent=" +
        acceptedIntentId,
    );
    expect(f.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Preview new requirements" }),
    ).toHaveAttribute(
      "href",
      "/organizations/org_preview/projects/project_preview/intent",
    );
  });
  it.each(["organization", "id", "digest", "anonymous", "malformed"] as const)(
    "refuses a %s mismatch before disclosing saved content",
    async (change) => {
      const f = fixture(change);
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Accepted requirements are unavailable",
      );
      expect(
        screen.queryByRole("heading", { name: "Accepted requirements" }),
      ).not.toBeInTheDocument();
      if (change === "anonymous" || change === "malformed")
        expect(f.request).not.toHaveBeenCalled();
      if (change === "organization")
        expect(f.request.mock.calls.map(([operation]) => operation)).toEqual([
          "projects.get",
        ]);
    },
  );
});
