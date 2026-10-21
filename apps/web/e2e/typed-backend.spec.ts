import { writeFile } from "node:fs/promises";
import {
  acquireProjectEditingLeaseV1Schema,
  apiErrorEnvelopeV1Schema,
  createProjectResponseV1Schema,
  createProjectV1Schema,
  createSolutionExportJobV1Schema,
  createSolutionRevisionV1Schema,
  draftArchitectureDocumentResponseV1Schema,
  projectEditingLeaseResponseV1Schema,
  saveDraftV1Schema,
  solutionRevisionListResponseV1Schema,
  solutionRevisionResponseV1Schema,
} from "@cloudmarkup/api-contract";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import axe from "axe-core";

import {
  TYPED_BACKEND_API_PREFIX,
  TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID,
  TYPED_BACKEND_NOTES_PROJECT_ID,
  TYPED_BACKEND_ORGANIZATION_ID,
  TypedBackendApiHarness,
  type TypedBackendPrincipalRole,
} from "./support/typed-backend-api-harness.js";

import {
  FIRST_IMPORT_COMMIT_SHA,
  installFirstImportGitHubReads,
} from "./support/first-import-github-reads.js";

test.skip(
  process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] !== "true",
  "Run the typed-backend browser scenarios with config/playwright/typed-backend.config.ts.",
);

const organizationRoot =
  `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}` as const;

function editorPath(projectId: string): string {
  return `${organizationRoot}/projects/${projectId}/editor`;
}

function projectPath(projectId: string): string {
  return `${organizationRoot}/projects/${projectId}`;
}

function revisionPath(projectId: string): string {
  return `${projectPath(projectId)}/revisions`;
}

async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "commit" });
}

async function installApi(
  context: BrowserContext,
  role: TypedBackendPrincipalRole = "owner",
): Promise<TypedBackendApiHarness> {
  const api = new TypedBackendApiHarness({ role });
  await api.install(context);
  return api;
}

async function waitForBackendEditor(
  page: Page,
  version?: number,
): Promise<void> {
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });
  const status = page
    .getByRole("status")
    .filter({ hasText: /Saved.*server draft version/u });
  await expect(status.first()).toBeVisible();
  if (version !== undefined) {
    await expect(status.first()).toContainText(
      `server draft version ${String(version)}`,
    );
  }
}

async function addService(
  page: Page,
  input: {
    readonly accessibleName: string;
    readonly expectedNodeId: string;
    readonly search: string;
  },
): Promise<void> {
  await page
    .getByRole("searchbox", { name: "Search services" })
    .fill(input.search);
  await page.getByRole("button", { name: input.accessibleName }).click();
  await expect(
    page.locator(
      `.architecture-editor [data-architecture-node-id="${input.expectedNodeId}"]`,
    ),
  ).toHaveCount(1);
}

async function addLambda(page: Page): Promise<void> {
  await addService(page, {
    accessibleName: "Drag or add Lambda function to canvas",
    expectedNodeId: "node_lambda_function",
    search: "bounded application workload",
  });
}

async function addHttpApi(page: Page): Promise<void> {
  await addService(page, {
    accessibleName: "Drag or add API Gateway HTTP API to canvas",
    expectedNodeId: "node_apigateway_http_api",
    search: "API Gateway HTTP API",
  });
}

async function expectSavedVersion(page: Page, version: number): Promise<void> {
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Saved.*server draft version/u })
      .first(),
  ).toContainText(`server draft version ${String(version)}`, {
    timeout: 15_000,
  });
}

async function expectAccessibleAccountPage(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const runtime = (globalThis as typeof globalThis & { axe: typeof axe }).axe;
    const result = await runtime.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    }));
  });
  expect(violations).toEqual([]);
}

test("recovers an early example-catalog project by creating an AWS canvas with Lambda", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  api.seedLegacyExampleCatalog(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID);
  await goto(page, editorPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID));
  await waitForBackendEditor(page, 1);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    page.getByText("This project uses the early example catalog"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create an AWS project" }).click();
  await page
    .getByRole("textbox", { name: "Project name" })
    .fill("AWS service recovery");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await waitForBackendEditor(page, 1);
  await expect(
    page.getByText("This project uses the early example catalog"),
  ).toHaveCount(0);
  await addLambda(page);
  await expectSavedVersion(page, 2);
  expect(
    api.requests.filter(
      (r) =>
        r.method === "PUT" &&
        r.path.includes(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID),
    ),
  ).toEqual([]);
});

test("builds networking from the catalog with required setup and parent choices", async ({
  context,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID));
  await waitForBackendEditor(page);
  await page
    .getByTestId("guided-walkthrough")
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "Search services" });
  for (const name of ["AWS Region", "Virtual private cloud"]) {
    await search.fill(name);
    await page
      .getByRole("button", { name: `Add ${name} to canvas`, exact: true })
      .click();
  }
  await search.fill("Availability Zone");
  await page
    .getByRole("button", {
      name: "Set up Availability Zone",
      exact: true,
    })
    .click();
  const zone = page.getByRole("dialog", {
    name: "Set up Availability Zone",
    exact: true,
  });
  await zone
    .getByRole("button", { name: "Add to canvas", exact: true })
    .click();
  await expect(zone.getByRole("alert")).toBeVisible();
  await zone
    .getByRole("textbox", { name: "Availability Zone name" })
    .fill("us-east-1a");
  await expectAccessibleAccountPage(page);
  await zone
    .getByRole("button", { name: "Add to canvas", exact: true })
    .click();
  await expect(zone).toHaveCount(0);
  await search.fill("Subnet");
  await page
    .getByRole("button", { name: "Add Subnet to canvas", exact: true })
    .click();
  await search.fill("NAT gateway");
  await page
    .getByRole("button", { name: "Set up NAT gateway", exact: true })
    .click();
  const nat = page.getByRole("dialog", {
    name: "Set up NAT gateway",
    exact: true,
  });
  await nat
    .getByRole("textbox", { name: "Elastic IP allocation ID" })
    .fill("eipalloc-0123456789abcdef0");
  await expectAccessibleAccountPage(page);
  await page.screenshot({
    path: testInfo.outputPath("service-setup.png"),
    fullPage: true,
  });
  await nat.getByRole("button", { name: "Add to canvas", exact: true }).click();
  await expect(nat).toHaveCount(0);
  await expect(
    page.locator(
      '.architecture-editor [data-architecture-node-id="node_ec2_nat_gateway"]',
    ),
  ).toHaveCount(1);
  await search.fill("VPC");
  await page
    .getByRole("button", {
      name: "Add Virtual private cloud to canvas",
      exact: true,
    })
    .click();
  await search.fill("Availability Zone");
  await page
    .getByRole("button", {
      name: "Set up Availability Zone",
      exact: true,
    })
    .click();
  await zone
    .getByRole("combobox", { name: "Add inside" })
    .selectOption("node_ec2_vpc_2");
  await zone
    .getByRole("textbox", { name: "Availability Zone name" })
    .fill("us-east-1b");
  await zone
    .getByRole("button", { name: "Add to canvas", exact: true })
    .click();
  await expect(zone).toHaveCount(0);
  await expect(
    page.locator(
      '.architecture-editor [data-architecture-node-id="node_ec2_availability_zone_2"]',
    ),
  ).toHaveCount(1);
});

