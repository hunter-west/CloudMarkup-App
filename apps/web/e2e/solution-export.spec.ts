import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { BrowserContext, Download, Page } from "@playwright/test";

import {
  SOLUTION_EXPORT_ARCHIVE_DIGEST,
  SOLUTION_EXPORT_ARTIFACT_ID,
  SOLUTION_EXPORT_BUILD_EVIDENCE_ID,
  SOLUTION_EXPORT_BUILD_REQUEST_DIGEST,
  SOLUTION_EXPORT_DOWNGRADE_REASON,
  SOLUTION_EXPORT_EXPORT_JOB_ID,
  SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST,
  SOLUTION_EXPORT_NOTES_PROJECT_ID,
  SOLUTION_EXPORT_ORGANIZATION_ID,
  SOLUTION_EXPORT_SOLUTION_REVISION_ID,
  SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST,
  SolutionExportExportApiHarness,
  type SolutionExportScenario,
} from "./support/solution-export-api-harness.js";

test.skip(
  process.env["CLOUDMARKUP_SOLUTION_EXPORT_E2E"] !== "true",
  "Run immutable Solution Export browser scenarios with config/playwright/solution-export.config.ts.",
);

const organizationRoot =
  `/organizations/${SOLUTION_EXPORT_ORGANIZATION_ID}` as const;

function exportPath(projectId: string): string {
  return `${organizationRoot}/projects/${projectId}/exports/${SOLUTION_EXPORT_EXPORT_JOB_ID}`;
}

async function installApi(
  context: BrowserContext,
  scenario: SolutionExportScenario = "complete-supported",
): Promise<SolutionExportExportApiHarness> {
  const api = new SolutionExportExportApiHarness(scenario);
  await api.install(context);
  return api;
}

async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "commit" });
}

async function gotoExport(
  page: Page,
  api: SolutionExportExportApiHarness,
): Promise<void> {
  await goto(page, exportPath(api.projectId));
  await expect(
    page.getByRole("heading", { name: "Solution export", level: 1 }),
  ).toBeVisible();
}

async function digestDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const digest = createHash("sha256");
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (typeof chunk === "string" || chunk instanceof Uint8Array) {
      digest.update(chunk);
      continue;
    }
    throw new TypeError("The browser returned an unsupported download chunk.");
  }
  return `sha256:${digest.digest("hex")}`;
}

test("starts an export only from an immutable Solution Revision with approved selectors and idempotency", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(
    page,
    `${organizationRoot}/projects/${SOLUTION_EXPORT_NOTES_PROJECT_ID}/revisions/${SOLUTION_EXPORT_SOLUTION_REVISION_ID}`,
  );

  await page.getByText("Technical revision details", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Frozen documents and contracts" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "Generate from this exact revision" }),
  ).toBeVisible();
  await page.getByLabel("Environment type").selectOption("staging");
  await page.getByLabel("Export name").fill("notes-api-reviewed");
  await page.getByRole("button", { name: "Generate export" }).click();

  await expect(page).toHaveURL(
    new RegExp(`${exportPath(SOLUTION_EXPORT_NOTES_PROJECT_ID)}$`, "u"),
  );
  const create = api.requests.find(
    (request) =>
      request.method === "POST" &&
      request.path ===
        `/v1/projects/${SOLUTION_EXPORT_NOTES_PROJECT_ID}/solution-export-jobs`,
  );
  expect(create?.headers["idempotency-key"]).toMatch(/^solution-export:/u);
  expect(create?.body).toEqual({
    contractVersion: 1,
    diagram: {
      background: "opaque-light",
      includeStableDeploymentIdentifiers: false,
      maxHeight: 4_096,
      maxWidth: 4_096,
      profile: "presentation",
      scale: 2,
    },
    environment: { environmentType: "staging" },
    exportName: "notes-api-reviewed",
    solutionRevisionId: SOLUTION_EXPORT_SOLUTION_REVISION_ID,
    targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
  });
  expect(create?.body).not.toMatchObject({
    manifestDigest: expect.anything(),
    organizationId: expect.anything(),
    tenantId: expect.anything(),
  });
});

