import type {
  CloudMarkupClient,
  CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, PublicShell } from "./App.js";
import { AppErrorBoundary } from "./app/AppErrorBoundary.js";
import { CloudMarkupQueryProvider, cloudMarkupQueryKeys } from "./api/index.js";
import { RouterProvider } from "./routing/index.js";

// Route smoke tests exercise loaded content. Prepare the real editor outside
// interaction deadlines; App.deferred-routes.test.tsx covers cold loading.
import "./features/editor/EditorRoute.js";

function setViewport(width: number, height = 900) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

function setOnlineStatus(isOnline: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: isOnline,
  });
}

async function renderRoute(path: string, width = 1440) {
  setViewport(width);
  window.history.replaceState(null, "", path);
  const result = render(<App />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return result;
}

function renderVerifiedNavigationRoute(path: string, width = 1440) {
  const principal: CurrentPrincipalV1 = {
    displayName: "Morgan Architect",
    id: "principal_navigation",
    organizationContexts: [
      {
        capabilities: ["organizations.read", "projects.read"],
        isOwner: true,
        membershipId: "membership_navigation",
        organizationId: "org_navigation",
        role: "owner",
      },
    ],
    resourceVersion: 1,
  };
  const organization = {
    createdAt: "2026-09-02T12:00:00.000Z",
    displayName: "Navigation engineering",
    id: "org_navigation",
    lifecycleStatus: "active",
    slug: "navigation-engineering",
    version: 1,
  };
  const request = vi.fn((operation: string) => {
    if (operation === "principal.get")
      return Promise.resolve({ data: principal });
    if (operation === "account.workspaces.get")
      return Promise.resolve({
        data: {
          contractVersion: 1,
          principalId: principal.id,
          id: organization.id,
          displayName: organization.displayName,
          kind: "organization",
          role: "owner",
        },
      });
    if (operation === "account.workspaces.list")
      return Promise.resolve({
        data: [
          {
            contractVersion: 1,
            principalId: principal.id,
            id: organization.id,
            displayName: organization.displayName,
            kind: "organization",
            role: "owner",
          },
        ],
        page: { hasMore: false },
      });
    if (operation === "organizations.list")
      return Promise.resolve({
        data: [organization],
        page: { hasMore: false },
      });
    if (operation === "projects.list")
      return Promise.resolve({ data: [], page: { hasMore: false } });
    return Promise.reject(
      new Error(`Unexpected navigation operation: ${operation}`),
    );
  });
  const client = {
    request,
    requestWithMetadata: vi.fn().mockResolvedValue({
      data: {
        data: {
          contextualLearningEnabled: true,
          contractVersion: 1,
          experienceMode: "guided",
          syncVersion: 1,
          updatedAt: "2026-09-02T12:00:00.000Z",
        },
      },
      metadata: { etag: '"preferences:1"' },
    }),
  } as unknown as CloudMarkupClient;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  setViewport(width);
  window.history.replaceState(null, "", path);
  render(
    <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
      <App />
    </CloudMarkupQueryProvider>,
  );
  return { principal, queryClient, request };
}

describe("CloudMarkup application routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOnlineStatus(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("labels the production authentication surface without implying invite-only admission", () => {
    render(
      <RouterProvider>
        <PublicShell development={false}>
          <p>Public content</p>
        </PublicShell>
      </RouterProvider>,
    );

    expect(screen.getByText("Beta")).toBeVisible();
    expect(screen.queryByText("Authentication unavailable")).toBeNull();
  });

  it.each([
    ["/", "Bring your cloud architecture into focus."],
    ["/sign-in", "Sign in"],
    ["/auth/callback", "Completing sign-in"],
    ["/invitations/opaque-token", "Organization invitation"],
    ["/organizations/local-org/projects", "Projects"],
    ["/organizations/local-org/projects/new", "Create a project"],
    ["/organizations/local-org/templates", "Templates"],
    ["/organizations/local-org/templates/template-1", "Template unavailable"],
    ["/organizations/local-org/billing", "Billing"],
    ["/organizations/local-org/usage", "Usage"],
    ["/settings/profile", "Profile settings"],
    ["/settings/preferences", "Experience preferences"],
    ["/organizations", "Organizations"],
    ["/organizations/local-org/settings/general", "Organization settings"],
    ["/organizations/local-org/projects/field-notes", "Field notes API"],
    [
      "/organizations/local-org/projects/field-notes/editor",
      "Architecture editor",
    ],
    [
      "/organizations/local-org/projects/field-notes/revisions",
      "Revision history",
    ],
    [
      "/organizations/local-org/projects/field-notes/revisions/revision-1",
      "Immutable revision",
    ],
    [
      "/organizations/local-org/projects/field-notes/artifacts/artifact-1/review",
      "Artifact review",
    ],
    [
      "/organizations/local-org/projects/field-notes/artifacts/artifact-1/export/zip",
      "ZIP export",
    ],
    [
      "/organizations/local-org/projects/field-notes/artifacts/artifact-1/export/github",
      "GitHub export",
    ],
    ["/denied", "Access unavailable"],
    ["/unsupported", "Version not supported"],
    ["/missing", "Page unavailable"],
  ])("renders %s as %s", async (path, heading) => {
    await renderRoute(path);

    expect(
      screen.getByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();
  });

  it("keeps the immersive architecture editor named without a visible title block", async () => {
    await renderRoute("/organizations/local-org/projects/field-notes/editor");

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Architecture editor",
    });
    expect(heading.closest("header")).toHaveClass("visually-hidden");
    expect(document.title).toBe("Architecture editor");
    expect(
      screen.queryByRole("heading", {
        level: 1,
        name: "Architecture workspace",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /Inspect, add, and arrange resources in one deterministic catalog-bound Architecture Document fixture/iu,
      ),
    ).not.toBeInTheDocument();
  });

  it("uses an explicit editor fixture without waiting for API authentication in development", async () => {
    const request = vi.fn().mockRejectedValue(new Error("API unavailable"));
    const client = {
      request,
      requestWithMetadata: vi
        .fn()
        .mockRejectedValue(new Error("API unavailable")),
    } as CloudMarkupClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setViewport(1440);
    window.history.replaceState(
      null,
      "",
      "/organizations/local-org/projects/field-notes/editor?fixture=manual-notes-api",
    );

    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <App />
      </CloudMarkupQueryProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Architecture editor",
      }),
    ).toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith(
      "principal.get",
      expect.anything(),
    );
  });

  it("uses an honest global shell while a verified multi-org user chooses a workspace", async () => {
    const request = vi.fn((operation: string) => {
      if (operation === "principal.get") {
        return Promise.resolve({
          data: {
            displayName: "Morgan Multi-org",
            id: "principal_multi_org",
            organizationContexts: [
              {
                capabilities: ["organizations.read", "projects.read"],
                isOwner: true,
                membershipId: "membership_first",
                organizationId: "org_first",
                role: "owner",
              },
              {
                capabilities: ["organizations.read", "projects.read"],
                isOwner: false,
                membershipId: "membership_second",
                organizationId: "org_second",
                role: "viewer",
              },
            ],
            resourceVersion: 1,
          },
        });
      }
      if (operation === "account.workspaces.list")
        return Promise.resolve({
          data: [
            {
              contractVersion: 1,
              principalId: "principal_multi_org",
              id: "org_first",
              displayName: "First organization",
              kind: "organization",
              role: "owner",
            },
            {
              contractVersion: 1,
              principalId: "principal_multi_org",
              id: "org_second",
              displayName: "Second organization",
              kind: "organization",
              role: "viewer",
            },
          ],
          page: { hasMore: false },
        });
      if (operation === "organizations.list") {
        return Promise.resolve({
          data: [
            {
              createdAt: "2026-09-02T12:00:00.000Z",
              displayName: "First organization",
              id: "org_first",
              lifecycleStatus: "active",
              slug: "first-organization",
              version: 1,
            },
            {
              createdAt: "2026-09-03T12:00:00.000Z",
              displayName: "Second organization",
              id: "org_second",
              lifecycleStatus: "active",
              slug: "second-organization",
              version: 1,
            },
          ],
          page: { hasMore: false },
        });
      }
      return Promise.reject(new Error("Unexpected operation"));
    });
    const client = {
      request,
      requestWithMetadata: vi.fn(),
    } as unknown as CloudMarkupClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setViewport(1440);
    window.history.replaceState(null, "", "/organizations");

    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <App />
      </CloudMarkupQueryProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Your workspaces",
      }),
    ).toBeInTheDocument();
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(navigation).getByRole("link", { name: "Organizations" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(navigation).getByRole("link", { name: "Preferences" }),
    ).toHaveAttribute("href", "/settings/preferences");
    expect(
      within(navigation).queryByRole("link", { name: "Projects" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Account workspace")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Open authenticated account" }),
    );
    const account = await screen.findByRole("dialog", {
      name: "Authenticated account",
    });
    expect(within(account).getByText("Morgan Multi-org")).toBeVisible();
    expect(
      within(account).getByRole("link", { name: "Profile" }),
    ).toHaveAttribute("href", "/settings/profile");
    expect(
      screen.queryByRole("button", { name: "Project status" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Organization org_first"),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith(
      "account.workspaces.get",
      expect.anything(),
    );
  });

  it.each([1440, 390])(
    "keeps account navigation and an authorized Projects return path at %i pixels",
    async (width) => {
      const { request } = renderVerifiedNavigationRoute(
        "/organizations/org_navigation/projects",
        width,
      );
      await screen.findByRole("heading", { level: 1, name: "Projects" });
      const openNavigation = async () => {
        if (width < 1280) {
          fireEvent.click(
            screen.getByRole("button", { name: "Open application navigation" }),
          );
        }
        return screen.findByRole("navigation", { name: "Primary navigation" });
      };
      const initialNavigation = await openNavigation();
      expect(
        within(initialNavigation).queryByRole("link", {
          name: "Members & roles",
        }),
      ).not.toBeInTheDocument();
      expect(
        within(initialNavigation).queryByRole("link", {
          name: "Organization integrations",
        }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        within(initialNavigation).getByRole("link", {
          name: "Organizations",
        }),
      );
      const organizationsHeading = await screen.findByRole("heading", {
        level: 1,
        name: "Workspaces",
      });
      await waitFor(() => expect(organizationsHeading).toHaveFocus());
      expect(document.title).toBe("Workspaces");
      expect(
        screen.queryByRole("button", { name: "Project status" }),
      ).not.toBeInTheDocument();
      const organizationsNavigation = await openNavigation();
      expect(
        within(organizationsNavigation).getByRole("link", { name: "Projects" }),
      ).toHaveAttribute("href", "/organizations/org_navigation/projects");
      fireEvent.click(
        within(organizationsNavigation).getByRole("link", {
          name: "Preferences",
        }),
      );
      const preferencesHeading = await screen.findByRole("heading", {
        level: 1,
        name: "Experience preferences",
      });
      await waitFor(() => expect(preferencesHeading).toHaveFocus());
      expect(document.title).toBe("Experience preferences");
      const preferencesNavigation = await openNavigation();
      expect(
        screen.queryByRole("navigation", { name: "Personal settings" }),
      ).not.toBeInTheDocument();
      expect(
        within(preferencesNavigation).getByRole("link", {
          name: "Preferences",
        }),
      ).toHaveAttribute("aria-current", "page");
      fireEvent.click(
        within(preferencesNavigation).getByRole("link", { name: "Projects" }),
      );
      expect(
        await screen.findByRole("heading", { level: 1, name: "Projects" }),
      ).toBeVisible();
      expect(window.location.pathname).toBe(
        "/organizations/org_navigation/projects",
      );
      expect(request).not.toHaveBeenCalledWith("projects.list", {
        path: { organizationId: "unavailable" },
      });
    },
  );

  it("does not invent a tenant for a direct preferences link", async () => {
    const { request } = renderVerifiedNavigationRoute("/settings/preferences");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Experience preferences",
      }),
    ).toBeVisible();
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(navigation).getByRole("link", { name: "Organizations" }),
    ).toHaveAttribute("href", "/organizations");
    expect(
      within(navigation).queryByRole("link", { name: "Projects" }),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith(
      "account.workspaces.get",
      expect.anything(),
    );
    expect(request).not.toHaveBeenCalledWith(
      "projects.list",
      expect.anything(),
    );
  });

  it("removes remembered tenant links when verified membership is revoked", async () => {
    const { principal, queryClient } = renderVerifiedNavigationRoute(
      "/organizations/org_navigation/projects",
    );
    await screen.findByRole("heading", { level: 1, name: "Projects" });
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Primary navigation" }),
      ).getByRole("link", { name: "Preferences" }),
    );
    await screen.findByRole("heading", {
      level: 1,
      name: "Experience preferences",
    });
    act(() => {
      queryClient.setQueryData(cloudMarkupQueryKeys.currentPrincipal(), {
        ...principal,
        organizationContexts: [],
      });
    });
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("navigation", { name: "Primary navigation" }),
        ).queryByRole("link", { name: "Projects" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("binds template navigation to the verified organization without exposing local fixtures", async () => {
    const request = vi.fn((operation: string) => {
      if (operation === "principal.get") {
        return Promise.resolve({
          data: {
            displayName: "Morgan Architect",
            id: "principal_template_org",
            organizationContexts: [
              {
                capabilities: [
                  "organizations.read",
                  "projects.read",
                  "projects.create",
                ],
                isOwner: false,
                membershipId: "membership_template_org",
                organizationId: "org_template_routes",
                role: "editor",
              },
            ],
            resourceVersion: 1,
          },
        });
      }
      if (operation === "account.workspaces.get") {
        return Promise.resolve({
          data: {
            contractVersion: 1,
            principalId: "principal_template_org",
            kind: "organization",
            role: "editor",
            displayName: "Template Route Organization",
            id: "org_template_routes",
          },
        });
      }
      return Promise.reject(new Error(`Unexpected operation: ${operation}`));
    });
    const client = {
      request,
      requestWithMetadata: vi.fn(),
    } as unknown as CloudMarkupClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setViewport(1440);
    window.history.replaceState(
      null,
      "",
      "/organizations/org_template_routes/templates",
    );

    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <App />
      </CloudMarkupQueryProvider>,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Templates" }),
    ).toBeVisible();
    const reviewLinks = screen.getAllByRole("link", {
      name: "Review template",
    });
    expect(reviewLinks).toHaveLength(4);
    for (const link of reviewLinks) {
      expect(link.getAttribute("href")).toMatch(
        /^\/organizations\/org_template_routes\/templates\//u,
      );
    }
    expect(
      screen.queryByRole("heading", { name: "Notes API walkthrough" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="local-org"]')).toBeNull();

    const firstReviewLink = reviewLinks[0];
    if (firstReviewLink === undefined) {
      throw new Error("Expected a verified template review link.");
    }
    fireEvent.click(firstReviewLink);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Image upload with asynchronous processing",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to templates" }),
    ).toHaveAttribute("href", "/organizations/org_template_routes/templates");
    expect(
      screen.getByRole("link", { name: "Create project from template" }),
    ).toHaveAttribute(
      "href",
      "/organizations/org_template_routes/projects/new?template=image-upload-processing",
    );
    expect(
      screen.queryByRole("link", { name: "Open template in editor" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="local-org"]')).toBeNull();
    fireEvent.click(
      screen.getByRole("link", { name: "Create project from template" }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Create a project",
      }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: /^Project name/u })).toHaveValue(
      "Image upload with asynchronous processing",
    );
  });

  it("keeps organization-less authenticated routes out of tenant navigation", async () => {
    const request = vi.fn((operation: string) =>
      operation === "principal.get"
        ? Promise.resolve({
            data: {
              displayName: "Morgan Account",
              email: "morgan.account@example.com",
              id: "principal_without_org",
              organizationContexts: [],
              resourceVersion: 1,
            },
          })
        : Promise.reject(new Error("Unexpected operation")),
    );
    const client = {
      request,
      requestWithMetadata: vi.fn((operation: string) =>
        operation === "account.profile.get"
          ? Promise.resolve({
              data: {
                apiVersion: "v1",
                data: {
                  contractVersion: 1,
                  principalId: "principal_without_org",
                  displayName: "Morgan Account",
                  username: null,
                  version: 1,
                },
              },
              metadata: { etag: '"profile-fixture:1"' },
            })
          : Promise.reject(new Error("Unexpected operation")),
      ),
    } as unknown as CloudMarkupClient;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setViewport(1440);
    window.history.replaceState(null, "", "/settings/profile");

    render(
      <CloudMarkupQueryProvider client={client} queryClient={queryClient}>
        <App />
      </CloudMarkupQueryProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Profile settings",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Account workspace")).toBeVisible();
    expect(screen.getByText("Verified account")).toBeVisible();
    expect(screen.getByText("morgan.account@example.com")).toBeVisible();
    expect(
      screen.queryByText("Personal settings placeholder"),
    ).not.toBeInTheDocument();
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(navigation).queryByRole("link", { name: "Projects" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open authenticated account" }),
    );
    const account = await screen.findByRole("dialog", {
      name: "Authenticated account",
    });
    const signOut = within(account).getByRole("button", { name: "Sign out" });
    expect(signOut).toBeEnabled();
    expect(
      document.querySelector('a[href*="/organizations/unavailable"]'),
    ).toBeNull();

    fireEvent.click(signOut);
    expect(
      await screen.findByText("Sign out could not be completed"),
    ).toBeVisible();
    expect(
      await screen.findByText(
        "The browser session was not redirected to Cognito logout.",
      ),
    ).toBeVisible();
  });

  it("moves focus and announces the next route after in-app navigation", async () => {
    await renderRoute("/organizations/local-org/projects");

    fireEvent.click(screen.getByRole("link", { name: "Templates" }));

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Templates",
    });
    expect(heading).toHaveFocus();
    expect(document.title).toBe("Templates");
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent.includes("Viewing Templates")),
    ).toBe(true);
  });
});

