import {
  MAX_JSON_REQUEST_BYTES,
  apiErrorEnvelopeV1Schema,
  creditBalanceResponseV1Schema,
  creditOverviewResponseV1Schema,
  currentPrincipalResponseV1Schema,
  currentPlanEntitlementsResponseV1Schema,
  solutionRevisionResponseV1Schema,
} from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentContentHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { InMemorySeed } from "./testing/in-memory-adapters.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
  StaticReadinessProbe,
} from "./testing/in-memory-adapters.js";

const NOW = "2026-08-02T12:00:00.000Z";
const LATER = "2026-08-02T12:01:00.000Z";
const TOKEN = "Bearer principal-one";
const VIEWER_TOKEN = "Bearer principal-viewer";
const DIGEST = "sha256:" + "0".repeat(64);
const CAPABILITIES = [
  "artifacts.read",
  "audit.read",
  "exports.run",
  "generation.run",
  "integrations.read",
  "memberships.read",
  "organizations.read",
  "projects.create",
  "projects.mutate",
  "projects.read",
  "revisions.create",
  "validation.run",
] as const;

function architectureDocument(
  identity: {
    architectureId: string;
    documentId: string;
    revisionId: string;
  },
  sourceDraftId?: string,
): ArchitectureDocumentV3 {
  return parseArchitectureDocument({
    architectureId: identity.architectureId,
    assumptions: [],
    catalog: {
      digest: DIGEST,
      id: "aws.cloudmarkup",
      version: "1.0.0",
    },
    compilerCompatibility: {
      inputContractVersion: 1,
      minimumCompilerVersion: "1.0.0",
    },
    documentId: identity.documentId,
    edges: [],
    kind: "cloudmarkup.architecture-document",
    metadata: {
      serialization: {
        canonicalization: "cloudmarkup.canonical-json.v1",
        encoding: "utf-8",
        mediaType: "application/json",
      },
      source: "user",
    },
    nodes: [],
    outputs: [],
    provider: {
      id: "aws.cloudmarkup",
      region: "us-east-1",
    },
    revision: {
      createdAt: NOW,
      createdBy: "actor_test",
      revisionId: identity.revisionId,
      revisionNumber: 1,
      ...(sourceDraftId === undefined ? {} : { sourceDraftId }),
    },
    schemaVersion: 2,
    unresolvedRequirements: [],
    variables: [],
    workloadBehavior: {
      contractVersion: 1,
      workloads: [],
    },
  });
}

