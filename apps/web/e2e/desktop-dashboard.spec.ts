import type {
  CreditTopUpWorkspaceV1,
  RecipientOrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { loadBlankAwsEditorArchitectureDocument } from "../src/provider-catalog/aws-editor-fixture.js";
import { awsEditorCatalog } from "../src/provider-catalog/aws-editor-catalog.js";
import { prepareBetaInfrastructureProposal } from "../src/features/generation/beta-infrastructure-proposal.js";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import {
  TypedBackendApiHarness,
  TYPED_BACKEND_ORGANIZATION_ID,
  TYPED_BACKEND_NOTES_PROJECT_ID,
} from "./support/typed-backend-api-harness.js";
test.skip(
  process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] !== "true",
  "Uses the authenticated browser fixture.",
);
const root = "/organizations/" + TYPED_BACKEND_ORGANIZATION_ID;

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/gu)
      ?.slice(0, 3)
      .map(Number);
    if (channels?.length !== 3) throw new Error("Expected an RGB color.");
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (
      (linear[0] ?? 0) * 0.2126 +
      (linear[1] ?? 0) * 0.7152 +
      (linear[2] ?? 0) * 0.0722
    );
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Cover both palettes, the narrow/wide limits and both sides of the modal breakpoint.
for (const [theme, width] of [
  ["light", 320],
  ["dark", 390],
  ["light", 767],
  ["dark", 768],
  ["light", 1440],
] as const) {
  test(`readable account in ${theme} at ${String(width)}px`, async ({
    context,
    page,
  }, testInfo) => {
    const height = width === 768 ? 360 : width === 1440 ? 720 : 844;
    await page.setViewportSize({ width, height });
    await context.addInitScript((appearance) => {
      localStorage.setItem("cloudmarkup.appearance.v1", appearance);
    }, theme);
    const api = new TypedBackendApiHarness({ role: "owner" });
    await api.install(context);
    await page.goto(root + "/dashboard");
    await expect(
      page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible();
    const dismissTour = page.getByRole("button", {
      name: "Dismiss workspace tour",
    });
    if (await dismissTour.isVisible()) await dismissTour.click();
    const trigger = page.getByRole("button", {
      name: "Open authenticated account",
    });
    await trigger.click();
    const account = page.getByRole("dialog", {
      name: "Authenticated account",
    });
    await expect(account).toBeVisible();
    const background = await account.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    // An opaque menu prevents underlying labels from competing with its text.
    expect(background).toMatch(/^rgb\(/u);
    for (const link of await account.getByRole("link").all()) {
      const foreground = await link.evaluate(
        (element) => getComputedStyle(element).color,
      );
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    // Common destinations are visible without opening a nested menu.
    await expect(
      account.getByRole("link", { name: "Profile", exact: true }),
    ).toBeVisible();
    await expect(
      account.getByRole("link", { name: "Personal security", exact: true }),
    ).toBeVisible();
    const appearance = account.getByLabel("Appearance", { exact: true });
    const control = await appearance.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        foreground: style.color,
        background: style.backgroundColor,
        border: style.borderColor,
      };
    });
    expect(
      contrastRatio(control.foreground, control.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(control.border, control.background),
    ).toBeGreaterThanOrEqual(3);
    await appearance.scrollIntoViewIfNeeded();
    await expect(appearance).toBeInViewport();
    const bottomLink = account.getByRole("link").last();
    await bottomLink.focus();
    await expect(bottomLink).toBeInViewport();
    const closeButton = account.getByRole("button", {
      name: "Close",
      exact: true,
    });
    await expect(closeButton).toBeInViewport();
    const bounds = await account.boundingBox();
    if (bounds === null) throw new Error("Account menu has no visible bounds.");
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
    if (width < 768) {
      const close = account.getByRole("button", {
        name: "Close",
        exact: true,
      });
      const closeBox = await close.boundingBox();
      expect(closeBox?.width).toBeGreaterThanOrEqual(44);
      expect(closeBox?.height).toBeGreaterThanOrEqual(44);
      expect((await appearance.boundingBox())?.height).toBeGreaterThanOrEqual(
        44,
      );
      await expect(account).toHaveAttribute("aria-modal", "true");
      for (let index = 0; index < 20; index += 1) {
        await page.keyboard.press("Tab");
        expect(
          await account.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        ).toBe(true);
      }
    }
    await page.screenshot({
      path: testInfo.outputPath(`account-${theme}-${String(width)}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(account).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${theme}-${String(width)}.png`),
      fullPage: true,
    });
  });
}
test("keeps settings sections beside the primary navigation with history and keyboard focus", async ({
  context,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 520 });
  await new TypedBackendApiHarness({ role: "owner" }).install(context);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/typed-backend-api/") &&
      request.method() !== "GET"
    )
      mutations.push(request.method() + " " + request.url());
  });
  const member = {
    contractVersion: 1,
    organizationId: TYPED_BACKEND_ORGANIZATION_ID,
    membershipId: "membership_typed_backend_owner",
    principalId: "principal_typed_backend_owner",
    displayName: "Workspace owner",
    username: "workspace_owner",
    role: "owner",
    status: "active",
    version: 1,
    etag: '"member:membership_typed_backend_owner:1"',
    joinedAt: "2026-08-15T12:00:00.000Z",
    endedAt: null,
    endReason: null,
  };
  await context.route(
    "**/v1/organizations/" + TYPED_BACKEND_ORGANIZATION_ID + "/members?**",
    (route) =>
      route.fulfill({
        json: { apiVersion: "v1", data: [member], page: { hasMore: false } },
      }),
  );
  await context.route(
    "**/v1/account/workspaces/" + TYPED_BACKEND_ORGANIZATION_ID + "/membership",
    (route) =>
      route.fulfill({
        headers: { etag: member.etag },
        json: { apiVersion: "v1", data: member },
      }),
  );
  await context.route(
    /\/v1\/(?:organizations\/org_local\/member-invitations|account\/invitations)(?:\?.*)?$/,
    (route) =>
      route.fulfill({
        json: { apiVersion: "v1", data: [], page: { hasMore: false } },
      }),
  );
  await page.goto("/organizations");
  await expect(
    page.getByRole("heading", { name: "Workspaces", exact: true }),
  ).toBeVisible();
  const entryNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  await expect(
    entryNavigation.getByRole("link", { name: "Dashboard", exact: true }),
  ).toHaveAttribute("href", root + "/dashboard");
  await expect(
    entryNavigation.getByRole("link", { name: "Projects", exact: true }),
  ).toHaveAttribute("href", root + "/projects");
  await page.screenshot({
    path: testInfo.outputPath("workspace-navigation-first-entry.png"),
    fullPage: true,
  });
  await entryNavigation
    .getByRole("link", { name: "Dashboard", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss workspace tour" }).click();
  const navigation = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  const panel = page.getByRole("main");
  async function expectSettledHeadingInView() {
    const heading = panel.getByRole("heading", { level: 1 });
    await expect(heading).toBeFocused();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    await expect(heading).toBeInViewport();
    const headingBounds = await heading.boundingBox();
    const headerBounds = await page
      .getByRole("banner", { name: "Application header" })
      .boundingBox();
    if (headingBounds === null || headerBounds === null)
      throw new Error("Missing focused heading or application header.");
    expect(headingBounds.y).toBeGreaterThanOrEqual(
      headerBounds.y + headerBounds.height,
    );
  }
  const navigationBounds = await navigation.boundingBox();
  if (navigationBounds === null)
    throw new Error("Primary navigation is not visible.");
  for (const [label, path, title] of [
    ["Usage", root + "/usage", "Usage"],
    ["Plans & billing", root + "/billing", "Billing"],
    [
      "Organization settings",
      root + "/settings/general",
      "Organization settings",
    ],
    ["Members & roles", root + "/settings/members", "Members"],
    [
      "Organization integrations",
      root + "/settings/integrations",
      "Integrations",
    ],
    ["Projects", root + "/projects", "Projects"],
    ["Templates", root + "/templates", "Templates"],
    ["Profile", "/settings/profile", "Profile settings"],
    ["Invitations", "/settings/invitations", "Invitations"],
    ["Preferences", "/settings/preferences", "Experience preferences"],
    ["Personal security", "/settings/security", "Personal security"],
    [
      "Personal integrations",
      "/settings/integrations",
      "Personal integrations",
    ],
    ["Organizations", "/organizations", "Workspaces"],
  ] as const) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(path);
    const heading = panel.getByRole("heading", {
      name: title,
      level: 1,
      exact: true,
    });
    await expect(heading).toBeFocused();
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("navigation", {
        name: /^(Personal settings|Organization settings sections|Security sections)$/u,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const contentBounds = await panel.boundingBox();
    if (contentBounds === null)
      throw new Error("Selected content panel is not visible.");
    expect(contentBounds.x).toBeGreaterThanOrEqual(
      navigationBounds.x + navigationBounds.width,
    );
    expect((await navigation.boundingBox())?.width).toBeCloseTo(
      navigationBounds.width,
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const actions = panel.getByRole("button");
    if (await actions.count()) {
      await actions.last().scrollIntoViewIfNeeded();
      if (await actions.last().isEnabled()) await actions.last().focus();
      await expect(actions.last()).toBeInViewport();
    }
    if (label === "Usage" || label === "Plans & billing") {
      await page.screenshot({
        path: testInfo.outputPath(
          label === "Usage"
            ? "unified-usage-1440.png"
            : "unified-billing-1440.png",
        ),
        fullPage: true,
      });
    }
    if (label === "Plans & billing") {
      await page.goBack();
      await expect(
        panel.getByRole("heading", { name: "Usage", level: 1, exact: true }),
      ).toBeFocused();
      await expectSettledHeadingInView();
      await expect(
        navigation.getByRole("link", { name: "Usage", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await page.goForward();
      await expect(heading).toBeFocused();
      await expectSettledHeadingInView();
      await expect(navigation).toBeVisible();
    }
  }
  await page.goto("/organizations");
  await expect(
    page.getByRole("heading", { name: "Workspaces", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Workspaces", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Dashboard", exact: true }),
  ).toHaveAttribute("href", root + "/dashboard");
  await expect(
    navigation.getByRole("link", { name: "Projects", exact: true }),
  ).toHaveAttribute("href", root + "/projects");
  await page
    .getByRole("button", { name: "Hide Navigation", exact: true })
    .click();
  const collapsed = page.getByRole("navigation", {
    name: "Collapsed application navigation",
  });
  await expect(collapsed).toBeVisible();
  await collapsed.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Projects", level: 1, exact: true }),
  ).toBeFocused();
  await expect(
    collapsed.getByRole("link", { name: "Projects", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: testInfo.outputPath("workspace-navigation-collapsed.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Show Navigation", exact: true })
    .click();
  await expect(navigation).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "Resize application navigation" }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test("an unauthenticated reload preserves the dashboard sign-in destination", async ({
  context,
  page,
}, testInfo) => {
  const theme = "light";
  const width = 320;
  await page.setViewportSize({ width, height: 960 });
  await context.addInitScript((appearance) => {
    localStorage.setItem("cloudmarkup.appearance.v1", appearance);
  }, theme);
  const api = new TypedBackendApiHarness({ role: "owner" });
  await api.install(context);
  await page.goto(root + "/dashboard");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  api.expireSession();
  await page.reload();
  const expired = page.getByRole("alert");
  const heading = expired.getByRole("heading", {
    name: "Sign in to continue",
  });
  await expect(heading).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeHidden();
  expect((await expired.boundingBox())?.x).toBeGreaterThanOrEqual(24);
  expect(
    parseFloat(
      await heading.evaluate((element) => getComputedStyle(element).fontSize),
    ),
  ).toBeLessThanOrEqual(32);
  const recovery = expired.getByRole("link", { name: "Sign in", exact: true });
  await expect(recovery).toHaveAttribute(
    "href",
    "/sign-in?" +
      new URLSearchParams({ returnTo: root + "/dashboard" }).toString(),
  );
  await page.keyboard.press("Tab");
  await expect(recovery).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`session-expired-${theme}-${String(width)}.png`),
    fullPage: true,
  });
});
for (const theme of ["light", "dark"]) {
  test(
    "desktop dashboard, navigation and clearer glass in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 960 });
      await context.addInitScript((appearance) => {
        localStorage.setItem("cloudmarkup.appearance.v1", appearance);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      await page.goto(root + "/dashboard");
      await expect(
        page.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Recorded credit balance")).toBeVisible();
      const groups = page.locator(
        ".primary-navigation [data-navigation-group]",
      );
      await expect(groups.locator("h2")).toHaveText([
        "Workspace",
        "Account",
        "Organization",
      ]);
      const accountNavigation = groups.filter({
        has: page.getByRole("heading", { name: "Workspace", exact: true }),
      });
      await expect(
        accountNavigation.getByRole("link", { name: "Usage", exact: true }),
      ).toHaveAttribute("href", root + "/usage");
      await expect(
        accountNavigation.getByRole("link", { name: "Plans & billing" }),
      ).toHaveAttribute("href", root + "/billing");
      const tour = page.getByRole("complementary", { name: "Workspace tour" });
      await expect(tour).toBeVisible();
      await expect
        .poll(async () => {
          const target = await groups.first().boundingBox();
          const card = await tour.boundingBox();
          return target && card
            ? Math.abs(card.x - target.x - target.width - 18)
            : 999;
        })
        .toBeLessThan(2);
      await expect(tour).toHaveCSS(
        "backdrop-filter",
        "blur(4px) saturate(1.15)",
      );
      await tour.getByRole("button", { name: "Next", exact: true }).click();
      await expect(groups.filter({ hasText: "Personal security" })).toHaveCSS(
        "outline-width",
        "4px",
      );
      await tour
        .getByRole("button", { name: "Dismiss workspace tour" })
        .click();
      await page
        .getByRole("button", { name: "Open authenticated account" })
        .click();
      const profile = page.getByRole("dialog", {
        name: "Authenticated account",
      });
      await expect(profile.locator("details[open]")).toHaveCount(0);
      expect((await profile.boundingBox())?.height).toBeLessThan(650);
      await expect(
        profile.getByRole("region", { name: /^(Organization|Workspace)$/u }),
      ).toBeVisible();
      await expect(
        profile.getByRole("link", { name: "Usage", exact: true }),
      ).toHaveAttribute("href", root + "/usage");
      await expect(
        profile.getByRole("link", { name: "Plans & billing" }),
      ).toHaveAttribute("href", root + "/billing");
      const notifications = profile.getByRole("button", {
        name: /^Notifications/u,
      });
      await expect(notifications).toBeVisible();
      await expect(profile).toHaveCSS("backdrop-filter", "none");
      await expect(profile).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: testInfo.outputPath("profile-" + theme + ".png"),
      });
      await notifications.click();
      await expect(
        page.getByRole("dialog", { name: "Notifications" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const runtime = (globalThis as typeof globalThis & { axe: typeof axe })
          .axe;
        return (
          await runtime.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        }));
      });
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("dashboard-" + theme + ".png"),
        fullPage: true,
      });
      await page.getByRole("link", { name: /Create with AI/u }).click();
      await expect(
        page.getByRole("radio", { name: /Describe with AI/u }),
      ).toBeChecked();
      await expect(
        page.getByRole("textbox", {
          name: "What would you like to build?",
          exact: true,
        }),
      ).toBeVisible();
    },
  );
}
test("loads the editor without flashing navigation and puts Canvas actions on the minimap", async ({
  context,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await new TypedBackendApiHarness({ role: "owner" }).install(context);
  await page.goto(root + "/dashboard");
  await page.getByRole("button", { name: "Dismiss workspace tour" }).click();
  const gridSize = await page
    .locator(".standard-shell")
    .evaluate((el) => getComputedStyle(el).backgroundSize);
  expect(gridSize).toBe("auto");
  await expect(page.locator(".standard-shell")).toHaveCSS(
    "background-image",
    "none",
  );
  let finishLoading!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishLoading = resolve;
  });
  let allowEditing!: () => void;
  const editingGate = new Promise<void>((resolve) => {
    allowEditing = resolve;
  });
  await page.route(
    "**/projects/" + TYPED_BACKEND_NOTES_PROJECT_ID + "/editing-lease",
    async (route) => {
      if (route.request().method() === "POST") await editingGate;
      await route.fallback();
    },
  );
  await page.route(
    "**/projects/" + TYPED_BACKEND_NOTES_PROJECT_ID + "/draft",
    async (route) => {
      if (route.request().method() === "GET") await gate;
      await route.fallback();
    },
  );
  await page.goto(
    root + "/projects/" + TYPED_BACKEND_NOTES_PROJECT_ID + "/editor",
    {
      waitUntil: "commit",
    },
  );
  await expect(page.locator(".route-loading-indicator")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  finishLoading();
  await expect(page.locator(".route-loading-indicator")).toBeVisible();
  await expect(page.locator(".editor-project-access")).toHaveCount(0);
  await expect(page.locator(".standard-shell")).toHaveCount(0);
  allowEditing();
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30000,
  });
  const header = page.getByRole("banner", { name: "Application header" });
  await expect(
    header.getByRole("button", { name: "Open Canvas menu" }),
  ).toHaveCount(0);
  const minimap = page.locator("#architecture-canvas-menu-slot");
  await minimap.click({ position: { x: 76, y: 42 } });
  const canvasMenu = page.getByRole("dialog", { name: "Canvas actions" });
  await expect(
    canvasMenu.getByRole("button", { name: "Fit architecture" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(minimap.getByRole("button")).toBeFocused();
  const pattern = page.locator(".react-flow__background pattern");
  await expect
    .poll(async () => Number(await pattern.getAttribute("width")))
    .toBeCloseTo(48, 0);
  const openingLines = await pattern.evaluate((element) => {
    const grid = element as SVGPatternElement;
    const offset = grid.patternTransform.baseVal.consolidate()?.matrix;
    const width = grid.width.baseVal.value;
    return [
      grid.x.baseVal.value + (offset?.e ?? 0) + width / 2,
      grid.y.baseVal.value + (offset?.f ?? 0) + width / 2,
    ].map((value) => ((value % width) + width) % width);
  });
  for (const line of openingLines) expect(line).toBeCloseTo(0.5, 1);
  await page
    .getByRole("navigation", { name: "Inspector tools" })
    .getByRole("button", { name: "Configure" })
    .click();
  await minimap.getByRole("button", { name: "Open Canvas menu" }).click();
  await expect(canvasMenu).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Workspace tools" })
    .getByRole("button", { name: /^Issues/u })
    .click();
  await minimap.getByRole("button", { name: "Open Canvas menu" }).click();
  await expect(canvasMenu).toBeVisible();
  await page.keyboard.press("Escape");
  const before = await page
    .locator(".architecture-editor")
    .getAttribute("data-content-hash");
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(
    page.locator('[data-overview-tile="true"]').first(),
  ).toBeVisible();
  const tile = page.locator('[data-overview-tile="true"]').first();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const service = page.locator(".architecture-node--service").first();
  await expect(service).toHaveCSS("transition-property", "box-shadow");
  await expect(service).toHaveCSS("transition-delay", "0s");
  await expect(service.locator(".architecture-service-details")).toHaveCount(0);
  const serviceToggle = service.locator(".architecture-service-toggle");
  await service.hover();
  await serviceToggle.click();
  const serviceDetails = page.locator(
    ".architecture-service-floating-toolbar .architecture-service-details",
  );
  await expect(serviceDetails).toBeVisible();
  await expect(serviceDetails).toHaveCSS(
    "animation-name",
    "architecture-service-open",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(service).toHaveCSS("transition-duration", "0s");
  await expect(serviceDetails).toHaveCSS("animation-name", "none");
  await serviceToggle.click();
  await expect(serviceDetails).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, 100);
  const box = await tile.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(31);
  await expect(tile).toHaveAttribute("title", /.+/u);
  await expect(page.locator(".architecture-editor")).toHaveAttribute(
    "data-content-hash",
    before ?? "",
  );
  await page.screenshot({
    path: testInfo.outputPath("compact-canvas-tiles.png"),
    fullPage: true,
  });
});

test("AI nested boundaries keep headings clear of their children", async ({
  context,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await context.addInitScript(() => {
    localStorage.setItem("cloudmarkup.appearance.v1", "dark");
  });
  const document = loadBlankAwsEditorArchitectureDocument("us-east-1");
  let sequence = 0;
  const prepared = prepareBetaInfrastructureProposal({
    document,
    catalog: awsEditorCatalog,
    createId: () => "operation_browser_spacing_" + String(++sequence),
    proposal: {
      contractVersion: 3,
      summary: "Nested network placement",
      existingResources: [],
      limitations: [],
      connections: [],
      resources: [
        {
          key: "vpc",
          serviceType: "aws.ec2.vpc",
          parentKey: null,
          configuration: {},
          label: "Processing network",
        },
        {
          key: "az1",
          serviceType: "aws.ec2.availability-zone",
          parentKey: "vpc",
          configuration: { zoneName: "us-east-1a" },
          label: "Availability zone A",
        },
        {
          key: "az2",
          serviceType: "aws.ec2.availability-zone",
          parentKey: "vpc",
          configuration: { zoneName: "us-east-1b" },
          label: "Availability zone B",
        },
      ],
    },
  });
  const harness = new TypedBackendApiHarness({ role: "owner" });
  harness.seedArchitecture(
    TYPED_BACKEND_NOTES_PROJECT_ID,
    applyGraphCommand(document, prepared.command).document,
  );
  await harness.install(context);
  await page.goto(
    root + "/projects/" + TYPED_BACKEND_NOTES_PROJECT_ID + "/editor",
  );
  await expect(page.locator(".architecture-editor")).toBeVisible({
    timeout: 30_000,
  });
  const overlaps = await page
    .locator(".architecture-boundary-heading")
    .evaluateAll((headings) =>
      headings.flatMap((heading) => {
        const parent = heading.closest(".react-flow__node");
        const id = parent?.getAttribute("data-id");
        const header = heading.getBoundingClientRect();
        const nodes = [
          ...globalThis.document.querySelectorAll<HTMLElement>(
            ".react-flow__node",
          ),
        ];
        return nodes
          .filter((node) => node.getAttribute("data-id") !== id)
          .filter((node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.left >= header.left &&
              bounds.right <= (parent?.getBoundingClientRect().right ?? 0) &&
              bounds.top < header.bottom &&
              bounds.bottom > header.top
            );
          })
          .map((node) => [id, node.getAttribute("data-id")]);
      }),
    );
  expect(overlaps).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("nested-ai-layout-dark.png"),
    fullPage: true,
  });
});

