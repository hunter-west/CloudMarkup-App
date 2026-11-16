import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ApiClientError,
  createCloudMarkupClient,
  type ApiTransportRequest,
  type JsonApiOperationId,
} from "./client.js";
import {
  consequentialMutationHeadersV1Schema,
  pageLimitQuerySchema,
} from "./common.js";
import { apiOperationsV1 } from "./operations.js";
import {
  createExportJobV1Schema,
  createProjectV1Schema,
  createRevisionV1Schema,
  updatePresentationPreferencesV1Schema,
} from "./resources.js";

const principalResponse = {
  apiVersion: "v1",
  data: {
    displayName: "Ada Example",
    id: "principal_ada",
    organizationContexts: [],
    resourceVersion: 1,
  },
} as const;

describe("API contract v1", () => {
  it("keeps authoritative actor and tenant identity out of mutation bodies", () => {
    expect(
      createProjectV1Schema.safeParse({
        creationMode: "blank",
        name: "Notes API",
        organizationId: "org_other",
      }).success,
    ).toBe(false);
    expect(
      createProjectV1Schema.safeParse({
        architectureDocument: { kind: "cloudmarkup.architecture-document" },
        creationMode: "draft-copy",
        name: "Recovered copy",
      }).success,
    ).toBe(true);
    expect(
      createProjectV1Schema.safeParse({
        architectureDocument: {},
        creationMode: "draft-copy",
        name: "Recovered copy",
        organizationId: "org_other",
      }).success,
    ).toBe(false);
    expect(
      updatePresentationPreferencesV1Schema.safeParse({
        contextualLearningEnabled: true,
        contractVersion: 1,
        experienceMode: "guided",
        principalId: "principal_other",
      }).success,
    ).toBe(false);
    expect(
      createExportJobV1Schema.safeParse({
        artifactId: "artifact_notes",
        contractVersion: 1,
        kind: "zip",
        organizationId: "org_other",
      }).success,
    ).toBe(false);
    const revision = {
      contractVersion: 1,
      draftId: "draft_notes",
      draftVersion: 1,
      name: "Reviewed revision",
      validationRunId: "validation_notes",
    };
    expect(createRevisionV1Schema.safeParse(revision).success).toBe(true);
    for (const authority of [
      { organizationId: "org_other" },
      { principalId: "principal_other" },
    ]) {
      expect(
        createRevisionV1Schema.safeParse({ ...revision, ...authority }).success,
      ).toBe(false);
    }
  });

  it("defines bounded pagination and consequential mutation headers", () => {
    expect(pageLimitQuerySchema.safeParse("1").success).toBe(true);
    expect(pageLimitQuerySchema.safeParse("100").success).toBe(true);
    expect(pageLimitQuerySchema.safeParse("0").success).toBe(false);
    expect(pageLimitQuerySchema.safeParse("101").success).toBe(false);
    expect(
      consequentialMutationHeadersV1Schema.safeParse({
        "idempotency-key": "request-0001",
        "if-match": '"draft:draft_notes:v1"',
      }).success,
    ).toBe(true);
  });

  it("keeps every operation versioned and every product route principal-bound", () => {
    for (const operation of Object.values(apiOperationsV1)) {
      expect(operation.path === "/health" || operation.path === "/ready").toBe(
        operation.security === "public",
      );
      if (operation.path.startsWith("/v1/")) {
        expect(operation.security).toBe("principal");
      }
    }
  });
});