function fixture(options: { readonly principalExpiresAt?: string } = {}) {
  const document = architectureDocument(
    {
      architectureId: "architecture_main",
      documentId: "doc_main",
      revisionId: "revision_graph",
    },
    "draft_main",
  );
  const contentDigest = getArchitectureDocumentContentHash(document);
  const seed: InMemorySeed = {
    artifacts: [
      {
        contentDigest,
        createdAt: NOW,
        fileCount: 1,
        files: [
          {
            digest: DIGEST,
            id: "file_main",
            mediaType: "text/plain",
            path: "main.tf",
            sizeBytes: 12,
          },
        ],
        id: "artifact_main",
        projectId: "project_main",
        revisionId: "revision_main",
        status: "verified",
        target: "terraform",
      },
    ],
    auditEvents: [
      {
        action: "project.created",
        actor: { displayName: "Principal One", id: "principal_one" },
        correlationId: "correlation-seed",
        id: "audit_main",
        occurredAt: NOW,
        organizationId: "org_main",
        outcome: "succeeded",
        summary: "Project created.",
        target: { id: "project_main", kind: "project" },
      },
    ],
    blankDocumentFactory: (identity) => architectureDocument(identity),
    creditBalances: [
      {
        activeGrantedCreditUnits: 200,
        asOf: NOW,
        availableCreditUnits: 175,
        compensatedCreditUnits: 0,
        contractVersion: 1,
        debitAdjustmentCreditUnits: 0,
        exhausted: false,
        expiredCreditUnits: 0,
        netAdjustmentCreditUnits: 0,
        organizationId: "org_main",
        reservedCreditUnits: 25,
        settledCreditUnits: 0,
        totalGrantedCreditUnits: 200,
        unresolvedCreditUnits: 0,
      },
    ],
    currentPlanEntitlements: [
      {
        asOf: NOW,
        billingAccountState: "active",
        contractVersion: 1,
        entitlements: [
          { enabled: true, feature: "manual-editing", source: "plan" },
        ],
        expensiveOperationsEnabled: true,
        limits: [],
        organizationId: "org_main",
        organizationState: "active",
        plan: {
          commercialStatus: "beta-example",
          displayName: "Starter",
          effectiveFrom: "2026-01-01T00:00:00.000Z",
          id: "plan_starter",
          key: "starter",
          price: {
            amountMicros: "9000000",
            billingInterval: "month",
            currency: "USD",
            status: "beta-example",
          },
          version: 1,
          versionId: "planver_starter_2026_08_14_v1",
        },
        subscription: { state: "not-subscribed" },
      },
    ],
    downloads: [
      {
        artifactId: "artifact_main",
        digest: DIGEST,
        downloadId: "download_main",
        expiresAt: "2026-08-02T13:00:00.000Z",
        fileName: "cloudmarkup.zip",
        mediaType: "application/zip",
        sizeBytes: 12,
        url: "/downloads/download_main",
      },
    ],
    drafts: [
      {
        architectureDocument: document,
        contentDigest,
        id: "draft_main",
        projectId: "project_main",
        updatedAt: NOW,
        version: 1,
      },
    ],
    integrations: [
      {
        capabilities: ["repository.write"],
        createdAt: NOW,
        displayName: "GitHub",
        id: "integration_main",
        kind: "github",
        organizationId: "org_main",
        status: "connected",
      },
    ],
    memberships: [
      {
        capabilities: [...CAPABILITIES],
        id: "membership_main",
        isOwner: true,
        joinedAt: NOW,
        organizationId: "org_main",
        principal: { displayName: "Principal One", id: "principal_one" },
        role: "owner",
        status: "active",
      },
      {
        capabilities: [
          "artifacts.read",
          "commercial.summary.read",
          "organizations.read",
          "projects.read",
        ],
        id: "membership_viewer",
        isOwner: false,
        joinedAt: NOW,
        organizationId: "org_main",
        principal: { displayName: "Principal Viewer", id: "principal_viewer" },
        role: "viewer",
        status: "active",
      },
    ],
    organizations: [
      {
        createdAt: NOW,
        displayName: "Main Organization",
        id: "org_main",
        lifecycleStatus: "active",
        slug: "main-organization",
      },
      {
        createdAt: NOW,
        displayName: "Other Organization",
        id: "org_other",
        lifecycleStatus: "active",
        slug: "other-organization",
      },
    ],
    principals: [
      {
        displayName: "Principal One",
        email: "one@example.com",
        id: "principal_one",
      },
      {
        displayName: "Principal Viewer",
        email: "viewer@example.com",
        id: "principal_viewer",
      },
    ],
    projects: [
      {
        createdAt: NOW,
        currentDraft: { id: "draft_main", version: 1 },
        description: "Seed project",
        environmentCount: 0,
        id: "project_main",
        latestRevisionId: "revision_main",
        lifecycleStatus: "active",
        name: "Main Project",
        organizationId: "org_main",
        updatedAt: NOW,
      },
      {
        createdAt: NOW,
        currentDraft: { id: "draft_other", version: 1 },
        environmentCount: 0,
        id: "project_other",
        lifecycleStatus: "active",
        name: "Other Tenant Project",
        organizationId: "org_other",
        updatedAt: NOW,
      },
    ],
    revisions: [
      {
        architectureDocument: document,
        catalogDigest: DIGEST,
        catalogId: "aws.cloudmarkup",
        catalogVersion: "1.0.0",
        contentDigest,
        createdAt: NOW,
        createdBy: { displayName: "Principal One", id: "principal_one" },
        graphSchemaVersion: 2,
        id: "revision_main",
        projectId: "project_main",
        sourceDraftId: "draft_main",
        sourceDraftVersion: 1,
        workloadBehaviorVersion: 1,
      },
    ],
    validationRuns: [
      {
        completedAt: NOW,
        createdAt: NOW,
        id: "validation_complete",
        input: {
          draftId: "draft_main",
          draftVersion: 1,
          kind: "draft",
        },
        projectId: "project_main",
        status: "succeeded",
        summary: {
          complete: true,
          findingCounts: {
            costWarning: 0,
            educationalNote: 0,
            error: 0,
            recommendation: 0,
            securityError: 0,
            warning: 0,
          },
          findings: [],
          reportId: "report_complete",
        },
        target: "draft",
      },
    ],
  };
  const application = new InMemoryCloudMarkupApplication(seed, {
    clock: () => LATER,
  });
  const app = createApp({
    application,
    authenticationClock: () => new Date(NOW),
    correlationIdFactory: () => "correlation-test",
    principalResolver: new FixedPrincipalResolver({
      [TOKEN]: {
        ...(options.principalExpiresAt === undefined
          ? {}
          : { expiresAt: options.principalExpiresAt }),
        principalId: "principal_one",
        sessionId: "session_one",
      },
      [VIEWER_TOKEN]: {
        principalId: "principal_viewer",
        sessionId: "session_viewer",
      },
    }),
    readiness: new StaticReadinessProbe([
      { name: "http", ready: true },
      { name: "adapter", ready: true },
    ]),
  });
  return { app, document, application };
}

function authorizedAs(
  app: ReturnType<typeof createApp>,
  path: string,
  token: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", token);
  return app.request(path, { ...init, headers });
}

function authorized(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit = {},
) {
  return authorizedAs(app, path, TOKEN, init);
}

function jsonRequest(method: "POST" | "PUT", body: unknown, headers = {}) {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method,
  } satisfies RequestInit;
}

