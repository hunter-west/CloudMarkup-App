import type { CloudMarkupClient } from "@cloudmarkup/api-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitLabProjectSettings } from "./GitLabProjectSettings.js";
const binding = {
  contractVersion: 1 as const,
  organizationId: "org_example",
  principalId: "principal_actor",
  connectionId: "gitlab_" + "a".repeat(32),
};
const project = {
  projectId: 42,
  pathWithNamespace: "group/project",
  defaultBranch: "main",
  url: "https://gitlab.com/group/project",
  eligibility: "eligible" as const,
};
const selection = { ...binding, projectId: 42, version: 1, enabled: true };
const collection = (data: unknown[], nextCursor?: string) => ({
  apiVersion: "v1",
  data,
  page: {
    hasMore: nextCursor !== undefined,
    ...(nextCursor ? { nextCursor } : {}),
  },
});
function mount(request: ReturnType<typeof vi.fn>, canManage = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GitLabProjectSettings
        organizationId={binding.organizationId}
        principalId={binding.principalId}
        connectionId={binding.connectionId}
        canManage={canManage}
        runtime={{
          client: { request } as unknown as CloudMarkupClient,
          queryClient,
        }}
      />
    </QueryClientProvider>,
  );
}
function fixture() {
  let selected: (typeof selection)[] = [];
  const request = vi.fn<
    (
      ...args: [
        string,
        { body?: { expectedVersion: number; enabled: boolean } }?,
      ]
    ) => Promise<unknown>
  >(
    async (
      operation: string,
      options?: { body?: { expectedVersion: number; enabled: boolean } },
    ) => {
      await Promise.resolve();
      if (operation === "gitlab-projects.discover")
        return {
          apiVersion: "v1",
          data: { ...binding, projects: [project], nextPage: null },
        };
      if (operation === "gitlab-project-selections.list")
        return collection(selected);
      if (operation === "gitlab-project-selections.update") {
        if (!options?.body) throw Error("Missing selection");
        const result = {
          ...selection,
          version: options.body.expectedVersion + 1,
          enabled: options.body.enabled,
        };
        selected = [result];
        return { apiVersion: "v1", data: result };
      }
      throw Error("Unexpected operation");
    },
  );
  return {
    request,
    seed: (value: (typeof selection)[]) => {
      selected = value;
    },
  };
}
function implementation(request: ReturnType<typeof fixture>["request"]) {
  const base = request.getMockImplementation();
  if (!base) throw Error("Synthetic request implementation missing");
  return base;
}
afterEach(cleanup);
describe("GitLab project selection settings", () => {
  it("selects and removes with the current version without repository writes", async () => {
    const f = fixture();
    mount(f.request);
    const select = await screen.findByRole("button", {
      name: "Select group/project",
    });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.click(select);
    const remove = await screen.findByRole("button", {
      name: "Remove group/project",
    });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove group/project" }),
      ).not.toBeInTheDocument(),
    );
    const changes = f.request.mock.calls.filter(
      ([op]) => op === "gitlab-project-selections.update",
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]?.[1]).toMatchObject({
      path: {
        ...{
          organizationId: binding.organizationId,
          connectionId: binding.connectionId,
        },
        projectId: "42",
      },
      body: { contractVersion: 1, expectedVersion: 0, enabled: true },
    });
    expect(changes[1]?.[1]).toMatchObject({
      body: { expectedVersion: 1, enabled: false },
    });
    expect(screen.getByRole("link", { name: "group/project" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
  it("allows a reader to inspect but not mutate selections", async () => {
    const f = fixture();
    f.seed([selection]);
    mount(f.request, false);
    await screen.findByText(
      "An owner or administrator can change selected projects.",
    );
    expect(
      screen.queryByRole("button", { name: /^(Select |Remove )/ }),
    ).not.toBeInTheDocument();
    expect(
      f.request.mock.calls.every(
        ([op]) => op !== "gitlab-project-selections.update",
      ),
    ).toBe(true);
  });
  it.each(["archived", "empty", "insufficient-access"] as const)(
    "explains and disables %s projects",
    async (eligibility) => {
      const f = fixture();
      const base = implementation(f.request);
      f.request.mockImplementation(async (op, options) =>
        op === "gitlab-projects.discover"
          ? {
              apiVersion: "v1",
              data: {
                ...binding,
                projects: [{ ...project, eligibility }],
                nextPage: null,
              },
            }
          : base(op, options),
      );
      mount(f.request);
      expect(
        await screen.findByRole("button", { name: "Select group/project" }),
      ).toBeDisabled();
    },
  );
  it.each(["organizationId", "principalId", "connectionId"] as const)(
    "hides substituted %s metadata",
    async (key) => {
      const f = fixture(),
        base = implementation(f.request);
      f.request.mockImplementation(async (op, options) =>
        op === "gitlab-projects.discover"
          ? {
              apiVersion: "v1",
              data: {
                ...binding,
                [key]:
                  key === "connectionId"
                    ? "gitlab_" + "f".repeat(32)
                    : "other_foreign",
                projects: [project],
                nextPage: null,
              },
            }
          : base(op, options),
      );
      mount(f.request);
      await screen.findByText(
        "GitLab projects are unavailable. Check the connection and reload.",
      );
      expect(
        screen.queryByRole("link", { name: "group/project" }),
      ).not.toBeInTheDocument();
    },
  );
  it("does not guess a version while selection history has more pages", async () => {
    const f = fixture(),
      base = implementation(f.request);
    f.request.mockImplementation(async (op, options) =>
      op === "gitlab-project-selections.list"
        ? collection([{ ...selection, enabled: false }], "42")
        : base(op, options),
    );
    mount(f.request);
    expect(
      await screen.findByRole("button", { name: "Select group/project" }),
    ).toBeDisabled();
    expect(
      await screen.findByRole("button", { name: "Load remaining selections" }),
    ).toBeEnabled();
  });
  it("recovers an uncertain selection with readback and never repeats its write", async () => {
    const f = fixture(),
      base = implementation(f.request);
    f.request.mockImplementation(async (op, options) => {
      if (op === "gitlab-project-selections.update") {
        f.seed([selection]);
        throw Error("Synthetic lost acknowledgement");
      }
      return base(op, options);
    });
    mount(f.request);
    const select = await screen.findByRole("button", {
      name: "Select group/project",
    });
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.click(select);
    await screen.findByRole("alert");
    await screen.findByRole("button", { name: "Remove group/project" });
    expect(
      f.request.mock.calls.filter(
        ([op]) => op === "gitlab-project-selections.update",
      ),
    ).toHaveLength(1);
  });
});
