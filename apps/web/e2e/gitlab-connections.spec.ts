import { expect, test } from "@playwright/test";
import type { BrowserContext, Route } from "@playwright/test";
import { createServer } from "node:http";
import axe from "axe-core";
import {
  TypedBackendApiHarness,
  TYPED_BACKEND_ORGANIZATION_ID,
} from "./support/typed-backend-api-harness.js";

test.skip(
  process.env["CLOUDMARKUP_TYPED_BACKEND_E2E"] !== "true",
  "Uses the isolated typed-backend browser profile.",
);
const browserOrigin = "https://app.gitlab-fixture.test";
async function proxySyntheticApp(route: Route, localOrigin: string) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== browserOrigin) {
    await route.abort();
    return;
  }
  const isModuleGet =
    request.method() === "GET" &&
    request.resourceType() === "script" &&
    ["/src/", "/@", "/node_modules/"].some((prefix) =>
      url.pathname.startsWith(prefix),
    );
  const response = await route.fetch({
    url: localOrigin + url.pathname + url.search,
    // Only synthetic Vite module GETs may recover one connection reset.
    // HTTP errors, persistent resets, documents and API writes still fail.
    maxRetries: isModuleGet ? 1 : 0,
  });
  await route.fulfill({ response });
}
async function install(context: BrowserContext, localOrigin: string) {
  await context.routeWebSocket("**/*", async (socket) => {
    await socket.close();
  });
  // Keep HTTPS callback semantics while proxying only the synthetic app to local Vite.
  await context.route("**/*", (route) => proxySyntheticApp(route, localOrigin));
  const api = new TypedBackendApiHarness({ role: "owner" });
  await api.install(context);
  return api;
}
test("synthetic module proxy bounds reset recovery and preserves failed writes and HTTP errors", async ({
  context,
  page,
}) => {
  let scenario = "reset-once";
  let moduleRequests = 0;
  let writeRequests = 0;
  const proxyErrors: string[] = [];
  const server = createServer((request, response) => {
    if (request.url === "/src/reset-fixture.js") {
      moduleRequests++;
      if (
        scenario === "reset-always" ||
        (scenario === "reset-once" && moduleRequests === 1)
      ) {
        request.socket.destroy();
        return;
      }
      response.writeHead(scenario === "http-error" ? 503 : 200, {
        "content-type": "application/javascript",
      });
      response.end("window.fixtureModuleLoaded = true;");
      return;
    }
    if (request.url === "/write" && request.method === "POST") {
      writeRequests++;
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      "<!doctype html><script>window.fixtureModuleLoaded = false;</script>" +
        (scenario === "write-reset"
          ? ""
          : '<script src="/src/reset-fixture.js"></script>'),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw Error("Synthetic reset fixture has no loopback port");
  }
  const localOrigin = "http://127.0.0.1:" + String(address.port);
  await context.route("**/*", async (route) => {
    try {
      await proxySyntheticApp(route, localOrigin);
    } catch (error) {
      // This fault-injection case observes the error; normal fixtures propagate it.
      proxyErrors.push(String(error).split("\n")[0] ?? "");
      await route.abort();
    }
  });
  try {
    await page.goto(browserOrigin);
    expect(moduleRequests).toBe(2);
    expect(proxyErrors).toEqual([]);
    expect(
      await page.evaluate((): unknown =>
        Reflect.get(window, "fixtureModuleLoaded"),
      ),
    ).toBe(true);

    scenario = "reset-always";
    moduleRequests = 0;
    await page.goto(browserOrigin);
    expect(moduleRequests).toBe(2);
    expect(proxyErrors).toHaveLength(1);
    expect(proxyErrors[0]).toMatch(/socket hang up/u);
    expect(
      await page.evaluate((): unknown =>
        Reflect.get(window, "fixtureModuleLoaded"),
      ),
    ).toBe(false);

    scenario = "http-error";
    moduleRequests = 0;
    await page.goto(browserOrigin);
    expect(moduleRequests).toBe(1);
    expect(proxyErrors).toHaveLength(1);
    expect(
      await page.evaluate((): unknown =>
        Reflect.get(window, "fixtureModuleLoaded"),
      ),
    ).toBe(false);

    scenario = "write-reset";
    await page.goto(browserOrigin);
    expect(
      await page.evaluate(() =>
        fetch("/write", { method: "POST", body: "synthetic-mutation" }).then(
          () => "unexpected-success",
          () => "network-failure",
        ),
      ),
    ).toBe("network-failure");
    expect(writeRequests).toBe(1);
    expect(proxyErrors).toHaveLength(2);
    expect(proxyErrors[1]).toMatch(/socket hang up/u);
  } finally {
    await page.close();
    await context.unrouteAll({ behavior: "wait" });
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});
// Narrow-screen geometry is stricter; the unchanged connection/retry workflow runs once.
for (const width of [390]) {
  test(
    "GitLab connection and disconnect through the initiating tab at " +
      String(width),
    async ({ context, page, baseURL }, testInfo) => {
      if (!baseURL) throw Error("Local browser origin missing");
      await page.setViewportSize({ width, height: 1000 });
      await install(context, baseURL);
      const state = "s".repeat(43),
        code = "synthetic-gitlab-code-1234567890",
        intentId = "gitlablink_" + "a".repeat(32);
      const connection = {
        contractVersion: 1,
        id: "gitlab_" + "b".repeat(32),
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        principalId: "principal_typed_backend_owner",
        providerUsername: "synthetic-gitlab-owner",
        status: "active",
        providerRevocation: "not-requested",
      };
      let linked = false,
        disconnected = false,
        completions = 0,
        providerNavigations = 0;
      let selectionVersion = 0,
        projectSelected = false;
      const callbackRequests: string[] = [];
      context.on("page", (opened) =>
        opened.on("request", (request) => {
          if (request.url().includes("/typed-backend-api/"))
            callbackRequests.push(request.url());
        }),
      );
      await context.route(
        "https://gitlab.com/oauth/authorize?*",
        async (route) => {
          providerNavigations++;
          const url = new URL(route.request().url());
          expect(url.searchParams.get("scope")).toBe("api");
          expect(url.searchParams.get("state")).toBe(state);
          // Routing does not redispatch an HTTP redirect to another fixture handler.
          const callbackUrl =
            browserOrigin +
            "/account/gitlab/callback?state=" +
            state +
            "&code=" +
            code;
          await route.fulfill({
            contentType: "text/html",
            body:
              "<!doctype html><script>location.replace(" +
              JSON.stringify(callbackUrl) +
              ")</script>",
          });
        },
      );
      await context.route(
        /\/typed-backend-api\/v1\/organizations\/org_local\/gitlab-connections(?:\/.*)?$/u,
        async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith("/link-intents")) {
            const parameters = new URLSearchParams({
              client_id: "a".repeat(64),
              redirect_uri: browserOrigin + "/account/gitlab/callback",
              response_type: "code",
              scope: "api",
              state,
              code_challenge: "c".repeat(43),
              code_challenge_method: "S256",
            });
            await route.fulfill({
              status: 201,
              headers: {
                "set-cookie":
                  "__Host-cloudmarkup-gitlab-link=synthetic-sealed-cookie; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=60",
              },
              json: {
                apiVersion: "v1",
                data: {
                  contractVersion: 1,
                  intentId,
                  expiresAt: new Date(Date.now() + 60_000).toISOString(),
                  authorizationUrl:
                    "https://gitlab.com/oauth/authorize?" +
                    parameters.toString(),
                },
              },
            });
          } else if (path.endsWith("/link-completions")) {
            expect(route.request().frame().page()).toBe(page);
            expect(route.request().postDataJSON()).toEqual({
              contractVersion: 1,
              intentId,
              state,
              code,
            });
            expect((await route.request().allHeaders())["cookie"]).toContain(
              "__Host-cloudmarkup-gitlab-link=synthetic-sealed-cookie",
            );
            linked = true;
            completions++;
            await route.fulfill({
              json: { apiVersion: "v1", data: connection },
              headers: {
                "set-cookie":
                  "__Host-cloudmarkup-gitlab-link=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
              },
            });
          } else if (path.endsWith("/project-selections/42")) {
            const input = route.request().postDataJSON() as {
              contractVersion: number;
              expectedVersion: number;
              enabled: boolean;
            };
            expect(route.request().method()).toBe("POST");
            expect(input.contractVersion).toBe(1);
            expect(input.expectedVersion).toBe(selectionVersion);
            selectionVersion++;
            projectSelected = input.enabled;
            await route.fulfill({
              json: {
                apiVersion: "v1",
                data: {
                  contractVersion: 1,
                  organizationId: connection.organizationId,
                  principalId: connection.principalId,
                  connectionId: connection.id,
                  projectId: 42,
                  version: selectionVersion,
                  enabled: projectSelected,
                },
              },
            });
          } else if (path.endsWith("/project-selections")) {
            await route.fulfill({
              json: {
                apiVersion: "v1",
                data: selectionVersion
                  ? [
                      {
                        contractVersion: 1,
                        organizationId: connection.organizationId,
                        principalId: connection.principalId,
                        connectionId: connection.id,
                        projectId: 42,
                        version: selectionVersion,
                        enabled: projectSelected,
                      },
                    ]
                  : [],
                page: { hasMore: false },
              },
            });
          } else if (path.endsWith("/projects")) {
            await route.fulfill({
              json: {
                apiVersion: "v1",
                data: {
                  contractVersion: 1,
                  organizationId: connection.organizationId,
                  principalId: connection.principalId,
                  connectionId: connection.id,
                  projects: [
                    {
                      projectId: 42,
                      pathWithNamespace: "synthetic-team/infrastructure",
                      defaultBranch: "main",
                      url: "https://gitlab.com/synthetic-team/infrastructure",
                      eligibility: "eligible",
                    },
                  ],
                  nextPage: null,
                },
              },
            });
          } else if (path.endsWith("/disconnect")) {
            disconnected = true;
            await route.fulfill({
              json: {
                apiVersion: "v1",
                data: {
                  ...connection,
                  status: "disconnected",
                  providerRevocation: "requires-user-action",
                },
              },
            });
          } else {
            await route.fulfill({
              json: {
                apiVersion: "v1",
                data: linked
                  ? [
                      disconnected
                        ? {
                            ...connection,
                            status: "disconnected",
                            providerRevocation: "requires-user-action",
                          }
                        : connection,
                    ]
                  : [],
                page: { hasMore: false },
              },
            });
          }
        },
      );
      await page.goto(
        browserOrigin +
          `/organizations/${TYPED_BACKEND_ORGANIZATION_ID}/settings/integrations`,
      );
      await page
        .getByRole("button", { name: "Connect GitLab", exact: true })
        .press("Enter");
      const popup = context.waitForEvent("page");
      await page
        .getByRole("link", { name: "Continue to GitLab" })
        .press("Enter");
      const callback = await popup;
      try {
        await callback.waitForURL(
          (url) =>
            url.origin === browserOrigin &&
            url.pathname === "/account/gitlab/callback",
          { waitUntil: "load" },
        );
        await expect(
          callback.getByRole("heading", {
            name: "GitLab connected in the original tab",
          }),
        ).toBeVisible();
        await expect(
          page.getByText(connection.providerUsername, { exact: true }),
        ).toBeVisible();
        expect(callbackRequests).toEqual([]);
        expect(completions).toBe(1);
        expect(providerNavigations).toBe(1);
        expect(new URL(callback.url()).search).toBe("");
        expect(await page.evaluate(() => document.cookie)).not.toContain(
          "synthetic-sealed-cookie",
        );
        expect(
          await callback.evaluate(() => document.body.textContent),
        ).not.toContain(code);
        await page
          .getByRole("button", {
            name: "Choose projects for " + connection.providerUsername,
          })
          .press("Enter");
        await page
          .getByRole("button", { name: "Select synthetic-team/infrastructure" })
          .press("Enter");
        await expect(
          page.getByRole("button", {
            name: "Remove synthetic-team/infrastructure",
          }),
        ).toBeVisible();
        expect(selectionVersion).toBe(1);
        expect(projectSelected).toBe(true);
        const projectViolations = await page.evaluate(async (source) => {
          window.eval(source);
          return (
            await (window as unknown as { axe: typeof axe }).axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
            })
          ).violations;
        }, axe.source);
        expect(projectViolations).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath("gitlab-projects.png"),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Remove synthetic-team/infrastructure" })
          .press("Enter");
        await expect(
          page.getByRole("button", {
            name: "Select synthetic-team/infrastructure",
          }),
        ).toBeVisible();
        expect(selectionVersion).toBe(2);
        expect(projectSelected).toBe(false);
        await page
          .getByRole("button", {
            name: "Disconnect " + connection.providerUsername,
          })
          .press("Enter");
        await expect(
          page.getByText(/cannot confirm that all GitLab access was revoked/u),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: "GitLab applications" }),
        ).toHaveAttribute("rel", "noopener noreferrer");
        const violations = await page.evaluate(async (source) => {
          window.eval(source);
          return (
            await (window as unknown as { axe: typeof axe }).axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
            })
          ).violations;
        }, axe.source);
        expect(violations).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath("gitlab-connections.png"),
          fullPage: true,
        });
      } finally {
        await callback.close();
      }
    },
  );
}
test("a rejected GitLab callback shows safe recovery without authentication requests", async ({
  context,
  page,
  baseURL,
}) => {
  if (!baseURL) throw Error("Local browser origin missing");
  await install(context, baseURL);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/typed-backend-api/"))
      requests.push(request.url());
  });
  await page.goto(
    browserOrigin +
      "/account/gitlab/callback?error=access_denied&error_description=synthetic-private-diagnostic",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Return to your original CloudMarkup tab",
  );
  expect(requests).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  expect(await page.textContent("body")).not.toContain(
    "synthetic-private-diagnostic",
  );
});