describe("shell behavior and presentation modes", () => {
  it("compacts the top bar before changing the desktop workspace posture", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1280,
    );
    expect(
      screen.getByRole("separator", { name: "Resize service catalog" }),
    ).toBeInTheDocument();

    const statusButton = screen.getByRole("link", {
      name: "Skip to workspace status",
    });
    statusButton.focus();
    fireEvent.click(statusButton);
    const statusDrawer = screen.getByRole("dialog", {
      name: "Project status",
    });
    expect(statusDrawer).not.toHaveAttribute("aria-modal");
    expect(statusDrawer).toHaveTextContent(
      "Open Issues for availability and current report status",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Project status" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(statusButton).toHaveFocus();
    });

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Skip links" })).getByRole(
        "link",
        { name: "Skip to workspace status" },
      ),
    );
    expect(
      screen.getByRole("dialog", { name: "Project status" }),
    ).toBeInTheDocument();
  });

  beforeEach(() => {
    window.localStorage.clear();
    setOnlineStatus(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("provides landmark navigation, a skip link, and a labeled mock identity", async () => {
    await renderRoute("/organizations/local-org/projects");

    const skipNavigation = screen.getByRole("navigation", {
      name: "Skip links",
    });
    expect(
      within(skipNavigation).getByRole("link", {
        name: "Skip to main content",
      }),
    ).toHaveAttribute("href", "#main-content");
    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(
      screen.getByRole("region", { name: "Workspace status" }),
    ).toHaveAttribute("id", "workspace-status");
    expect(
      screen.getByRole("button", { name: "Open local mock account" }),
    ).toHaveTextContent("Local mock - not verified");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("starts with the Catalog open and compact popup launchers closed in both modes", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1440,
    );

    const editor = document.querySelector<HTMLElement>(".architecture-editor");
    if (editor === null) {
      throw new Error("The architecture editor did not render.");
    }
    const contentHash = editor.dataset["contentHash"];
    const visualHash = editor.dataset["visualHash"];

    expect(
      screen.getByRole("button", { name: "Hide Catalog" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("separator", { name: "Resize service catalog" }),
    ).toHaveAttribute("aria-valuenow", "300");
    const inspectorTools = screen.getByRole("navigation", {
      name: "Inspector tools",
    });
    const workspaceTools = screen.getByRole("navigation", {
      name: "Workspace tools",
    });
    for (const name of ["Architecture", "Configure", "Connect", "Learn"]) {
      expect(
        within(inspectorTools).getByRole("button", { name }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    for (const name of ["Assistant", "Issues", "Code", "Activity"]) {
      expect(
        within(workspaceTools).getByRole("button", { name }),
      ).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).toHaveAttribute(
      "data-workspace-open",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Professional" }));

    expect(editor).toHaveAttribute("data-content-hash", contentHash);
    expect(editor).toHaveAttribute("data-visual-hash", visualHash);
    expect(
      within(inspectorTools).getByRole("button", { name: "Configure" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(workspaceTools).getByRole("button", { name: "Issues" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("switches mode without implying an architecture change", async () => {
    await renderRoute("/settings/preferences");

    const preferenceCard = screen
      .getByRole("heading", { name: "Appearance and guidance" })
      .closest("section");
    expect(preferenceCard).not.toBeNull();
    if (preferenceCard === null) {
      throw new Error("The preference card was not rendered.");
    }
    expect(
      within(preferenceCard).getByRole("link", { name: "Open project start" }),
    ).toHaveAttribute("href", "/organizations/local-org/projects");
    expect(
      within(preferenceCard).getByRole("button", {
        name: "Restart first-use setup",
      }),
    ).toBeEnabled();
    expect(
      within(preferenceCard).getByRole("button", {
        name: "Restart notes API walkthrough",
      }),
    ).toBeEnabled();
    expect(
      within(preferenceCard).getByText("Notes API walkthrough"),
    ).not.toBeVisible();
    fireEvent.click(
      within(preferenceCard).getByText("Local preview preferences"),
    );
    expect(
      within(preferenceCard).getByText("Notes API walkthrough"),
    ).toBeVisible();
    fireEvent.click(
      within(preferenceCard).getByRole("button", { name: "Professional" }),
    );

    expect(document.documentElement).toHaveAttribute(
      "data-mode",
      "professional",
    );
    expect(
      screen.getByText(
        "Professional presentation enabled. Architecture data did not change.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open local mock account" }),
    );
    const account = await screen.findByRole("dialog", {
      name: "Local mock account",
    });
    fireEvent.click(
      within(account).getByRole("button", { name: "Notifications (1)" }),
    );
    const notifications = await screen.findByRole("dialog", {
      name: "Notifications",
    });
    expect(
      within(notifications).getByText("Professional presentation enabled"),
    ).toBeVisible();
    expect(
      within(notifications).getByText(
        /architecture data and editing capabilities did not change/iu,
      ),
    ).toBeVisible();
  });

  it("supports keyboard resizing and collapsing for the desktop Catalog", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1440,
    );

    const catalogResizer = screen.getByRole("separator", {
      name: "Resize service catalog",
    });
    expect(catalogResizer).toHaveAttribute("aria-valuenow", "300");
    expect(catalogResizer).toHaveAttribute("aria-valuemin", "224");
    expect(catalogResizer).toHaveAttribute("aria-valuemax", "1004");
    fireEvent.keyDown(catalogResizer, { key: "ArrowRight" });
    expect(catalogResizer).toHaveAttribute("aria-valuenow", "308");
    fireEvent.keyDown(catalogResizer, {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(catalogResizer).toHaveAttribute("aria-valuenow", "340");
    fireEvent.keyDown(catalogResizer, { key: "Home" });
    expect(catalogResizer).toHaveAttribute("aria-valuenow", "224");
    fireEvent.keyDown(catalogResizer, { key: "End" });
    expect(catalogResizer).toHaveAttribute("aria-valuenow", "1004");

    expect(
      document.querySelector(".cm-resize-handle summary"),
    ).not.toBeInTheDocument();

    const hideCatalog = screen.getByRole("button", { name: "Hide Catalog" });
    hideCatalog.focus();
    fireEvent.click(hideCatalog);
    expect(
      screen.getByRole("button", { name: "Show Catalog" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Show Catalog" })).toHaveFocus();
    expect(
      screen.queryByRole("heading", { name: "Catalog unavailable" }),
    ).not.toBeInTheDocument();
  });

  it("switches one desktop popup at a time and restores focus after Escape", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1440,
    );

    const editor = document.querySelector<HTMLElement>(".architecture-editor");
    if (editor === null) {
      throw new Error("The architecture editor did not render.");
    }
    const contentHash = editor.dataset["contentHash"];
    const visualHash = editor.dataset["visualHash"];
    const inspectorTools = screen.getByRole("navigation", {
      name: "Inspector tools",
    });
    const workspaceTools = screen.getByRole("navigation", {
      name: "Workspace tools",
    });
    const configureButton = within(inspectorTools).getByRole("button", {
      name: "Configure",
    });
    configureButton.focus();
    fireEvent.click(configureButton);
    expect(
      await screen.findByRole("dialog", { name: "Configure inspector" }),
    ).toBeInTheDocument();

    const issuesButton = within(workspaceTools).getByRole("button", {
      name: "Issues",
    });
    issuesButton.focus();
    fireEvent.click(issuesButton);
    expect(
      await screen.findByRole("dialog", { name: "Issues workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Configure inspector" }),
    ).not.toBeInTheDocument();

    const activityButton = within(workspaceTools).getByRole("button", {
      name: "Activity",
    });
    activityButton.focus();
    fireEvent.click(activityButton);
    expect(
      await screen.findByRole("dialog", { name: "Activity workspace" }),
    ).toHaveTextContent("This editing session");
    expect(
      screen.queryByRole("dialog", { name: "Issues workspace" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(editor).toHaveAttribute("data-content-hash", contentHash);
    expect(editor).toHaveAttribute("data-visual-hash", visualHash);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Activity workspace" }),
      ).not.toBeInTheDocument();
      expect(activityButton).toHaveFocus();
    });
  });

  it("opens a modeless tablet catalog drawer and restores focus after Escape", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    const catalogButton = screen.getByRole("button", { name: "Catalog" });
    catalogButton.focus();
    fireEvent.click(catalogButton);

    const drawer = screen.getByRole("dialog", { name: "Service catalog" });
    expect(drawer).not.toHaveAttribute("aria-modal");
    expect(
      screen.getByRole("heading", { name: "Service catalog" }),
    ).toHaveFocus();

    screen.getByRole("main").focus();
    expect(screen.getByRole("main")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Service catalog" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(catalogButton).toHaveFocus();
    });
  });

  it("does not replace a drawer's invoker when another trigger is only focused", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    const catalogButton = screen.getByRole("button", { name: "Catalog" });
    catalogButton.focus();
    fireEvent.click(catalogButton);

    screen.getByRole("button", { name: "Open local mock account" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(catalogButton).toHaveFocus();
    });
  });

  it("converts the Catalog and retains the Inspector popup across a desktop transition", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    fireEvent.click(screen.getByRole("button", { name: "Catalog" }));
    expect(
      screen.getByRole("dialog", { name: "Service catalog" }),
    ).toBeInTheDocument();

    setViewport(1440);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Service catalog" }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Service catalog region")).toHaveFocus();
    });

    setViewport(900);
    expect(
      screen.queryByRole("dialog", { name: "Service catalog" }),
    ).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Inspector" }));
    expect(
      await screen.findByRole("dialog", { name: "Configure inspector" }),
    ).toBeInTheDocument();

    setViewport(1440);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Configure inspector" }),
      ).not.toHaveAttribute("aria-modal");
      expect(
        within(
          screen.getByRole("navigation", { name: "Inspector tools" }),
        ).getByRole("button", { name: "Configure" }),
      ).toHaveAttribute("aria-expanded", "true");
    });
  });

  it("moves an unactivated tablet panel trigger to its desktop region", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    screen.getByRole("button", { name: "Catalog" }).focus();
    setViewport(1440);

    await waitFor(() => {
      expect(screen.getByLabelText("Service catalog region")).toHaveFocus();
    });
  });

  it("moves the responsive application-menu trigger to desktop navigation", async () => {
    await renderRoute("/organizations/local-org/projects", 900);

    screen.getByRole("button", { name: "Open application navigation" }).focus();
    setViewport(1440);

    await waitFor(() => {
      expect(
        within(
          screen.getByRole("navigation", { name: "Primary navigation" }),
        ).getByRole("link", { name: "Projects" }),
      ).toHaveFocus();
    });
  });

  it("preserves standard navigation context across responsive posture changes", async () => {
    await renderRoute("/organizations/local-org/projects", 1440);

    const navigationResizeHandle = screen.getByRole("separator", {
      name: "Resize application navigation",
    });
    expect(navigationResizeHandle).toHaveAttribute("aria-valuenow", "264");
    expect(navigationResizeHandle).toHaveAttribute("aria-valuemin", "208");
    expect(navigationResizeHandle).toHaveAttribute("aria-valuemax", "320");
    navigationResizeHandle.focus();
    setViewport(900);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Application navigation" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Application navigation" }),
      ).toHaveFocus();
    });

    setViewport(1440);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Application navigation" }),
      ).not.toBeInTheDocument();
      expect(
        within(
          screen.getByRole("navigation", { name: "Primary navigation" }),
        ).getByRole("link", { name: "Projects" }),
      ).toHaveFocus();
    });
  });

  it("opens the focused desktop region after switching to a review posture", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1440,
    );

    const catalogToggle = screen.getByRole("button", {
      name: "Hide Catalog",
    });
    catalogToggle.focus();
    setViewport(900);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Service catalog" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Service catalog" }),
      ).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Catalog" })).toHaveFocus();
    });
  });

  it("preserves a resize control's panel context across a review-layout transition", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1440,
    );

    const catalogResizeHandle = screen.getByRole("separator", {
      name: "Resize service catalog",
    });
    catalogResizeHandle.focus();
    setViewport(900);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Service catalog" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Service catalog" }),
      ).toHaveFocus();
    });
  });

  it("refreshes focus and restoration when switching tablet drawers", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    const catalogButton = screen.getByRole("button", { name: "Catalog" });
    catalogButton.focus();
    fireEvent.click(catalogButton);
    expect(
      screen.getByRole("heading", { name: "Service catalog" }),
    ).toHaveFocus();

    const inspectorButton = screen.getByRole("button", { name: "Inspector" });
    inspectorButton.focus();
    fireEvent.click(inspectorButton);

    const inspectorDialog = await screen.findByRole("dialog", {
      name: "Configure inspector",
    });
    // Opening the drawer focuses its heading, then the requested inspector
    // destination. Both are valid, and focus must stay in the active dialog.
    await waitFor(() => {
      expect(inspectorDialog.contains(document.activeElement)).toBe(true);
    });
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(inspectorButton).toHaveFocus();
    });
  });

  it("preserves workspace focus across the tablet-to-phone breakpoint", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    screen.getByRole("button", { name: "Workspace" }).focus();
    setViewport(700);

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Issues workspace" }),
      ).toHaveAttribute("aria-modal", "true");
      expect(
        screen.getByRole("heading", { name: "Issues workspace" }),
      ).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Issues" })).toHaveFocus();
    });
  });

  it("keeps responsive editor skip destinations and inspector tabs operable", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      900,
    );

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Skip links" })).getByRole(
        "link",
        { name: "Skip to catalog" },
      ),
    );
    expect(
      screen.getByRole("dialog", { name: "Service catalog" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    const inspectorButton = screen.getByRole("button", { name: "Inspector" });
    fireEvent.click(inspectorButton);
    const inspector = await screen.findByRole("dialog", {
      name: "Configure inspector",
    });
    fireEvent.click(within(inspector).getByRole("tab", { name: "Learn" }));
    expect(
      within(inspector).getByRole("tab", { name: "Learn" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("dialog", { name: "Learn inspector" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(inspectorButton);
    expect(
      within(screen.getByRole("dialog", { name: "Learn inspector" })).getByRole(
        "tab",
        { name: "Learn" },
      ),
    ).toHaveAttribute("aria-selected", "true");

    const openArchitectureList = () => {
      const canvasButton = screen.getByRole("button", {
        name: "Open Canvas menu",
      });
      expect(canvasButton).toHaveAttribute("aria-haspopup", "dialog");
      fireEvent.click(canvasButton);
      const canvasMenu = screen.getByRole("dialog", {
        name: "Canvas actions",
      });
      const architectureListButton = within(canvasMenu).getByRole("button", {
        name: /Architecture list/u,
      });
      fireEvent.click(architectureListButton);
    };

    openArchitectureList();

    const architectureList = document.getElementById("architecture-list");
    if (architectureList === null) {
      throw new Error(
        "The focusable responsive Architecture list did not render.",
      );
    }
    expect(
      screen.getByRole("dialog", { name: "Architecture inspector" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(architectureList).toHaveFocus();
    });

    openArchitectureList();
    await waitFor(() => {
      expect(architectureList).toHaveFocus();
    });
  });

  it("uses the review-first architecture list and bottom navigation on phone", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      375,
    );

    expect(
      screen.getByRole("heading", { name: "Architecture list" }),
    ).toBeInTheDocument();
    const phoneNavigation = screen.getByRole("navigation", {
      name: "Phone workspace navigation",
    });
    expect(
      within(phoneNavigation).getByRole("link", { name: "Architecture" }),
    ).toBeInTheDocument();
    expect(
      within(phoneNavigation).getByRole("button", { name: "Issues" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Resize service catalog" }),
    ).not.toBeInTheDocument();
    expect(
      within(phoneNavigation).getByRole("button", { name: "Catalog" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Inspector" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Workspace" }),
    ).not.toBeInTheDocument();

    expect(document.querySelectorAll("#architecture-list")).toHaveLength(1);
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Skip links" })).getByRole(
        "link",
        { name: "Skip to inspector" },
      ),
    );
    const phoneInspector = await screen.findByRole("dialog", {
      name: "Configure inspector",
    });
    expect(document.querySelectorAll("#architecture-list")).toHaveLength(1);
    expect(
      within(phoneInspector).queryByRole("region", {
        name: "Architecture list",
      }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(
      within(phoneNavigation).getByRole("button", { name: "Activity" }),
    );
    const workspaceSheet = await screen.findByRole("dialog", {
      name: "Activity workspace",
    });
    expect(workspaceSheet).toHaveAttribute("aria-modal", "true");
    expect(workspaceSheet).toHaveTextContent("This editing session");
  });

  it("keeps project context without redundant status in the desktop header", async () => {
    await renderRoute(
      "/organizations/local-org/projects/field-notes/editor",
      1920,
    );
    const bar = screen.getByRole("banner", { name: "Application header" });
    expect(bar).toHaveTextContent("Northstar Sandbox");
    expect(bar).toHaveTextContent("Field notes API");
    expect(
      within(bar).queryByRole("button", { name: "Project status" }),
    ).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole("button", { name: /Switch to .* mode/u }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("link", { name: "Skip to workspace status" }),
    );
    const status = screen.getByRole("dialog", { name: "Project status" });
    expect(status).toHaveTextContent("EnvironmentUnknown");
    expect(status).toHaveTextContent("Backend unavailable");
  });

  it("resets popup presentation state without changing architecture", async () => {
    setViewport(1440, 600);
    window.history.replaceState(
      null,
      "",
      "/organizations/local-org/projects/field-notes/editor",
    );
    render(<App />);

    const editor = document.querySelector<HTMLElement>(".architecture-editor");
    if (editor === null) {
      throw new Error("The architecture editor did not render.");
    }
    const contentHash = editor.dataset["contentHash"];
    const visualHash = editor.dataset["visualHash"];
    const inspectorTools = screen.getByRole("navigation", {
      name: "Inspector tools",
    });
    const workspaceTools = screen.getByRole("navigation", {
      name: "Workspace tools",
    });

    fireEvent.click(
      within(workspaceTools).getByRole("button", { name: "Activity" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Activity workspace" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(inspectorTools).getByRole("button", { name: "Learn" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Learn inspector" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide Catalog" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open local mock account" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Reset workspace layout" }),
    );

    expect(
      screen.getByRole("separator", { name: "Resize service catalog" }),
    ).toHaveAttribute("aria-valuenow", "300");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-shell")).toHaveAttribute(
      "data-workspace-open",
      "false",
    );
    expect(
      within(inspectorTools).getByRole("button", { name: "Configure" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      within(workspaceTools).getByRole("button", { name: "Issues" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(editor).toHaveAttribute("data-content-hash", contentHash);
    expect(editor).toHaveAttribute("data-visual-hash", visualHash);

    expect(
      screen.getByText(
        "Workspace layout reset. Architecture data was not changed.",
      ),
    ).toBeInTheDocument();
  });
});

describe("truthful shell states", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOnlineStatus(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows stale and empty states without claiming server freshness", async () => {
    await renderRoute("/organizations/local-org/projects");

    expect(
      screen.getByRole("heading", {
        name: "Project status is not server-authoritative",
      }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search project previews" }),
      { target: { value: "does not exist" } },
    );

    expect(
      screen.getByRole("heading", {
        name: /no local project preview matches/iu,
      }),
    ).toBeInTheDocument();
  });

  it("shows a durable offline state", async () => {
    setOnlineStatus(false);
    await renderRoute("/organizations/local-org/projects");

    expect(screen.getByText("Offline.")).toBeVisible();
    expect(
      screen.getByText(/server freshness and save status remain unavailable/iu),
    ).toBeVisible();
  });

  it("renders loading and safe callback error states", async () => {
    await renderRoute("/auth/callback");
    expect(
      screen.getByRole("heading", {
        name: "Waiting for a configured identity provider",
      }),
    ).toBeInTheDocument();

    cleanup();
    await renderRoute("/auth/callback?error=provider");
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was changed");
  });

  it("keeps unresolved organization policy controls unavailable", async () => {
    await renderRoute("/organizations/local-org/settings/policies");

    expect(
      screen.getByText(
        /role, policy, retention, export, and deletion contracts remain unresolved/iu,
      ),
    ).toBeVisible();
    const policyState = screen
      .getByText(
        /role, policy, retention, export, and deletion contracts remain unresolved/iu,
      )
      .closest("section");
    expect(policyState).not.toBeNull();
    if (policyState === null) {
      throw new Error("The policy state was not rendered.");
    }
    expect(
      within(policyState).queryByRole("button", {
        name: /save|change|delete/iu,
      }),
    ).not.toBeInTheDocument();
  });

  it("catches render failures without exposing raw error details", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    function BrokenRoute(): never {
      throw new Error("sensitive raw failure");
    }

    render(
      <AppErrorBoundary>
        <BrokenRoute />
      </AppErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("This view could not be rendered");
    expect(alert).toHaveTextContent(
      "This page cannot confirm whether an in-flight request or action completed",
    );
    expect(alert).toHaveTextContent(
      "Check the current project or account state before retrying",
    );
    expect(alert).not.toHaveTextContent("No backend request");
    expect(screen.queryByText("sensitive raw failure")).not.toBeInTheDocument();
    expect(document.title).toBe("Application error");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This view could not be rendered",
      }),
    ).toHaveFocus();
    consoleError.mockRestore();
  });
});
