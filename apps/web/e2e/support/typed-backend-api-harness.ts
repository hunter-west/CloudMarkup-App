import { createHash, randomUUID } from "node:crypto";
import {
  accountPhotoV1Schema,
  acquireProjectEditingLeaseV1Schema,
  mutateProjectEditingLeaseV1Schema,
  projectEditingLeaseProofV1Schema,
} from "@cloudmarkup/api-contract";

import type { BrowserContext, Request, Route } from "@playwright/test";
import {
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  serializeArchitectureDocumentV3,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

import {
  loadAwsEditorArchitectureDocument,
  loadBlankAwsEditorArchitectureDocument,
} from "../../src/provider-catalog/aws-editor-fixture.js";

export const TYPED_BACKEND_API_PREFIX = "/typed-backend-api" as const;
export const TYPED_BACKEND_ORGANIZATION_ID = "org_local" as const;
export const TYPED_BACKEND_NOTES_PROJECT_ID = "project_notes" as const;
export const TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID =
  "project_infrastructure" as const;

const API_VERSION = "v1" as const;
const NOW = "2026-08-15T12:00:00.000Z" as const;
const LATER = "2026-08-15T12:05:00.000Z" as const;
const DIGEST_EMPTY = `sha256:${"0".repeat(64)}` as const;

const ownerCapabilities = [
  "organizations.read",
  "memberships.read",
  "memberships.manage",
  "memberships.assign-owner",
  "projects.read",
  "projects.create",
  "projects.mutate",
  "projects.delete",
  "environments.create",
  "revisions.create",
  "validation.run",
  "generation.run",
  "exports.run",
  "artifacts.read",
  "integrations.read",
  "integrations.manage",
  "audit.read",
  "commercial.summary.read",
  "commercial.expensive.use",
  "billing.manage",
  "usage.read-technical",
  "organizations.delete",
] as const;

const viewerCapabilities = [
  "organizations.read",
  "projects.read",
  "artifacts.read",
  "commercial.summary.read",
] as const;

export type TypedBackendPrincipalRole = "owner" | "viewer";
export type TypedBackendFailureMode =
  "none" | "offline" | "service-unavailable";

interface TypedBackendProject {
  createdAt: string;
  currentDraft: { id: string; version: number };
  description?: string;
  environmentCount: number;
  id: string;
  latestRevisionId?: string;
  lifecycleStatus: "active" | "archived" | "deletion-pending" | "deleted";
  name: string;
  organizationId: string;
  tombstoneRequestedAt?: string;
  updatedAt: string;
  version: number;
}

interface TypedBackendDraft {
  document: ArchitectureDocumentV3;
  id: string;
  projectId: string;
  updatedAt: string;
  version: number;
}

interface TypedBackendRevision {
  readonly manifest: Record<string, unknown>;
  readonly revision: Record<string, unknown>;
  readonly summary: TypedBackendRevisionSummary;
}

interface TypedBackendRevisionSummary {
  readonly architectureRevisionId: string;
  readonly contentDigest: string;
  readonly createdAt: string;
  readonly createdBy: { readonly displayName: string; readonly id: string };
  readonly documentDigest: string;
  readonly generationCoverage: Record<string, unknown>;
  readonly name: string;
  readonly projectId: string;
  readonly semanticDigest: string;
  readonly solutionRevisionId: string;
  readonly sourceDraftId: string;
  readonly sourceDraftVersion: number;
  readonly visualDigest: string;
}

export interface TypedBackendRecordedRequest {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
}

export interface TypedBackendApiHarnessOptions {
  readonly role?: TypedBackendPrincipalRole;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function documentDigests(document: ArchitectureDocumentV3) {
  return {
    contentDigest: getArchitectureDocumentContentHash(document),
    documentDigest: sha256(serializeArchitectureDocumentV3(document)),
    visualDigest: getArchitectureDocumentVisualHash(document),
  } as const;
}

function draftEtag(draft: TypedBackendDraft): string {
  return `"draft:${draft.id}:${String(draft.version)}"`;
}

function projectEtag(project: TypedBackendProject): string {
  return `"project:${project.id}:${String(project.version)}"`;
}

function preferenceEtag(version: number): string {
  return `"preferences:principal_typed_backend:${String(version)}"`;
}

function data<T>(value: T) {
  return { apiVersion: API_VERSION, data: value } as const;
}

function list<T>(values: readonly T[]) {
  return {
    apiVersion: API_VERSION,
    data: values,
    page: { hasMore: false },
  } as const;
}

function projectSummary(project: TypedBackendProject) {
  return {
    createdAt: project.createdAt,
    currentDraft: project.currentDraft,
    id: project.id,
    latestRevisionId: project.latestRevisionId,
    lifecycleStatus: project.lifecycleStatus,
    name: project.name,
    organizationId: project.organizationId,
    tombstoneRequestedAt: project.tombstoneRequestedAt,
    updatedAt: project.updatedAt,
    version: project.version,
  };
}
function errorEnvelope(
  code:
    | "access_denied"
    | "authentication_required"
    | "not_found"
    | "precondition_failed"
    | "service_unavailable",
  message: string,
  conflict?: Record<string, unknown>,
) {
  return {
    apiVersion: API_VERSION,
    error: {
      code,
      ...(conflict === undefined ? {} : { conflict }),
      correlationId: "correlation-typed_backend-e2e",
      message,
    },
  } as const;
}

function cloneDocument(
  document: ArchitectureDocumentV3,
): ArchitectureDocumentV3 {
  return architectureDocumentV3Schema.parse(structuredClone(document));
}

function initialProjects(): readonly {
  readonly draft: TypedBackendDraft;
  readonly project: TypedBackendProject;
}[] {
  return [
    {
      draft: {
        document: cloneDocument(loadAwsEditorArchitectureDocument()),
        id: "draft_notes",
        projectId: TYPED_BACKEND_NOTES_PROJECT_ID,
        updatedAt: NOW,
        version: 1,
      },
      project: {
        createdAt: NOW,
        currentDraft: { id: "draft_notes", version: 1 },
        description:
          "A deterministic notes API with an explicit Workload Document.",
        environmentCount: 0,
        id: TYPED_BACKEND_NOTES_PROJECT_ID,
        lifecycleStatus: "active",
        name: "Notes API",
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        updatedAt: NOW,
        version: 1,
      },
    },
    {
      draft: {
        document: cloneDocument(loadBlankAwsEditorArchitectureDocument()),
        id: "draft_infrastructure",
        projectId: TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID,
        updatedAt: NOW,
        version: 1,
      },
      project: {
        createdAt: NOW,
        currentDraft: { id: "draft_infrastructure", version: 1 },
        description: "An infrastructure-only project without application code.",
        environmentCount: 0,
        id: TYPED_BACKEND_INFRASTRUCTURE_PROJECT_ID,
        lifecycleStatus: "active",
        name: "Infrastructure only",
        organizationId: TYPED_BACKEND_ORGANIZATION_ID,
        updatedAt: NOW,
        version: 1,
      },
    },
  ];
}

function buildSolutionRevision(
  project: TypedBackendProject,
  draft: TypedBackendDraft,
  name: string,
  ordinal: number,
): TypedBackendRevision {
  const digests = documentDigests(draft.document);
  const solutionRevisionId = `solution_typed_backend_${String(ordinal)}`;
  const architectureRevisionId = `revision_typed_backend_${String(ordinal)}`;
  const workloadRecords = draft.document.workloadBehavior.workloads;
  const infrastructureOnly = workloadRecords.length === 0;
  const aggregateState = infrastructureOnly
    ? "infrastructure-only"
    : "custom-implementation-required";
  const missingRequirements = infrastructureOnly
    ? []
    : ["deterministic-application-generation"];
  const workloads = workloadRecords.map((workload) => ({
    evidence: [],
    missingRequirements,
    state: aggregateState,
    unresolvedRequirementIds: workload.unresolvedRequirementIds,
    workloadId: workload.id,
  }));
  const generationCoverage = {
    contractVersion: 1,
    evidence: [],
    missingRequirements,
    solutionRevisionId,
    state: aggregateState,
    workloads,
  } as const;
  const summary: TypedBackendRevisionSummary = {
    architectureRevisionId,
    contentDigest: digests.contentDigest,
    createdAt: LATER,
    createdBy: {
      displayName: "Prompt 26 Owner",
      id: "principal_typed_backend_owner",
    },
    documentDigest: digests.documentDigest,
    generationCoverage,
    name,
    projectId: project.id,
    semanticDigest: digests.contentDigest,
    solutionRevisionId,
    sourceDraftId: draft.id,
    sourceDraftVersion: draft.version,
    visualDigest: digests.visualDigest,
  };

  return {
    manifest: {
      aiExtensionIds: [],
      architecture: {
        contentHash: digests.contentDigest,
        documentHash: digests.documentDigest,
        documentKind: "cloudmarkup.architecture-document",
        revisionId: architectureRevisionId,
        schemaVersion: 3,
        visualHash: digests.visualDigest,
      },
      assumptions: draft.document.assumptions.map(
        (assumption) => assumption.id,
      ),
      contractVersion: 1,
      contracts: {
        contentHash: DIGEST_EMPTY,
        contractVersion: 1,
        recordHashes: [],
      },
      createdAt: LATER,
      createdBy: "principal_typed_backend_owner",
      evidenceIdsAtFreeze: [],
      externalResources: {
        contentHash: DIGEST_EMPTY,
        contractVersion: 1,
      },
      generationCoverage,
      intent: {
        reason: "No Intent Document is persisted for this local fixture.",
        state: "not-applicable",
      },
      issueIdsAtFreeze: [],
      kind: "cloudmarkup.solution-revision-manifest",
      repositoryObservations: [],
      solutionRevisionId,
      sourceOwnership: [],
      unresolvedDecisionIds: draft.document.unresolvedRequirements.map(
        (requirement) => requirement.id,
      ),
      versions: {
        applicationGenerator: {
          reason: "Application generation did not run.",
          state: "not-applicable",
        },
        catalog: draft.document.catalog,
        compiler: {
          reason: "Compilation did not run.",
          state: "not-applicable",
        },
        diagramRenderer: {
          reason: "Diagram rendering did not run.",
          state: "not-applicable",
        },
        importer: {
          reason: "Repository import did not run.",
          state: "not-applicable",
        },
        modelPrompt: {
          reason: "No model was called.",
          state: "not-applicable",
        },
        policy: [],
      },
      workload: {
        contentHash: DIGEST_EMPTY,
        contractVersion: 2,
      },
    },
    revision: {
      architectureDocument: cloneDocument(draft.document),
      catalogDigest: draft.document.catalog.digest,
      catalogId: draft.document.catalog.id,
      catalogVersion: draft.document.catalog.version,
      compatibility: {
        catalog: draft.document.catalog,
        compiler: {
          inputContractVersion:
            draft.document.compilerCompatibility.inputContractVersion,
          maximumVersionExclusive:
            draft.document.compilerCompatibility
              .maximumCompilerVersionExclusive,
          minimumVersion:
            draft.document.compilerCompatibility.minimumCompilerVersion,
        },
        documentSchema: {
          kind: "cloudmarkup.architecture-document",
          version: 3,
        },
      },
      contentDigest: digests.contentDigest,
      createdAt: LATER,
      createdBy: summary.createdBy,
      documentDigest: digests.documentDigest,
      graphSchemaVersion: 3,
      id: architectureRevisionId,
      name,
      projectId: project.id,
      revisionNumber: ordinal,
      semanticDigest: digests.contentDigest,
      sourceDraftId: draft.id,
      sourceDraftVersion: draft.version,
      storageStatus: "published",
      visualDigest: digests.visualDigest,
      workloadBehaviorVersion: 2,
    },
    summary,
  };
}

function requestBody(request: Request): unknown {
  const body = request.postData();
  if (body === null || body.length === 0) {
    return undefined;
  }
  return JSON.parse(body) as unknown;
}

function requestHeaders(request: Request): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(request.headers()).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

async function fulfill(
  route: Route,
  status: number,
  json: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> {
  await route.fulfill({
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
    json,
    status,
  });
}

export class TypedBackendApiHarness {
  readonly #editingLeases = new Map<
    string,
    { leaseId: string; token: string; expiresAt: number }
  >();
  readonly #drafts = new Map<string, TypedBackendDraft>();
  readonly #projects = new Map<string, TypedBackendProject>();
  readonly #revisions = new Map<string, TypedBackendRevision[]>();
  readonly #role: TypedBackendPrincipalRole;
  #draftSaveFailure: TypedBackendFailureMode = "none";
  #preferencesFailure: TypedBackendFailureMode = "none";
  #preferences: {
    contextualLearningEnabled: boolean;
    contractVersion: 1;
    experienceMode: "guided" | "professional";
    syncVersion: number;
    updatedAt: string;
  } = {
    contextualLearningEnabled: true,
    contractVersion: 1,
    experienceMode: "guided",
    syncVersion: 1,
    updatedAt: NOW,
  };
  #sessionExpired = false;
  readonly requests: TypedBackendRecordedRequest[] = [];

  constructor(options: TypedBackendApiHarnessOptions = {}) {
    this.#role = options.role ?? "owner";
    for (const entry of initialProjects()) {
      this.#drafts.set(entry.project.id, entry.draft);
      this.#projects.set(entry.project.id, entry.project);
      this.#revisions.set(entry.project.id, []);
    }
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(`**${TYPED_BACKEND_API_PREFIX}/v1/**`, (route) =>
      this.#handle(route),
    );
  }

  seedArchitecture(projectId: string, document: ArchitectureDocumentV3): void {
    this.#requireDraft(projectId).document =
      architectureDocumentV3Schema.parse(document);
  }

  seedLegacyExampleCatalog(projectId: string): void {
    const draft = this.#requireDraft(projectId);
    draft.document = architectureDocumentV3Schema.parse({
      ...draft.document,
      provider: { id: "example.cloud", region: "example-region-1" },
      catalog: {
        id: "example.cloud.catalog",
        version: "1.0.0",
        digest: `sha256:${"0".repeat(64)}`,
      },
      nodes: [],
      edges: [],
    });
  }

  setDraftSaveFailure(mode: TypedBackendFailureMode): void {
    this.#draftSaveFailure = mode;
  }

  /** Advance only this synthetic server lease past its natural deadline. */
  expireEditingLease(projectId: string): void {
    const lease = this.#editingLeases.get(projectId);
    if (lease !== undefined) lease.expiresAt = Date.now() - 1;
  }

  setPreferencesFailure(mode: TypedBackendFailureMode): void {
    this.#preferencesFailure = mode;
  }

  expireSession(): void {
    this.#sessionExpired = true;
  }

  restoreSession(): void {
    this.#sessionExpired = false;
  }

  advanceDraftVersion(projectId: string): void {
    const draft = this.#requireDraft(projectId);
    draft.version += 1;
    draft.updatedAt = LATER;
    const project = this.#requireProject(projectId);
    project.currentDraft = { id: draft.id, version: draft.version };
    project.updatedAt = LATER;
  }

  seedSolutionRevision(projectId: string, name: string): TypedBackendRevision {
    const project = this.#requireProject(projectId);
    const draft = this.#requireDraft(projectId);
    const revisions = this.#revisions.get(projectId) ?? [];
    const revision = buildSolutionRevision(
      project,
      draft,
      name,
      revisions.length + 1,
    );
    revisions.push(revision);
    this.#revisions.set(projectId, revisions);
    project.latestRevisionId = revision.summary.architectureRevisionId;
    return revision;
  }

  latestDraftSave(projectId: string): TypedBackendRecordedRequest | undefined {
    const path = `/v1/projects/${projectId}/draft`;
    return [...this.requests]
      .reverse()
      .find((request) => request.method === "PUT" && request.path === path);
  }

  requestCount(method: string, path: string): number {
    return this.requests.filter(
      (request) => request.method === method && request.path === path,
    ).length;
  }

  #requireProject(projectId: string): TypedBackendProject {
    const project = this.#projects.get(projectId);
    if (project === undefined) {
      throw new Error(`Unknown Prompt 26 project: ${projectId}`);
    }
    return project;
  }

  #requireDraft(projectId: string): TypedBackendDraft {
    const draft = this.#drafts.get(projectId);
    if (draft === undefined) {
      throw new Error(`Unknown Prompt 26 draft: ${projectId}`);
    }
    return draft;
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice(TYPED_BACKEND_API_PREFIX.length);
    const method = request.method();
    const body = requestBody(request);
    const headers = requestHeaders(request);
    this.requests.push({ body, headers, method, path });

    if (this.#sessionExpired) {
      await fulfill(
        route,
        401,
        errorEnvelope("authentication_required", "Authentication is required."),
      );
      return;
    }

    if (method === "GET" && path === "/v1/me") {
      await this.#principal(route);
      return;
    }
    if (method === "GET" && path === "/v1/account/profile") {
      const owner = this.#role === "owner";
      await fulfill(
        route,
        200,
        data({
          contractVersion: 1,
          principalId: owner
            ? "principal_typed_backend_owner"
            : "principal_typed_backend_viewer",
          displayName: owner ? "Prompt 26 Owner" : "Prompt 26 Viewer",
          username: null,
          version: 1,
        }),
        { etag: '"profile-browser:1"' },
      );
      return;
    }
    if (method === "GET" && path === "/v1/account/photo") {
      await fulfill(
        route,
        200,
        data(
          accountPhotoV1Schema.parse({
            contractVersion: 1,
            principalId:
              this.#role === "owner"
                ? "principal_typed_backend_owner"
                : "principal_typed_backend_viewer",
            version: 0,
            image: null,
          }),
        ),
        { etag: '"photo-browser:0"' },
      );
      return;
    }
    if (method === "GET" && path === "/v1/account/authenticator") {
      await fulfill(
        route,
        200,
        data({
          contractVersion: 1,
          principalId:
            this.#role === "owner"
              ? "principal_typed_backend_owner"
              : "principal_typed_backend_viewer",
          enabled: false,
          enrollmentAvailable: false,
          recoveryContact: null,
          enrollment: null,
        }),
      );
      return;
    }
    const accountWorkspace = {
      contractVersion: 1,
      principalId:
        this.#role === "owner"
          ? "principal_typed_backend_owner"
          : "principal_typed_backend_viewer",
      id: TYPED_BACKEND_ORGANIZATION_ID,
      displayName: "CloudMarkup workspace",
      kind: "organization",
      role: this.#role,
    };
    if (method === "GET" && path === "/v1/account/workspaces") {
      await fulfill(route, 200, list([accountWorkspace]));
      return;
    }
    if (
      method === "GET" &&
      path === "/v1/account/workspaces/" + TYPED_BACKEND_ORGANIZATION_ID
    ) {
      await fulfill(route, 200, data(accountWorkspace));
      return;
    }
    if (method === "GET" && path === "/v1/organizations") {
      await fulfill(
        route,
        200,
        list([
          {
            id: TYPED_BACKEND_ORGANIZATION_ID,
            displayName: "CloudMarkup workspace",
            slug: "cloudmarkup-workspace",
            createdAt: NOW,
            lifecycleStatus: "active",
            version: 1,
          },
        ]),
      );
      return;
    }
    if (path === "/v1/me/presentation-preferences") {
      await this.#presentationPreferences(route, method, body, headers);
      return;
    }

    const projectListMatch = /^\/v1\/organizations\/([^/]+)\/projects$/u.exec(
      path,
    );
    if (projectListMatch !== null) {
      await this.#projectsRoute(
        route,
        method,
        decodeURIComponent(projectListMatch[1] ?? ""),
        body,
      );
      return;
    }

    const billingWorkspaceMatch =
      /^\/v1\/organizations\/([^/]+)\/billing$/u.exec(path);
    if (billingWorkspaceMatch !== null && method === "GET") {
      const organizationId = decodeURIComponent(billingWorkspaceMatch[1] ?? "");
      if (organizationId !== TYPED_BACKEND_ORGANIZATION_ID) {
        await fulfill(
          route,
          404,
          errorEnvelope("not_found", "The requested resource is unavailable."),
        );
        return;
      }
      await fulfill(
        route,
        200,
        data({
          contractVersion: 1,
          organizationId,
          asOf: NOW,
          mode: "disabled",
          accountState: "active",
          subscriptionState: "active",
          currentPlanKey: "starter",
          canCheckout: false,
          canManage: false,
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
              monthlyPriceMicros: "39000000",
              monthlyCreditUnits: 1000,
            },
          ],
        }),
      );
      return;
    }
    const commercialMatch =
      /^\/v1\/organizations\/([^/]+)\/commercial\/(current-plan|credit-balance|credit-overview)$/u.exec(
        path,
      );
    if (commercialMatch !== null && method === "GET") {
      await this.#commercial(
        route,
        decodeURIComponent(commercialMatch[1] ?? ""),
        commercialMatch[2] ?? "",
      );
      return;
    }

    const solutionRevisionMatch =
      /^\/v1\/projects\/([^/]+)\/solution-revisions(?:\/([^/]+))?$/u.exec(path);
    if (solutionRevisionMatch !== null) {
      await this.#solutionRevisions(
        route,
        method,
        decodeURIComponent(solutionRevisionMatch[1] ?? ""),
        solutionRevisionMatch[2] === undefined
          ? undefined
          : decodeURIComponent(solutionRevisionMatch[2]),
        body,
        headers,
      );
      return;
    }

    const editingLeaseMatch = /^\/v1\/projects\/([^/]+)\/editing-lease$/u.exec(
      path,
    );
    if (editingLeaseMatch !== null) {
      await this.#editingLease(
        route,
        method,
        decodeURIComponent(editingLeaseMatch[1] ?? ""),
        body,
      );
      return;
    }
    const draftMatch = /^\/v1\/projects\/([^/]+)\/draft$/u.exec(path);
    if (draftMatch !== null) {
      await this.#draft(
        route,
        method,
        decodeURIComponent(draftMatch[1] ?? ""),
        body,
        headers,
      );
      return;
    }

    const archiveMatch = /^\/v1\/projects\/([^/]+)\/archive$/u.exec(path);
    if (archiveMatch !== null && method === "POST") {
      await this.#archive(
        route,
        decodeURIComponent(archiveMatch[1] ?? ""),
        headers,
      );
      return;
    }

    const projectMatch = /^\/v1\/projects\/([^/]+)$/u.exec(path);
    if (projectMatch !== null) {
      await this.#project(
        route,
        method,
        decodeURIComponent(projectMatch[1] ?? ""),
        headers,
      );
      return;
    }

    await fulfill(
      route,
      404,
      errorEnvelope("not_found", "The requested resource is unavailable."),
    );
  }

  async #principal(route: Route): Promise<void> {
    const owner = this.#role === "owner";
    await fulfill(
      route,
      200,
      data({
        displayName: owner ? "Prompt 26 Owner" : "Prompt 26 Viewer",
        email: owner ? "owner@example.test" : "viewer@example.test",
        id: owner
          ? "principal_typed_backend_owner"
          : "principal_typed_backend_viewer",
        organizationContexts: [
          {
            capabilities: owner ? ownerCapabilities : viewerCapabilities,
            isOwner: owner,
            membershipId: owner
              ? "membership_typed_backend_owner"
              : "membership_typed_backend_viewer",
            organizationId: TYPED_BACKEND_ORGANIZATION_ID,
            role: this.#role,
          },
        ],
        resourceVersion: 1,
      }),
    );
  }

  async #presentationPreferences(
    route: Route,
    method: string,
    body: unknown,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> {
    if (this.#preferencesFailure === "offline") {
      await route.abort("internetdisconnected");
      return;
    }
    if (this.#preferencesFailure === "service-unavailable") {
      await fulfill(
        route,
        503,
        errorEnvelope(
          "service_unavailable",
          "Preferences are temporarily unavailable.",
        ),
      );
      return;
    }
    if (method === "GET") {
      await fulfill(route, 200, data(this.#preferences), {
        etag: preferenceEtag(this.#preferences.syncVersion),
      });
      return;
    }
    if (method === "PUT") {
      const expected = preferenceEtag(this.#preferences.syncVersion);
      if (headers["if-match"] !== expected) {
        await fulfill(
          route,
          412,
          errorEnvelope(
            "precondition_failed",
            "The preferences changed. Reload and try again.",
          ),
        );
        return;
      }
      const input = body as {
        readonly contextualLearningEnabled?: unknown;
        readonly experienceMode?: unknown;
      };
      this.#preferences = {
        contextualLearningEnabled: input.contextualLearningEnabled === true,
        contractVersion: 1,
        experienceMode:
          input.experienceMode === "professional" ? "professional" : "guided",
        syncVersion: this.#preferences.syncVersion + 1,
        updatedAt: LATER,
      };
      await fulfill(route, 200, data(this.#preferences), {
        etag: preferenceEtag(this.#preferences.syncVersion),
      });
      return;
    }
    await fulfill(
      route,
      404,
      errorEnvelope("not_found", "The requested resource is unavailable."),
    );
  }

  async #projectsRoute(
    route: Route,
    method: string,
    organizationId: string,
    body: unknown,
  ): Promise<void> {
    if (organizationId !== TYPED_BACKEND_ORGANIZATION_ID) {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    if (method === "GET") {
      const projects = [...this.#projects.values()]
        .filter((project) => project.organizationId === organizationId)
        .map(projectSummary);
      await fulfill(route, 200, list(projects));
      return;
    }
    if (method === "POST") {
      if (this.#role !== "owner") {
        await fulfill(
          route,
          403,
          errorEnvelope(
            "access_denied",
            "This action is not available for the current account.",
          ),
        );
        return;
      }
      const input = body as {
        readonly architectureDocument?: unknown;
        readonly creationMode?: unknown;
        readonly description?: unknown;
        readonly name?: unknown;
      };
      const ordinal = this.#projects.size + 1;
      const projectId = `project_created_${String(ordinal)}`;
      const draftId = `draft_created_${String(ordinal)}`;
      const document =
        input.creationMode === "draft-copy"
          ? architectureDocumentV3Schema.parse(input.architectureDocument)
          : cloneDocument(loadBlankAwsEditorArchitectureDocument());
      const project: TypedBackendProject = {
        createdAt: LATER,
        currentDraft: { id: draftId, version: 1 },
        ...(typeof input.description === "string"
          ? { description: input.description }
          : {}),
        environmentCount: 0,
        id: projectId,
        lifecycleStatus: "active",
        name: typeof input.name === "string" ? input.name : "Created project",
        organizationId,
        updatedAt: LATER,
        version: 1,
      };
      const draft: TypedBackendDraft = {
        document,
        id: draftId,
        projectId,
        updatedAt: LATER,
        version: 1,
      };
      this.#projects.set(projectId, project);
      this.#drafts.set(projectId, draft);
      this.#revisions.set(projectId, []);
      await fulfill(
        route,
        201,
        data({ draft: { id: draftId, version: 1 }, project }),
      );
      return;
    }
    await fulfill(
      route,
      404,
      errorEnvelope("not_found", "The requested resource is unavailable."),
    );
  }

  async #project(
    route: Route,
    method: string,
    projectId: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> {
    const project = this.#projects.get(projectId);
    if (project === undefined) {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    if (method === "GET") {
      await fulfill(route, 200, data(project), { etag: projectEtag(project) });
      return;
    }
    if (method === "DELETE") {
      if (this.#role !== "owner") {
        await fulfill(
          route,
          403,
          errorEnvelope(
            "access_denied",
            "This action is not available for the current account.",
          ),
        );
        return;
      }
      if (headers["if-match"] !== projectEtag(project)) {
        await fulfill(
          route,
          412,
          errorEnvelope(
            "precondition_failed",
            "The project changed. Refresh and try again.",
          ),
        );
        return;
      }
      project.lifecycleStatus = "deletion-pending";
      project.tombstoneRequestedAt = LATER;
      project.updatedAt = LATER;
      project.version += 1;
      await fulfill(route, 200, data(project), { etag: projectEtag(project) });
      return;
    }
    await fulfill(
      route,
      404,
      errorEnvelope("not_found", "The requested resource is unavailable."),
    );
  }

  async #archive(
    route: Route,
    projectId: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> {
    const project = this.#projects.get(projectId);
    if (project === undefined) {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    if (this.#role !== "owner") {
      await fulfill(
        route,
        403,
        errorEnvelope(
          "access_denied",
          "This action is not available for the current account.",
        ),
      );
      return;
    }
    if (headers["if-match"] !== projectEtag(project)) {
      await fulfill(
        route,
        412,
        errorEnvelope(
          "precondition_failed",
          "The project changed. Refresh and try again.",
        ),
      );
      return;
    }
    project.lifecycleStatus = "archived";
    project.updatedAt = LATER;
    project.version += 1;
    await fulfill(route, 200, data(project), { etag: projectEtag(project) });
  }

  async #editingLease(
    route: Route,
    method: string,
    projectId: string,
    body: unknown,
  ): Promise<void> {
    const project = this.#projects.get(projectId);
    if (project?.lifecycleStatus !== "active") {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    let current = this.#editingLeases.get(projectId);
    if (current !== undefined && current.expiresAt <= Date.now()) {
      this.#editingLeases.delete(projectId);
      current = undefined;
    }
    const state = (owned = false) =>
      data({
        contractVersion: 1,
        projectId,
        ...(current === undefined
          ? { state: "available" }
          : {
              state: owned ? "owned" : "held",
              expiresAt: new Date(current.expiresAt).toISOString(),
              ...(owned ? { leaseId: current.leaseId } : {}),
            }),
      });
    if (method === "GET") {
      await fulfill(route, 200, state());
      return;
    }
    if (this.#role !== "owner") {
      await fulfill(
        route,
        403,
        errorEnvelope(
          "access_denied",
          "Editing is not available for this account.",
        ),
      );
      return;
    }
    if (method === "POST") {
      const input = acquireProjectEditingLeaseV1Schema.safeParse(body);
      if (!input.success) {
        await fulfill(
          route,
          403,
          errorEnvelope("access_denied", "A valid editing token is required."),
        );
        return;
      }
      if (current === undefined) {
        current = {
          leaseId: "projectlease_" + randomUUID(),
          token: input.data.token,
          expiresAt: Date.now() + 60_000,
        };
        this.#editingLeases.set(projectId, current);
      }
      await fulfill(route, 200, state(current.token === input.data.token));
      return;
    }
    const proof = mutateProjectEditingLeaseV1Schema.safeParse(body);
    if (
      !proof.success ||
      proof.data.token !== current?.token ||
      proof.data.leaseId !== current.leaseId
    ) {
      await fulfill(
        route,
        403,
        errorEnvelope(
          "access_denied",
          "This session no longer holds editing access.",
        ),
      );
      return;
    }
    if (method === "DELETE") {
      this.#editingLeases.delete(projectId);
      current = undefined;
      await fulfill(route, 200, state());
      return;
    }
    if (method === "PUT") {
      current.expiresAt = Date.now() + 60_000;
      await fulfill(route, 200, state(true));
      return;
    }
    await fulfill(
      route,
      404,
      errorEnvelope("not_found", "The requested resource is unavailable."),
    );
  }

  async #draft(
    route: Route,
    method: string,
    projectId: string,
    body: unknown,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> {
    const draft = this.#drafts.get(projectId);
    const project = this.#projects.get(projectId);
    if (draft === undefined || project === undefined) {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    if (method === "GET") {
      await fulfill(route, 200, data(this.#draftResponse(draft)), {
        etag: draftEtag(draft),
      });
      return;
    }
    if (method !== "PUT") {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    if (this.#role !== "owner") {
      await fulfill(
        route,
        403,
        errorEnvelope(
          "access_denied",
          "This action is not available for the current account.",
        ),
      );
      return;
    }
    const proof = projectEditingLeaseProofV1Schema.safeParse(
      (body as { editingLease?: unknown }).editingLease,
    );
    const lease = this.#editingLeases.get(projectId);
    if (
      !proof.success ||
      lease === undefined ||
      lease.expiresAt <= Date.now() ||
      lease.leaseId !== proof.data.leaseId ||
      lease.token !== proof.data.token
    ) {
      await fulfill(
        route,
        403,
        errorEnvelope(
          "access_denied",
          "This session does not hold editing access.",
        ),
      );
      return;
    }
    if (this.#draftSaveFailure === "offline") {
      await route.abort("internetdisconnected");
      return;
    }
    if (this.#draftSaveFailure === "service-unavailable") {
      await fulfill(
        route,
        503,
        errorEnvelope(
          "service_unavailable",
          "Draft saving is temporarily unavailable.",
        ),
      );
      return;
    }
    if (headers["if-match"] !== draftEtag(draft)) {
      const digests = documentDigests(draft.document);
      await fulfill(
        route,
        412,
        errorEnvelope(
          "precondition_failed",
          "The draft changed. Reload, compare metadata, or save your work as a copy.",
          {
            current: {
              contentDigest: digests.documentDigest,
              etag: draftEtag(draft),
              semanticDigest: digests.contentDigest,
              updatedAt: draft.updatedAt,
              version: draft.version,
              visualDigest: digests.visualDigest,
            },
            recovery: {
              canCompare: true,
              canCopy: true,
              canReload: true,
            },
            resourceId: draft.id,
            resourceKind: "draft",
          },
        ),
      );
      return;
    }
    const input = body as { readonly architectureDocument?: unknown };
    draft.document = architectureDocumentV3Schema.parse(
      input.architectureDocument,
    );
    draft.version += 1;
    draft.updatedAt = LATER;
    project.currentDraft = { id: draft.id, version: draft.version };
    project.updatedAt = LATER;
    await fulfill(route, 200, data(this.#draftResponse(draft)), {
      etag: draftEtag(draft),
    });
  }

  #draftResponse(draft: TypedBackendDraft) {
    const digests = documentDigests(draft.document);
    return {
      architectureDocument: cloneDocument(draft.document),
      contentDigest: digests.contentDigest,
      documentDigest: digests.documentDigest,
      id: draft.id,
      projectId: draft.projectId,
      semanticDigest: digests.contentDigest,
      storageStatus: "published",
      updatedAt: draft.updatedAt,
      version: draft.version,
      visualDigest: digests.visualDigest,
    } as const;
  }

  async #solutionRevisions(
    route: Route,
    method: string,
    projectId: string,
    solutionRevisionId: string | undefined,
    body: unknown,
    headers: Readonly<Record<string, string>>,
  ): Promise<void> {
    const project = this.#projects.get(projectId);
    const draft = this.#drafts.get(projectId);
    if (project === undefined || draft === undefined) {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    const revisions = this.#revisions.get(projectId) ?? [];
    if (method === "GET" && solutionRevisionId === undefined) {
      await fulfill(
        route,
        200,
        list(revisions.map((revision) => revision.summary)),
      );
      return;
    }
    if (method === "GET" && solutionRevisionId !== undefined) {
      const revision = revisions.find(
        (candidate) =>
          candidate.summary.solutionRevisionId === solutionRevisionId,
      );
      if (revision === undefined) {
        await fulfill(
          route,
          404,
          errorEnvelope("not_found", "The requested resource is unavailable."),
        );
        return;
      }
      await fulfill(route, 200, data(revision));
      return;
    }
    if (method === "POST" && solutionRevisionId === undefined) {
      if (this.#role !== "owner") {
        await fulfill(
          route,
          403,
          errorEnvelope(
            "access_denied",
            "This action is not available for the current account.",
          ),
        );
        return;
      }
      if (headers["if-match"] !== draftEtag(draft)) {
        await fulfill(
          route,
          412,
          errorEnvelope(
            "precondition_failed",
            "The draft changed. Reload and try again.",
          ),
        );
        return;
      }
      const input = body as {
        readonly draftId?: unknown;
        readonly draftVersion?: unknown;
        readonly name?: unknown;
      };
      if (input.draftId !== draft.id || input.draftVersion !== draft.version) {
        await fulfill(
          route,
          412,
          errorEnvelope(
            "precondition_failed",
            "The draft changed. Reload and try again.",
          ),
        );
        return;
      }
      const revision = buildSolutionRevision(
        project,
        draft,
        typeof input.name === "string" ? input.name : "Solution Revision",
        revisions.length + 1,
      );
      revisions.push(revision);
      this.#revisions.set(projectId, revisions);
      project.latestRevisionId = revision.summary.architectureRevisionId;
      await fulfill(route, 201, data(revision));
      return;
    }
    await fulfill(
      route,
      404,
      errorEnvelope("not_found", "The requested resource is unavailable."),
    );
  }

  async #commercial(
    route: Route,
    organizationId: string,
    resource: string,
  ): Promise<void> {
    if (organizationId !== TYPED_BACKEND_ORGANIZATION_ID) {
      await fulfill(
        route,
        404,
        errorEnvelope("not_found", "The requested resource is unavailable."),
      );
      return;
    }
    if (resource === "current-plan") {
      await fulfill(
        route,
        200,
        data({
          asOf: NOW,
          billingAccountState: "active",
          contractVersion: 1,
          entitlements: [
            { enabled: true, feature: "manual-editing", source: "plan" },
          ],
          expensiveOperationsEnabled: true,
          limits: [],
          organizationId,
          organizationState: "active",
          plan: {
            commercialStatus: "beta-example",
            displayName: "Starter",
            effectiveFrom: NOW,
            id: "plan_typed_backend_starter",
            key: "starter",
            price: {
              amountMicros: "9000000",
              billingInterval: "month",
              currency: "USD",
              status: "beta-example",
            },
            version: 1,
            versionId: "planver_typed_backend_starter_v1",
          },
          subscription: { projectionVersion: 1, state: "active" },
        }),
      );
      return;
    }
    const balance = {
      activeGrantedCreditUnits: 200,
      asOf: NOW,
      availableCreditUnits: 175,
      compensatedCreditUnits: 0,
      contractVersion: 1,
      debitAdjustmentCreditUnits: 0,
      exhausted: false,
      expiredCreditUnits: 0,
      netAdjustmentCreditUnits: 0,
      organizationId,
      reservedCreditUnits: 5,
      settledCreditUnits: 20,
      totalGrantedCreditUnits: 200,
      unresolvedCreditUnits: 0,
    };
    await fulfill(
      route,
      200,
      data(
        resource === "credit-overview"
          ? {
              contractVersion: 1,
              balance,
              availableByKind: { monthly: 75, purchased: 100, other: 0 },
              nextExpiration: {
                at: "2026-12-01T00:00:00.000Z",
                creditUnits: 75,
              },
            }
          : balance,
      ),
    );
  }
}