// Narrow-screen geometry is stricter; the unchanged connection/retry workflow runs once.
for (const width of [390]) {
  test(
    "GitLab reviewed export resumes after a lost response at " + String(width),
    async ({ context, page, baseURL }, testInfo) => {
      if (!baseURL) throw Error("Local browser origin missing");
      await page.setViewportSize({ width, height: 1000 });
      await install(context, baseURL);
      const organizationId = TYPED_BACKEND_ORGANIZATION_ID,
        projectId = "project_notes",
        artifactId = "solutionartifact_gitlab",
        connectionId = "gitlab_" + "a".repeat(32),
        principalId = "principal_typed_backend_owner",
        reviewId = "gitlabreview_" + "b".repeat(32),
        digest = "sha256:" + "c".repeat(64),
        commit = "d".repeat(40);
      const initial = {
        contractVersion: 1,
        reviewId,
        organizationId,
        projectId,
        principalId,
        connectionId,
        providerProjectId: 42,
        selectionVersion: 7,
        artifactId,
        artifactManifestDigest: digest,
        artifactZipDigest: digest,
        approvalDigest: digest,
        baseCommitSha: "e".repeat(40),
        baseBranch: "main",
        branch: "cloudmarkup/export-" + "b".repeat(32),
        destinationFolder: "cloudmarkup/export",
        fileCount: 1,
        state: "prepared",
        recordVersion: 1,
        verifiedFiles: 0,
        commitSha: null as string | null,
        mergeRequest: null as {
          number: number;
          sha: string;
          state: string;
          draft: boolean;
          url: string;
        } | null,
        expiresAt: "2099-10-01T12:15:00.000Z",
        expired: false,
      };
      let record = initial,
        advances = 0,
        lost = false;
      const seenVersions: number[] = [];
      await context.route(
        /\/typed-backend-api\/v1\/organizations\/org_local\/gitlab-connections(?:\/.*)?$/u,
        async (route) => {
          const path = new URL(route.request().url()).pathname;
          const data = path.endsWith("/projects")
            ? {
                contractVersion: 1,
                organizationId,
                principalId,
                connectionId,
                projects: [
                  {
                    projectId: 42,
                    pathWithNamespace: "synthetic-team/infrastructure",
                    defaultBranch: "main",
                    eligibility: "eligible",
                    url: "https://gitlab.com/synthetic-team/infrastructure",
                  },
                ],
                nextPage: null,
              }
            : path.endsWith("/project-selections")
              ? [
                  {
                    contractVersion: 1,
                    organizationId,
                    principalId,
                    connectionId,
                    projectId: 42,
                    version: 7,
                    enabled: true,
                  },
                ]
              : [
                  {
                    contractVersion: 1,
                    id: connectionId,
                    organizationId,
                    principalId,
                    providerUsername: "synthetic-gitlab-owner",
                    status: "active",
                    providerRevocation: "not-requested",
                  },
                ];
          await route.fulfill({
            json: {
              apiVersion: "v1",
              data,
              ...(Array.isArray(data) ? { page: { hasMore: false } } : {}),
            },
          });
        },
      );
      await context.route(
        "**/typed-backend-api/v1/projects/project_notes/solution-export-artifacts/solutionartifact_gitlab",
        async (route) => {
          await route.fulfill({
            json: {
              apiVersion: "v1",
              data: {
                archiveFileName: "synthetic.zip",
                contractVersion: 1,
                createdAt: "2026-10-01T12:00:00.000Z",
                digest,
                manifestDigest: digest,
                downloadAvailability: {
                  state: "available",
                  expiresAt: "2099-10-01T12:15:00.000Z",
                },
                id: artifactId,
                projectId,
                jobId: "solutionexport_gitlab",
                solutionRevisionId: "solution_gitlab_v1",
                fileCount: 1,
                files: [
                  {
                    checksum: digest,
                    id: "solutionfile_gitlab",
                    mediaType: "application/vnd.hashicorp.terraform",
                    ownership: "generated-replaceable",
                    path: "main.tf",
                    previewAvailable: true,
                    semanticChecksum: digest,
                    sizeBytes: 20,
                  },
                ],
                sizeBytes: 200,
                warnings: [],
              },
            },
          });
        },
      );
      await context.route(
        /\/typed-backend-api\/v1\/projects\/project_notes\/gitlab-exports(?:\/.*)?$/u,
        async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith("/gitlab-exports")) {
            expect(route.request().postDataJSON()).toEqual({
              contractVersion: 1,
              connectionId,
              providerProjectId: 42,
              selectionVersion: 7,
              artifactId,
              destinationFolder: "cloudmarkup/export",
            });
            await route.fulfill({
              status: 201,
              json: {
                apiVersion: "v1",
                data: {
                  export: record,
                  files: [
                    {
                      path: "cloudmarkup/export/main.tf",
                      sizeBytes: 20,
                      sha256: digest,
                      mode: "100644",
                    },
                  ],
                },
              },
            });
          } else if (path.endsWith("/advance")) {
            const input = route.request().postDataJSON() as {
              expectedVersion: number;
              approvalDigest: string;
              acknowledgedAutomation?: boolean;
            };
            expect(input.expectedVersion).toBe(record.recordVersion);
            expect(input.approvalDigest).toBe(digest);
            if (record.state === "prepared")
              expect(input.acknowledgedAutomation).toBe(true);
            seenVersions.push(input.expectedVersion);
            advances++;
            const states = [
              "prepared",
              "commit-dispatched",
              "verifying",
              "verified",
              "merge-request-dispatched",
              "succeeded",
            ];
            const next =
              states[states.indexOf(record.state) + 1] ?? "succeeded";
            record = {
              ...record,
              state: next,
              recordVersion: record.recordVersion + 1,
              commitSha: next === "commit-dispatched" ? null : commit,
              verifiedFiles: [
                "verified",
                "merge-request-dispatched",
                "succeeded",
              ].includes(next)
                ? 1
                : 0,
              mergeRequest:
                next === "succeeded"
                  ? {
                      number: 17,
                      sha: commit,
                      state: "opened",
                      draft: true,
                      url: "https://gitlab.com/synthetic-team/infrastructure/-/merge_requests/17",
                    }
                  : null,
            };
            if (!lost) {
              lost = true;
              await route.abort("failed");
              return;
            }
            await route.fulfill({ json: { apiVersion: "v1", data: record } });
          } else
            await route.fulfill({ json: { apiVersion: "v1", data: record } });
        },
      );
      const path = `/organizations/${organizationId}/projects/${projectId}/artifacts/${artifactId}/export/gitlab`;
      await page.goto(browserOrigin + path);
      await page
        .getByRole("combobox", { name: "GitLab account", exact: true })
        .selectOption(connectionId);
      await page
        .getByRole("combobox", { name: "GitLab project", exact: true })
        .selectOption("42");
      await page
        .getByRole("button", { name: "Review export", exact: true })
        .press("Enter");
      await expect(
        page.getByRole("button", { name: "Approve and export" }),
      ).toBeDisabled();
      expect(advances).toBe(0);
      await expect(
        page.getByText("cloudmarkup/export/main.tf", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", { name: /I approve these files/u })
        .press("Space");
      await page
        .getByRole("button", { name: "Approve and export" })
        .press("Enter");
      await expect(
        page.getByRole("heading", { name: "Export needs attention" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Checking the export branch" }),
      ).toBeVisible();
      expect(advances).toBe(1);
      expect(new URL(page.url()).searchParams.get("review")).toBe(reviewId);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Checking the export branch" }),
      ).toBeVisible();
      expect(advances).toBe(1);
      await page.getByRole("button", { name: "Resume export" }).press("Enter");
      await expect(
        page.getByRole("link", { name: "Open draft merge request #17" }),
      ).toHaveAttribute(
        "href",
        "https://gitlab.com/synthetic-team/infrastructure/-/merge_requests/17",
      );
      expect(seenVersions).toEqual([1, 2, 3, 4, 5]);
      expect(advances).toBe(5);
      const violations = await page.evaluate(async (source) => {
        window.eval(source);
        return (
          await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
          })
        ).violations;
      }, axe.source);
      expect(violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("gitlab-export.png"),
        fullPage: true,
      });
    },
  );
}