for (const width of [1440, 390]) {
  test(`introduces real project menus with a dismissible editor tour at ${String(width)} pixels`, async ({
    context,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await installApi(context);
    await goto(page, editorPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID));
    await waitForBackendEditor(page);
    const editor = page.locator(".architecture-editor");
    const originalHash = await editor.getAttribute("data-content-hash");
    const tour = page.getByTestId("guided-walkthrough");
    await expect(tour).toContainText("A quick tour");
    await expect(
      tour.getByRole("heading", { name: "Your backend starts here" }),
    ).toBeVisible();
    await expectAccessibleAccountPage(page);
    await page.screenshot({
      path: testInfo.outputPath("editor-tour-start.png"),
      fullPage: true,
    });
    await tour.getByRole("button", { name: "Show me" }).click();
    if (width === 390) {
      await expect(
        page.getByRole("dialog", { name: "Service catalog" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Service catalog", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("searchbox", { name: "Search services" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    } else {
      await expect(
        page.getByRole("searchbox", { name: "Search services" }),
      ).toBeFocused();
    }
    for (const [title, surface] of [
      ["Make each service your own", "Configure inspector"],
      ["A little help, right where you need it", "Learn inspector"],
      ["Connect the pieces", "Connect inspector"],
      ["Get help from AI", "Assistant workspace"],
      ["Catch issues early", "Issues workspace"],
      ["Save a milestone", "Create Solution Revision"],
      ["Already have infrastructure code?", "Code workspace"],
      ["Take your backend with you", "Project status"],
    ] as const) {
      const next = tour.getByRole("button", { name: "Next", exact: true });
      await next.focus();
      await page.keyboard.press("Enter");
      await expect(
        tour.getByRole("heading", { name: title, exact: true }),
      ).toBeFocused();
      await expect(
        tour.getByRole("heading", { name: title, exact: true }),
      ).toBeInViewport();
      if (title === "Save a milestone") {
        const createRevision = page.getByRole("button", {
          name: surface,
          exact: true,
        });
        await expect(createRevision).toBeVisible();
        await expect(tour).toContainText("application header");
        await tour.getByRole("button", { name: "Show me" }).click();
        await expect(createRevision).toBeFocused();
      } else {
        await expect(
          page.getByRole("dialog", { name: surface, exact: true }),
        ).toBeVisible();
      }
      if (title === "Take your backend with you") {
        await tour.getByRole("button", { name: "Show me" }).click();
        const revisions = page
          .getByRole("dialog", { name: "Project status", exact: true })
          .getByRole("link", {
            name: "Revisions and exports",
            exact: true,
          });
        await expect(revisions).toHaveAttribute(
          "href",
          revisionPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID),
        );
        await expect(revisions).toBeFocused();
      }
      await expect(tour).toHaveCSS("animation-name", "none");
      await page.screenshot({
        path: testInfo.outputPath(
          "tour-step-" + String(await tour.getAttribute("data-step")) + ".png",
        ),
        fullPage: true,
      });
    }
    await expect(editor).toHaveAttribute(
      "data-content-hash",
      originalHash ?? "",
    );
    expect(
      api.requests.filter(
        (request) =>
          ["PUT", "PATCH"].includes(request.method) &&
          request.path.includes("/draft"),
      ),
    ).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await tour.getByRole("button", { name: "Complete walkthrough" }).click();
    await expect(tour).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Help and keyboard shortcuts",
        exact: true,
      }),
    ).toBeFocused();
    // Refresh drops the tab's in-memory lease proof. Model the old lease's
    // natural expiry before reopening; never grant a forced takeover.
    api.expireEditingLease(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID);
    await page.reload();
    await waitForBackendEditor(page);
    await expect(tour).toHaveCount(0);
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("searchbox").fill("restart editor tour");
    await palette.getByRole("button", { name: /Restart editor tour/u }).click();
    await expect(
      tour.getByRole("heading", { name: "Your backend starts here" }),
    ).toBeVisible();
    await tour.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(tour).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await palette.getByRole("searchbox").fill("import terraform");
    await palette
      .getByRole("button", { name: /Import Terraform or CloudFormation/u })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Code workspace", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await palette.getByRole("searchbox").fill("export cloudformation");
    await palette
      .getByRole("button", {
        name: /^Export infrastructure and diagrams/u,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Project status", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("dialog", { name: "Project status", exact: true })
        .getByRole("link", { name: "Revisions and exports", exact: true }),
    ).toHaveAttribute(
      "href",
      revisionPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID),
    );
    await page.keyboard.press("Escape");
    await expectAccessibleAccountPage(page);
  });
}

for (const width of [1440, 390]) {
  test(`keeps Organizations and preferences navigation available at ${String(width)} pixels`, async ({
    context,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await installApi(context);
    const organization = {
      createdAt: "2026-08-15T12:00:00.000Z",
      displayName: "Navigation engineering",
      id: TYPED_BACKEND_ORGANIZATION_ID,
      lifecycleStatus: "active",
      slug: "navigation-engineering",
      version: 1,
    };
    await context.route(
      /\/typed-backend-api\/v1\/account\/workspaces(?:\/org_local)?(?:\?.*)?$/u,
      async (route) => {
        const isList = new URL(route.request().url()).pathname.endsWith(
          "/workspaces",
        );
        const workspace = {
          contractVersion: 1,
          principalId: "principal_typed_backend_owner",
          id: organization.id,
          displayName: organization.displayName,
          kind: "organization",
          role: "owner",
        };
        await route.fulfill({
          status: 200,
          json: {
            apiVersion: "v1",
            data: isList ? [workspace] : workspace,
            ...(isList ? { page: { hasMore: false } } : {}),
          },
        });
      },
    );
    await context.route(
      /\/typed-backend-api\/v1\/organizations(?:\/org_local)?(?:\?.*)?$/u,
      async (route) => {
        const isList = new URL(route.request().url()).pathname.endsWith(
          "/organizations",
        );
        await route.fulfill({
          status: 200,
          headers: isList ? {} : { etag: '"org:org_local:1"' },
          json: {
            apiVersion: "v1",
            data: isList ? [organization] : organization,
            ...(isList ? { page: { hasMore: false } } : {}),
          },
        });
      },
    );
    await context.route(
      /\/typed-backend-api\/v1\/organizations\/org_local\/billing$/u,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: {
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              organizationId: TYPED_BACKEND_ORGANIZATION_ID,
              asOf: "2026-09-05T12:00:00.000Z",
              mode: "disabled",
              accountState: "unprovisioned",
              subscriptionState: "not-subscribed",
              currentPlanKey: null,
              canCheckout: false,
              canManage: false,
              plans: [
                {
                  key: "starter",
                  displayName: "Starter",
                  currency: "USD",
                  monthlyPriceMicros: "15000000",
                  monthlyCreditUnits: 100,
                },
                {
                  key: "pro",
                  displayName: "Professional",
                  currency: "USD",
                  monthlyPriceMicros: "49000000",
                  monthlyCreditUnits: 500,
                },
              ],
            },
          },
        });
      },
    );
    await goto(page, `${organizationRoot}/projects`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();
    const brand = page
      .getByRole("banner", { name: "Application header" })
      .locator('img[src="/app-icon-192.png"]');
    await expect(brand).toBeVisible();
    expect((await brand.boundingBox())?.width).toBe(36);
    expect((await brand.boundingBox())?.height).toBe(36);
    await expect
      .poll(() =>
        brand.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth === 192,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("projects.png"),
      fullPage: true,
    });
    await expect(
      page
        .getByRole("banner", { name: "Application header" })
        .getByText("Navigation engineering", { exact: true }),
    ).toHaveCount(1);
    const openNavigation = async () => {
      if (width < 1280) {
        await page
          .getByRole("button", { name: "Open application navigation" })
          .press("Enter");
        await expect(
          page.getByRole("dialog", { name: "Application navigation" }),
        ).toBeVisible();
      }
      return page.getByRole("navigation", { name: "Primary navigation" });
    };
    await (
      await openNavigation()
    )
      .getByRole("link", { name: "Organizations" })
      .press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Workspaces" }),
    ).toBeFocused();
    await expect(page).toHaveTitle("Workspaces");
    await expect(
      page.getByText(
        "Open your personal workspace or choose an organization to collaborate.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("organizations.png"),
      fullPage: true,
    });
    await expectAccessibleAccountPage(page);
    await page
      .getByRole("button", { name: "Open authenticated account" })
      .press("Enter");
    await page
      .getByRole("dialog", { name: "Authenticated account" })
      .getByRole("link", { name: "Preferences", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Experience preferences" }),
    ).toBeFocused();
    await expect(page).toHaveTitle("Experience preferences");
    await expect(
      page.getByRole("link", { name: "Choose an organization" }),
    ).toHaveAttribute("href", "/organizations");
    await expect(
      page.getByRole("button", { name: "Project status" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("preferences.png"),
      fullPage: true,
    });
    await expectAccessibleAccountPage(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const settingsNavigation = await openNavigation();
    const preferencesLink = settingsNavigation.getByRole("link", {
      name: "Preferences",
      exact: true,
    });
    await expect(preferencesLink).toHaveAttribute("aria-current", "page");
    await preferencesLink.scrollIntoViewIfNeeded();
    await expect(preferencesLink).toBeInViewport({ ratio: 1 });
    await settingsNavigation
      .getByRole("link", { name: "Organizations", exact: true })
      .press("Enter");
    await page.getByRole("link", { name: "Open dashboard" }).press("Enter");
    const navigation = await openNavigation();
    await expect(
      navigation.getByRole("link", { name: "Projects" }),
    ).toHaveAttribute("href", `${organizationRoot}/projects`);
    if (width < 1280) {
      await page.screenshot({
        path: testInfo.outputPath("preferences-navigation.png"),
        fullPage: true,
      });
      const bounds = await navigation
        .getByRole("link", { name: "Projects" })
        .boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await navigation.getByRole("link", { name: "Projects" }).press("Enter");
    await expect(page).toHaveURL(`${organizationRoot}/projects`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeFocused();
    await (
      await openNavigation()
    )
      .getByRole("link", { name: "Billing" })
      .press("Enter");
    await expect(
      page.getByRole("group", { name: "Monthly plans" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Starter" }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("banner", { name: "Application header" })
        .getByText("Navigation engineering", { exact: true }),
    ).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath("billing.png"),
      fullPage: true,
    });
    await expectAccessibleAccountPage(page);
    expect(api.requests.some(({ method }) => method !== "GET")).toBe(false);
    await context.route(
      /\/typed-backend-api\/v1\/organizations\/org_local\/commercial\/credit-overview$/u,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: {
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              availableByKind: { monthly: 0, purchased: 0, other: 0 },
              nextExpiration: null,
              balance: {
                contractVersion: 1,
                organizationId: TYPED_BACKEND_ORGANIZATION_ID,
                asOf: "2026-09-05T12:00:00.000Z",
                activeGrantedCreditUnits: 0,
                availableCreditUnits: 0,
                compensatedCreditUnits: 0,
                debitAdjustmentCreditUnits: 0,
                exhausted: true,
                expiredCreditUnits: 0,
                netAdjustmentCreditUnits: 0,
                reservedCreditUnits: 0,
                settledCreditUnits: 0,
                totalGrantedCreditUnits: 0,
                unresolvedCreditUnits: 0,
              },
            },
          },
        });
      },
    );
    await (
      await openNavigation()
    )
      .getByRole("link", { name: "Usage", exact: true })
      .press("Enter");
    await expect(
      page.getByRole("heading", { name: "0 available credits" }),
    ).toBeVisible();
    await expect(page.getByText(/Not subscribed\./u)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("usage.png"),
      fullPage: true,
    });
    await expectAccessibleAccountPage(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(api.requests.some(({ method }) => method !== "GET")).toBe(false);
  });
}