// Palette contrast and viewport geometry are covered above; each state transition runs once.
for (const theme of ["light"] as const) {
  test(
    "account credit packs and verified purchase in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await context.addInitScript((appearance) => {
        localStorage.setItem("cloudmarkup.appearance.v1", appearance);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      let value: CreditTopUpWorkspaceV1 = {
        contractVersion: 1,
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        asOf: "2026-09-30T12:00:00.000Z",
        mode: "disabled",
        canPurchase: false,
        availableCreditUnits: "1250",
        latestPurchase: null,
        packs: [
          {
            key: "small",
            creditUnits: 100,
            priceMicros: "5000000",
            currency: "USD",
            expiration: "never",
          },
          {
            key: "medium",
            creditUnits: 350,
            priceMicros: "15000000",
            currency: "USD",
            expiration: "never",
          },
          {
            key: "large",
            creditUnits: 800,
            priceMicros: "30000000",
            currency: "USD",
            expiration: "never",
          },
        ],
      };
      const requests: unknown[] = [];
      await context.route("**/billing/credit-top-ups**", async (route) => {
        if (route.request().method() === "POST") {
          requests.push(route.request().postDataJSON());
          value = {
            ...value,
            latestPurchase: {
              id: "topup_" + "a".repeat(32),
              packKey: "medium",
              state: "created",
              needsReview: false,
            },
          };
          await route.fulfill({
            status: 201,
            json: {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                organizationId: TYPED_BACKEND_ORGANIZATION_ID,
                kind: "checkout",
                url: "https://checkout.stripe.com/c/pay/cs_test_synthetic_browser",
              },
            },
          });
        } else await route.fulfill({ json: { apiVersion: "v1", data: value } });
      });
      await context.route("https://checkout.stripe.com/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><title>Synthetic checkout</title><p>Local purchase test</p>",
        }),
      );
      await page.goto(root + "/billing");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      const section = page.getByRole("region", { name: "Credit top-ups" });
      await expect(
        section.getByText("Credit purchases are not enabled yet."),
      ).toBeVisible();
      for (const credits of [100, 350, 800])
        await expect(
          section.getByRole("button", {
            name: "Buy " + String(credits) + " credits",
          }),
        ).toBeDisabled();
      for (const price of ["$5", "$15", "$30"])
        await expect(section.getByText(price, { exact: true })).toBeVisible();
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath("credit-packs-" + theme + ".png"),
        fullPage: true,
      });
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const runtime = (globalThis as typeof globalThis & { axe: typeof axe })
          .axe;
        return (
          await runtime.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        }));
      });
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      value = { ...value, mode: "stripe-sandbox", canPurchase: true };
      await section
        .getByRole("button", { name: "Refresh credit status" })
        .click();
      const buy = section.getByRole("button", { name: "Buy 350 credits" });
      await expect(buy).toBeEnabled();
      const opened = context.waitForEvent("page");
      await buy.focus();
      await page.keyboard.press("Enter");
      const checkout = await opened;
      await expect(checkout).toHaveURL(
        "https://checkout.stripe.com/c/pay/cs_test_synthetic_browser",
      );
      expect(requests).toEqual([{ contractVersion: 1, packKey: "medium" }]);
      await checkout.close();
      await expect(
        section.getByText(/Payment has not been confirmed yet/u),
      ).toBeVisible();
      value = {
        ...value,
        availableCreditUnits: "1600",
        latestPurchase: {
          id: "topup_" + "a".repeat(32),
          packKey: "medium",
          state: "fulfilled",
          needsReview: false,
        },
      };
      await section
        .getByRole("button", { name: "Refresh credit status" })
        .click();
      await expect(
        section.getByText(
          "Payment verified. Your purchased credits are available.",
        ),
      ).toBeVisible();
      await expect(section.getByText("1,600", { exact: true })).toBeVisible();
      expect(requests).toHaveLength(1);
    },
  );
}
for (const theme of ["light"] as const) {
  test(
    "personal workspace and organization creation in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await context.addInitScript((value) => {
        localStorage.setItem("cloudmarkup.appearance.v1", value);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      let created = false;
      const actor = "principal_typed_backend_owner",
        newId = "org_browser_created";
      const personal = {
        contractVersion: 1,
        principalId: actor,
        id: TYPED_BACKEND_ORGANIZATION_ID,
        displayName: "Personal",
        kind: "personal",
        role: "owner",
      };
      const organization = {
        contractVersion: 1,
        principalId: actor,
        id: newId,
        displayName: "Browser organization",
        kind: "organization",
        role: "owner",
      };
      const workspaces = () =>
        created ? [personal, organization] : [personal];
      const requests: unknown[] = [];
      await context.route("**/v1/me", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              id: actor,
              displayName: "Synthetic workspace owner",
              resourceVersion: 1,
              organizationContexts: workspaces().map((workspace) => ({
                organizationId: workspace.id,
                membershipId: "membership_" + workspace.id,
                isOwner: true,
                role: "owner",
                capabilities: [
                  "organizations.read",
                  "projects.read",
                  "projects.create",
                  ...(workspace.kind === "organization"
                    ? ["memberships.read", "memberships.manage"]
                    : []),
                ],
              })),
            },
          },
        }),
      );
      await context.route("**/v1/organizations?*", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: workspaces().map((workspace) => ({
              id: workspace.id,
              displayName: workspace.displayName,
              createdAt: "2026-09-30T12:00:00.000Z",
              lifecycleStatus: "active",
              slug: workspace.id.replaceAll("_", "-"),
              version: 1,
            })),
            page: { hasMore: false },
          },
        }),
      );
      await context.route("**/v1/account/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() === "POST") {
          requests.push(route.request().postDataJSON());
          expect(route.request().headers()["idempotency-key"]).toMatch(
            /^workspace-/u,
          );
          created = true;
          await route.fulfill({
            status: 201,
            json: { apiVersion: "v1", data: organization },
          });
          return;
        }
        if (path.endsWith("/workspaces")) {
          await route.fulfill({
            json: {
              apiVersion: "v1",
              data: workspaces(),
              page: { hasMore: false },
            },
          });
          return;
        }
        const value = path.endsWith("/" + newId) ? organization : personal;
        await route.fulfill({ json: { apiVersion: "v1", data: value } });
      });
      await page.goto("/organizations");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      const personalCard = page.getByRole("listitem").filter({
        has: page.getByRole("heading", {
          level: 3,
          name: "Personal",
          exact: true,
        }),
      });
      await expect(personalCard.getByText("Only you")).toBeVisible();
      await expect(
        personalCard.getByRole("link", { name: "Organization settings" }),
      ).toHaveCount(0);
      await personalCard.getByRole("link", { name: "Open dashboard" }).click();
      await expect(
        page.getByRole("group", { name: "Personal workspace", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name: "Organization settings" }),
      ).toHaveCount(0);
      await page
        .getByRole("navigation", { name: "Primary navigation" })
        .getByRole("link", { name: "Organizations", exact: true })
        .click();
      const form = page.getByRole("region", { name: "Create an organization" });
      await form.getByLabel("Organization name").fill("Browser organization");
      await form
        .getByRole("button", { name: "Create organization", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(form.getByRole("status")).toHaveText(
        "Your organization is ready. Open its settings to manage members.",
      );
      await expect(
        page.getByRole("heading", { level: 3, name: "Browser organization" }),
      ).toBeVisible();
      expect(requests).toEqual([
        { contractVersion: 1, displayName: "Browser organization" },
      ]);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const runtime = (globalThis as typeof globalThis & { axe: typeof axe })
          .axe;
        return (
          await runtime.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => v.id);
      });
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("workspace-creation-" + theme + ".png"),
        fullPage: true,
      });
    },
  );
}

