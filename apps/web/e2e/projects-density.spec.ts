import { expect, test } from "@playwright/test";
import axe from "axe-core";

const projectsPath = "/organizations/local-org/projects";

test("keeps first-use choices compact without changing mode geometry", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto(projectsPath);

  const firstUse = page.getByTestId("first-use-experience");
  await expect(firstUse).toBeVisible();

  const experienceGroup = page.getByRole("group", {
    name: "Experience preference",
  });
  const choices = experienceGroup.locator("label");
  await expect(choices).toHaveCount(2);

  const guidedBox = await choices.nth(0).boundingBox();
  const professionalBox = await choices.nth(1).boundingBox();
  expect(guidedBox).not.toBeNull();
  expect(professionalBox).not.toBeNull();
  expect(
    Math.abs((guidedBox?.width ?? 0) - (professionalBox?.width ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((guidedBox?.height ?? 0) - (professionalBox?.height ?? 0)),
  ).toBeLessThanOrEqual(1);

  for (const control of await firstUse
    .locator('input[type="radio"]:visible, input[type="checkbox"]:visible')
    .all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(20);
    expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(20);
  }

  const firstUseBox = await firstUse.boundingBox();
  expect(firstUseBox).not.toBeNull();
  expect(firstUseBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(620);
  await expect(
    page.getByRole("button", { name: "Start local experience" }),
  ).toBeInViewport();
  const beforeMode = await firstUse.boundingBox();
  await page.getByRole("radio", { name: "Professional", exact: true }).check();
  expect(await firstUse.boundingBox()).toEqual(beforeMode);
  await expect(
    page.getByText("Optional defaults and teaching", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("compact-first-use-desktop.png"),
    fullPage: true,
  });
});

test("keeps the compact Projects setup free of horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ height: 900, width: 540 });
  await page.goto(projectsPath);

  await expect(page.getByTestId("first-use-experience")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: 540, scrollWidth: 540 });

  for (const choice of await page
    .getByRole("group", { name: "Experience preference" })
    .locator("label")
    .all()) {
    const box = await choice.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: testInfo.outputPath("compact-first-use-phone.png"),
    fullPage: true,
  });
});

// Desktop tour placement/motion has a dedicated check; keep narrow-screen target/focus checks here.
for (const width of [390]) {
  test(`keeps walkthrough guidance on demand with accessible controls at ${String(width)} pixels`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ height: 900, width });
    await page.goto(
      "/organizations/local-org/projects/field-notes/editor?start=template",
    );
    const walkthrough = page.getByTestId("guided-walkthrough");
    await expect(walkthrough).toBeVisible();
    const why = walkthrough.getByRole("button", {
      name: "Why this walkthrough step matters",
    });
    await expect(
      page.getByText(
        "Start with one service. You can always add more as your idea takes shape.",
      ),
    ).toHaveCount(0);
    await why.focus();
    await why.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Why this matters" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(why).toBeFocused();
    await expect(
      page.getByRole("dialog", { name: "Why this matters" }),
    ).toHaveCount(0);
    if (width === 390) {
      for (const control of await walkthrough.getByRole("button").all()) {
        expect(
          (await control.boundingBox())?.height ?? 0,
        ).toBeGreaterThanOrEqual(44);
      }
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const runtime = (globalThis as typeof globalThis & { axe: typeof axe })
        .axe;
      return (
        await runtime.run(".guided-walkthrough", {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
          },
        })
      ).violations;
    });
    expect(violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("compact-walkthrough.png"),
      fullPage: true,
    });
  });
}
