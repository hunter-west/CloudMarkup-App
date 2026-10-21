import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { TypedBackendApiHarness } from "./support/typed-backend-api-harness.js";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4193") await route.abort();
    else if (url.pathname === "/api/auth/session/v1/restore")
      await route.fulfill({
        json: {
          schemaVersion: 1,
          accessToken: `${"a".repeat(48)}.${"b".repeat(48)}.${"c".repeat(48)}`,
          expiresIn: 1800,
          sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
    else if (url.pathname.startsWith("/api/"))
      await route.fulfill({ status: 503, json: {} });
    else await route.fallback();
  });
  await new TypedBackendApiHarness({ role: "owner" }).install(context);
  let photo = {
    contractVersion: 1,
    principalId: "principal_typed_backend_owner",
    version: 0,
    image: null as string | null,
  };
  await context.route(
    "**/typed-backend-api/v1/account/photo",
    async (route) => {
      const request = route.request(),
        etag = () => '"photo:synthetic:' + String(photo.version) + '"';
      if (request.method() === "PUT") {
        if (request.headers()["if-match"] !== etag()) {
          await route.fulfill({
            status: 412,
            json: {
              apiVersion: "v1",
              error: {
                code: "precondition_failed",
                message: "Changed",
                correlationId: "correlation_photo_browser",
              },
            },
          });
          return;
        }
        const input = request.postDataJSON() as {
          readonly image: string | null;
        };
        photo = { ...photo, version: photo.version + 1, image: input.image };
      }
      await route.fulfill({
        headers: { etag: etag(), "cache-control": "private, no-store" },
        json: { apiVersion: "v1", data: photo },
      });
    },
  );
});
async function ready(page: Page) {
  await page.goto("/organizations/org_local/dashboard");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  const tour = page.getByRole("button", { name: "Dismiss workspace tour" });
  if (await tour.isVisible()) await tour.click();
}
async function theme(page: Page, value: string) {
  await page.evaluate((value) => {
    localStorage.setItem("cloudmarkup.appearance.v1", value);
    location.reload();
  }, value);
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}
const screenshot = (page: Page, name: string) =>
  page.screenshot({
    animations: "disabled",
    path: "../ui-evidence/" + name + ".png",
  });

test("capture actual production shell audit", async ({ page }, info) => {
  test.skip(
    info.project.name !== "1440x900",
    "Exact comparison uses the pre-change 1440x900 baseline.",
  );
  await ready(page);
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    const contrast = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const color = (token: string) =>
        styles.getPropertyValue("--cm-color-" + token).trim();
      const luminance = (hex: string) => {
        const normalized = /^#[a-f0-9]{3}$/iu.test(hex)
          ? "#" +
            Array.from(hex.slice(1))
              .map((value) => value + value)
              .join("")
          : hex;
        const values = normalized.startsWith("#")
          ? normalized
              .slice(1)
              .match(/.{2}/gu)
              ?.map((value) => parseInt(value, 16))
          : normalized
              .match(/[\d.]+/gu)
              ?.slice(0, 3)
              .map(Number);
        const rgb = values?.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
        if (rgb?.length !== 3) throw Error("Unexpected token color: " + hex);
        return (
          (rgb[0] ?? 0) * 0.2126 +
          (rgb[1] ?? 0) * 0.7152 +
          (rgb[2] ?? 0) * 0.0722
        );
      };
      return [
        ["text", "surface", 4.5],
        ["text-muted", "surface", 4.5],
        ["text-muted", "surface-raised", 4.5],
        ["action", "action-subtle", 4.5],
        ["on-action", "action", 4.5],
        ["border-strong", "surface", 3],
        ["border-strong", "surface-raised", 3],
        ["focus", "surface-raised", 3],
      ].map(([foreground, background, minimum]) => {
        const front = color(String(foreground)),
          back = color(String(background));
        const first = luminance(front),
          second = luminance(back);
        return {
          foreground,
          background,
          front,
          back,
          ratio:
            (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
          minimum: Number(minimum),
        };
      });
    });
    await writeFile(
      `../ui-evidence/contrast-${info.project.name}-${value}.json`,
      JSON.stringify(contrast, null, 2),
    );
    for (const pair of contrast)
      expect(
        pair.ratio,
        `${String(pair.foreground)} on ${String(pair.background)}`,
      ).toBeGreaterThanOrEqual(pair.minimum);
    const prefix = `${process.env["UI_CAPTURE_PHASE"] ?? "after"}-${value}`;
    await screenshot(page, prefix + "-dashboard");
    await page
      .getByRole("button", { name: "Hide Navigation", exact: true })
      .click();
    await screenshot(page, prefix + "-collapsed");
    await page
      .getByRole("button", { name: "Show Navigation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open authenticated account" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Authenticated account" }),
    ).toBeVisible();
    await screenshot(page, prefix + "-profile");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Authenticated account" }),
    ).toHaveCount(0);
  }
});