for (const theme of ["light"] as const) {
  test(
    "editable account profile in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await context.addInitScript((appearance) => {
        localStorage.setItem("cloudmarkup.appearance.v1", appearance);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      const actor = "principal_typed_backend_owner";
      let profile = {
        contractVersion: 1,
        principalId: actor,
        displayName: "Synthetic profile owner",
        username: null as string | null,
        version: 1,
      };
      const writes: unknown[] = [];
      await context.route("**/v1/me", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              id: actor,
              displayName: profile.displayName,
              email: "profile@example.test",
              resourceVersion: 1,
              organizationContexts: [
                {
                  organizationId: TYPED_BACKEND_ORGANIZATION_ID,
                  membershipId: "membership_typed_backend_owner",
                  isOwner: true,
                  role: "owner",
                  capabilities: [
                    "organizations.read",
                    "projects.read",
                    "projects.create",
                  ],
                },
              ],
            },
          },
        }),
      );
      await context.route("**/v1/account/profile", async (route) => {
        if (route.request().method() === "PUT") {
          const body = route.request().postDataJSON() as {
            contractVersion: number;
            displayName: string;
            username: string | null;
          };
          expect(route.request().headers()["if-match"]).toBe(
            '"profile-browser:1"',
          );
          writes.push(body);
          profile = { ...profile, ...body, version: 2 };
        }
        await route.fulfill({
          headers: {
            etag: '"profile-browser:' + String(profile.version) + '"',
          },
          json: { apiVersion: "v1", data: profile },
        });
      });
      await page.goto("/settings/profile");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      await expect(
        page.getByLabel("Display name", { exact: true }),
      ).toHaveValue("Synthetic profile owner");
      await page.getByText("Account details", { exact: true }).click();
      await expect(page.getByText(actor, { exact: true })).toBeVisible();
      await page
        .getByLabel("Display name", { exact: true })
        .fill("Updated profile owner");
      await page.getByLabel("Username", { exact: false }).fill("Browser_Owner");
      await page
        .getByRole("button", { name: "Save profile", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status").filter({ hasText: "Profile saved." }),
      ).toBeVisible();
      await expect(page.getByLabel("Username", { exact: false })).toHaveValue(
        "browser_owner",
      );
      await expect(
        page.getByRole("heading", {
          name: "Updated profile owner",
          exact: true,
        }),
      ).toBeVisible();
      expect(writes).toEqual([
        {
          contractVersion: 1,
          displayName: "Updated profile owner",
          username: "browser_owner",
        },
      ]);
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => {
        const runtime = (globalThis as typeof globalThis & { axe: typeof axe })
          .axe;
        return (
          await runtime.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => v.id);
      });
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("account-profile-" + theme + ".png"),
        fullPage: true,
      });
    },
  );
}
for (const theme of ["light"] as const) {
  test(
    "recipient invitations and account inbox in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await context.addInitScript((appearance) => {
        localStorage.setItem("cloudmarkup.appearance.v1", appearance);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      let recipientSession = false,
        accepted = false;
      const recipientId = "principal_recipient_browser";
      const base: RecipientOrganizationInvitationV1 = {
        contractVersion: 1,
        id: "invitation_12345678-1234-4234-8234-123456789abc",
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        organizationName: "Northstar Team",
        role: "editor",
        expiresAt: "2026-10-01T18:00:00.000Z",
        status: "pending",
        recipient: {
          principalId: recipientId,
          displayName: "Morgan Member",
          username: "morgan_member",
        },
      };
      let items: (typeof base)[] = [];
      const writes: unknown[] = [];
      await context.route("**/v1/me", (route) => {
        if (!recipientSession) return route.fallback();
        return route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              id: recipientId,
              displayName: "Morgan Member",
              resourceVersion: 1,
              organizationContexts: accepted
                ? [
                    {
                      organizationId: TYPED_BACKEND_ORGANIZATION_ID,
                      membershipId: "membership_browser_joined",
                      role: "editor",
                      isOwner: false,
                      capabilities: ["organizations.read", "projects.read"],
                    },
                  ]
                : [],
            },
          },
        });
      });
      await context.route("**/v1/organizations/*/members?*", (route) =>
        route.fulfill({
          json: { apiVersion: "v1", data: [], page: { hasMore: false } },
        }),
      );
      await context.route("**/member-invitations**", async (route) => {
        if (route.request().method() === "POST") {
          writes.push(route.request().postDataJSON());
          items = [base];
          await route.fulfill({
            status: 201,
            json: { apiVersion: "v1", data: base },
          });
        } else
          await route.fulfill({
            json: { apiVersion: "v1", data: items, page: { hasMore: false } },
          });
      });
      await context.route("**/v1/account/invitations**", async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === "POST") {
          expect(route.request().postDataJSON()).toEqual({
            contractVersion: 1,
          });
          if (url.pathname.endsWith("/accept")) {
            accepted = true;
            items = items.map((item) =>
              item.id === base.id ? { ...item, status: "accepted" } : item,
            );
            await route.fulfill({
              json: {
                apiVersion: "v1",
                data: {
                  contractVersion: 1,
                  organizationId: base.organizationId,
                  membershipId: "membership_browser_joined",
                  role: "editor",
                  status: "accepted",
                },
              },
            });
          } else {
            items = items.map((item) =>
              item.id !== base.id ? { ...item, status: "declined" } : item,
            );
            await route.fulfill({ json: { apiVersion: "v1", data: items[1] } });
          }
        } else
          await route.fulfill({
            json: { apiVersion: "v1", data: items, page: { hasMore: false } },
          });
      });
      await page.goto(root + "/settings/members");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      await page.getByLabel("Find member by").selectOption("user-id");
      await page.getByLabel("Member user ID").fill(recipientId);
      await page
        .getByRole("button", { name: "Send invitation", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText(/Invitation sent to Morgan Member/),
      ).toBeVisible();
      expect(writes).toEqual([
        {
          contractVersion: 1,
          role: "editor",
          recipient: { kind: "user-id", userId: recipientId },
        },
      ]);
      await page.screenshot({
        path: testInfo.outputPath("organization-invitations-" + theme + ".png"),
        fullPage: true,
      });
      items.push({
        ...base,
        id: "invitation_22345678-1234-4234-8234-123456789abc",
        organizationId: "org_second",
        organizationName: "Second Studio",
      });
      recipientSession = true;
      await page.goto("/settings/invitations");
      if (await tour.isVisible()) await tour.click();
      await expect(
        page.getByRole("heading", { name: "Invitations", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Accept invitation to Northstar Team",
        }),
      ).toBeVisible();
      expect(accepted).toBe(false);
      await page
        .getByRole("button", { name: "Decline invitation to Second Studio" })
        .click();
      await expect(
        page.getByText("Invitation to Second Studio declined."),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Accept invitation to Northstar Team" })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("link", { name: "Open workspace", exact: true }),
      ).toHaveAttribute("href", root + "/projects");
      await page
        .getByRole("button", { name: "Open authenticated account" })
        .click();
      await expect(
        page
          .getByRole("dialog", { name: "Authenticated account" })
          .getByRole("link", { name: "Invitations", exact: true }),
      ).toHaveAttribute("href", "/settings/invitations");
      await page.keyboard.press("Escape");
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () =>
        (
          await (globalThis as typeof globalThis & { axe: typeof axe }).axe.run(
            document,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          )
        ).violations.map((v) => v.id),
      );
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("account-invitations-" + theme + ".png"),
        fullPage: true,
      });
    },
  );
}
for (const theme of ["light"] as const) {
  test(
    "member role and ownership controls in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await context.addInitScript((appearance) => {
        localStorage.setItem("cloudmarkup.appearance.v1", appearance);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      let own = {
        contractVersion: 1 as const,
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        membershipId: "membership_browser_owner",
        principalId: "principal_typed_backend_owner",
        displayName: "Alex Owner",
        username: null as string | null,
        role: "owner",
        status: "active",
        version: 1,
        etag: '"member:owner:1"',
        joinedAt: "2026-09-30T12:00:00.000Z",
        endedAt: null,
        endReason: null,
      };
      let target = {
        ...own,
        membershipId: "membership_browser_target",
        principalId: "principal_browser_target",
        displayName: "Morgan Member",
        username: "morgan",
        role: "editor",
        etag: '"member:target:1"',
      };
      const writes: unknown[] = [];
      await context.route("**/v1/me", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              id: own.principalId,
              displayName: own.displayName,
              resourceVersion: 1,
              organizationContexts: [
                {
                  organizationId: own.organizationId,
                  membershipId: own.membershipId,
                  role: own.role,
                  isOwner: own.role === "owner",
                  capabilities: [
                    "organizations.read",
                    "projects.read",
                    "memberships.read",
                    "memberships.manage",
                    ...(own.role === "owner"
                      ? ["memberships.assign-owner"]
                      : []),
                  ],
                },
              ],
            },
          },
        }),
      );
      await context.route(
        "**/v1/account/workspaces/" + TYPED_BACKEND_ORGANIZATION_ID,
        (route) =>
          route.fulfill({
            json: {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                id: own.organizationId,
                principalId: own.principalId,
                displayName: "Northstar Team",
                kind: "organization",
                role: own.role,
              },
            },
          }),
      );
      await context.route("**/v1/account/workspaces/*/membership", (route) =>
        route.fulfill({
          headers: { etag: own.etag },
          json: { apiVersion: "v1", data: own },
        }),
      );
      await context.route("**/v1/organizations/*/members?*", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: [own, target],
            page: { hasMore: false },
          },
        }),
      );
      await context.route("**/member-invitations**", (route) =>
        route.fulfill({
          json: { apiVersion: "v1", data: [], page: { hasMore: false } },
        }),
      );
      await context.route(
        "**/v1/organizations/*/membership-changes",
        async (route) => {
          const body = route.request().postDataJSON() as {
            action: string;
            membershipId: string;
            role?: string;
            targetMembershipId?: string;
            targetVersion?: number;
          };
          writes.push(body);
          expect(route.request().headers()["idempotency-key"]).toMatch(
            /^membership_/,
          );
          if (body.action === "set-role") {
            expect(route.request().headers()["if-match"]).toBe(target.etag);
            expect(body).toEqual({
              contractVersion: 1,
              action: "set-role",
              membershipId: target.membershipId,
              role: "viewer",
            });
            target = {
              ...target,
              role: "viewer",
              version: 2,
              etag: '"member:target:2"',
            };
          } else {
            expect(body).toEqual({
              contractVersion: 1,
              action: "transfer-ownership",
              membershipId: own.membershipId,
              targetMembershipId: target.membershipId,
              targetVersion: 2,
            });
            expect(route.request().headers()["if-match"]).toBe(own.etag);
            own = {
              ...own,
              role: "administrator",
              version: 2,
              etag: '"member:owner:2"',
            };
            target = {
              ...target,
              role: "owner",
              version: 3,
              etag: '"member:target:3"',
            };
          }
          const states = body.action === "set-role" ? [target] : [own, target];
          await route.fulfill({
            json: {
              apiVersion: "v1",
              data: {
                contractVersion: 1,
                organizationId: own.organizationId,
                actorPrincipalId: own.principalId,
                action: body.action,
                members: states.map((m) => ({
                  membershipId: m.membershipId,
                  principalId: m.principalId,
                  role: m.role,
                  status: m.status,
                  version: m.version,
                })),
                occurredAt: own.joinedAt,
              },
            },
          });
        },
      );
      await page.goto(root + "/settings/members");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      await expect(
        page.getByRole("table", { name: "Organization member roster" }),
      ).toContainText("Morgan Member");
      await page
        .getByRole("button", { name: "Manage member access", exact: true })
        .click();
      let dialog = page.getByRole("dialog", { name: "Manage member access" });
      await expect(
        dialog.getByRole("combobox", { name: "Member", exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Review role change" }).click();
      expect(writes).toHaveLength(0);
      await dialog
        .getByRole("button", { name: "Confirm membership change" })
        .focus();
      await page.keyboard.press("Enter");
      await expect(dialog).not.toBeVisible();
      await expect(
        page.getByRole("table", { name: "Organization member roster" }),
      ).toContainText("Viewer");
      await page
        .getByRole("button", { name: "Manage member access", exact: true })
        .click();
      dialog = page.getByRole("dialog", { name: "Manage member access" });
      await dialog
        .getByRole("button", { name: "Review ownership transfer" })
        .click();
      await expect(
        dialog.getByText(/You will become an administrator/),
      ).toBeVisible();
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () =>
        (
          await (globalThis as typeof globalThis & { axe: typeof axe }).axe.run(
            document,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          )
        ).violations.map((v) => v.id),
      );
      expect(violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath("member-transfer-" + theme + ".png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Confirm membership change" })
        .click();
      await expect(dialog).not.toBeVisible();
      expect(writes).toHaveLength(2);
      await expect(
        page.getByRole("table", { name: "Organization member roster" }),
      ).toContainText("Administrator");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("member-roster-" + theme + ".png"),
        fullPage: true,
      });
    },
  );
}