for (const success of [
  {
    coverage: "Infrastructure only",
    scenario: "infrastructure-only",
  },
  {
    coverage: "Starter application",
    scenario: "generated-starter",
  },
  {
    coverage: "Complete supported pattern",
    scenario: "complete-supported",
  },
] as const) {
  test(`shows exact ${success.scenario} success coverage without overclaiming`, async ({
    context,
    page,
  }) => {
    const api = await installApi(context, success.scenario);
    await gotoExport(page, api);

    await expect(
      page.getByRole("heading", { name: "Export checks passed" }),
    ).toBeVisible();
    await page
      .getByText("Application coverage and build details", { exact: true })
      .click();
    await page
      .getByText("Revision and technical details", { exact: true })
      .click();
    const assessment = page.getByRole("region", {
      exact: true,
      name: success.coverage,
    });
    await expect(assessment).toBeVisible();
    await expect(
      assessment.getByText("Exact revision assessment"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Artifact review and download" }),
    ).toBeVisible();
    const exactBinding = page.getByRole("region", {
      name: "Exact revision and target binding",
    });
    await expect(
      exactBinding.getByText(SOLUTION_EXPORT_TARGET_SETTINGS_DIGEST),
    ).toBeVisible();
    if (success.scenario === "infrastructure-only") {
      await expect(
        page.getByRole("heading", {
          name: "No application verification recorded",
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Application code is required."),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Application" }).click();
      await expect(
        page.getByText(
          "Application source is not included for this coverage state.",
        ),
      ).toBeVisible();
    } else {
      const verification = page.getByRole("region", {
        name: `${success.coverage} confirmed`,
      });
      await expect(
        verification.getByText(SOLUTION_EXPORT_BUILD_EVIDENCE_ID),
      ).toBeVisible();
      await expect(
        verification.getByText(SOLUTION_EXPORT_BUILD_REQUEST_DIGEST),
      ).toBeVisible();
      await expect(
        verification.getByText(SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Tests" }).click();
      const testsPanel = page.getByRole("tabpanel", { name: "Tests" });
      await expect(
        testsPanel.getByRole("heading", {
          name: "Application build/test Evidence",
        }),
      ).toBeVisible();
      await expect(
        testsPanel.getByText(SOLUTION_EXPORT_BUILD_EVIDENCE_ID),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Application" }).click();
      await expect(
        page.getByRole("button", { name: /application\/src\/handler\.ts/u }),
      ).toBeVisible();
    }
  });
}

for (const failure of [
  {
    code: "COMPILER.INVALID_SOLUTION_REVISION",
    scenario: "compiler-error",
  },
  {
    code: "APPLICATION_GENERATION.UNSUPPORTED_OPERATION",
    scenario: "application-generation-error",
  },
  {
    code: "APPLICATION_BUILD.TYPECHECK_FAILED",
    scenario: "application-build-error",
  },
  {
    code: "APPLICATION_TEST.CONTRACT_FAILED",
    scenario: "application-test-error",
  },
  {
    code: "TERRAFORM_VALIDATION.INVALID_CONFIGURATION",
    scenario: "terraform-validation-error",
  },
] as const) {
  test(`keeps ${failure.scenario} diagnostics visible and download blocked`, async ({
    context,
    page,
  }) => {
    const api = await installApi(context, failure.scenario);
    await gotoExport(page, api);

    await expect(
      page.getByRole("heading", { name: "Export checks failed" }),
    ).toBeVisible();
    await page.getByText("Diagnostic details", { exact: true }).first().click();
    await expect(page.getByText(failure.code, { exact: true })).toBeVisible();
    await page
      .getByText("Application coverage and build details", { exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Download blocked" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download ZIP" }),
    ).toHaveCount(0);
    if (
      failure.scenario === "application-build-error" ||
      failure.scenario === "application-test-error"
    ) {
      const assessment = page.getByRole("region", {
        exact: true,
        name: "Starter application",
      });
      await expect(
        assessment.getByText("Exact revision assessment"),
      ).toBeVisible();
      const verification = page.getByRole("region", {
        name: "Custom implementation required",
      });
      await expect(
        verification.getByText(SOLUTION_EXPORT_DOWNGRADE_REASON),
      ).toBeVisible();
      await expect(
        verification.getByText("No passing build Evidence"),
      ).toBeVisible();
      await expect(
        verification.getByText(SOLUTION_EXPORT_GENERATION_ARTIFACT_DIGEST),
      ).toBeVisible();
    } else if (failure.scenario === "terraform-validation-error") {
      await expect(
        page.getByRole("region", {
          name: "Complete supported pattern confirmed",
        }),
      ).toContainText(SOLUTION_EXPORT_BUILD_EVIDENCE_ID);
    } else {
      await expect(
        page.getByRole("heading", {
          name: "No application verification recorded",
        }),
      ).toBeVisible();
    }
  });
}

test("keeps a retriable worker failure bound to the same job and supports explicit cancellation", async ({
  context,
  page,
}) => {
  const api = await installApi(context, "retry-cancel");
  await gotoExport(page, api);

  await expect(
    page.getByRole("heading", { name: "Export checks in progress" }),
  ).toBeVisible();
  await expect(page.getByText("WORKER_RETRY_SCHEDULED")).toBeVisible();
  await page
    .getByText("Revision and technical details", { exact: true })
    .click();
  await expect(
    page.getByText(SOLUTION_EXPORT_SOLUTION_REVISION_ID),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel export" }).click();
  await expect(
    page.getByRole("dialog", { name: "Cancel this export job?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request cancellation" }).click();

  await expect(
    page.getByRole("heading", { name: "Cancellation requested" }),
  ).toBeVisible();
  expect(
    api.requestCount(
      "POST",
      `/v1/projects/${api.projectId}/solution-export-jobs/${SOLUTION_EXPORT_EXPORT_JOB_ID}/cancel`,
    ),
  ).toBe(1);
});

test("keeps Guided and Professional action/tab ordering and active job, tab, and file state identical", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await gotoExport(page, api);
  await expect(page.getByRole("tab", { name: "Sources" })).toBeVisible();

  const tabs = page.getByRole("tab");
  const guidedTabOrder = await tabs.allTextContents();
  expect(guidedTabOrder).toEqual([
    "Sources",
    "Diagram",
    "IaC",
    "Application",
    "Built artifacts",
    "Tests",
    "Diff",
    "Manifest",
  ]);
  const downloadActions = page
    .locator(".solution-export__download")
    .getByRole("button");
  const guidedActionOrder = await downloadActions.allTextContents();
  expect(guidedActionOrder).toEqual(["Download ZIP"]);
  await expect(page.locator(".solution-export")).toHaveAttribute(
    "data-assistance-mode",
    "guided",
  );

  await page.getByRole("tab", { name: "IaC" }).click();
  await page.getByRole("tab", { name: "Diagram" }).click();
  await expect(
    page.getByAltText("SVG architecture diagram for notes-api-export"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "diagram/architecture.svg" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "PNG preview" }).click();
  await expect(
    page.getByAltText("PNG architecture diagram for notes-api-export"),
  ).toBeVisible();
  await page.getByRole("button", { name: "SVG preview" }).click();
  await expect(
    page.getByAltText("SVG architecture diagram for notes-api-export"),
  ).toBeVisible();

  await page.getByRole("tab", { name: "IaC" }).click();
  const selectedFile = page.getByRole("button", {
    name: /infrastructure\/main\.tf/u,
  });
  await expect(selectedFile).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByText('resource "aws_lambda_function" "notes" {}'),
  ).toBeVisible();
  const jobUrl = page.url();

  await page.getByRole("button", { name: "Professional" }).click();
  await expect(
    page.getByRole("button", { name: "Professional" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".solution-export")).toHaveAttribute(
    "data-assistance-mode",
    "professional",
  );
  expect(await tabs.allTextContents()).toEqual(guidedTabOrder);
  expect(await downloadActions.allTextContents()).toEqual(guidedActionOrder);
  await expect(page.getByRole("tab", { name: "IaC" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(selectedFile).toHaveAttribute("aria-current", "true");
  expect(page.url()).toBe(jobUrl);

  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.getByText("Semantic: changed")).toBeVisible();
  await expect(page.getByText("Semantic: formatting only")).toBeVisible();
  await expect(
    page.getByText(/solutionartifact_solution_export_previous/u),
  ).toBeVisible();
});

test("keeps expired artifact metadata reviewable without exposing a download grant", async ({
  context,
  page,
}) => {
  const api = await installApi(context, "expired-artifact");
  await gotoExport(page, api);

  await expect(
    page.getByRole("heading", { name: "Artifact download expired" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Artifact review and download" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download ZIP" })).toHaveCount(
    0,
  );
  expect(
    api.requestCount(
      "POST",
      `/v1/projects/${api.projectId}/solution-export-artifacts/${SOLUTION_EXPORT_ARTIFACT_ID}/download-grants`,
    ),
  ).toBe(0);
});

test("rejects cross-tenant route selectors before an export job is requested", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await goto(
    page,
    `/organizations/org_other/projects/${api.projectId}/exports/${SOLUTION_EXPORT_EXPORT_JOB_ID}`,
  );

  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
  expect(
    api.requestCount(
      "GET",
      `/v1/projects/${api.projectId}/solution-export-jobs/${SOLUTION_EXPORT_EXPORT_JOB_ID}`,
    ),
  ).toBe(0);
});

test("reproducible reruns retain exact digests, previous-export diff, and sanitized presentation", async ({
  context,
  page,
}) => {
  const api = await installApi(context, "reproducible-rerun");
  await gotoExport(page, api);
  await page.getByRole("tab", { name: "Manifest" }).click();
  const manifest = page.getByRole("tabpanel", { name: "Manifest" });
  await expect(
    manifest.getByText(SOLUTION_EXPORT_ARCHIVE_DIGEST).first(),
  ).toBeVisible();
  const firstDigestCount = await manifest
    .getByText(SOLUTION_EXPORT_ARCHIVE_DIGEST)
    .count();

  await page.reload({ waitUntil: "commit" });
  await page.getByRole("tab", { name: "Manifest" }).click();
  const repeatedManifest = page.getByRole("tabpanel", { name: "Manifest" });
  await expect(
    repeatedManifest.getByText(SOLUTION_EXPORT_ARCHIVE_DIGEST).first(),
  ).toBeVisible();
  expect(
    await repeatedManifest.getByText(SOLUTION_EXPORT_ARCHIVE_DIGEST).count(),
  ).toBe(firstDigestCount);
  const visible = await page.locator("body").innerText();
  expect(visible).not.toMatch(
    /C:\\|\/Users\/|solution_export-e2e|signed-url|secret|token=/iu,
  );
});

test("downloads through the authenticated short-lived grant and verifies filename and checksum binding", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  await gotoExport(page, api);
  await expect(
    page.getByRole("button", { name: "Download ZIP" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("notes-api.zip");
  expect(await digestDownload(download)).toBe(SOLUTION_EXPORT_ARCHIVE_DIGEST);
  await expect(page.getByText("Verified ZIP download started.")).toBeVisible();

  const grant = api.requests.find(
    (request) =>
      request.method === "POST" && request.path.endsWith("/download-grants"),
  );
  expect(grant?.headers["idempotency-key"]).toMatch(
    /^solution-export-download:/u,
  );
  const content = api.requests.find((request) =>
    request.path.endsWith("/downloadgrant_solution_export/content"),
  );
  expect(content?.headers["authorization"]).toBe(
    "Bearer local-development:solution_export-e2e",
  );
  expect(content?.headers["accept"]).toBe("application/zip");
});

test("resumes an interrupted gateway response with the exact export request", async ({
  context,
  page,
}) => {
  const api = await installApi(context);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  await context.route(
    "**/v1/projects/" +
      SOLUTION_EXPORT_NOTES_PROJECT_ID +
      "/solution-export-jobs",
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }
      attempts.push({
        key: request.headers()["idempotency-key"],
        body: request.postData(),
      });
      if (attempts.length === 1) {
        await route.fulfill({
          status: 504,
          contentType: "text/html",
          body: "<html>Gateway timeout</html>",
        });
        return;
      }
      await route.fallback();
    },
  );
  await goto(
    page,
    organizationRoot +
      "/projects/" +
      SOLUTION_EXPORT_NOTES_PROJECT_ID +
      "/revisions/" +
      SOLUTION_EXPORT_SOLUTION_REVISION_ID,
  );
  await page.getByRole("button", { name: "Generate export" }).click();
  await expect(page).toHaveURL(
    new RegExp(exportPath(api.projectId) + "$", "u"),
    { timeout: 30000 },
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0]?.key).toMatch(/^solution-export:/u);
});