test("connects organization GitHub through the original tab without authenticating the callback window", async ({
  context,
  page,
}, testInfo) => {
  await installApi(context);
  const state = "a".repeat(48);
  const receipt = "b".repeat(48);
  const intentId = "githublink_browser";
  const installation = {
    accountId: 123,
    accountLogin: "controlled-fixture",
    accountType: "User",
    createdAt: "2026-08-03T14:30:00.000Z",
    updatedAt: "2026-08-03T14:30:00.000Z",
    integrationId: "integration_browser",
    installationId: 456,
    organizationId: TYPED_BACKEND_ORGANIZATION_ID,
    permissions: {
      contents: "write",
      metadata: "read",
      pullRequests: "write",
      workflows: "none",
    },
    repositorySelection: "selected",
    status: "connected",
  };
  let linked = false;
  let completions = 0;
  await context.route(
    /\/typed-backend-api\/v1\/organizations\/org_local\/github-app-(?:installations|installation-link-intents|installation-link-completions)$/u,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/github-app-installations")) {
        await route.fulfill({
          status: 200,
          json: {
            apiVersion: "v1",
            data: linked ? [installation] : [],
            page: { hasMore: false },
          },
        });
      } else if (path.endsWith("/github-app-installation-link-intents")) {
        await route.fulfill({
          status: 201,
          json: {
            apiVersion: "v1",
            data: {
              intentId,
              state,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              installationUrl: `https://github.com/apps/cloudmarkup-example-beta/installations/new?state=${state}`,
            },
          },
        });
      } else {
        const body: unknown = JSON.parse(route.request().postData() ?? "null");
        expect(body).toEqual({
          contractVersion: 1,
          intentId,
          callbackReceipt: receipt,
        });
        linked = true;
        completions += 1;
        await route.fulfill({
          status: 201,
          json: { apiVersion: "v1", data: installation },
        });
      }
    },
  );
  await goto(page, `${organizationRoot}/settings/integrations`);
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(
    page.getByRole("link", { name: "Continue to GitHub" }),
  ).toHaveAttribute("target", "_blank");
  const callbackPage = await context.newPage();
  const callbackRequests: string[] = [];
  callbackPage.on("request", (request) => {
    if (request.url().includes("/typed-backend-api/"))
      callbackRequests.push(request.url());
  });
  try {
    await goto(
      callbackPage,
      `${organizationRoot}/settings/integrations#github_link_intent=${intentId}&github_link_receipt=${receipt}`,
    );
    await expect(
      callbackPage.getByRole("heading", {
        name: "GitHub connected in the original tab",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("controlled-fixture", { exact: true }),
    ).toBeVisible();
    expect(callbackRequests).toEqual([]);
    expect(completions).toBe(1);
    expect(new URL(callbackPage.url()).hash).toBe("");
    await page.screenshot({
      path: testInfo.outputPath("github-integrations-desktop.png"),
    });
  } finally {
    await callbackPage.close();
  }
});

test("keeps the authenticated editor header compact with accessible save details and touch targets", async ({
  context,
  page,
}, testInfo) => {
  const api = await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);

  const header = page.getByRole("banner", { name: "Application header" });
  const saveDetails = header.getByRole("button", {
    name: "Open save and recovery status",
  });
  const revision = header.getByRole("button", {
    name: "Create Solution Revision",
  });
  await expect(saveDetails).toContainText("Saved");
  await expect(revision).toHaveText("Create revision");
  await expect(header.getByRole("button", { name: "Save now" })).toHaveCount(0);
  await expect(
    header.getByRole("region", { name: "Project status summary" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Development fixture status" }),
  ).toHaveCount(0);

  for (const width of [2_000, 1_280]) {
    await page.setViewportSize({ width, height: 1_000 });
    const headerBox = await header.boundingBox();
    expect(headerBox?.height).toBeLessThanOrEqual(48);
    for (const button of await header.getByRole("button").all()) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(32);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("compact-desktop.png") });

  for (const width of [944, 787]) {
    await page.setViewportSize({ width, height: 757 });
    const brand = await header.locator(".brand-link").boundingBox();
    const actions = await header
      .locator(".top-app-bar__editor-actions")
      .boundingBox();
    expect(brand).not.toBeNull();
    expect(actions).not.toBeNull();
    if (brand === null || actions === null)
      throw Error("Expected responsive header rows");
    expect(actions.y).toBeGreaterThanOrEqual(brand.y + brand.height);
    expect(actions.x).toBeGreaterThanOrEqual(0);
    expect(actions.x + actions.width).toBeLessThanOrEqual(width);
    for (const button of await header.getByRole("button").all()) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
  }
  await page.setViewportSize({ width: 1_280, height: 1_000 });

  const writesBefore = api.requestCount(
    "PUT",
    `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
  );
  await saveDetails.click();
  const details = page.getByRole("dialog", {
    name: "Save and recovery status",
  });
  await expect(
    details.getByText("Server draft", { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByText("Local recovery", { exact: true }),
  ).toBeVisible();
  await expect(details.getByRole("button", { name: "Save now" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(saveDetails).toBeFocused();
  expect(
    api.requestCount(
      "PUT",
      `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
    ),
  ).toBe(writesBefore);

  await page.getByRole("link", { name: "Skip to workspace status" }).focus();
  await page.keyboard.press("Enter");
  const projectStatus = page.getByRole("dialog", { name: "Project status" });
  await expect(projectStatus).toContainText(TYPED_BACKEND_NOTES_PROJECT_ID);
  await expect(projectStatus).toContainText("Open organization Usage");
  await expect(projectStatus).not.toContainText(
    "No authorized project context",
  );
  await expect(projectStatus).not.toContainText("usage service not connected");
  await page.keyboard.press("Escape");
  await expect(projectStatus).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const control of [saveDetails, revision]) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("compact-phone.png") });
});