describe("derived typed client", () => {
  it("builds a request from the canonical operation and validates its response", async () => {
    let captured: ApiTransportRequest | undefined;
    const client = createCloudMarkupClient({
      baseUrl: "https://api.example.test/",
      transport: (request) => {
        captured = request;
        return Promise.resolve({
          headers: { get: () => null },
          status: 200,
          text: () => Promise.resolve(JSON.stringify(principalResponse)),
        });
      },
    });

    await expect(client.request("principal.get", {})).resolves.toEqual(
      principalResponse,
    );
    expect(captured).toEqual({
      headers: {},
      method: "GET",
      url: "https://api.example.test/v1/me",
    });
  });

  it("serializes the schema-validated numeric GitHub repository path before branch discovery", async () => {
    let captured: ApiTransportRequest | undefined;
    const response = { apiVersion: "v1", data: [], page: { hasMore: false } };
    const client = createCloudMarkupClient({
      baseUrl: "https://api.example.test",
      transport: (request) => {
        captured = request;
        return Promise.resolve({
          headers: { get: () => null },
          status: 200,
          text: () => Promise.resolve(JSON.stringify(response)),
        });
      },
    });
    await expect(
      client.request("github-repository-branches.list", {
        path: {
          organizationId: "org_local",
          integrationId: "integration_first_import",
          repositoryId: 41,
        },
      }),
    ).resolves.toEqual(response);
    expect(captured).toEqual({
      headers: {},
      method: "GET",
      url: "https://api.example.test/v1/organizations/org_local/github-app-installations/integration_first_import/repositories/41/branches",
    });
  });

  it("serializes validated numeric queries and string cursors without losing pagination", async () => {
    const captured: ApiTransportRequest[] = [];
    const page = { apiVersion: "v1", data: [], page: { hasMore: false } };
    const discovery = {
      apiVersion: "v1",
      data: {
        contractVersion: 1,
        organizationId: "org_local",
        principalId: "principal_local",
        connectionId: "gitlab_11111111111111111111111111111111",
        projects: [],
        nextPage: null,
      },
    };
    const client = createCloudMarkupClient({
      baseUrl: "https://api.example.test",
      transport: (request) => {
        captured.push(request);
        return Promise.resolve({
          headers: { get: () => null },
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify(
                request.url.includes("/projects?") ? discovery : page,
              ),
            ),
        });
      },
    });
    const path = {
      organizationId: "org_local",
      connectionId: "gitlab_11111111111111111111111111111111",
    };
    await client.request("gitlab-projects.discover", {
      path,
      query: { page: "2" },
    });
    await client.request("gitlab-project-selections.list", {
      path,
      query: { limit: 100, cursor: "41" },
    });
    await client.request("gitlab-connections.list", {
      path: { organizationId: "org_local" },
      query: { cursor: "gitlab_11111111111111111111111111111111", limit: "75" },
    });
    expect(captured.map((request) => request.url)).toEqual([
      "https://api.example.test/v1/organizations/org_local/gitlab-connections/gitlab_11111111111111111111111111111111/projects?page=2",
      "https://api.example.test/v1/organizations/org_local/gitlab-connections/gitlab_11111111111111111111111111111111/project-selections?cursor=41&limit=100",
      "https://api.example.test/v1/organizations/org_local/gitlab-connections?cursor=gitlab_11111111111111111111111111111111&limit=75",
    ]);
    for (const invalidPage of [
      0,
      201,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { page: 2 },
    ]) {
      await expect(
        client.request("gitlab-projects.discover", {
          path,
          query: { page: invalidPage },
        }),
      ).rejects.toThrow();
    }
    expect(captured).toHaveLength(3);
  });

  it.each([0, "malformed"])(
    "rejects invalid numeric GitHub path input %s before transport",
    async (repositoryId) => {
      let transportCalls = 0;
      const client = createCloudMarkupClient({
        baseUrl: "https://api.example.test",
        transport: () => {
          transportCalls += 1;
          return Promise.resolve({
            headers: { get: () => null },
            status: 200,
            text: () => Promise.resolve("{}"),
          });
        },
      });
      await expect(
        client.request("github-repository-branches.list", {
          path: {
            organizationId: "org_local",
            integrationId: "integration_first_import",
            repositoryId,
          },
        }),
      ).rejects.toThrow();
      expect(transportCalls).toBe(0);
    },
  );

  it("derives project mutations and validates required ETag response metadata", async () => {
    let captured: ApiTransportRequest | undefined;
    const response = {
      apiVersion: "v1",
      data: {
        createdAt: "2026-08-03T12:00:00.000Z",
        currentDraft: { id: "draft_notes", version: 1 },
        environmentCount: 0,
        id: "project_notes",
        lifecycleStatus: "active",
        name: "Renamed Notes",
        organizationId: "org_notes",
        updatedAt: "2026-08-03T12:01:00.000Z",
        version: 2,
      },
    } as const;
    const client = createCloudMarkupClient({
      baseUrl: "https://api.example.test",
      transport: (request) => {
        captured = request;
        return Promise.resolve({
          headers: { get: () => '"project:project_notes:v2"' },
          status: 200,
          text: () => Promise.resolve(JSON.stringify(response)),
        });
      },
    });

    const input = {
      body: { contractVersion: 1 as const, name: "Renamed Notes" },
      headers: { "if-match": '"project:project_notes:v1"' },
      path: { projectId: "project_notes" },
    };
    await expect(client.request("projects.rename", input)).resolves.toEqual(
      response,
    );
    const responseWithMetadata = await client.requestWithMetadata(
      "projects.rename",
      input,
    );
    expect(responseWithMetadata).toEqual({
      data: response,
      metadata: { etag: '"project:project_notes:v2"' },
    });
    expectTypeOf(responseWithMetadata.metadata.etag).toEqualTypeOf<string>();

    const missingEtagClient = createCloudMarkupClient({
      baseUrl: "https://api.example.test",
      transport: () =>
        Promise.resolve({
          headers: { get: () => null },
          status: 200,
          text: () => Promise.resolve(JSON.stringify(response)),
        }),
    });
    await expect(
      missingEtagClient.requestWithMetadata("projects.rename", input),
    ).rejects.toThrow("The API returned an invalid ETag response header.");
    expect(captured).toEqual({
      body: JSON.stringify({ contractVersion: 1, name: "Renamed Notes" }),
      headers: {
        "content-type": "application/json",
        "if-match": '"project:project_notes:v1"',
      },
      method: "PUT",
      url: "https://api.example.test/v1/projects/project_notes",
    });
  });

  it("excludes binary grant consumption from the generic JSON client", async () => {
    let transportCalls = 0;
    const client = createCloudMarkupClient({
      baseUrl: "https://api.example.test",
      transport: () => {
        transportCalls += 1;
        return Promise.resolve({
          headers: { get: () => null },
          status: 200,
          text: () => Promise.resolve("{}"),
        });
      },
    });
    const binaryOperationIsExcluded: "solution-export-download-grants.consume" extends JsonApiOperationId
      ? false
      : true = true;
    expect(binaryOperationIsExcluded).toBe(true);
    const forceBinaryOperation = client.request.bind(client) as unknown as (
      operationId: string,
      input: unknown,
    ) => Promise<unknown>;

    await expect(
      forceBinaryOperation("solution-export-download-grants.consume", {
        path: {
          projectId: "project_main",
          solutionExportArtifactId: "solutionartifact_main",
          solutionExportDownloadGrantId: "downloadgrant_main",
        },
      }),
    ).rejects.toThrow(
      "Binary API operations require a dedicated integrity-validating downloader.",
    );
    expect(transportCalls).toBe(0);
  });

  it("parses versioned error envelopes into a typed client error", async () => {
    const client = createCloudMarkupClient({
      baseUrl: "https://api.example.test",
      transport: () =>
        Promise.resolve({
          headers: { get: () => null },
          status: 401,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                apiVersion: "v1",
                error: {
                  code: "authentication_required",
                  correlationId: "correlation-test-2",
                  message: "Authentication is required.",
                },
              }),
            ),
        }),
    });

    const request = client.request("principal.get", {});
    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({
      envelope: { error: { code: "authentication_required" } },
      status: 401,
    });
  });
});