for (const theme of ["light"] as const) {
  test(
    "account session security controls in " + theme,
    async ({ context, page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 960 });
      await context.addInitScript((appearance) => {
        localStorage.setItem("cloudmarkup.appearance.v1", appearance);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      const now = "2026-10-01T00:00:00.000Z",
        actor = "principal_typed_backend_owner";
      const other = {
        contractVersion: 1,
        principalId: actor,
        id: "browser_" + "a".repeat(64),
        authenticatedAt: now,
        expiresAt: "2026-10-01T08:00:00.000Z",
        current: false,
      };
      const own = { ...other, id: "browser_" + "b".repeat(64), current: true };
      let ended = false;
      const writes: unknown[] = [];
      await context.route("**/v1/account/sessions?**", (route) =>
        route.fulfill({
          json: {
            apiVersion: "v1",
            data: ended ? [own] : [other, own],
            page: { hasMore: false },
          },
        }),
      );
      await context.route("**/v1/account/session-changes", async (route) => {
        const body = route.request().postDataJSON() as {
          contractVersion: number;
          action: string;
          sessionId: string;
        };
        expect(body).toEqual({
          contractVersion: 1,
          action: "revoke",
          sessionId: other.id,
        });
        expect(route.request().headers()["idempotency-key"]).toMatch(
          /^session_/,
        );
        writes.push(body);
        ended = true;
        await route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              principalId: actor,
              action: "revoke",
              sessionId: other.id,
              authenticatedThrough: null,
              occurredAt: now,
            },
          },
        });
      });
      await page.goto("/settings/security");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      await expect(
        page.getByRole("heading", { name: "Browser sessions", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "End browser sign-in 1", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "End account sessions" });
      await expect(
        dialog.getByText(/billing history and local draft recovery/),
      ).toBeVisible();
      expect(writes).toHaveLength(0);
      await page.addScriptTag({ content: axe.source });
      expect(
        await page.evaluate(async () =>
          (
            await (
              globalThis as typeof globalThis & { axe: typeof axe }
            ).axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations.map((v) => v.id),
        ),
      ).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath("session-confirm-" + theme + ".png"),
        fullPage: true,
      });
      await dialog
        .getByRole("button", { name: "Confirm ending sessions" })
        .focus();
      await page.keyboard.press("Enter");
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText("The selected sign-in ended.")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "End this sign-in", exact: true }),
      ).toBeVisible();
      expect(writes).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("session-security-" + theme + ".png"),
        fullPage: true,
      });
    },
  );
}