test("creates an authenticated project without tenant authority in the request body", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(page, `${organizationRoot}/projects/new`);

  await expect(
    page.getByRole("heading", { name: "Create a project" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("textbox", { name: "Project name" }).fill("Runbook API");
  await page
    .getByRole("textbox", { name: "Description (optional)" })
    .fill("Deterministic Prompt 26 browser fixture.");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(
    new RegExp(`${organizationRoot}/projects/project_created_3/editor$`, "u"),
  );
  await waitForBackendEditor(page, 1);
  const request = api.requests.find(
    (candidate) =>
      candidate.method === "POST" &&
      candidate.path ===
        `/v1/organizations/${TYPED_BACKEND_ORGANIZATION_ID}/projects`,
  );
  expect(request?.headers["idempotency-key"]).toMatch(/^project-create:/u);
  expect(request?.body).toEqual({
    creationMode: "blank",
    description: "Deterministic Prompt 26 browser fixture.",
    name: "Runbook API",
  });
  expect(request?.body).not.toMatchObject({
    organizationId: TYPED_BACKEND_ORGANIZATION_ID,
  });
});

test("reuses one project cache shape across the editor and project overview", async ({
  context,
  page,
}) => {
  await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);

  await page.getByRole("link", { name: "Dashboard home" }).click();
  await page.getByRole("link", { name: "View all", exact: true }).click();
  const projectCard = page
    .getByRole("listitem")
    .filter({ hasText: "Notes API" });
  await projectCard.getByRole("link", { name: "Open project" }).click();

  await expect(page).toHaveURL(projectPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await expect(
    page.getByRole("heading", { level: 1, name: "Notes API" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Open canvas" }).click();
  await expect(page).toHaveURL(editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);
});

test("saves before closing and reopens only the selected shared project", async ({
  context,
  page,
}, testInfo) => {
  const api = await installApi(context);
  let releaseSave!: () => void;
  let saveStarted = false;
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await context.route(
    /\/typed-backend-api\/v1\/projects\/[^/]+\/draft$/u,
    async (route) => {
      if (route.request().method() === "PUT") {
        saveStarted = true;
        await heldSave;
      }
      await route.fallback();
    },
  );
  try {
    await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await waitForBackendEditor(page, 1);
    await addLambda(page);
    await page
      .getByRole("button", { name: "Open save and recovery status" })
      .click();
    await page.getByRole("button", { name: "Close project" }).click();
    await expect.poll(() => saveStarted).toBe(true);
    await expect(
      page.getByRole("button", { name: "Saving and closing…" }),
    ).toBeDisabled();
    await expect(page).toHaveURL(editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    releaseSave();
    await expect(page).toHaveURL(`${organizationRoot}/projects`);
    await expect(page.locator(".architecture-editor")).toHaveCount(0);
    expect(
      api.requestCount(
        "PUT",
        `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
      ),
    ).toBe(1);
    const openProject = async (name: string) => {
      await page
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .getByRole("link", { name: "Open project" })
        .click();
      await page.getByRole("link", { name: "Open canvas" }).click();
    };
    await openProject("Infrastructure only");
    await waitForBackendEditor(page, 1);
    await expect(page.locator(".architecture-editor")).toHaveCount(1);
    await expect(
      page.locator(
        '.architecture-editor [data-architecture-node-id="node_lambda_function"]',
      ),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open save and recovery status" })
      .click();
    await page.getByRole("button", { name: "Close project" }).click();
    await expect(page).toHaveURL(`${organizationRoot}/projects`);
    expect(
      api.requestCount(
        "PUT",
        `/v1/projects/${TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID}/draft`,
      ),
    ).toBe(0);
    await openProject("Notes API");
    await waitForBackendEditor(page, 2);
    await expect(page.locator(".architecture-editor")).toHaveCount(1);
    await expect(
      page.locator(
        '.architecture-editor [data-architecture-node-id="node_lambda_function"]',
      ),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Open save and recovery status" })
      .click();
    await page.screenshot({
      path: testInfo.outputPath("project-save-close.png"),
      fullPage: true,
    });
  } finally {
    releaseSave();
  }
});

test("autosaves the atomic Architecture and Workload envelope and restores it after refresh", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);

  await addLambda(page);
  await expectSavedVersion(page, 2);

  const save = api.latestDraftSave(TYPED_BACKEND_NOTES_PROJECT_ID);
  expect(save?.headers["if-match"]).toBe('"draft:draft_notes:1"');
  expect(save?.body).toMatchObject({
    architectureDocument: {
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "node_lambda_function" }),
      ]),
      workloadBehavior: {
        contractVersion: 2,
        workloads: expect.arrayContaining([
          expect.objectContaining({ id: "workload_notes_api_handler" }),
        ]),
      },
    },
    contractVersion: 1,
  });

  const [heldLeaseResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          "/typed-backend-api/v1/projects/" +
            TYPED_BACKEND_NOTES_PROJECT_ID +
            "/editing-lease",
    ),
    page.reload({ waitUntil: "commit" }),
  ]);
  expect(heldLeaseResponse.status()).toBe(200);
  const heldLeaseEnvelope: unknown = await heldLeaseResponse.json();
  expect(heldLeaseEnvelope).toMatchObject({
    apiVersion: "v1",
    data: {
      contractVersion: 1,
      projectId: TYPED_BACKEND_NOTES_PROJECT_ID,
      state: "held",
    },
  });
  await expect(page.getByRole("button", { name: "Try editing" })).toBeVisible();
  api.expireEditingLease(TYPED_BACKEND_NOTES_PROJECT_ID);
  await page.getByRole("button", { name: "Try editing" }).click();
  await waitForBackendEditor(page, 2);
  await expect(
    page.locator(
      '.architecture-editor [data-architecture-node-id="node_lambda_function"]',
    ),
  ).toHaveCount(1);
});

test("preserves a paused stale tab as a copy after another editing session saves", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  const secondPage = await context.newPage();
  try {
    api.setDraftSaveFailure("offline");
    await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await waitForBackendEditor(page, 1);
    await addHttpApi(page);
    await expect(
      page.getByRole("status").filter({ hasText: "Offline recovery" }).first(),
    ).toBeVisible();
    api.expireEditingLease(TYPED_BACKEND_NOTES_PROJECT_ID);
    await page.evaluate(() => {
      const now = Date.now;
      Date.now = () => now() + 60_001;
      window.dispatchEvent(new Event("focus"));
      Date.now = now;
    });
    await expect(
      page.getByRole("region", { name: "Paused local recovery" }),
    ).toBeVisible();
    api.setDraftSaveFailure("none");
    await goto(secondPage, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await waitForBackendEditor(secondPage, 1);
    await addLambda(secondPage);
    await expectSavedVersion(secondPage, 2);
    await secondPage
      .getByRole("button", { name: "Open save and recovery status" })
      .click();
    await secondPage.getByRole("button", { name: "Close project" }).click();
    await expect(secondPage).toHaveURL(`${organizationRoot}/projects`);
    await page.getByRole("button", { name: "Try editing" }).click();
    const recovery = page.getByRole("region", {
      name: "Paused local recovery",
    });
    await expect(
      recovery.getByRole("button", { name: "Load latest saved draft" }),
    ).toBeVisible();
    await expect(page.locator(".architecture-editor")).toHaveCount(0);
    await recovery
      .getByText("Unsaved local resources", { exact: true })
      .click();
    await expect(
      recovery.getByText("API Gateway HTTP API", { exact: true }),
    ).toBeVisible();
    await recovery
      .getByRole("button", { name: "Save local changes as a copy" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${organizationRoot}/projects/project_created_3/editor$`, "u"),
    );
    await waitForBackendEditor(page, 1);
    await expect(
      page.locator(
        '.architecture-editor [data-architecture-node-id="node_apigateway_http_api"]',
      ),
    ).toHaveCount(1);

    const copyRequest = api.requests.find(
      (request) =>
        request.method === "POST" &&
        request.path ===
          `/v1/organizations/${TYPED_BACKEND_ORGANIZATION_ID}/projects` &&
        JSON.stringify(request.body).includes('"creationMode":"draft-copy"'),
    );
    expect(copyRequest?.body).toMatchObject({ creationMode: "draft-copy" });
  } finally {
    await secondPage.close();
  }
});

test("keeps failed saves in local recovery without silently overwriting the server", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  api.setDraftSaveFailure("offline");
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);

  await addLambda(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Offline recovery" }).first(),
  ).toBeVisible({ timeout: 15_000 });
  const failedSaveCount = api.requestCount(
    "PUT",
    `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
  );
  expect(failedSaveCount).toBe(1);

  api.setDraftSaveFailure("none");
  const [heldLeaseResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          "/typed-backend-api/v1/projects/" +
            TYPED_BACKEND_NOTES_PROJECT_ID +
            "/editing-lease",
    ),
    page.reload({ waitUntil: "commit" }),
  ]);
  expect(heldLeaseResponse.status()).toBe(200);
  const heldLeaseEnvelope: unknown = await heldLeaseResponse.json();
  expect(heldLeaseEnvelope).toMatchObject({
    apiVersion: "v1",
    data: {
      contractVersion: 1,
      projectId: TYPED_BACKEND_NOTES_PROJECT_ID,
      state: "held",
    },
  });
  await expect(page.getByRole("button", { name: "Try editing" })).toBeVisible();
  api.expireEditingLease(TYPED_BACKEND_NOTES_PROJECT_ID);
  await page.getByRole("button", { name: "Try editing" }).click();
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator(
      '.architecture-editor [data-architecture-node-id="node_lambda_function"]',
    ),
  ).toHaveCount(1);
  await page.waitForTimeout(1_000);
  expect(
    api.requestCount(
      "PUT",
      `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
    ),
  ).toBe(failedSaveCount);

  await page
    .getByRole("button", { name: "Open save and recovery status" })
    .click();
  await page.getByRole("button", { name: "Save now" }).click();
  await expectSavedVersion(page, 2);
});

test("creates exact Solution Revisions for workload and infrastructure-only projects and reads them without edit controls", async ({
  context,
  page,
}) => {
  await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);
  await page.getByRole("button", { name: "Create Solution Revision" }).click();

  const workloadCreated = page.getByRole("status").filter({
    hasText: "Immutable Solution Revision created",
  });
  await expect(workloadCreated).toContainText(
    "Application generation requires custom work",
    { timeout: 15_000 },
  );
  await workloadCreated
    .getByRole("link", { name: "Open read-only Solution Revision" })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "Technical revision details" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Frozen documents and contracts" }),
  ).toBeVisible();
  await expect(
    page.getByText("Workload Document", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save now", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create Solution Revision" }),
  ).toHaveCount(0);

  await goto(page, editorPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID));
  await waitForBackendEditor(page, 1);
  await page.getByRole("button", { name: "Create Solution Revision" }).click();
  const infrastructureCreated = page.getByRole("status").filter({
    hasText: "Immutable Solution Revision created",
  });
  await expect(infrastructureCreated).toContainText("Infrastructure only", {
    timeout: 15_000,
  });
  await infrastructureCreated
    .getByRole("link", { name: "Open read-only Solution Revision" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Infrastructure[- ]only/u }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This revision contains infrastructure only; no application workloads are included.",
      {
        exact: false,
      },
    ),
  ).toBeVisible();

  await goto(page, revisionPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID));
  await expect(
    page.getByRole("heading", { name: "Immutable Solution Revisions" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^Infrastructure[- ]only$/u)).toBeVisible();
});