describe("v1 modular API", () => {
  it("serves health, readiness, and canonical OpenAPI without authentication", async () => {
    const { app } = fixture();
    const [health, readiness, openapi] = await Promise.all([
      app.request("/health"),
      app.request("/ready"),
      app.request("/openapi/v1.json"),
    ]);

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      contractVersion: 1,
      status: "ok",
    });
    expect(await readiness.json()).toMatchObject({
      contractVersion: 1,
      status: "ready",
    });
    expect(await openapi.json()).toMatchObject({
      info: { version: "1.0.0" },
      openapi: "3.1.0",
    });
  });

  it("derives the current principal from middleware and fails closed", async () => {
    const { app } = fixture();
    const unauthorized = await app.request("/v1/me");
    const response = await authorized(app, "/v1/me");

    expect(unauthorized.status).toBe(401);
    apiErrorEnvelopeV1Schema.parse(await unauthorized.json());
    expect(response.status).toBe(200);
    const principal = currentPrincipalResponseV1Schema.parse(
      await response.json(),
    );
    expect(principal.data.id).toBe("principal_one");
    expect(principal.data.organizationContexts[0]?.organizationId).toBe(
      "org_main",
    );
  });

  it("rejects expired authenticated sessions with a stable safe error", async () => {
    const { app } = fixture({ principalExpiresAt: NOW });
    const response = await authorized(app, "/v1/me");

    expect(response.status).toBe(401);
    const envelope = apiErrorEnvelopeV1Schema.parse(await response.json());
    expect(envelope.error).toMatchObject({
      code: "authentication_required",
      correlationId: "correlation-test",
      message: "Authentication is required.",
    });
  });

  it("keeps presentation preferences separate from architecture semantics", async () => {
    const { app, document } = fixture();
    const before = await authorized(app, "/v1/projects/project_main/draft");
    const preferences = await authorized(
      app,
      "/v1/me/presentation-preferences",
    );
    const update = await authorized(
      app,
      "/v1/me/presentation-preferences",
      jsonRequest(
        "PUT",
        {
          contextualLearningEnabled: false,
          contractVersion: 1,
          experienceMode: "professional",
        },
        { "if-match": preferences.headers.get("etag") ?? "" },
      ),
    );
    const after = await authorized(app, "/v1/projects/project_main/draft");

    expect(update.status).toBe(200);
    expect(update.headers.get("etag")).not.toBe(
      preferences.headers.get("etag"),
    );
    const beforeBody = (await before.json()) as {
      data: {
        architectureDocument: ArchitectureDocumentV3;
        contentDigest: string;
      };
    };
    const afterBody = (await after.json()) as {
      data: {
        architectureDocument: ArchitectureDocumentV3;
        contentDigest: string;
      };
    };
    expect(afterBody.data.architectureDocument).toEqual(document);
    expect(afterBody.data.contentDigest).toBe(beforeBody.data.contentDigest);

    const stale = await authorized(
      app,
      "/v1/me/presentation-preferences",
      jsonRequest(
        "PUT",
        {
          contextualLearningEnabled: true,
          contractVersion: 1,
          experienceMode: "guided",
        },
        { "if-match": preferences.headers.get("etag") ?? "" },
      ),
    );
    expect(stale.status).toBe(412);
  });

  it("uses indistinguishable not-found responses across tenant boundaries", async () => {
    const { app } = fixture();
    const pathPairs = [
      ["/v1/organizations/org_other", "/v1/organizations/org_absent"],
      ["/v1/projects/project_other", "/v1/projects/project_absent"],
      ["/v1/projects/project_other/draft", "/v1/projects/project_absent/draft"],
      [
        "/v1/projects/project_other/environments/env_guessed",
        "/v1/projects/project_absent/environments/env_guessed",
      ],
      [
        "/v1/projects/project_other/revisions/revision_guessed",
        "/v1/projects/project_absent/revisions/revision_guessed",
      ],
      [
        "/v1/projects/project_other/solution-revisions/solution_guessed",
        "/v1/projects/project_absent/solution-revisions/solution_guessed",
      ],
    ] as const;

    for (const [crossTenantPath, absentPath] of pathPairs) {
      const crossTenant = await authorized(app, crossTenantPath);
      const absent = await authorized(app, absentPath);
      expect(crossTenant.status).toBe(404);
      expect(await crossTenant.json()).toEqual(await absent.json());
    }
  });

  it("returns provider-neutral commercial summaries to authorized organization roles", async () => {
    const { app } = fixture();
    const planPath = "/v1/organizations/org_main/commercial/current-plan";
    const balancePath = "/v1/organizations/org_main/commercial/credit-balance";
    const [ownerPlan, ownerBalance, viewerPlan, viewerBalance] =
      await Promise.all([
        authorized(app, planPath),
        authorized(app, balancePath),
        authorizedAs(app, planPath, VIEWER_TOKEN),
        authorizedAs(app, balancePath, VIEWER_TOKEN),
      ]);

    for (const response of [
      ownerPlan,
      ownerBalance,
      viewerPlan,
      viewerBalance,
    ]) {
      expect(response.status).toBe(200);
    }
    const plan = currentPlanEntitlementsResponseV1Schema.parse(
      await ownerPlan.json(),
    );
    const balance = creditBalanceResponseV1Schema.parse(
      await ownerBalance.json(),
    );
    expect(plan.data).toMatchObject({
      organizationId: "org_main",
      plan: { displayName: "Starter", key: "starter" },
    });
    expect(balance.data).toMatchObject({
      availableCreditUnits: 175,
      organizationId: "org_main",
      totalGrantedCreditUnits: 200,
    });

    for (const suffix of ["current-plan", "credit-balance"]) {
      const crossTenant = await authorized(
        app,
        `/v1/organizations/org_other/commercial/${suffix}`,
      );
      const absent = await authorized(
        app,
        `/v1/organizations/org_absent/commercial/${suffix}`,
      );
      expect(crossTenant.status).toBe(404);
      expect(await crossTenant.json()).toEqual(await absent.json());
    }
  });
  it("reads the additive overview with tenant binding and strict query admission", async () => {
    const { app, application } = fixture();
    const get = vi
      .spyOn(application, "getCreditOverview")
      .mockImplementation(async (principal, organizationId) => {
        const balance = await application.getCreditBalance(
          principal,
          organizationId,
        );
        return {
          contractVersion: 1,
          balance,
          availableByKind: { monthly: 175, purchased: 0, other: 0 },
          nextExpiration: null,
        };
      });
    const path = "/v1/organizations/org_main/commercial/credit-overview";
    const response = await authorizedAs(app, path, VIEWER_TOKEN);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      creditOverviewResponseV1Schema.parse(await response.json()).data
        .availableByKind.monthly,
    ).toBe(175);
    expect((await app.request(path)).status).toBe(401);
    expect((await authorized(app, path + "?at=2030-01-01")).status).toBe(400);
    expect((await authorized(app, path + "?a=1&a=2")).status).toBe(400);
    expect(
      (await authorized(app, path.replace("org_main", "invalid!"))).status,
    ).toBe(400);
    const cross = await authorized(app, path.replace("org_main", "org_other"));
    const absent = await authorized(
      app,
      path.replace("org_main", "org_absent"),
    );
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual(await absent.json());
    const original = await application.getCreditBalance(
      {
        principalId: "principal_one",
        sessionId: "session_one",
        correlationId: "test",
        authenticationSource: "test",
        authenticatedAt: NOW,
        expiresAt: LATER,
      },
      "org_main",
    );
    get.mockResolvedValue({
      contractVersion: 1,
      balance: { ...original, organizationId: "org_other" },
      availableByKind: { monthly: 175, purchased: 0, other: 0 },
      nextExpiration: null,
    });
    expect((await authorized(app, path)).status).toBe(503);
  });
  it("enforces strict validation, duplicate-query rejection, and body limits", async () => {
    const { app } = fixture();
    const invalid = await authorized(
      app,
      "/v1/organizations/org_main/projects",
      jsonRequest(
        "POST",
        {
          creationMode: "blank",
          name: "Invalid",
          principalId: "principal_other",
        },
        { "idempotency-key": "request-invalid" },
      ),
    );
    const duplicate = await authorized(
      app,
      "/v1/organizations?page%5Blimit%5D=10&page%5Blimit%5D=20",
    );
    const oversized = await authorized(
      app,
      "/v1/organizations/org_main/projects",
      jsonRequest(
        "POST",
        {
          creationMode: "blank",
          description: "x".repeat(MAX_JSON_REQUEST_BYTES),
          name: "Large",
        },
        { "idempotency-key": "request-oversized" },
      ),
    );

    expect(invalid.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(oversized.status).toBe(413);
    for (const response of [invalid, duplicate, oversized]) {
      apiErrorEnvelopeV1Schema.parse(await response.json());
    }
  });

  it("replays matching idempotent requests and rejects key collisions", async () => {
    const { app } = fixture();
    const path = "/v1/organizations/org_main/projects";
    const headers = { "idempotency-key": "project-create-one" };
    const first = await authorized(
      app,
      path,
      jsonRequest("POST", { creationMode: "blank", name: "Created" }, headers),
    );
    const replay = await authorized(
      app,
      path,
      jsonRequest("POST", { creationMode: "blank", name: "Created" }, headers),
    );
    const collision = await authorized(
      app,
      path,
      jsonRequest(
        "POST",
        { creationMode: "blank", name: "Different" },
        headers,
      ),
    );

    expect(first.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(collision.status).toBe(409);
  });

  it("saves a conflicted valid draft as a server-rebound project copy", async () => {
    const { app, document } = fixture();
    const response = await authorized(
      app,
      "/v1/organizations/org_main/projects",
      jsonRequest(
        "POST",
        {
          architectureDocument: document,
          creationMode: "draft-copy",
          name: "Recovered copy",
        },
        { "idempotency-key": "project-save-as-copy" },
      ),
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      data: { draft: { id: string }; project: { id: string } };
    };
    const copiedResponse = await authorized(
      app,
      "/v1/projects/" + created.data.project.id + "/draft",
    );
    const copied = (await copiedResponse.json()) as {
      data: { architectureDocument: ArchitectureDocumentV3; id: string };
    };

    expect(copied.data.id).toBe(created.data.draft.id);
    expect(copied.data.architectureDocument.documentId).not.toBe(
      document.documentId,
    );
    expect(copied.data.architectureDocument.architectureId).not.toBe(
      document.architectureId,
    );
    expect(copied.data.architectureDocument.revision.sourceDraftId).toBe(
      created.data.draft.id,
    );
    expect(copied.data.architectureDocument.externalResources).toMatchObject({
      architectureId: copied.data.architectureDocument.architectureId,
      documentId: copied.data.architectureDocument.documentId,
      revision: {
        revisionId: copied.data.architectureDocument.revision.revisionId,
      },
    });
    expect(copied.data.architectureDocument.applicationContracts).toMatchObject(
      {
        documentId: copied.data.architectureDocument.documentId,
        revision: {
          revisionId: copied.data.architectureDocument.revision.revisionId,
        },
      },
    );
    expect(copied.data.architectureDocument.nodes).toEqual(document.nodes);
    expect(copied.data.architectureDocument.workloadBehavior).toEqual(
      document.workloadBehavior,
    );
    expect(
      copied.data.architectureDocument.applicationContracts.contracts,
    ).toEqual(document.applicationContracts.contracts);
    expect(
      copied.data.architectureDocument.externalResources.resources,
    ).toEqual(document.externalResources.resources);
  });

  it("applies draft Graph Commands with both ETag and idempotency preconditions", async () => {
    const { app } = fixture();
    const draft = await authorized(app, "/v1/projects/project_main/draft");
    const body = {
      command: {
        commandId: "operation_add-node",
        inverseCommandId: "operation_remove-node",
        kind: "add-node",
        node: {
          id: "node_queue",
          presentation: { label: "Queue", position: { x: 10, y: 20 } },
          semantic: {
            configuration: {
              schemaId: "aws.sqs.queue",
              schemaVersion: "1.0.0",
              values: {},
            },
            deploymentKey: "queue",
            lifecycle: { origin: "user", ownership: "user" },
            resourceType: "aws.sqs.queue",
            serviceType: "aws.sqs",
          },
        },
        origin: "user",
        schemaVersion: 1,
        target: {
          architectureId: "architecture_main",
          documentId: "doc_main",
          revisionId: "revision_graph",
        },
      },
      contractVersion: 1,
    };
    const missing = await authorized(
      app,
      "/v1/projects/project_main/draft/commands",
      jsonRequest("POST", body, { "idempotency-key": "command-add-node" }),
    );
    const headers = {
      "idempotency-key": "command-add-node",
      "if-match": draft.headers.get("etag") ?? "",
    };
    const applied = await authorized(
      app,
      "/v1/projects/project_main/draft/commands",
      jsonRequest("POST", body, headers),
    );
    const replay = await authorized(
      app,
      "/v1/projects/project_main/draft/commands",
      jsonRequest("POST", body, headers),
    );

    expect(missing.status).toBe(428);
    expect(applied.status).toBe(200);
    expect(await replay.json()).toEqual(await applied.json());
  });

  it("freezes only an exact successfully validated draft as an immutable revision", async () => {
    const { app } = fixture();
    const draft = await authorized(app, "/v1/projects/project_main/draft");
    const body = {
      contractVersion: 1,
      draftId: "draft_main",
      draftVersion: 1,
      name: "Validated baseline",
      validationRunId: "validation_complete",
    };
    const headers = {
      "idempotency-key": "revision-create",
      "if-match": draft.headers.get("etag") ?? "",
    };
    const created = await authorized(
      app,
      "/v1/projects/project_main/revisions",
      jsonRequest("POST", body, headers),
    );
    const replay = await authorized(
      app,
      "/v1/projects/project_main/revisions",
      jsonRequest("POST", body, headers),
    );

    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      data: {
        architectureDocument: ArchitectureDocumentV3;
        compatibility: {
          catalog: { digest: string; id: string; version: string };
          compiler: {
            inputContractVersion: number;
            maximumVersionExclusive?: string;
            minimumVersion: string;
          };
          documentSchema: { kind: string; version: number };
        };
        documentDigest: string;
        id: string;
        name: string;
        revisionNumber: number;
        semanticDigest: string;
        sourceDraftVersion: number;
        storageStatus: string;
        visualDigest: string;
      };
    };
    expect(createdBody.data.architectureDocument.revision.revisionId).toBe(
      createdBody.data.id,
    );
    expect(createdBody.data.sourceDraftVersion).toBe(1);
    expect(createdBody.data).toMatchObject({
      compatibility: {
        catalog: {
          digest: DIGEST,
          id: "aws.cloudmarkup",
          version: "1.0.0",
        },
        compiler: {
          inputContractVersion: 1,
          minimumVersion: "1.0.0",
        },
        documentSchema: {
          kind: "cloudmarkup.architecture-document",
          version: 3,
        },
      },
      name: "Validated baseline",
      revisionNumber: 2,
      storageStatus: "published",
    });
    expect(createdBody.data.documentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(createdBody.data.semanticDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(createdBody.data.visualDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await replay.json()).toEqual(createdBody);

    const immutable = await authorized(
      app,
      "/v1/projects/project_main/revisions/" + createdBody.data.id,
    );
    expect(immutable.status).toBe(200);
    expect(await immutable.json()).toEqual(createdBody);

    const stale = await authorized(
      app,
      "/v1/projects/project_main/revisions",
      jsonRequest("POST", body, {
        "idempotency-key": "revision-create-stale",
        "if-match": '"draft:draft_main:v99"',
      }),
    );
    expect(stale.status).toBe(412);
  });

  it("creates idempotent exact Solution Revisions and exposes immutable viewer-safe reads", async () => {
    const { app } = fixture();
    const draft = await authorized(app, "/v1/projects/project_main/draft");
    const body = {
      contractVersion: 1,
      draftId: "draft_main",
      draftVersion: 1,
      name: "Exact solution baseline",
    };
    const headers = {
      "idempotency-key": "solution-revision-create",
      "if-match": draft.headers.get("etag") ?? "",
    };
    const [created, replay] = await Promise.all([
      authorized(
        app,
        "/v1/projects/project_main/solution-revisions",
        jsonRequest("POST", body, headers),
      ),
      authorized(
        app,
        "/v1/projects/project_main/solution-revisions",
        jsonRequest("POST", body, headers),
      ),
    ]);

    expect(created.status).toBe(201);
    const createdBody = solutionRevisionResponseV1Schema.parse(
      await created.json(),
    );
    expect(await replay.json()).toEqual(createdBody);
    expect(createdBody.data.manifest).toMatchObject({
      assumptions: [],
      contracts: { contractVersion: 1, recordHashes: [] },
      generationCoverage: {
        missingRequirements: [],
        state: "infrastructure-only",
        workloads: [],
      },
      workload: { contractVersion: 2 },
    });
    expect(createdBody.data.summary.architectureRevisionId).toBe(
      createdBody.data.revision.id,
    );
    expect(createdBody.data.manifest.architecture.revisionId).toBe(
      createdBody.data.revision.id,
    );

    const path =
      "/v1/projects/project_main/solution-revisions/" +
      createdBody.data.summary.solutionRevisionId;
    const [immutable, viewerRead, list] = await Promise.all([
      authorized(app, path),
      authorizedAs(app, path, VIEWER_TOKEN),
      authorized(app, "/v1/projects/project_main/solution-revisions"),
    ]);
    expect(immutable.status).toBe(200);
    expect(viewerRead.status).toBe(200);
    expect(await immutable.json()).toEqual(createdBody);
    expect(await viewerRead.json()).toEqual(createdBody);
    expect(await list.json()).toMatchObject({
      data: [
        {
          name: "Exact solution baseline",
          solutionRevisionId: createdBody.data.summary.solutionRevisionId,
        },
      ],
    });

    const viewerCreate = await authorizedAs(
      app,
      "/v1/projects/project_main/solution-revisions",
      VIEWER_TOKEN,
      jsonRequest("POST", body, {
        ...headers,
        "idempotency-key": "solution-revision-viewer-denied",
      }),
    );
    expect(viewerCreate.status).toBe(403);

    const staleRevision = await authorized(
      app,
      "/v1/projects/project_main/solution-revisions",
      jsonRequest(
        "POST",
        { ...body, draftVersion: 999 },
        {
          "idempotency-key": "solution-revision-superseded",
          "if-match": draft.headers.get("etag") ?? "",
        },
      ),
    );
    expect(staleRevision.status).toBe(412);

    const attemptedMutation = await authorized(
      app,
      path,
      jsonRequest("PUT", { name: "Changed" }, { "if-match": '"v1"' }),
    );
    expect(attemptedMutation.status).toBe(404);
    expect(await (await authorized(app, path)).json()).toEqual(createdBody);
  });

  it("exposes every remaining resource and queued-job route family", async () => {
    const { app } = fixture();
    const getPaths = [
      "/v1/organizations",
      "/v1/organizations/org_main",
      "/v1/organizations/org_main/memberships",
      "/v1/organizations/org_main/projects",
      "/v1/projects/project_main",
      "/v1/projects/project_main/environments",
      "/v1/projects/project_main/revisions",
      "/v1/projects/project_main/revisions/revision_main",
      "/v1/projects/project_main/artifacts",
      "/v1/projects/project_main/artifacts/artifact_main",
      "/v1/projects/project_main/artifacts/artifact_main/downloads",
      "/v1/organizations/org_main/integrations",
      "/v1/organizations/org_main/audit-events",
    ];
    const responses = [];
    for (const path of getPaths) {
      responses.push(await authorized(app, path));
    }
    expect(responses.map((response) => response.status)).toEqual(
      getPaths.map(() => 200),
    );

    const environment = await authorized(
      app,
      "/v1/projects/project_main/environments",
      jsonRequest(
        "POST",
        { environmentType: "development", name: "Development" },
        { "idempotency-key": "environment-create" },
      ),
    );
    const validation = await authorized(
      app,
      "/v1/projects/project_main/validation-runs",
      jsonRequest(
        "POST",
        {
          contractVersion: 1,
          environment: "development",
          input: { draftId: "draft_main", draftVersion: 1, kind: "draft" },
          target: "draft",
        },
        { "idempotency-key": "validation-create" },
      ),
    );
    const generation = await authorized(
      app,
      "/v1/projects/project_main/generation-jobs",
      jsonRequest(
        "POST",
        {
          contractVersion: 1,
          kind: "infrastructure-as-code",
          revisionId: "revision_main",
          target: "terraform",
        },
        { "idempotency-key": "generation-create" },
      ),
    );
    const exportJob = await authorized(
      app,
      "/v1/projects/project_main/export-jobs",
      jsonRequest(
        "POST",
        { artifactId: "artifact_main", contractVersion: 1, kind: "zip" },
        { "idempotency-key": "export-create" },
      ),
    );

    expect(environment.status).toBe(201);
    expect(validation.status).toBe(202);
    expect(generation.status).toBe(202);
    expect(exportJob.status).toBe(202);

    const validationId = ((await validation.json()) as { data: { id: string } })
      .data.id;
    const generationId = ((await generation.json()) as { data: { id: string } })
      .data.id;
    const exportId = ((await exportJob.json()) as { data: { id: string } }).data
      .id;
    const jobResponses = await Promise.all([
      authorized(
        app,
        "/v1/projects/project_main/validation-runs/" + validationId,
      ),
      authorized(
        app,
        "/v1/projects/project_main/generation-jobs/" + generationId,
      ),
      authorized(app, "/v1/projects/project_main/export-jobs/" + exportId),
    ]);
    expect(jobResponses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
  });
  it("manages project and environment lifecycle through ETags and tombstones", async () => {
    const { app, document } = fixture();
    const project = await authorized(app, "/v1/projects/project_main");
    const renamed = await authorized(
      app,
      "/v1/projects/project_main",
      jsonRequest(
        "PUT",
        { contractVersion: 1, name: "Renamed Project" },
        { "if-match": project.headers.get("etag") ?? "" },
      ),
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      data: { name: "Renamed Project", version: 2 },
    });

    const createdEnvironment = await authorized(
      app,
      "/v1/projects/project_main/environments",
      jsonRequest(
        "POST",
        {
          environmentType: "staging",
          name: "Staging",
          region: "us-east-1",
        },
        { "idempotency-key": "environment-lifecycle-create" },
      ),
    );
    expect(createdEnvironment.status).toBe(201);
    const environmentId = (
      (await createdEnvironment.json()) as { data: { id: string } }
    ).data.id;
    const environment = await authorized(
      app,
      `/v1/projects/project_main/environments/${environmentId}`,
    );
    const updatedEnvironment = await authorized(
      app,
      `/v1/projects/project_main/environments/${environmentId}`,
      jsonRequest(
        "PUT",
        {
          contractVersion: 1,
          environmentType: "production",
          name: "Production",
          region: "us-west-2",
        },
        { "if-match": environment.headers.get("etag") ?? "" },
      ),
    );
    expect(updatedEnvironment.status).toBe(200);
    const deletedEnvironment = await authorized(
      app,
      `/v1/projects/project_main/environments/${environmentId}`,
      {
        headers: {
          "idempotency-key": "environment-lifecycle-delete",
          "if-match": updatedEnvironment.headers.get("etag") ?? "",
        },
        method: "DELETE",
      },
    );
    expect(await deletedEnvironment.json()).toMatchObject({
      data: { lifecycleStatus: "deletion-pending" },
    });

    const currentDraft = await authorized(
      app,
      "/v1/projects/project_main/draft",
    );
    const currentProject = await authorized(app, "/v1/projects/project_main");
    const archived = await authorized(
      app,
      "/v1/projects/project_main/archive",
      jsonRequest(
        "POST",
        { contractVersion: 1 },
        {
          "idempotency-key": "project-lifecycle-archive",
          "if-match": currentProject.headers.get("etag") ?? "",
        },
      ),
    );
    expect(await archived.json()).toMatchObject({
      data: { lifecycleStatus: "archived" },
    });
    const archivedSave = await authorized(
      app,
      "/v1/projects/project_main/draft",
      jsonRequest(
        "PUT",
        { architectureDocument: document, contractVersion: 1 },
        { "if-match": currentDraft.headers.get("etag") ?? "" },
      ),
    );
    expect(archivedSave.status).toBe(409);
    expect(await archivedSave.json()).toMatchObject({
      error: { code: "conflict" },
    });
    const deleted = await authorized(app, "/v1/projects/project_main", {
      headers: {
        "idempotency-key": "project-lifecycle-delete",
        "if-match": archived.headers.get("etag") ?? "",
      },
      method: "DELETE",
    });
    expect(await deleted.json()).toMatchObject({
      data: {
        lifecycleStatus: "deletion-pending",
        tombstoneRequestedAt: LATER,
      },
    });

    const organization = await authorized(app, "/v1/organizations/org_main");
    const organizationDeleted = await authorized(
      app,
      "/v1/organizations/org_main",
      {
        headers: {
          "idempotency-key": "organization-lifecycle-delete",
          "if-match": organization.headers.get("etag") ?? "",
        },
        method: "DELETE",
      },
    );
    expect(await organizationDeleted.json()).toMatchObject({
      data: {
        deletionRequestedAt: LATER,
        lifecycleStatus: "deletion-pending",
      },
    });
  });

  it("rejects concurrent autosaves with recovery metadata and separates layout hashes", async () => {
    const { app, document } = fixture();
    const initial = await authorized(app, "/v1/projects/project_main/draft");
    const withNode = architectureDocumentV3Schema.parse({
      ...document,
      nodes: [
        {
          id: "node_service",
          presentation: {
            label: "Service",
            position: { x: 10, y: 20 },
          },
          semantic: {
            configuration: {
              schemaId: "example.service-config",
              schemaVersion: "1.0.0",
              values: {},
            },
            deploymentKey: "service",
            lifecycle: { origin: "user", ownership: "user" },
            resourceType: "example.service.resource",
            serviceType: "example.service",
          },
        },
      ],
    });
    const seeded = await authorized(
      app,
      "/v1/projects/project_main/draft",
      jsonRequest(
        "PUT",
        { architectureDocument: withNode, contractVersion: 1 },
        { "if-match": initial.headers.get("etag") ?? "" },
      ),
    );
    expect(seeded.status).toBe(200);
    const seededBody = (await seeded.json()) as {
      data: {
        documentDigest: string;
        semanticDigest: string;
        visualDigest: string;
      };
    };

    const layout = (x: number) =>
      architectureDocumentV3Schema.parse({
        ...withNode,
        nodes: withNode.nodes.map((node) => ({
          ...node,
          presentation: {
            ...node.presentation,
            position: { ...node.presentation.position, x },
          },
        })),
      });
    const headers = {
      "if-match": seeded.headers.get("etag") ?? "",
    };
    const [left, right] = await Promise.all([
      authorized(
        app,
        "/v1/projects/project_main/draft",
        jsonRequest(
          "PUT",
          { architectureDocument: layout(40), contractVersion: 1 },
          headers,
        ),
      ),
      authorized(
        app,
        "/v1/projects/project_main/draft",
        jsonRequest(
          "PUT",
          { architectureDocument: layout(80), contractVersion: 1 },
          headers,
        ),
      ),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 412]);
    const success = left.status === 200 ? left : right;
    const conflict = left.status === 412 ? left : right;
    const successBody = (await success.json()) as {
      data: {
        documentDigest: string;
        semanticDigest: string;
        visualDigest: string;
      };
    };
    expect(successBody.data.semanticDigest).toBe(
      seededBody.data.semanticDigest,
    );
    expect(successBody.data.documentDigest).not.toBe(
      seededBody.data.documentDigest,
    );
    expect(successBody.data.visualDigest).not.toBe(
      seededBody.data.visualDigest,
    );
    expect(await conflict.json()).toMatchObject({
      error: {
        code: "precondition_failed",
        conflict: {
          current: {
            etag: success.headers.get("etag"),
            semanticDigest: successBody.data.semanticDigest,
            version: 3,
          },
          recovery: {
            canCompare: true,
            canCopy: true,
            canReload: true,
          },
          resourceId: "draft_main",
          resourceKind: "draft",
        },
      },
    });
  });

  it("rejects full-document saves that replace server-owned draft identities", async () => {
    const { app, document } = fixture();
    const draft = await authorized(app, "/v1/projects/project_main/draft");
    const replacementRootRevision = {
      ...document.revision,
      revisionId: "revision_replacement",
      sourceDraftId: "draft_replacement",
    };
    const {
      sourceDraftId: replacementSourceDraftId,
      ...replacementNestedRevision
    } = replacementRootRevision;
    void replacementSourceDraftId;
    const replacement = architectureDocumentV3Schema.parse({
      ...document,
      applicationContracts: {
        ...document.applicationContracts,
        contractSetId: "contractset_replacement",
        documentId: "document_replacement",
        revision: replacementNestedRevision,
      },
      architectureId: "architecture_replacement",
      documentId: "document_replacement",
      externalResources: {
        ...document.externalResources,
        architectureId: "architecture_replacement",
        documentId: "document_replacement",
        revision: replacementNestedRevision,
      },
      revision: replacementRootRevision,
    });

    const rejected = await authorized(
      app,
      "/v1/projects/project_main/draft",
      jsonRequest(
        "PUT",
        { architectureDocument: replacement, contractVersion: 1 },
        { "if-match": draft.headers.get("etag") ?? "" },
      ),
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: { code: "invalid_request" },
    });

    const after = await authorized(app, "/v1/projects/project_main/draft");
    expect(after.headers.get("etag")).toBe(draft.headers.get("etag"));
    expect(await after.json()).toMatchObject({
      data: {
        architectureDocument: {
          architectureId: document.architectureId,
          documentId: document.documentId,
          revision: {
            revisionId: document.revision.revisionId,
            sourceDraftId: "draft_main",
          },
        },
        version: 1,
      },
    });
  });

  it("rejects unsupported document versions and never exposes revision mutation", async () => {
    const { app, document } = fixture();
    const draft = await authorized(app, "/v1/projects/project_main/draft");
    const unsupported = await authorized(
      app,
      "/v1/projects/project_main/draft",
      jsonRequest(
        "PUT",
        {
          architectureDocument: { ...document, schemaVersion: 999 },
          contractVersion: 1,
        },
        { "if-match": draft.headers.get("etag") ?? "" },
      ),
    );
    expect(unsupported.status).toBe(422);
    expect(await unsupported.json()).toMatchObject({
      error: { code: "unsupported_version" },
    });

    const before = await authorized(
      app,
      "/v1/projects/project_main/revisions/revision_main",
    );
    const attemptedMutation = await authorized(
      app,
      "/v1/projects/project_main/revisions/revision_main",
      jsonRequest(
        "PUT",
        { name: "Mutated revision" },
        { "if-match": '"revision:revision_main:v1"' },
      ),
    );
    const after = await authorized(
      app,
      "/v1/projects/project_main/revisions/revision_main",
    );
    expect(attemptedMutation.status).toBe(404);
    expect(await after.json()).toEqual(await before.json());
  });
});