for (const theme of ["light"] as const) {
  test(
    "account password and verified email controls in " + theme,
    async ({ context, page }, testInfo) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.setViewportSize({ width: 1440, height: 960 });
      await context.addInitScript((value) => {
        localStorage.setItem("cloudmarkup.appearance.v1", value);
      }, theme);
      await new TypedBackendApiHarness({ role: "owner" }).install(context);
      const actor = "principal_typed_backend_owner";
      let email = "old@example.com";
      const state = () => ({
        contractVersion: 1,
        principalId: actor,
        email,
        emailVerified: true,
        authenticatorEnabled: false,
      });
      const actions: string[] = [];
      await context.route("**/v1/account/sessions?**", (route) =>
        route.fulfill({
          json: { apiVersion: "v1", data: [], page: { hasMore: false } },
        }),
      );
      await context.route("**/v1/account/credentials", (route) =>
        route.fulfill({ json: { apiVersion: "v1", data: state() } }),
      );
      await context.route("**/v1/account/credential-changes", async (route) => {
        const body = route.request().postDataJSON() as {
          attemptId: string;
          action: string;
          code?: string;
          email?: string;
        };
        expect(route.request().headers()["x-cloudmarkup-account"]).toBe(actor);
        expect(body.attemptId).toMatch(/^[a-f0-9-]{36}$/u);
        actions.push(body.action);
        const rejected =
          body.action === "email-confirm" && body.code === "000000";
        if (body.action === "email-confirm" && !rejected)
          email = "new@example.com";
        await route.fulfill({
          json: {
            apiVersion: "v1",
            data: {
              contractVersion: 1,
              principalId: actor,
              attemptId: body.attemptId,
              action: body.action,
              outcome: rejected ? "rejected" : "succeeded",
              problem: rejected ? "incorrect-code" : null,
              state: rejected ? null : state(),
            },
          },
        });
      });
      await page.goto("/settings/security");
      const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
      if (await tour.isVisible()) await tour.click();
      const controls = page.getByRole("region", {
        name: "Password and sign-in email",
      });
      await controls.getByText("Change your password", { exact: true }).click();
      await expect(
        controls.getByRole("button", { name: "Change password", exact: true }),
      ).toBeEnabled();
      await controls
        .getByLabel("Current password", { exact: true })
        .fill("Synthetic-old-Password1!");
      await controls
        .getByLabel("New password", { exact: true })
        .fill("Synthetic-new-Password2!");
      await controls
        .getByLabel("Confirm new password", { exact: true })
        .fill("Synthetic-new-Password2!");
      await controls
        .getByRole("button", { name: "Change password", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        controls.getByText("Password changed.", { exact: true }),
      ).toBeVisible();
      await expect(
        controls.getByLabel("Current password", { exact: true }),
      ).toHaveValue("");
      await controls
        .getByText("Update your sign-in email", { exact: true })
        .click();
      await controls.getByLabel("New email address").fill("new@example.com");
      await controls
        .getByRole("button", { name: "Send verification code" })
        .click();
      await expect(controls.getByText(/Email update requested/u)).toBeVisible();
      await expect(
        controls.getByText("old@example.com · Verified", { exact: true }),
      ).toBeVisible();
      await controls.getByLabel("Email verification code").fill("000000");
      await controls
        .getByRole("button", { name: "Verify email", exact: true })
        .click();
      await expect(
        controls.getByText(/verification code was not accepted/u),
      ).toBeVisible();
      await expect(controls.getByLabel("Email verification code")).toHaveValue(
        "",
      );
      await controls.getByLabel("Email verification code").fill("123456");
      await controls
        .getByRole("button", { name: "Verify email", exact: true })
        .click();
      await expect(
        controls.getByText("Email verified: new@example.com.", { exact: true }),
      ).toBeVisible();
      expect(actions).toEqual([
        "password-change",
        "email-start",
        "email-confirm",
        "email-confirm",
      ]);
      await page.addScriptTag({ content: axe.source });
      expect(
        await page.evaluate(async () =>
          (
            await (
              globalThis as typeof globalThis & { axe: typeof axe }
            ).axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations.map((v) => v.id),
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(browserErrors).toEqual([]);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath("account-credentials-" + theme + ".png"),
      });
    },
  );
}