test("gives viewers read-only access and rejects cross-tenant route selectors before project disclosure", async ({
  context,
  page,
}) => {
  const api = await installApi(context, "viewer");
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));

  await expect(page.getByText("Read-only project")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Notes API" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Solution Revision" }),
  ).toHaveCount(0);
  await expect(page.locator(".architecture-editor")).toHaveCount(0);

  await goto(page, projectPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await expect(page.getByRole("link", { name: "Review draft" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: "Archive project" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete project" }),
  ).toHaveCount(0);

  const projectReadsBefore = api.requestCount(
    "GET",
    `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}`,
  );
  await goto(page, "/organizations/org_other/projects/project_notes");
  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("Notes API", { exact: true })).toHaveCount(0);
  expect(
    api.requestCount("GET", `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}`),
  ).toBe(projectReadsBefore);
});

test("allows only one editing tab per shared project and reads the saved head after release", async ({
  context,
  page,
}, testInfo) => {
  const api = await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);
  await addLambda(page);
  await expectSavedVersion(page, 2);
  const second = await context.newPage();
  await goto(second, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await expect(second.getByText("Read-only project")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    second.getByRole("status").filter({
      hasText:
        "Editing access was reserved when last checked. If you just reloaded or closed another editor, wait briefly, then choose Try editing to check again.",
    }),
  ).toBeVisible();
  const observedReservation = second.getByText(
    /^Last observed reservation expiry:/u,
  );
  await expect(observedReservation).toBeVisible();
  await expect(observedReservation.locator("time")).toHaveAttribute(
    "datetime",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u,
  );
  await expect(
    second.getByRole("button", { name: "Try editing", exact: true }),
  ).toBeEnabled();
  await expect(second.locator(".architecture-editor")).toHaveCount(0);
  await second
    .getByText("Saved resources and connections", { exact: true })
    .click();
  await expect(second.getByText(/Lambda function ·/u)).toBeVisible();
  await expect(
    second.getByText("Semantic digest", { exact: true }),
  ).not.toBeVisible();
  await second.getByText("Saved draft details", { exact: true }).click();
  await expect(
    second.getByText("Semantic digest", { exact: true }),
  ).toBeVisible();
  await second.getByText("Saved draft details", { exact: true }).click();
  await expectAccessibleAccountPage(second);
  await second.screenshot({
    path: testInfo.outputPath("shared-project-held.png"),
    fullPage: true,
  });
  await second.setViewportSize({ width: 390, height: 844 });
  await expectAccessibleAccountPage(second);
  expect(
    await second
      .getByRole("button", { name: "Try editing" })
      .evaluate((button) => button.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await second.screenshot({
    path: testInfo.outputPath("shared-project-held-phone.png"),
    fullPage: true,
  });
  await second.setViewportSize({ width: 2000, height: 1000 });
  await page
    .getByRole("button", { name: "Open save and recovery status" })
    .click();
  await page.getByRole("button", { name: "Close project" }).click();
  await expect(page).toHaveURL(new RegExp(`${organizationRoot}/projects$`));
  await second.getByRole("button", { name: "Try editing" }).click();
  await waitForBackendEditor(second, 2);
  await expect(
    second.locator('[data-architecture-node-id="node_lambda_function"]'),
  ).toHaveCount(1);
  const acquisitions = api.requests.filter(
    (request) =>
      request.method === "POST" && request.path.endsWith("/editing-lease"),
  );
  const tokens = acquisitions.map(
    (request) => (request.body as { token: string }).token,
  );
  expect(new Set(tokens).size).toBeGreaterThanOrEqual(2);
  await second.close();
});

test("keeps unsaved work in a recovery-only view when editing access expires", async ({
  context,
  page,
}, testInfo) => {
  const api = await installApi(context);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);
  await addLambda(page);
  await page.evaluate(() => {
    const originalNow = Date.now;
    Date.now = () => originalNow() + 60_001;
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    page.getByRole("region", { name: "Paused local recovery" }),
  ).toBeVisible();
  await expect(page.locator(".architecture-editor")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download local recovery" }),
  ).toBeVisible();
  await page.getByText("Unsaved local resources", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Paused local recovery" })
      .getByText("Lambda function", { exact: true }),
  ).toBeVisible();
  await expectAccessibleAccountPage(page);
  await page.screenshot({
    path: testInfo.outputPath("shared-project-recovery.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessibleAccountPage(page);
  expect(
    await page
      .getByRole("button", { name: "Download local recovery" })
      .evaluate((button) => button.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("shared-project-recovery-phone.png"),
    fullPage: true,
  });
  const savesBefore = api.requests.filter(
    (request) => request.method === "PUT" && request.path.endsWith("/draft"),
  ).length;
  await page.waitForTimeout(850);
  expect(
    api.requests.filter(
      (request) => request.method === "PUT" && request.path.endsWith("/draft"),
    ),
  ).toHaveLength(savesBefore);
});

test("syncs presentation preferences across sessions, falls back offline, and never changes semantic hashes", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await waitForBackendEditor(page, 1);
  const editor = page.locator(".architecture-editor");
  const semanticHash = await editor.getAttribute("data-content-hash");
  if (semanticHash === null) {
    throw new Error("The editor did not expose its semantic hash.");
  }

  await page.getByRole("button", { name: "Professional" }).click();
  await expect(
    page.getByRole("button", { name: "Professional" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toHaveAttribute("data-content-hash", semanticHash);
  await expect
    .poll(() => api.requestCount("PUT", "/v1/me/presentation-preferences"))
    .toBe(1);
  expect(
    api.requestCount(
      "PUT",
      `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
    ),
  ).toBe(0);

  const secondPage = await context.newPage();
  try {
    // Presentation preferences span sessions; editing ownership does not.
    await page
      .getByRole("button", { name: "Open save and recovery status" })
      .click();
    await page.getByRole("button", { name: "Close project" }).click();
    await expect(page).toHaveURL(`${organizationRoot}/projects`);
    await goto(secondPage, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await waitForBackendEditor(secondPage, 1);
    await expect(
      secondPage.getByRole("button", { name: "Professional" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(secondPage.locator(".architecture-editor")).toHaveAttribute(
      "data-content-hash",
      semanticHash,
    );

    api.setPreferencesFailure("offline");
    await secondPage
      .getByRole("button", { name: "Open save and recovery status" })
      .click();
    await secondPage.getByRole("button", { name: "Close project" }).click();
    await expect(secondPage).toHaveURL(`${organizationRoot}/projects`);
    await goto(secondPage, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await expect(secondPage.locator(".architecture-editor")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      secondPage.getByRole("button", { name: "Professional" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(secondPage.locator(".architecture-editor")).toHaveAttribute(
      "data-content-hash",
      semanticHash,
    );
  } finally {
    await secondPage.close();
  }
});

test("shows typed sandbox plan and credit fixtures and handles session expiry with a stable error", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(page, `${organizationRoot}/billing`);
  const plans = page.getByRole("group", { name: "Monthly plans" });
  await expect(plans.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(plans.getByText("$9", { exact: true })).toBeVisible();
  await expect(
    plans.getByRole("heading", { name: "Professional" }),
  ).toBeVisible();
  await expect(
    plans.getByRole("button", { name: "Current plan" }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      /Sandbox Checkout and subscription management are still being connected/u,
    ),
  ).toBeVisible();

  await goto(page, `${organizationRoot}/usage`);
  await expect(
    page.getByRole("heading", { name: "175 available credits" }),
  ).toBeVisible();
  await expect(
    page.getByText("5 credits reserved for work in progress.", {
      exact: true,
    }),
  ).toBeVisible();

  api.expireSession();
  await page.reload({ waitUntil: "commit" });
  const expired = page.getByRole("alert");
  await expect(
    expired.getByRole("heading", { name: "Sign in to continue" }),
  ).toBeVisible();
  await expect(
    expired.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("requires confirmation for archive and delete and preserves a visible deletion tombstone", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(page, projectPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await expect(page.getByRole("heading", { name: "Notes API" })).toBeVisible();

  await page.getByText("Project settings", { exact: true }).click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Archive");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Archive project" }).click();
  expect(
    api.requestCount(
      "POST",
      `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/archive`,
    ),
  ).toBe(0);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Archive");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(
    page.locator('[aria-label="Project lifecycle summary"]'),
  ).toContainText("Archived");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(
      "Scheduled cleanup permanently removes retained project content.",
    );
    expect(dialog.message()).toContain("An audit record is retained.");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Delete project" }).click();
  const lifecycle = page.locator('[aria-label="Project lifecycle summary"]');
  await expect(lifecycle).toContainText("deletion-pending");
  await expect(
    page.getByRole("link", {
      name: /Open canvas|Current draft|Intent review/u,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Return to projects" }),
  ).toHaveAttribute("href", `${organizationRoot}/projects`);
  await expect(
    page.getByRole("button", { name: "Delete project" }),
  ).toHaveCount(0);
  expect(
    api.requestCount(
      "DELETE",
      `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}`,
    ),
  ).toBe(1);
  const readsBeforeClosedEditor = api.requestCount(
    "GET",
    `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
  );
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  await expect(
    page.getByRole("status").filter({ hasText: "Project closed" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".architecture-editor")).toHaveCount(0);
  expect(
    api.requestCount(
      "GET",
      `/v1/projects/${TYPED_BACKEND_NOTES_PROJECT_ID}/draft`,
    ),
  ).toBe(readsBeforeClosedEditor);
  await page.getByRole("link", { name: "Return to projects" }).click();
  await expect(page).toHaveURL(`${organizationRoot}/projects`);
});

for (const width of [1440, 390]) {
  test(`shows clear project starting points and import/export guidance at ${String(width)} pixels`, async ({
    context,
    page,
  }, testInfo) => {
    await installApi(context);
    await page.setViewportSize({ width, height: 960 });
    await goto(page, `${organizationRoot}/projects`);
    await expect(
      page.getByRole("heading", { name: "Where would you like to start?" }),
    ).toBeVisible({ timeout: 30_000 });
    const importStart = page.getByRole("link", {
      name: /Import existing code Review Terraform or CloudFormation from GitHub/u,
    });
    await expect(importStart).toHaveAttribute(
      "href",
      `${organizationRoot}/projects/new?start=import`,
    );
    await expect(
      page
        .locator(".project-card")
        .first()
        .getByRole("link", { name: "Open project" }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await page.screenshot({
      path: testInfo.outputPath("projects-entry.png"),
      fullPage: true,
    });
    await importStart.click();
    await expect(
      page.getByRole("radio", { name: /^Import existing code/u }),
    ).toBeChecked();
    await expect(
      page.getByText("Describe with AI", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^Describe with AI/u }),
    ).toBeEnabled();
    await expect(
      page.getByText(
        /Local file upload and automatic conversion into editable canvas resources are not available/u,
      ),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Project name", exact: true })
      .fill("Existing billing API");
    await expect(
      page.getByRole("button", { name: "Create project" }),
    ).toBeEnabled();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const runtime = (globalThis as typeof globalThis & { axe: typeof axe })
        .axe;
      return (
        await runtime.run(".project-setup", {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
          },
        })
      ).violations;
    });
    expect(violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("project-setup-import.png"),
      fullPage: true,
    });
    await goto(page, projectPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await expect(
      page.getByRole("link", { name: "Open canvas", exact: true }),
    ).toHaveAttribute("href", editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await expect(
      page.getByRole("link", { name: "Revisions and exports", exact: true }),
    ).toHaveAttribute("href", revisionPath(TYPED_BACKEND_NOTES_PROJECT_ID));
    await expect(
      page.getByText("Project settings", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete project" }),
    ).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await page.screenshot({
      path: testInfo.outputPath("project-overview.png"),
      fullPage: true,
    });
  });
}

// This covers the browser prerequisite, not GitHub retrieval or parser execution.
// Both starting points retain the full prerequisite; layout is checked at both widths above.
for (const [width, startingPoint] of [
  [1440, "blank"],
  [390, "import"],
] as const) {
  test(
    "confirms the first saved revision before enabling repository import from " +
      startingPoint +
      " at " +
      String(width) +
      " pixels",
    async ({ context, page }, testInfo) => {
      const api = await installApi(context);
      await installFirstImportGitHubReads(context);
      await page.setViewportSize({ width, height: 960 });
      const projectName = "First " + startingPoint + " project";
      await goto(
        page,
        organizationRoot +
          "/projects/new" +
          (startingPoint === "import" ? "?start=import" : ""),
      );
      await expect(
        page.getByRole("radio", {
          name:
            startingPoint === "blank"
              ? /^Blank canvas/u
              : /^Import existing code/u,
        }),
      ).toBeChecked();
      await page
        .getByRole("textbox", { name: "Project name", exact: true })
        .fill(projectName);
      const createdResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            TYPED_BACKEND_API_PREFIX +
              "/v1/organizations/" +
              TYPED_BACKEND_ORGANIZATION_ID +
              "/projects",
      );
      const initialDraftResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          /\/projects\/project_created_[0-9]+\/draft$/u.test(
            new URL(response.url()).pathname,
          ),
      );
      const leaseResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/projects\/project_created_[0-9]+\/editing-lease$/u.test(
            new URL(response.url()).pathname,
          ),
      );
      await page
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      const creation = await createdResponse;
      expect(creation.status()).toBe(201);
      expect(
        createProjectV1Schema.parse(creation.request().postDataJSON()),
      ).toEqual({
        creationMode: "blank",
        name: projectName,
      });
      const created = createProjectResponseV1Schema.parse(
        await creation.json(),
      ).data;
      const projectId = created.project.id;
      const draftPath = "/v1/projects/" + projectId + "/draft";
      const revisionsPath = "/v1/projects/" + projectId + "/solution-revisions";
      const importsPath =
        "/v1/projects/" + projectId + "/github-repository-imports";
      const initialDraft = draftArchitectureDocumentResponseV1Schema.parse(
        await (await initialDraftResponse).json(),
      ).data;
      const leaseHttp = await leaseResponse;
      const lease = projectEditingLeaseResponseV1Schema.parse(
        await leaseHttp.json(),
      ).data;
      const acquisition = acquireProjectEditingLeaseV1Schema.parse(
        leaseHttp.request().postDataJSON(),
      );
      expect(lease.state).toBe("owned");
      if (lease.state !== "owned")
        throw new Error("The first revision requires an owned editing lease.");
      expect(lease.projectId).toBe(projectId);
      expect(initialDraft.id).toBe(created.draft.id);
      expect(initialDraft.version).toBe(created.draft.version);
      await expect(page).toHaveURL(
        editorPath(projectId) +
          (startingPoint === "import" ? "?tool=import" : ""),
      );
      if (startingPoint === "import") {
        await expect(
          page.getByRole("dialog", { name: "Code workspace", exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId("guided-walkthrough")).toHaveCount(0);
      } else {
        await waitForBackendEditor(page, 1);
        await page
          .getByTestId("guided-walkthrough")
          .getByRole("button", { name: "Dismiss", exact: true })
          .click();
      }
      if (startingPoint === "blank") {
        await page.keyboard.press("Control+k");
        const palette = page.getByRole("dialog", { name: "Command palette" });
        await palette.getByRole("searchbox").fill("import terraform");
        await palette
          .getByRole("button", {
            name: /Import Terraform or CloudFormation/u,
          })
          .click();
      }
      const code = page.getByRole("dialog", {
        name: "Code workspace",
        exact: true,
      });
      await expect(code).toBeVisible();
      await expect(
        code.getByRole("heading", {
          name: "Save your first revision",
          exact: true,
        }),
      ).toBeVisible();
      const form = code.locator("#repository-import-form");
      const importButton = form.getByRole("button", {
        name: "Import pinned commit",
        exact: true,
      });
      await expect(importButton).toBeDisabled();
      await expect(
        form.getByRole("combobox", { name: "Repository", exact: true }),
      ).toBeEnabled();
      const discover = form.getByRole("button", {
        name: "Discover repository files",
      });
      await discover.focus();
      await page.keyboard.press("Enter");
      const file = form.getByRole("checkbox", {
        name: "Select infrastructure/main.tf",
      });
      await expect(file).toBeVisible();
      await file.focus();
      await page.keyboard.press("Space");
      await expect(file).toBeChecked();
      await form.getByRole("button", { name: "Use selected files" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        form.getByText("Import scope: 1 selected path"),
      ).toBeVisible();
      await expect(importButton).toBeDisabled();
      expect(api.requestCount("POST", importsPath)).toBe(0);
      expect(api.requestCount("POST", revisionsPath)).toBe(0);
      expect(api.requestCount("PUT", draftPath)).toBe(0);
      await page.screenshot({
        path: testInfo.outputPath("first-import-needs-revision.png"),
        fullPage: true,
      });

      // Delay, but never replace, the existing harness's authoritative list.
      // A successful create response alone must not enable the import form.
      let releaseConfirmation: (() => void) | undefined;
      let heldConfirmations = 0;
      const confirmationGate = new Promise<void>((resolve) => {
        releaseConfirmation = resolve;
      });
      await context.route(
        "**" + TYPED_BACKEND_API_PREFIX + revisionsPath + "**",
        async (route) => {
          const request = route.request();
          if (
            request.method() === "GET" &&
            new URL(request.url()).pathname ===
              TYPED_BACKEND_API_PREFIX + revisionsPath &&
            api.requestCount("POST", revisionsPath) > 0
          ) {
            heldConfirmations += 1;
            await confirmationGate;
          }
          await route.fallback();
        },
      );
      try {
        const revisionResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              TYPED_BACKEND_API_PREFIX + revisionsPath,
        );
        const confirmationResponse = page.waitForResponse(
          (response) =>
            response.request().method() === "GET" &&
            new URL(response.url()).pathname ===
              TYPED_BACKEND_API_PREFIX + revisionsPath,
        );
        const saveFirst = code.getByRole("button", {
          name: "Save first revision",
          exact: true,
        });
        await expect(saveFirst).toBeEnabled();
        await saveFirst.focus();
        await page.keyboard.press("Enter");
        const revisionHttp = await revisionResponse;
        expect(revisionHttp.status()).toBe(201);
        const revision = solutionRevisionResponseV1Schema.parse(
          await revisionHttp.json(),
        ).data;
        await expect.poll(() => heldConfirmations).toBe(1);
        await expect(
          code.getByRole("status").filter({
            hasText: "Checking your saved revision before import…",
          }),
        ).toBeVisible();
        await expect(importButton).toBeDisabled();
        await expect(
          form.getByRole("combobox", { name: "Repository", exact: true }),
        ).toBeEnabled();
        expect(api.requestCount("POST", importsPath)).toBe(0);

        const draftSave = api.latestDraftSave(projectId);
        expect(draftSave).toBeDefined();
        const savedInput = saveDraftV1Schema.parse(draftSave?.body);
        expect(savedInput.architectureDocument).toEqual(
          initialDraft.architectureDocument,
        );
        expect(savedInput.editingLease).toEqual({
          leaseId: lease.leaseId,
          token: acquisition.token,
        });
        expect(draftSave?.headers["if-match"]).toBe(
          '"draft:' + initialDraft.id + ':1"',
        );
        expect(
          createSolutionRevisionV1Schema.parse(
            revisionHttp.request().postDataJSON(),
          ),
        ).toEqual({
          contractVersion: 1,
          draftId: initialDraft.id,
          draftVersion: 2,
          name: "Solution revision 2",
        });
        expect(revisionHttp.request().headers()["if-match"]).toBe(
          '"draft:' + initialDraft.id + ':2"',
        );
        expect(revisionHttp.request().headers()["idempotency-key"]).toMatch(
          /^solution-revision:/u,
        );
        expect(revision.summary).toMatchObject({
          projectId,
          sourceDraftId: initialDraft.id,
          sourceDraftVersion: 2,
        });
        expect(api.requestCount("PUT", draftPath)).toBe(1);
        expect(api.requestCount("POST", revisionsPath)).toBe(1);

        releaseConfirmation?.();
        const confirmationHttp = await confirmationResponse;
        const confirmationUrl = new URL(confirmationHttp.url());
        expect(confirmationUrl.searchParams.get("page[limit]")).toBe("100");
        expect(confirmationUrl.searchParams.get("sort")).toBe("-createdAt");
        const confirmed = solutionRevisionListResponseV1Schema.parse(
          await confirmationHttp.json(),
        ).data;
        expect(confirmed).toEqual([revision.summary]);
        await expect(importButton).toBeEnabled();
        await expect(form).toBeFocused();
        await expect(form).toBeInViewport();
        await expect(
          code.getByRole("heading", {
            name: "Save your first revision",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          form.getByRole("combobox", { name: "Repository", exact: true }),
        ).toHaveValue("41");
        await expect(
          form.getByRole("combobox", { name: "Branch", exact: true }),
        ).toHaveValue("main");
        await expect(
          form.getByRole("textbox", {
            name: "Pinned commit SHA",
            exact: true,
          }),
        ).toHaveValue(FIRST_IMPORT_COMMIT_SHA);
        await form
          .getByText("Choose files and import options", { exact: true })
          .click();
        await expect(
          form.getByText(/Automatic refresh is not available here/u),
        ).toBeVisible();
        await expect(
          form.getByRole("checkbox", { name: /Refresh automatically/u }),
        ).toHaveCount(0);
        await expect(
          form.getByRole("textbox", {
            name: "Import scope (one repository-relative path per line)",
          }),
        ).toHaveValue("infrastructure/main.tf");
        await expect(
          code.getByRole("button", { name: /Regenerate/u }),
        ).toHaveCount(0);
        expect(api.requestCount("POST", importsPath)).toBe(0);
        expect(
          api.requests.filter(
            (request) =>
              request.method !== "GET" && request.path.includes("/github-"),
          ),
        ).toEqual([]);
        expect(api.requestCount("PUT", draftPath)).toBe(1);
        expect(api.requestCount("POST", revisionsPath)).toBe(1);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        await expectAccessibleAccountPage(page);
        await page.screenshot({
          path: testInfo.outputPath("first-import-ready.png"),
          fullPage: true,
        });
      } finally {
        releaseConfirmation?.();
      }
    },
  );
}

for (const width of [1440, 390]) {
  test(
    "guides an older revision back to the canvas after an exact export compatibility denial at " +
      String(width) +
      " pixels",
    async ({ context, page }, testInfo) => {
      const api = await installApi(context);
      await page.setViewportSize({ width, height: 960 });
      const seeded = api.seedSolutionRevision(
        TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID,
        "Older infrastructure revision",
      );
      const before = structuredClone(seeded);
      const revision = solutionRevisionResponseV1Schema.parse({
        apiVersion: "v1",
        data: seeded,
      }).data;
      expect(revision.manifest.versions.compiler.state).toBe("not-applicable");
      expect(revision.manifest.versions.diagramRenderer.state).toBe(
        "not-applicable",
      );
      const revisionId = revision.summary.solutionRevisionId;
      const exportRoute =
        TYPED_BACKEND_API_PREFIX +
        "/v1/projects/" +
        TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID +
        "/solution-export-jobs";
      const attempts: ReturnType<
        typeof createSolutionExportJobV1Schema.parse
      >[] = [];
      const denial = apiErrorEnvelopeV1Schema.parse({
        apiVersion: "v1",
        error: {
          code: "unsupported_version",
          correlationId: "correlation_first_export_compatibility",
          message:
            "Save a new revision before exporting with the current tools.",
          fieldIssues: [
            {
              code: "solution-export.revision-tools-unavailable.v1",
              path: ["solutionRevisionId"],
              message:
                "This saved revision does not use the current export tools. Save a new revision and try again.",
            },
          ],
        },
      });
      // Synthetic server admission only: no queue, compiler or package is run.
      await context.route("**" + exportRoute, async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        attempts.push(
          createSolutionExportJobV1Schema.parse(route.request().postDataJSON()),
        );
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify(denial),
        });
      });
      await goto(
        page,
        revisionPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID) +
          "/" +
          revisionId,
      );
      await expect(
        page.getByRole("heading", {
          name: "Generate from this exact revision",
        }),
      ).toBeVisible({ timeout: 30_000 });
      await page
        .getByLabel("Infrastructure target")
        .selectOption("cloudformation");
      await page.getByLabel("Environment type").selectOption("staging");
      await page.getByLabel("Export name").fill("older-infrastructure-review");
      await page.getByRole("button", { name: "Generate export" }).click();
      await expect(
        page.getByRole("heading", { name: "Save a new revision to export" }),
      ).toBeVisible();
      await expect(
        page.getByText(/This saved revision stays unchanged/u),
      ).toBeVisible();
      await expect(
        page.getByText("The export service is temporarily unavailable.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.getByLabel("Infrastructure target")).toHaveValue(
        "cloudformation",
      );
      await expect(page.getByLabel("Environment type")).toHaveValue("staging");
      await expect(page.getByLabel("Export name")).toHaveValue(
        "older-infrastructure-review",
      );
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        solutionRevisionId: revisionId,
        targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
        environment: { environmentType: "staging" },
        exportName: "older-infrastructure-review",
      });
      expect(
        api.requestCount(
          "POST",
          "/v1/projects/" +
            TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID +
            "/solution-revisions",
        ),
      ).toBe(0);
      const recovery = page.getByRole("link", {
        name: "Open canvas to save a new revision",
      });
      await expect(recovery).toHaveAttribute(
        "href",
        editorPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID),
      );
      await expectAccessibleAccountPage(page);
      async function assertRevisionFitsViewport(state: string) {
        const layout = await page.evaluate(() => {
          const main = document.querySelector("main");
          if (main === null)
            throw new Error("Expected the visible revision page.");
          const outsideViewport = [
            ...main.querySelectorAll<HTMLElement>(
              "h1, h2, p, a, form, fieldset, dl, dd, details, code, input, select, button",
            ),
          ]
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                text: element.textContent.slice(0, 80),
                left: bounds.left,
                right: bounds.right,
              };
            })
            .filter(
              ({ left, right }) => left < -1 || right > window.innerWidth + 1,
            );
          return {
            innerWidth: window.innerWidth,
            scrollX: window.scrollX,
            scrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            mainClientWidth: main.clientWidth,
            mainScrollWidth: main.scrollWidth,
            outsideViewport,
          };
        });
        const layoutPath = testInfo.outputPath(
          "revision-layout-" + state + ".json",
        );
        await writeFile(layoutPath, JSON.stringify(layout, null, 2));
        await testInfo.attach("revision-layout-" + state, {
          path: layoutPath,
          contentType: "application/json",
        });
        expect(layout.innerWidth).toBe(width);
        expect(layout.scrollX).toBe(0);
        expect(layout.scrollWidth).toBeLessThanOrEqual(width);
        expect(layout.bodyScrollWidth).toBeLessThanOrEqual(width);
        expect(layout.mainScrollWidth).toBeLessThanOrEqual(
          layout.mainClientWidth + 1,
        );
        expect(layout.outsideViewport).toEqual([]);
      }
      await assertRevisionFitsViewport("collapsed");
      await page.screenshot({
        path: testInfo.outputPath("older-revision-export-recovery.png"),
        fullPage: true,
      });
      for (const summary of [
        "Technical revision details",
        "Diagram options (optional)",
        "Revision and export details",
      ]) {
        await page.locator("summary").filter({ hasText: summary }).click();
      }
      await assertRevisionFitsViewport("expanded");
      await page.screenshot({
        path: testInfo.outputPath(
          "older-revision-export-recovery-expanded.png",
        ),
        fullPage: true,
      });
      await recovery.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        editorPath(TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID),
      );
      await waitForBackendEditor(page, 1);
      await page
        .getByTestId("guided-walkthrough")
        .getByRole("button", { name: "Dismiss", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Create Solution Revision",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Create Solution Revision",
          exact: true,
        }),
      ).toBeEnabled();
      // Navigation never freezes a revision or changes the historical record.
      expect(
        api.requestCount(
          "POST",
          "/v1/projects/" +
            TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID +
            "/solution-revisions",
        ),
      ).toBe(0);
      expect(
        api.requestCount(
          "PUT",
          "/v1/projects/" + TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID + "/draft",
        ),
      ).toBe(0);
      expect(seeded).toEqual(before);
    },
  );
}