test("both-theme responsive navigation, account hierarchy and keyboard behavior", async ({
  page,
}, info) => {
  await ready(page);
  const compact = (page.viewportSize()?.width ?? 0) < 1200;
  const trigger = page.getByRole("button", {
    name: "Open authenticated account",
  });
  for (const value of ["light", "dark"]) {
    await theme(page, value);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (compact) {
      await page
        .getByRole("button", { name: "Open application navigation" })
        .click();
      const nav = page.getByRole("dialog", { name: "Application navigation" });
      await expect(
        nav.getByRole("link", { name: "Dashboard", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await screenshot(page, `matrix-${info.project.name}-${value}-navigation`);
      await nav.getByRole("link", { name: "Profile", exact: true }).click();
      await expect(nav).toHaveCount(0);
      await expect(page).toHaveURL(/\/settings\/profile$/u);
      await ready(page);
    } else {
      const hide = page.getByRole("button", {
        name: "Hide Navigation",
        exact: true,
      });
      if (await hide.isVisible()) await hide.click();
      const nav = page.getByRole("navigation", {
        name: "Collapsed application navigation",
      });
      await expect(nav.getByRole("link")).toHaveCount(11);
      await expect(
        nav.getByRole("link", { name: "Dashboard", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await nav.getByRole("link", { name: "Profile", exact: true }).focus();
      await expect(
        nav.getByRole("link", { name: "Profile", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("tooltip").filter({ hasText: /^Profile$/u }),
      ).toBeVisible();
      await screenshot(page, `matrix-${info.project.name}-${value}-navigation`);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/settings\/profile$/u);
      await page.reload();
      await expect(
        page.getByRole("navigation", {
          name: "Collapsed application navigation",
        }),
      ).toBeVisible();
      await ready(page);
      await page
        .getByRole("button", { name: "Show Navigation", exact: true })
        .click();
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("dialog", { name: "Authenticated account" });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("button", { name: "Sign out", exact: true }),
      ).toBeVisible();
      await expect(
        menu.getByRole("link", { name: "Personal security", exact: true }),
      ).not.toBeVisible();
      const group = menu.locator("summary").filter({ hasText: /^Account$/u });
      await group.focus();
      await page.keyboard.press("Space");
      await expect(
        menu.getByRole("link", { name: "Personal security", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Space");
      await expect(
        menu.getByRole("link", { name: "Personal security", exact: true }),
      ).not.toBeVisible();
      if (attempt === 0) {
        await screenshot(page, `matrix-${info.project.name}-${value}-account`);
        const box = await menu.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(
            (page.viewportSize()?.width ?? 0) + 1,
          );
          expect(box.y + box.height).toBeLessThanOrEqual(
            (page.viewportSize()?.height ?? 0) + 1,
          );
        }
      }
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    if (!compact) {
      await trigger.click();
      await page
        .getByRole("heading", { name: "Dashboard", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Authenticated account" }),
      ).toHaveCount(0);
    }
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Authenticated account" });
    await menu.getByRole("link", { name: "Profile", exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings\/profile$/u);
    await expect(
      page.getByRole("button", { name: "Upload photo" }),
    ).toBeEnabled();
    await screenshot(page, `matrix-${info.project.name}-${value}-settings`);
    await ready(page);
    if (["1440x900", "phone"].includes(info.project.name)) {
      await trigger.click();
      await expect(
        page.getByRole("dialog", { name: "Authenticated account" }),
      ).toBeVisible();
      await page.addScriptTag({ content: axe.source });
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) =>
              Number.isFinite(animation.effect?.getComputedTiming().endTime),
            )
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      const results = await page.evaluate(async () => {
        const runtime = (window as unknown as { axe: typeof axe }).axe;
        return runtime.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        });
      });
      await writeFile(
        `../ui-evidence/axe-${info.project.name}-${value}.json`,
        JSON.stringify(results.violations, null, 2),
      );
      expect(results.violations).toEqual([]);
      await page.keyboard.press("Escape");
    }
  }
});

test("account support requires current authorized staff access", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "1440x900",
    "Staff visibility is independent of viewport size.",
  );
  let permissions: string[] = [],
    denied = false;
  await context.route("**/typed-backend-api/v1/staff/access", async (route) => {
    if (denied) await route.fulfill({ status: 403, json: {} });
    else
      await route.fulfill({
        json: { apiVersion: "v1", data: { contractVersion: 1, permissions } },
      });
  });

  const open = async () => {
    const response = page.waitForResponse(
      "**/typed-backend-api/v1/staff/access",
    );
    await ready(page);
    await page
      .getByRole("button", { name: "Open authenticated account" })
      .click();
    await response;
    return page.getByRole("dialog", { name: "Authenticated account" });
  };
  let menu = await open();
  await expect(menu.getByRole("link", { name: "Account support" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  permissions = ["accounts.read"];
  menu = await open();
  await expect(
    menu.getByRole("link", { name: "Account support" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("link", { name: "Account support" }),
  ).toHaveAttribute("href", "/staff/accounts");
  await page.keyboard.press("Escape");
  permissions = ["credits.grant"];
  menu = await open();
  await expect(menu.getByRole("link", { name: "Account support" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  denied = true;
  menu = await open();
  await expect(menu.getByRole("link", { name: "Account support" })).toHaveCount(
    0,
  );
});

test("photo preview, cancel, valid save/readback, reload and removal with synthetic transport", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "1440x900",
    "Photo transport scenario runs once; layout has its own full matrix.",
  );
  await ready(page);
  await page.goto("/settings/profile");
  const upload = page.getByRole("button", { name: "Upload photo" });
  await expect(upload).toBeEnabled();
  await page.getByLabel("Choose profile photo").setInputFiles({
    name: "invalid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Choose a JPEG" }),
  ).toBeVisible();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const brush = canvas.getContext("2d");
    if (!brush) throw Error("Canvas unavailable");
    brush.fillStyle = "#365ec8";
    brush.fillRect(0, 0, 192, 192);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  const file = {
    name: "synthetic-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
  await page.getByLabel("Choose profile photo").setInputFiles(file);
  await expect(
    page.getByRole("img", { name: "New profile preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel photo preview" }).click();
  await expect(upload).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Save photo", exact: true }),
  ).toHaveCount(0);
  for (const mime of ["image/jpeg", "image/webp"]) {
    const encoded = await page.evaluate((type) => {
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 192;
      const brush = canvas.getContext("2d");
      if (!brush) throw Error("Canvas unavailable");
      brush.fillStyle = "#365ec8";
      brush.fillRect(0, 0, 192, 192);
      return canvas.toDataURL(type).split(",")[1] ?? "";
    }, mime);
    await page.getByLabel("Choose profile photo").setInputFiles({
      name: "synthetic." + (mime.split("/")[1] ?? "image"),
      mimeType: mime,
      buffer: Buffer.from(encoded, "base64"),
    });
    await expect(
      page.getByRole("img", { name: "New profile preview" }),
    ).toHaveAttribute("src", /^data:image\/png;base64,/u);
    await page.getByRole("button", { name: "Cancel photo preview" }).click();
  }
  await page.getByLabel("Choose profile photo").setInputFiles(file);
  await page.getByRole("button", { name: "Save photo", exact: true }).click();
  await expect(
    page.getByText("Profile photo saved.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#profile-menu-trigger img")).toBeVisible();
  await screenshot(page, "photo-saved-synthetic");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Change photo" }),
  ).toBeEnabled();
  await expect(page.locator("#profile-menu-trigger img")).toBeVisible();
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(
    page.getByText("Profile photo removed.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#profile-menu-trigger img")).toHaveCount(0);
  await expect(upload).toBeFocused();
  await screenshot(page, "photo-removed-synthetic");
});
