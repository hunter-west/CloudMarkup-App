import { expect, test } from "@playwright/test";

test("keeps the unconfigured Vite preview on the synthetic CloudMarkup boundary", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  const failedResources: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/v1/")) {
      apiRequests.push(request.url());
    }
  });
  page.on("requestfailed", (request) => {
    failedResources.push(request.url());
  });

  await page.goto("/organizations/local-org/projects");
  await expect(page.getByText("CloudMarkup", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  await expect(page.getByText("CloudMarkup is unavailable")).toHaveCount(0);
  await expect.poll(() => apiRequests).toEqual([]);
  expect(failedResources).toEqual([]);
});