for (const kind of ["checkout", "portal"] as const) {
  test(`keeps the original app session when returning from a separate ${kind} window`, async ({
    context,
    page,
  }) => {
    await installApi(context);
    const billingPath = `${organizationRoot}/billing`;
    let complete = false;
    const envelope = (data: unknown) => ({ apiVersion: "v1", data });
    await context.route(
      /\/typed-backend-api\/v1\/organizations\/org_local\/billing$/u,
      async (route) => {
        await route.fulfill({
          status: 200,
          json: envelope({
            contractVersion: 1,
            organizationId: TYPED_BACKEND_ORGANIZATION_ID,
            asOf: "2026-09-16T12:00:00.000Z",
            mode: "stripe-sandbox",
            accountState: "active",
            subscriptionState:
              complete || kind === "portal" ? "active" : "not-subscribed",
            currentPlanKey: complete
              ? "pro"
              : kind === "portal"
                ? "starter"
                : null,
            canCheckout: !complete && kind === "checkout",
            canManage: complete || kind === "portal",
            plans: [
              {
                key: "starter",
                displayName: "Starter",
                currency: "USD",
                monthlyPriceMicros: "9000000",
                monthlyCreditUnits: 200,
              },
              {
                key: "pro",
                displayName: "Professional",
                currency: "USD",
                monthlyPriceMicros: "49000000",
                monthlyCreditUnits: 1000,
              },
            ],
          }),
        });
      },
    );
    const hostedUrl =
      kind === "checkout"
        ? "https://checkout.stripe.com/c/pay/cs_test_popup_fixture"
        : "https://billing.stripe.com/p/session/test_popup_fixture";
    await context.route(
      new RegExp(
        `/typed-backend-api/v1/organizations/org_local/billing/${kind}-sessions$`,
        "u",
      ),
      async (route) => {
        await route.fulfill({
          status: 201,
          json: envelope({
            contractVersion: 1,
            organizationId: TYPED_BACKEND_ORGANIZATION_ID,
            kind,
            url: hostedUrl,
          }),
        });
      },
    );
    await context.route(hostedUrl, async (route) => {
      await route.fulfill({
        contentType: "text/html",
        headers: { "Cross-Origin-Opener-Policy": "same-origin" },
        body: "<html><body><h1>Synthetic hosted billing</h1><button id='return'>Return to CloudMarkup</button></body></html>",
      });
    });
    // Match beta's strict opener isolation on the application documents too.
    await context.route("**/organizations/org_local/billing", async (route) => {
      if (route.request().resourceType() !== "document")
        return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      });
    });
    await goto(page, billingPath);
    const originalTimeOrigin = await page.evaluate(
      () => performance.timeOrigin,
    );
    const popupPromise = page.waitForEvent("popup");
    await page
      .getByRole("button", {
        name: kind === "checkout" ? "Continue with Starter" : "Manage billing",
      })
      .click();
    const popup = await popupPromise;
    await expect(
      popup.getByRole("heading", { name: "Synthetic hosted billing" }),
    ).toBeVisible();
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await expect(page).toHaveURL(billingPath);
    complete = true;
    const returnUrl = new URL(billingPath, page.url()).href;
    await popup.evaluate((url) => {
      document.querySelector("#return")?.addEventListener("click", () => {
        window.location.assign(url);
      });
    }, returnUrl);
    const closed = popup.waitForEvent("close");
    await popup.getByRole("button", { name: "Return to CloudMarkup" }).click();
    await closed;
    await expect(
      page
        .getByRole("region", { name: "Current subscription" })
        .getByRole("heading", { name: "Professional" }),
    ).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      originalTimeOrigin,
    );
    await expect(
      page.getByRole("heading", { name: "Your session expired" }),
    ).toHaveCount(0);
  });
}

test("shows current canvas credits and opens organization Usage", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(page, editorPath(TYPED_BACKEND_NOTES_PROJECT_ID));
  const balance = page.getByRole("link", {
    name: /^[\d,]+ credits(?: \d+ reserved)?$/u,
  });
  await expect(balance).toBeVisible({ timeout: 30_000 });
  await expect(balance).toHaveAttribute("href", organizationRoot + "/usage");
  await balance.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Usage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^[\d,]+ available credits$/u }),
  ).toBeVisible();
  expect(
    api.requests.some((request) =>
      request.path.endsWith("/commercial/credit-balance"),
    ),
  ).toBe(true);
});

test("collects an AI prompt on Create Project and keeps desktop dark mode readable", async ({
  context,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(context);
  await goto(page, organizationRoot + "/projects/new");
  await page.getByRole("radio", { name: /^Describe with AI/u }).check();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("File processing app");
  const prompt = page.getByRole("textbox", {
    name: "What would you like to build?",
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await prompt.fill(
    "Copy uploaded files into a managed file share, with a Lambda function to coordinate processing.",
  );
  await expect(
    page.getByRole("button", { name: "Create project", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".architecture-editor")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("ai-create-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open authenticated account", exact: true })
    .click();
  const account = page.getByRole("dialog", { name: "Authenticated account" });
  await account
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("dark");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const runtime = (globalThis as typeof globalThis & { axe: typeof axe }).axe;
    return (
      await runtime.run(".project-setup", {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
      })
    ).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("ai-create-desktop-dark.png"),
    fullPage: true,
  });
});
