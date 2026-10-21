import { createHash } from "node:crypto";
import { applyBoundDraftCommand } from "../application/apply-draft-command.js";

import {
  creditBalanceV1Schema,
  creditOverviewV1Schema,
  currentPlanEntitlementsV1Schema,
  draftArchitectureDocumentV1Schema,
  presentationPreferencesV1Schema,
  projectEnvironmentV1Schema,
  projectV1Schema,
  revisionV1Schema,
  type ApplyDraftCommandResultV1,
  type ApplyDraftCommandV1,
  type ArchiveProjectV1,
  type ArtifactSummaryV1,
  type ArtifactV1,
  type AuditEventSummaryV1,
  type CreateExportJobV1,
  type CreateGenerationJobV1,
  type CreateProjectEnvironmentV1,
  type CreateProjectResultV1,
  type CreateProjectV1,
  type CreateRevisionV1,
  type CreateSolutionRevisionV1,
  type CreateValidationRunV1,
  type CreditBalanceV1,
  type CreditOverviewV1,
  type CurrentPrincipalV1,
  type CurrentPlanEntitlementsV1,
  type DownloadableArtifactV1,
  type DraftArchitectureDocumentV1,
  type ExportJobV1,
  type GenerationJobV1,
  type IntegrationV1,
  type MembershipV1,
  type OrganizationV1,
  type PresentationPreferencesV1,
  type ProjectEnvironmentV1,
  type ProjectSummaryV1,
  type ProjectV1,
  type RenameProjectV1,
  type RevisionSummaryV1,
  type RevisionV1,
  type SaveDraftV1,
  type SolutionRevisionSummaryV1,
  type SolutionRevisionV1,
  type UpdatePresentationPreferencesV1,
  type UpdateProjectEnvironmentV1,
  type ValidationRunV1,
} from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getDocumentCompatibilityMetadata,
  migrateCloudMarkupDocument,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  serializeArchitectureDocumentV3,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

import {
  permissionsForRole,
  requireOrganizationPermission,
  type OrganizationPermission,
} from "../application/authorization.js";
import { hasMatchingDraftDocumentIdentity } from "../application/draft-document-identity.js";
import {
  requireRecentAuthentication,
  type Principal,
} from "../application/identity.js";

import { ApplicationError } from "../application/errors.js";
import { buildSolutionRevisionV1 } from "../application/solution-revision-builder.js";
import type {
  CloudMarkupApplication,
  PageOptions,
  PageResult,
  PrincipalContext,
  PrincipalResolver,
  ReadinessProbe,
  VersionedResult,
} from "../application/ports.js";

interface PrincipalSeed {
  readonly displayName: string;
  readonly email?: string;
  readonly id: string;
}

interface BlankDocumentIdentity {
  readonly architectureId: string;
  readonly documentId: string;
  readonly revisionId: string;
}

export interface InMemorySeed {
  readonly artifacts?: readonly ArtifactV1[];
  readonly auditEvents?: readonly AuditEventSummaryV1[];
  readonly creditBalances?: readonly CreditBalanceV1[];
  readonly creditOverviews?: readonly CreditOverviewV1[];
  readonly currentPlanEntitlements?: readonly CurrentPlanEntitlementsV1[];
  readonly blankDocumentFactory?: (
    identity: BlankDocumentIdentity,
  ) => ArchitectureDocumentV3;
  readonly downloads?: readonly DownloadableArtifactV1[];
  readonly drafts?: readonly DraftArchitectureDocumentV1[];
  readonly environments?: readonly ProjectEnvironmentV1[];
  readonly exportJobs?: readonly ExportJobV1[];
  readonly generationJobs?: readonly GenerationJobV1[];
  readonly integrations?: readonly IntegrationV1[];
  readonly memberships?: readonly MembershipV1[];
  readonly organizations?: readonly OrganizationV1[];
  readonly preferences?: Readonly<Record<string, PresentationPreferencesV1>>;
  readonly principals?: readonly PrincipalSeed[];
  readonly projects?: readonly ProjectV1[];
  readonly revisions?: readonly RevisionV1[];
  readonly solutionRevisions?: readonly SolutionRevisionV1[];
  readonly validationRuns?: readonly ValidationRunV1[];
}

interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly result: Promise<unknown>;
}

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function mapById<TValue extends { readonly id: string }>(
  values: readonly TValue[] = [],
): Map<string, TValue> {
  return new Map(values.map((value) => [value.id, clone(value)]));
}

function etag(kind: string, id: string, version: number): string {
  return `"${kind}:${id}:v${String(version)}"`;
}

function documentDigests(document: ArchitectureDocumentV3) {
  const bytes = serializeArchitectureDocumentV3(document);
  return {
    documentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    semanticDigest: getArchitectureDocumentContentHash(document),
    visualDigest: getArchitectureDocumentVisualHash(document),
  } as const;
}

export class FixedPrincipalResolver implements PrincipalResolver {
  readonly #principals: ReadonlyMap<string, Principal>;

  constructor(
    principals: Readonly<
      Record<
        string,
        Pick<Principal, "principalId" | "sessionId"> &
          Partial<Omit<Principal, "principalId" | "sessionId">>
      >
    >,
  ) {
    this.#principals = new Map(
      Object.entries(principals).map(([authorization, principal]) => [
        authorization,
        {
          authenticatedAt: "2026-08-02T12:00:00.000Z",
          authenticationSource: "test",
          expiresAt: "2026-08-02T13:00:00.000Z",
          ...principal,
        },
      ]),
    );
  }

  resolve(authorization: string | undefined): Promise<Principal | null> {
    if (authorization === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.#principals.get(authorization) ?? null);
  }
}

export class StaticReadinessProbe implements ReadinessProbe {
  readonly #checks: readonly {
    readonly name: string;
    readonly ready: boolean;
  }[];

  constructor(
    checks: readonly { readonly name: string; readonly ready: boolean }[],
  ) {
    this.#checks = clone(checks);
  }

  check(): Promise<
    readonly { readonly name: string; readonly ready: boolean }[]
  > {
    return Promise.resolve(clone(this.#checks));
  }
}

export class InMemoryCloudMarkupApplication implements CloudMarkupApplication {
  readonly #artifacts: Map<string, ArtifactV1>;
  readonly #auditEvents: Map<string, AuditEventSummaryV1>;
  readonly #creditBalances: Map<string, CreditBalanceV1>;
  readonly #creditOverviews: Map<string, CreditOverviewV1>;
  readonly #currentPlanEntitlements: Map<string, CurrentPlanEntitlementsV1>;
  readonly #blankDocumentFactory:
    ((identity: BlankDocumentIdentity) => ArchitectureDocumentV3) | undefined;
  readonly #clock: () => string;
  readonly #downloads: readonly DownloadableArtifactV1[];
  readonly #drafts: Map<string, DraftArchitectureDocumentV1>;
  readonly #environments: Map<string, ProjectEnvironmentV1>;
  readonly #exportJobs: Map<string, ExportJobV1>;
  readonly #generationJobs: Map<string, GenerationJobV1>;
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #idFactory: (prefix: string) => string;
  readonly #integrations: Map<string, IntegrationV1>;
  readonly #memberships: Map<string, MembershipV1>;
  readonly #organizations: Map<string, OrganizationV1>;
  readonly #preferences: Map<string, PresentationPreferencesV1>;
  readonly #principals: Map<string, PrincipalSeed>;
  readonly #projects: Map<string, ProjectV1>;
  readonly #revisions: Map<string, RevisionV1>;
  readonly #solutionRevisions: Map<string, SolutionRevisionV1>;
  readonly #validationRuns: Map<string, ValidationRunV1>;

  constructor(
    seed: InMemorySeed,
    options: {
      readonly clock?: () => string;
      readonly idFactory?: (prefix: string) => string;
    } = {},
  ) {
    this.#artifacts = mapById(seed.artifacts);
    this.#creditBalances = new Map(
      (seed.creditBalances ?? []).map((summary) => {
        const parsed = creditBalanceV1Schema.parse(clone(summary));
        return [parsed.organizationId, parsed];
      }),
    );
    this.#creditOverviews = new Map(
      (seed.creditOverviews ?? []).map((summary) => {
        const parsed = creditOverviewV1Schema.parse(clone(summary));
        return [parsed.balance.organizationId, parsed];
      }),
    );
    this.#currentPlanEntitlements = new Map(
      (seed.currentPlanEntitlements ?? []).map((summary) => {
        const parsed = currentPlanEntitlementsV1Schema.parse(clone(summary));
        return [parsed.organizationId, parsed];
      }),
    );
    this.#auditEvents = mapById(seed.auditEvents);
    this.#blankDocumentFactory = seed.blankDocumentFactory;
    this.#downloads = clone(seed.downloads ?? []);
    this.#drafts = mapById(seed.drafts);
    this.#environments = mapById(seed.environments);
    this.#exportJobs = mapById(seed.exportJobs);
    this.#generationJobs = mapById(seed.generationJobs);
    this.#integrations = mapById(seed.integrations);
    this.#memberships = mapById(seed.memberships);
    this.#organizations = mapById(seed.organizations);
    this.#preferences = new Map(
      Object.entries(seed.preferences ?? {}).map(([id, value]) => [
        id,
        presentationPreferencesV1Schema.parse(clone(value)),
      ]),
    );
    this.#principals = mapById(seed.principals);
    this.#projects = mapById(seed.projects);
    this.#revisions = mapById(seed.revisions);
    this.#solutionRevisions = new Map(
      (seed.solutionRevisions ?? []).map((revision) => [
        revision.summary.solutionRevisionId,
        clone(revision),
      ]),
    );
    this.#validationRuns = mapById(seed.validationRuns);
    this.#clock = options.clock ?? (() => new Date().toISOString());
    let nextId = 1;
    this.#idFactory =
      options.idFactory ?? ((prefix) => `${prefix}_memory-${String(nextId++)}`);
  }

  getCurrentPrincipal(
    principal: PrincipalContext,
  ): Promise<CurrentPrincipalV1> {
    const record = this.#principals.get(principal.principalId);
    if (record === undefined) {
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    }

    const organizationContexts = [...this.#memberships.values()]
      .filter(
        (membership) =>
          membership.principal.id === principal.principalId &&
          membership.status === "active",
      )
      .map((membership) => ({
        capabilities: [...permissionsForRole(membership.role)].sort(),
        isOwner: membership.role === "owner",
        membershipId: membership.id,
        organizationId: membership.organizationId,
        role: membership.role,
      }))
      .sort((left, right) =>
        left.organizationId.localeCompare(right.organizationId),
      );

    return Promise.resolve({
      displayName: record.displayName,
      ...(record.email === undefined ? {} : { email: record.email }),
      id: record.id,
      organizationContexts,
      resourceVersion: 1,
    });
  }

  getPresentationPreferences(
    principal: PrincipalContext,
  ): Promise<VersionedResult<PresentationPreferencesV1>> {
    this.#requirePrincipal(principal);
    let preferences = this.#preferences.get(principal.principalId);
    if (preferences === undefined) {
      preferences = {
        contextualLearningEnabled: true,
        contractVersion: 1,
        experienceMode: "guided",
        syncVersion: 1,
        updatedAt: this.#clock(),
      };
      this.#preferences.set(
        principal.principalId,
        presentationPreferencesV1Schema.parse(preferences),
      );
    }

    return Promise.resolve({
      etag: etag("preferences", principal.principalId, preferences.syncVersion),
      value: clone(preferences),
    });
  }

  async updatePresentationPreferences(
    principal: PrincipalContext,
    input: UpdatePresentationPreferencesV1,
    expectedEtag: string,
  ): Promise<VersionedResult<PresentationPreferencesV1>> {
    const current = await this.getPresentationPreferences(principal);
    if (current.etag !== expectedEtag) {
      throw new ApplicationError(
        "precondition_failed",
        "The presentation preference changed. Refresh and try again.",
      );
    }

    const next = presentationPreferencesV1Schema.parse({
      ...input,
      syncVersion: current.value.syncVersion + 1,
      updatedAt: this.#clock(),
    });
    this.#preferences.set(principal.principalId, next);
    return {
      etag: etag("preferences", principal.principalId, next.syncVersion),
      value: clone(next),
    };
  }

  listOrganizations(
    principal: PrincipalContext,
    options: PageOptions,
  ): Promise<PageResult<OrganizationV1>> {
    this.#requirePrincipal(principal);
    const organizationIds = new Set(
      [...this.#memberships.values()]
        .filter(
          (membership) =>
            membership.principal.id === principal.principalId &&
            membership.status === "active",
        )
        .map((membership) => membership.organizationId),
    );
    const values = [...this.#organizations.values()]
      .filter((organization) => organizationIds.has(organization.id))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    if (options.sort === "-displayName") {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  getOrganization(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<VersionedResult<OrganizationV1>> {
    this.#membership(principal, organizationId, "organizations.read");
    const organization = this.#organizations.get(organizationId);
    if (organization === undefined) {
      throw this.#notFound();
    }
    const version = organization.version ?? 1;
    return Promise.resolve({
      etag: etag("organization", organization.id, version),
      value: clone({ ...organization, version }),
    });
  }

  async deleteOrganization(
    principal: PrincipalContext,
    organizationId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<OrganizationV1>> {
    this.#membership(principal, organizationId, "organizations.delete");
    const current = await this.getOrganization(principal, organizationId);
    return this.#idempotent(
      principal,
      organizationId,
      `organizations.delete:${organizationId}`,
      idempotencyKey,
      { expectedEtag },
      () => {
        this.#requireEtag(
          "organization",
          organizationId,
          current.etag,
          current.value.version ?? 1,
          expectedEtag,
        );
        requireRecentAuthentication(principal, new Date(this.#clock()));
        const next = {
          ...current.value,
          deletionRequestedAt: this.#clock(),
          lifecycleStatus: "deletion-pending" as const,
          version: (current.value.version ?? 1) + 1,
        };
        this.#organizations.set(organizationId, next);
        this.#recordAudit(
          principal,
          organizationId,
          "organization.deletion-requested",
          "succeeded",
          "Organization-data deletion was requested.",
          "organization",
          organizationId,
        );
        return {
          etag: etag("organization", organizationId, next.version),
          value: clone(next),
        };
      },
    );
  }

  listMemberships(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<MembershipV1>> {
    this.#membership(principal, organizationId, "memberships.read");
    let values = [...this.#memberships.values()].filter(
      (membership) => membership.organizationId === organizationId,
    );
    const status = options.filters["status"];
    if (status !== undefined) {
      values = values.filter((membership) => membership.status === status);
    }
    values.sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
    if (options.sort?.startsWith("-") === true) {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  getCreditOverview(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CreditOverviewV1> {
    this.#membership(principal, organizationId, "commercial.summary.read");
    const summary = this.#creditOverviews.get(organizationId);
    if (summary === undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Grant funding details are not available in this fixture.",
      );
    return Promise.resolve(clone(summary));
  }

  getCreditBalance(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CreditBalanceV1> {
    this.#membership(principal, organizationId, "commercial.summary.read");
    const summary = this.#creditBalances.get(organizationId);
    if (summary === undefined) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(summary));
  }

  getCurrentPlanEntitlements(
    principal: PrincipalContext,
    organizationId: string,
  ): Promise<CurrentPlanEntitlementsV1> {
    this.#membership(principal, organizationId, "commercial.summary.read");
    const summary = this.#currentPlanEntitlements.get(organizationId);
    if (summary === undefined) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(summary));
  }
  listProjects(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<ProjectSummaryV1>> {
    this.#membership(principal, organizationId, "projects.read");
    let values = [...this.#projects.values()].filter(
      (project) => project.organizationId === organizationId,
    );
    const status = options.filters["status"];
    if (status !== undefined) {
      values = values.filter((project) => project.lifecycleStatus === status);
    }
    values.sort((left, right) =>
      options.sort?.includes("name") === true
        ? left.name.localeCompare(right.name)
        : left.updatedAt.localeCompare(right.updatedAt),
    );
    if (options.sort?.startsWith("-") === true) {
      values.reverse();
    }
    return Promise.resolve(
      this.#page(
        values.map(({ description, environmentCount, ...summary }) => {
          void description;
          void environmentCount;
          return summary;
        }),
        options,
      ),
    );
  }

  createProject(
    principal: PrincipalContext,
    organizationId: string,
    input: CreateProjectV1,
    idempotencyKey: string,
  ): Promise<CreateProjectResultV1> {
    this.#membership(principal, organizationId, "projects.create");
    return this.#idempotent(
      principal,
      organizationId,
      `projects.create:${organizationId}`,
      idempotencyKey,
      input,
      () => {
        const projectId = this.#idFactory("project");
        const draftId = this.#idFactory("draft");
        const now = this.#clock();
        const architectureId = this.#idFactory("architecture");
        const documentId = this.#idFactory("doc");
        const revisionId = this.#idFactory("revision");
        let architectureDocument: ArchitectureDocumentV3;
        if (input.creationMode === "blank") {
          if (this.#blankDocumentFactory === undefined) {
            throw new ApplicationError(
              "service_unavailable",
              "Blank project creation is not configured.",
            );
          }
          architectureDocument = this.#blankDocumentFactory({
            architectureId,
            documentId,
            revisionId,
          });
        } else {
          const migration = migrateCloudMarkupDocument(
            input.architectureDocument,
          );
          if (!migration.ok) {
            throw new ApplicationError(
              migration.classification === "unsupported-future"
                ? "unsupported_version"
                : "invalid_request",
              "The Architecture Document cannot be copied.",
            );
          }
          if (migration.schemaType !== "cloudmarkup.architecture-document") {
            throw new ApplicationError(
              "invalid_request",
              "The request must contain an Architecture Document.",
            );
          }
          const source = architectureDocumentV3Schema.parse(migration.document);
          const nestedRevision = {
            createdAt: now,
            createdBy: principal.principalId,
            revisionId,
            revisionNumber: 1,
          };
          architectureDocument = architectureDocumentV3Schema.parse({
            ...source,
            applicationContracts: {
              ...source.applicationContracts,
              contractSetId: this.#idFactory("contract-set"),
              documentId,
              revision: nestedRevision,
            },
            architectureId,
            documentId,
            externalResources: {
              ...source.externalResources,
              architectureId,
              documentId,
              revision: nestedRevision,
            },
            metadata: { ...source.metadata, source: "user" },
            revision: { ...nestedRevision, sourceDraftId: draftId },
          });
        }
        const digests = documentDigests(architectureDocument);
        const draft = draftArchitectureDocumentV1Schema.parse({
          architectureDocument,
          contentDigest: digests.semanticDigest,
          ...digests,
          id: draftId,
          projectId,
          storageStatus: "published",
          updatedAt: now,
          version: 1,
        });
        const project = projectV1Schema.parse({
          createdAt: now,
          currentDraft: { id: draftId, version: 1 },
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          environmentCount: 0,
          id: projectId,
          lifecycleStatus: "active",
          name: input.name,
          organizationId,
          updatedAt: now,
          version: 1,
        });
        this.#drafts.set(draft.id, draft);
        this.#projects.set(project.id, project);
        this.#recordAudit(
          principal,
          organizationId,
          "project.created",
          "succeeded",
          "A project was created.",
          "project",
          project.id,
        );
        return { draft: project.currentDraft, project: clone(project) };
      },
    );
  }

  getProject(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<VersionedResult<ProjectV1>> {
    const project = this.#project(principal, projectId, "projects.read");
    const version = project.version ?? 1;
    return Promise.resolve({
      etag: etag("project", project.id, version),
      value: clone({ ...project, version }),
    });
  }

  renameProject(
    principal: PrincipalContext,
    projectId: string,
    input: RenameProjectV1,
    expectedEtag: string,
  ): Promise<VersionedResult<ProjectV1>> {
    const project = this.#project(principal, projectId, "projects.mutate");
    const version = project.version ?? 1;
    this.#requireEtag(
      "project",
      projectId,
      etag("project", projectId, version),
      version,
      expectedEtag,
    );
    if (
      project.lifecycleStatus === "deletion-pending" ||
      project.lifecycleStatus === "deleted"
    ) {
      throw this.#notFound();
    }
    const next = projectV1Schema.parse({
      ...project,
      name: input.name,
      updatedAt: this.#clock(),
      version: version + 1,
    });
    this.#projects.set(projectId, next);
    this.#recordAudit(
      principal,
      project.organizationId,
      "project.renamed",
      "succeeded",
      "A project was renamed.",
      "project",
      projectId,
    );
    return Promise.resolve({
      etag: etag("project", projectId, version + 1),
      value: clone(next),
    });
  }

  archiveProject(
    principal: PrincipalContext,
    projectId: string,
    input: ArchiveProjectV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectV1>> {
    const project = this.#project(principal, projectId, "projects.mutate");
    return this.#idempotent(
      principal,
      project.organizationId,
      `projects.archive:${projectId}`,
      idempotencyKey,
      { expectedEtag, input },
      () => {
        const version = project.version ?? 1;
        this.#requireEtag(
          "project",
          projectId,
          etag("project", projectId, version),
          version,
          expectedEtag,
        );
        if (project.lifecycleStatus !== "active") {
          throw new ApplicationError(
            "conflict",
            "Only an active project can be archived.",
          );
        }
        const next = projectV1Schema.parse({
          ...project,
          lifecycleStatus: "archived",
          updatedAt: this.#clock(),
          version: version + 1,
        });
        this.#projects.set(projectId, next);
        this.#recordAudit(
          principal,
          project.organizationId,
          "project.archived",
          "succeeded",
          "A project was archived.",
          "project",
          projectId,
        );
        return {
          etag: etag("project", projectId, version + 1),
          value: clone(next),
        };
      },
    );
  }

  deleteProject(
    principal: PrincipalContext,
    projectId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectV1>> {
    const project = this.#project(principal, projectId, "projects.delete");
    return this.#idempotent(
      principal,
      project.organizationId,
      `projects.delete:${projectId}`,
      idempotencyKey,
      { expectedEtag },
      () => {
        const version = project.version ?? 1;
        this.#requireEtag(
          "project",
          projectId,
          etag("project", projectId, version),
          version,
          expectedEtag,
        );
        requireRecentAuthentication(principal, new Date(this.#clock()));
        const next = projectV1Schema.parse({
          ...project,
          lifecycleStatus: "deletion-pending",
          tombstoneRequestedAt: this.#clock(),
          updatedAt: this.#clock(),
          version: version + 1,
        });
        this.#projects.set(projectId, next);
        this.#recordAudit(
          principal,
          project.organizationId,
          "project.deletion-requested",
          "succeeded",
          "Project deletion was requested.",
          "project",
          projectId,
        );
        return {
          etag: etag("project", projectId, version + 1),
          value: clone(next),
        };
      },
    );
  }

  listProjectEnvironments(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<ProjectEnvironmentV1>> {
    this.#project(principal, projectId, "projects.read");
    let values = [...this.#environments.values()].filter(
      (environment) => environment.projectId === projectId,
    );
    const type = options.filters["type"];
    if (type !== undefined) {
      values = values.filter(
        (environment) => environment.environmentType === type,
      );
    }
    values.sort((left, right) => left.name.localeCompare(right.name));
    if (options.sort?.startsWith("-") === true) {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  createProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    input: CreateProjectEnvironmentV1,
    idempotencyKey: string,
  ): Promise<ProjectEnvironmentV1> {
    const project = this.#project(principal, projectId, "environments.create");
    return this.#idempotent(
      principal,
      project.organizationId,
      `environments.create:${projectId}`,
      idempotencyKey,
      input,
      () => {
        if (
          [...this.#environments.values()].some(
            (environment) =>
              environment.projectId === projectId &&
              environment.name.toLowerCase() === input.name.toLowerCase(),
          )
        ) {
          throw new ApplicationError(
            "conflict",
            "An environment with that name already exists.",
          );
        }
        const now = this.#clock();
        const environment = projectEnvironmentV1Schema.parse({
          ...input,
          createdAt: now,
          id: this.#idFactory("env"),
          lifecycleStatus: "active",
          projectId,
          updatedAt: now,
          version: 1,
        });
        this.#environments.set(environment.id, environment);
        this.#projects.set(projectId, {
          ...project,
          environmentCount: project.environmentCount + 1,
          updatedAt: now,
          version: (project.version ?? 1) + 1,
        });
        this.#recordAudit(
          principal,
          project.organizationId,
          "environment.created",
          "succeeded",
          "A project environment was created.",
          "project",
          projectId,
        );
        return clone(environment);
      },
    );
  }

  getProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    environmentId: string,
  ): Promise<VersionedResult<ProjectEnvironmentV1>> {
    this.#project(principal, projectId, "projects.read");
    const environment = this.#environments.get(environmentId);
    if (environment?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve({
      etag: etag("environment", environment.id, environment.version),
      value: clone(environment),
    });
  }

  async updateProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    environmentId: string,
    input: UpdateProjectEnvironmentV1,
    expectedEtag: string,
  ): Promise<VersionedResult<ProjectEnvironmentV1>> {
    const project = this.#project(principal, projectId, "projects.mutate");
    const current = await this.getProjectEnvironment(
      principal,
      projectId,
      environmentId,
    );
    this.#requireEtag(
      "environment",
      environmentId,
      current.etag,
      current.value.version,
      expectedEtag,
    );
    if (
      current.value.lifecycleStatus === "deletion-pending" ||
      current.value.lifecycleStatus === "deleted"
    ) {
      throw this.#notFound();
    }
    const duplicate = [...this.#environments.values()].some(
      (environment) =>
        environment.id !== environmentId &&
        environment.projectId === projectId &&
        environment.lifecycleStatus !== "deleted" &&
        environment.name.toLowerCase() === input.name.toLowerCase(),
    );
    if (duplicate) {
      throw new ApplicationError(
        "conflict",
        "An environment with that name already exists.",
      );
    }
    const next = projectEnvironmentV1Schema.parse({
      ...current.value,
      environmentType: input.environmentType,
      name: input.name,
      ...(input.region === undefined
        ? { region: current.value.region }
        : input.region === null
          ? { region: undefined }
          : { region: input.region }),
      updatedAt: this.#clock(),
      version: current.value.version + 1,
    });
    this.#environments.set(environmentId, next);
    this.#recordAudit(
      principal,
      project.organizationId,
      "environment.updated",
      "succeeded",
      "A project environment was updated.",
      "project",
      projectId,
    );
    return {
      etag: etag("environment", environmentId, next.version),
      value: clone(next),
    };
  }

  async deleteProjectEnvironment(
    principal: PrincipalContext,
    projectId: string,
    environmentId: string,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ProjectEnvironmentV1>> {
    const project = this.#project(principal, projectId, "projects.mutate");
    const current = await this.getProjectEnvironment(
      principal,
      projectId,
      environmentId,
    );
    return this.#idempotent(
      principal,
      project.organizationId,
      `environments.delete:${projectId}:${environmentId}`,
      idempotencyKey,
      { expectedEtag },
      () => {
        this.#requireEtag(
          "environment",
          environmentId,
          current.etag,
          current.value.version,
          expectedEtag,
        );
        requireRecentAuthentication(principal, new Date(this.#clock()));
        const next = projectEnvironmentV1Schema.parse({
          ...current.value,
          lifecycleStatus: "deletion-pending",
          updatedAt: this.#clock(),
          version: current.value.version + 1,
        });
        this.#environments.set(environmentId, next);
        this.#projects.set(projectId, {
          ...project,
          environmentCount: Math.max(0, project.environmentCount - 1),
          updatedAt: this.#clock(),
          version: (project.version ?? 1) + 1,
        });
        this.#recordAudit(
          principal,
          project.organizationId,
          "environment.deletion-requested",
          "succeeded",
          "Project-environment deletion was requested.",
          "project",
          projectId,
        );
        return {
          etag: etag("environment", environmentId, next.version),
          value: clone(next),
        };
      },
    );
  }

  getDraft(
    principal: PrincipalContext,
    projectId: string,
  ): Promise<VersionedResult<DraftArchitectureDocumentV1>> {
    const project = this.#project(principal, projectId, "projects.read");
    const draft = this.#drafts.get(project.currentDraft.id);
    if (draft === undefined) {
      throw this.#notFound();
    }
    return Promise.resolve({
      etag: etag("draft", draft.id, draft.version),
      value: clone(draft),
    });
  }

  async saveDraft(
    principal: PrincipalContext,
    projectId: string,
    input: SaveDraftV1,
    expectedEtag: string,
  ): Promise<VersionedResult<DraftArchitectureDocumentV1>> {
    const project = this.#project(principal, projectId, "projects.mutate");
    if (project.lifecycleStatus !== "active") {
      throw new ApplicationError(
        "conflict",
        "Only an active project draft can be saved.",
      );
    }
    const current = await this.getDraft(principal, projectId);
    this.#requireEtag(
      "draft",
      current.value.id,
      current.etag,
      current.value.version,
      expectedEtag,
      current.value,
    );

    const migration = migrateCloudMarkupDocument(input.architectureDocument);
    if (!migration.ok) {
      if (migration.classification === "unsupported-future") {
        throw new ApplicationError(
          "unsupported_version",
          "This Architecture Document version is not supported.",
          {
            fieldIssues: [
              {
                code: "draft.unsupported-document-version",
                message:
                  "Reload with a compatible CloudMarkup version or copy the document before retrying.",
                path: ["body", "architectureDocument", "schemaVersion"],
              },
            ],
          },
        );
      }
      throw new ApplicationError(
        "invalid_request",
        "The Architecture Document is invalid.",
        {
          fieldIssues: [
            {
              code: "draft.invalid-architecture-document",
              message:
                "The Architecture Document failed schema or semantic validation.",
              path: ["body", "architectureDocument"],
            },
          ],
        },
      );
    }
    if (migration.schemaType !== "cloudmarkup.architecture-document") {
      throw new ApplicationError(
        "invalid_request",
        "The request must contain an Architecture Document.",
      );
    }

    const architectureDocument = architectureDocumentV3Schema.parse(
      migration.document,
    );
    if (
      !hasMatchingDraftDocumentIdentity({
        candidate: architectureDocument,
        current: current.value.architectureDocument,
        currentDraftId: current.value.id,
      })
    ) {
      throw new ApplicationError(
        "invalid_request",
        "Draft identity cannot change during save. Create a project copy instead.",
      );
    }
    const digests = documentDigests(architectureDocument);
    const latestDraft = this.#drafts.get(current.value.id);
    if (latestDraft === undefined) {
      throw this.#notFound();
    }
    this.#requireEtag(
      "draft",
      latestDraft.id,
      etag("draft", latestDraft.id, latestDraft.version),
      latestDraft.version,
      expectedEtag,
      latestDraft,
    );
    const next = draftArchitectureDocumentV1Schema.parse({
      architectureDocument,
      contentDigest: digests.semanticDigest,
      ...digests,
      id: latestDraft.id,
      projectId,
      storageStatus: "published",
      updatedAt: this.#clock(),
      version: latestDraft.version + 1,
    });
    this.#drafts.set(next.id, next);
    const latestProject = this.#projects.get(projectId);
    if (latestProject === undefined) {
      throw this.#notFound();
    }
    this.#projects.set(projectId, {
      ...latestProject,
      currentDraft: { id: next.id, version: next.version },
      updatedAt: next.updatedAt,
      version: (latestProject.version ?? 1) + 1,
    });
    this.#recordAudit(
      principal,
      project.organizationId,
      "draft.saved",
      "succeeded",
      "A draft was autosaved.",
      "draft",
      next.id,
    );
    return {
      etag: etag("draft", next.id, next.version),
      value: clone(next),
    };
  }

  async applyDraftCommand(
    principal: PrincipalContext,
    projectId: string,
    input: ApplyDraftCommandV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<VersionedResult<ApplyDraftCommandResultV1>> {
    const project = this.#project(principal, projectId, "projects.mutate");
    const current = await this.getDraft(principal, projectId);
    return this.#idempotent(
      principal,
      project.organizationId,
      `drafts.apply-command:${projectId}`,
      idempotencyKey,
      { expectedEtag, input },
      () => {
        const latestDraft = this.#drafts.get(current.value.id);
        const latestProject = this.#projects.get(projectId);
        if (latestDraft === undefined || latestProject === undefined) {
          throw this.#notFound();
        }
        if (latestProject.lifecycleStatus !== "active") {
          throw new ApplicationError(
            "conflict",
            "Only an active project draft can be changed.",
          );
        }
        const latestEtag = etag("draft", latestDraft.id, latestDraft.version);
        this.#requireEtag(
          "draft",
          latestDraft.id,
          latestEtag,
          latestDraft.version,
          expectedEtag,
          latestDraft,
        );

        const result = applyBoundDraftCommand(
          latestDraft.architectureDocument,
          input,
        );

        const digests = documentDigests(result.document);
        const draft = draftArchitectureDocumentV1Schema.parse({
          ...latestDraft,
          architectureDocument: result.document,
          contentDigest: digests.semanticDigest,
          ...digests,
          storageStatus: "published",
          updatedAt: this.#clock(),
          version: latestDraft.version + 1,
        });
        this.#drafts.set(draft.id, draft);
        this.#projects.set(projectId, {
          ...latestProject,
          currentDraft: { id: draft.id, version: draft.version },
          updatedAt: draft.updatedAt,
          version: (latestProject.version ?? 1) + 1,
        });
        return {
          etag: etag("draft", draft.id, draft.version),
          value: {
            appliedCommandId: input.command.commandId,
            draft: clone(draft),
          },
        };
      },
    );
  }

  async createRevision(
    principal: PrincipalContext,
    projectId: string,
    input: CreateRevisionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<RevisionV1> {
    const project = this.#project(principal, projectId, "revisions.create");
    const current = await this.getDraft(principal, projectId);
    return this.#idempotent(
      principal,
      project.organizationId,
      "revisions.create:" + projectId,
      idempotencyKey,
      { expectedEtag, input },
      () => {
        const latestDraft = this.#drafts.get(current.value.id);
        const latestProject = this.#projects.get(projectId);
        if (latestDraft === undefined || latestProject === undefined) {
          throw this.#notFound();
        }
        if (latestProject.lifecycleStatus !== "active") {
          throw new ApplicationError(
            "conflict",
            "Only an active project can create a Solution Revision.",
          );
        }
        const latestEtag = etag("draft", latestDraft.id, latestDraft.version);
        this.#requireEtag(
          "draft",
          latestDraft.id,
          latestEtag,
          latestDraft.version,
          expectedEtag,
          latestDraft,
        );
        if (
          latestDraft.id !== input.draftId ||
          latestDraft.version !== input.draftVersion
        ) {
          throw new ApplicationError(
            "precondition_failed",
            "The draft changed. Refresh and validate it again before creating a revision.",
            {
              conflict: {
                current: {
                  contentDigest:
                    latestDraft.documentDigest ?? latestDraft.contentDigest,
                  etag: latestEtag,
                  semanticDigest:
                    latestDraft.semanticDigest ?? latestDraft.contentDigest,
                  updatedAt: latestDraft.updatedAt,
                  version: latestDraft.version,
                  visualDigest: latestDraft.visualDigest,
                },
                recovery: {
                  canCompare: true,
                  canCopy: true,
                  canReload: true,
                },
                resourceId: latestDraft.id,
                resourceKind: "draft",
              },
            },
          );
        }

        const validationRun = this.#validationRuns.get(input.validationRunId);
        if (
          validationRun?.projectId !== projectId ||
          validationRun.status !== "succeeded" ||
          validationRun.target !== "draft" ||
          validationRun.summary?.complete !== true ||
          validationRun.input.kind !== "draft" ||
          validationRun.input.draftId !== input.draftId ||
          validationRun.input.draftVersion !== input.draftVersion
        ) {
          throw new ApplicationError(
            "precondition_failed",
            "The exact draft version does not have a complete successful validation.",
          );
        }

        const principalRecord = this.#requirePrincipal(principal);
        const createdAt = this.#clock();
        const revisionId = this.#idFactory("revision");
        const revisionNumber =
          Math.max(
            0,
            ...[...this.#revisions.values()]
              .filter((revision) => revision.projectId === projectId)
              .map(
                (revision) =>
                  revision.architectureDocument.revision.revisionNumber,
              ),
          ) + 1;
        const nestedRevision = {
          createdAt,
          createdBy: principal.principalId,
          ...(latestProject.latestRevisionId === undefined
            ? {}
            : { previousRevisionId: latestProject.latestRevisionId }),
          revisionId,
          revisionNumber,
        };
        const architectureDocument = architectureDocumentV3Schema.parse({
          ...latestDraft.architectureDocument,
          applicationContracts: {
            ...latestDraft.architectureDocument.applicationContracts,
            revision: nestedRevision,
          },
          externalResources: {
            ...latestDraft.architectureDocument.externalResources,
            revision: nestedRevision,
          },
          revision: {
            ...nestedRevision,
            sourceDraftId: latestDraft.id,
          },
        });
        const digests = documentDigests(architectureDocument);
        const compatibility =
          getDocumentCompatibilityMetadata(architectureDocument);
        if (compatibility.schemaType !== "cloudmarkup.architecture-document") {
          throw new ApplicationError(
            "unsupported_version",
            "This Architecture Document version is not supported.",
          );
        }
        const revision = revisionV1Schema.parse({
          architectureDocument,
          catalogDigest: architectureDocument.catalog.digest,
          catalogId: architectureDocument.catalog.id,
          catalogVersion: architectureDocument.catalog.version,
          compatibility: {
            catalog: {
              digest: compatibility.catalog.digest,
              id: compatibility.catalog.id,
              version: compatibility.catalog.version,
            },
            compiler: {
              inputContractVersion: compatibility.compiler.inputContractVersion,
              ...(compatibility.compiler.maximumVersionExclusive === undefined
                ? {}
                : {
                    maximumVersionExclusive:
                      compatibility.compiler.maximumVersionExclusive,
                  }),
              minimumVersion: compatibility.compiler.minimumVersion,
            },
            documentSchema: {
              kind: compatibility.schemaType,
              version: compatibility.schemaVersion,
            },
          },
          contentDigest: digests.semanticDigest,
          createdAt,
          createdBy: {
            displayName: principalRecord.displayName,
            id: principalRecord.id,
          },
          ...digests,
          graphSchemaVersion: architectureDocument.schemaVersion,
          id: revisionId,
          name: input.name,
          projectId,
          revisionNumber,
          sourceDraftId: latestDraft.id,
          sourceDraftVersion: latestDraft.version,
          storageStatus: "published",
          workloadBehaviorVersion:
            architectureDocument.workloadBehavior.contractVersion,
        });
        this.#revisions.set(revision.id, revision);
        this.#projects.set(projectId, {
          ...latestProject,
          latestRevisionId: revision.id,
          updatedAt: createdAt,
          version: (latestProject.version ?? 1) + 1,
        });
        this.#recordAudit(
          principal,
          project.organizationId,
          "revision.created",
          "succeeded",
          "An immutable named revision was created.",
          "revision",
          revision.id,
        );
        return clone(revision);
      },
    );
  }

  listRevisions(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<RevisionSummaryV1>> {
    this.#project(principal, projectId, "projects.read");
    const values = [...this.#revisions.values()]
      .filter((revision) => revision.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(({ architectureDocument, ...summary }) => {
        void architectureDocument;
        return summary;
      });
    if (options.sort === "createdAt") {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  getRevision(
    principal: PrincipalContext,
    projectId: string,
    revisionId: string,
  ): Promise<RevisionV1> {
    this.#project(principal, projectId, "projects.read");
    const revision = this.#revisions.get(revisionId);
    if (revision?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(revision));
  }

  async createSolutionRevision(
    principal: PrincipalContext,
    projectId: string,
    input: CreateSolutionRevisionV1,
    expectedEtag: string,
    idempotencyKey: string,
  ): Promise<SolutionRevisionV1> {
    const project = this.#project(principal, projectId, "revisions.create");
    if (input.acceptedIntentId !== undefined)
      throw new ApplicationError(
        "service_unavailable",
        "Accepted requirements are unavailable in this test adapter.",
      );
    return this.#idempotent(
      principal,
      project.organizationId,
      "solution-revisions.create:" + projectId,
      idempotencyKey,
      { expectedEtag, input },
      async () => {
        const stableSuffix = createHash("sha256")
          .update(
            [
              project.organizationId,
              principal.principalId,
              projectId,
              idempotencyKey,
            ].join(":"),
          )
          .digest("hex")
          .slice(0, 24);
        const validationRunId = "validation_solution_" + stableSuffix;
        const validatedAt = this.#clock();
        this.#validationRuns.set(validationRunId, {
          completedAt: validatedAt,
          createdAt: validatedAt,
          id: validationRunId,
          input: {
            draftId: input.draftId,
            draftVersion: input.draftVersion,
            kind: "draft",
          },
          projectId,
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
            reportId: "report_solution_" + stableSuffix,
          },
          target: "draft",
        });
        const revision = await this.createRevision(
          principal,
          projectId,
          {
            contractVersion: 1,
            draftId: input.draftId,
            draftVersion: input.draftVersion,
            name: input.name,
            validationRunId,
          },
          expectedEtag,
          idempotencyKey + ":architecture",
        );
        const solutionRevisionId = "solution_revision_" + stableSuffix;
        const solutionRevision = buildSolutionRevisionV1({
          name: input.name,
          revision,
          solutionRevisionId,
        });
        this.#solutionRevisions.set(solutionRevisionId, solutionRevision);
        this.#recordAudit(
          principal,
          project.organizationId,
          "solution-revision.created",
          "succeeded",
          "An immutable Solution Revision was created from exact document versions.",
          "revision",
          solutionRevisionId,
        );
        return clone(solutionRevision);
      },
    );
  }

  listSolutionRevisions(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<SolutionRevisionSummaryV1>> {
    this.#project(principal, projectId, "projects.read");
    const values = [...this.#solutionRevisions.values()]
      .filter((revision) => revision.summary.projectId === projectId)
      .map((revision) => revision.summary)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    if (options.sort === "createdAt") {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  getSolutionRevision(
    principal: PrincipalContext,
    projectId: string,
    solutionRevisionId: string,
  ): Promise<SolutionRevisionV1> {
    this.#project(principal, projectId, "projects.read");
    const revision = this.#solutionRevisions.get(solutionRevisionId);
    if (revision?.summary.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(revision));
  }

  createValidationRun(
    principal: PrincipalContext,
    projectId: string,
    input: CreateValidationRunV1,
    idempotencyKey: string,
  ): Promise<ValidationRunV1> {
    const project = this.#project(principal, projectId, "validation.run");
    this.#validateValidationInput(projectId, input);
    return this.#idempotent(
      principal,
      project.organizationId,
      `validation.create:${projectId}`,
      idempotencyKey,
      input,
      () => {
        const run: ValidationRunV1 = {
          createdAt: this.#clock(),
          id: this.#idFactory("validation"),
          input: clone(input.input),
          projectId,
          status: "queued",
          target: input.target,
        };
        this.#validationRuns.set(run.id, run);
        return clone(run);
      },
    );
  }

  getValidationRun(
    principal: PrincipalContext,
    projectId: string,
    validationRunId: string,
  ): Promise<ValidationRunV1> {
    this.#project(principal, projectId, "projects.read");
    const run = this.#validationRuns.get(validationRunId);
    if (run?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(run));
  }

  createGenerationJob(
    principal: PrincipalContext,
    projectId: string,
    input: CreateGenerationJobV1,
    idempotencyKey: string,
  ): Promise<GenerationJobV1> {
    const project = this.#project(principal, projectId, "generation.run");
    const revision = this.#revisions.get(input.revisionId);
    if (revision?.projectId !== projectId) {
      throw this.#notFound();
    }
    return this.#idempotent(
      principal,
      project.organizationId,
      `generation.create:${projectId}`,
      idempotencyKey,
      input,
      () => {
        const job: GenerationJobV1 = {
          createdAt: this.#clock(),
          id: this.#idFactory("generation"),
          kind: input.kind,
          projectId,
          revisionId: input.revisionId,
          status: "queued",
          target: input.target,
        };
        this.#generationJobs.set(job.id, job);
        return clone(job);
      },
    );
  }

  getGenerationJob(
    principal: PrincipalContext,
    projectId: string,
    generationJobId: string,
  ): Promise<GenerationJobV1> {
    this.#project(principal, projectId, "projects.read");
    const job = this.#generationJobs.get(generationJobId);
    if (job?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(job));
  }

  createExportJob(
    principal: PrincipalContext,
    projectId: string,
    input: CreateExportJobV1,
    idempotencyKey: string,
  ): Promise<ExportJobV1> {
    const project = this.#project(principal, projectId, "exports.run");
    const artifact = this.#artifacts.get(input.artifactId);
    if (artifact?.projectId !== projectId) {
      throw this.#notFound();
    }
    if (input.kind === "github") {
      const integration = this.#integrations.get(input.integrationId);
      if (
        integration?.organizationId !== project.organizationId ||
        integration.status !== "connected"
      ) {
        throw this.#notFound();
      }
      try {
        requireRecentAuthentication(principal, new Date(this.#clock()));
      } catch (error) {
        this.#recordAudit(
          principal,
          project.organizationId,
          "export.queued",
          "denied",
          "Export initiation was denied.",
          "artifact",
          input.artifactId,
        );
        throw error;
      }
    }
    return this.#idempotent(
      principal,
      project.organizationId,
      `exports.create:${projectId}`,
      idempotencyKey,
      input,
      () => {
        const job: ExportJobV1 = {
          artifactId: input.artifactId,
          createdAt: this.#clock(),
          id: this.#idFactory("export"),
          ...(input.kind === "github"
            ? { integrationId: input.integrationId }
            : {}),
          kind: input.kind,
          projectId,
          status: "queued",
        };
        this.#exportJobs.set(job.id, job);
        this.#recordAudit(
          principal,
          project.organizationId,
          "export.queued",
          "succeeded",
          "An artifact export was queued.",
          "job",
          job.id,
        );
        return clone(job);
      },
    );
  }

  getExportJob(
    principal: PrincipalContext,
    projectId: string,
    exportJobId: string,
  ): Promise<ExportJobV1> {
    this.#project(principal, projectId, "projects.read");
    const job = this.#exportJobs.get(exportJobId);
    if (job?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(job));
  }

  listArtifacts(
    principal: PrincipalContext,
    projectId: string,
    options: PageOptions,
  ): Promise<PageResult<ArtifactSummaryV1>> {
    this.#project(principal, projectId, "artifacts.read");
    let values = [...this.#artifacts.values()].filter(
      (artifact) => artifact.projectId === projectId,
    );
    const status = options.filters["status"];
    if (status !== undefined) {
      values = values.filter((artifact) => artifact.status === status);
    }
    values.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    if (options.sort === "createdAt") {
      values.reverse();
    }
    return Promise.resolve(
      this.#page(
        values.map(({ files, target, ...summary }) => {
          void files;
          void target;
          return summary;
        }),
        options,
      ),
    );
  }

  getArtifact(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactV1> {
    this.#project(principal, projectId, "artifacts.read");
    const artifact = this.#artifacts.get(artifactId);
    if (artifact?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(clone(artifact));
  }

  listDownloads(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    options: PageOptions,
  ): Promise<PageResult<DownloadableArtifactV1>> {
    this.#project(principal, projectId, "artifacts.read");
    const artifact = this.#artifacts.get(artifactId);
    if (artifact?.projectId !== projectId) {
      throw this.#notFound();
    }
    return Promise.resolve(
      this.#page(
        this.#downloads.filter(
          (download) => download.artifactId === artifactId,
        ),
        options,
      ),
    );
  }

  listIntegrations(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<IntegrationV1>> {
    this.#membership(principal, organizationId, "integrations.read");
    let values = [...this.#integrations.values()].filter(
      (integration) => integration.organizationId === organizationId,
    );
    const status = options.filters["status"];
    if (status !== undefined) {
      values = values.filter((integration) => integration.status === status);
    }
    values.sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
    if (options.sort?.startsWith("-") === true) {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  listAuditEvents(
    principal: PrincipalContext,
    organizationId: string,
    options: PageOptions,
  ): Promise<PageResult<AuditEventSummaryV1>> {
    this.#membership(principal, organizationId, "audit.read");
    let values = [...this.#auditEvents.values()].filter(
      (event) => event.organizationId === organizationId,
    );
    const action = options.filters["action"];
    if (action !== undefined) {
      values = values.filter((event) => event.action === action);
    }
    const outcome = options.filters["outcome"];
    if (outcome !== undefined) {
      values = values.filter((event) => event.outcome === outcome);
    }
    values.sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt),
    );
    if (options.sort === "occurredAt") {
      values.reverse();
    }
    return Promise.resolve(this.#page(values, options));
  }

  #requireEtag(
    resourceKind: "organization" | "project" | "environment" | "draft",
    resourceId: string,
    currentEtag: string,
    currentVersion: number,
    expectedEtag: string,
    currentDraft?: DraftArchitectureDocumentV1,
  ): void {
    if (currentEtag === expectedEtag) {
      return;
    }
    throw new ApplicationError(
      "precondition_failed",
      "The resource changed. Reload it before retrying.",
      {
        conflict: {
          current: {
            ...(currentDraft === undefined
              ? {}
              : {
                  contentDigest:
                    currentDraft.documentDigest ?? currentDraft.contentDigest,
                  semanticDigest:
                    currentDraft.semanticDigest ?? currentDraft.contentDigest,
                  updatedAt: currentDraft.updatedAt,
                  visualDigest: currentDraft.visualDigest,
                }),
            etag: currentEtag,
            version: currentVersion,
          },
          recovery: {
            canCompare: resourceKind === "draft",
            canCopy: resourceKind === "draft",
            canReload: true,
          },
          resourceId,
          resourceKind,
        },
      },
    );
  }

  #recordAudit(
    principal: PrincipalContext,
    organizationId: string,
    action: string,
    outcome: AuditEventSummaryV1["outcome"],
    summary: string,
    targetKind: AuditEventSummaryV1["target"]["kind"],
    targetId: string,
  ): void {
    const actor = this.#requirePrincipal(principal);
    const event: AuditEventSummaryV1 = {
      action,
      actor: {
        displayName: actor.displayName,
        id: actor.id,
      },
      correlationId: principal.correlationId,
      id: this.#idFactory("audit"),
      occurredAt: this.#clock(),
      organizationId,
      outcome,
      summary,
      target: {
        id: targetId,
        kind: targetKind,
      },
    };
    this.#auditEvents.set(event.id, event);
  }

  #requirePrincipal(principal: PrincipalContext): PrincipalSeed {
    const record = this.#principals.get(principal.principalId);
    if (record === undefined) {
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    }
    return record;
  }

  #membership(
    principal: PrincipalContext,
    organizationId: string,
    permission: OrganizationPermission,
  ): MembershipV1 {
    this.#requirePrincipal(principal);
    const membership = [...this.#memberships.values()].find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.principal.id === principal.principalId &&
        candidate.status === "active",
    );
    if (membership === undefined) {
      throw this.#notFound();
    }
    requireOrganizationPermission(membership.role, permission);
    return membership;
  }

  #project(
    principal: PrincipalContext,
    projectId: string,
    permission: OrganizationPermission,
  ): ProjectV1 {
    this.#requirePrincipal(principal);
    const project = this.#projects.get(projectId);
    if (project === undefined) {
      throw this.#notFound();
    }
    this.#membership(principal, project.organizationId, permission);
    return project;
  }

  #validateValidationInput(
    projectId: string,
    input: CreateValidationRunV1,
  ): void {
    if (input.input.kind === "draft") {
      const project = this.#projects.get(projectId);
      const draft = this.#drafts.get(input.input.draftId);
      if (
        project?.currentDraft.id !== input.input.draftId ||
        draft?.projectId !== projectId ||
        draft.version !== input.input.draftVersion
      ) {
        throw new ApplicationError(
          "precondition_failed",
          "The draft input is not current.",
        );
      }
      return;
    }

    const revision = this.#revisions.get(input.input.revisionId);
    if (revision?.projectId !== projectId) {
      throw this.#notFound();
    }
  }

  #page<TValue>(
    values: readonly TValue[],
    options: PageOptions,
  ): PageResult<TValue> {
    let start = 0;
    if (options.cursor !== undefined) {
      const match = /^cursor:(\d+)$/.exec(options.cursor);
      if (match?.[1] === undefined) {
        throw new ApplicationError(
          "invalid_request",
          "The page cursor is invalid.",
          {
            fieldIssues: [
              {
                code: "request.invalid-page-cursor",
                message: "The page cursor is invalid.",
                path: ["query", "page[cursor]"],
              },
            ],
          },
        );
      }
      start = Number(match[1]);
    }

    const items = values.slice(start, start + options.limit).map(clone);
    const next = start + items.length;
    return {
      items,
      ...(next < values.length ? { nextCursor: `cursor:${String(next)}` } : {}),
    };
  }

  async #idempotent<TValue>(
    principal: PrincipalContext,
    organizationId: string,
    operation: string,
    idempotencyKey: string,
    input: unknown,
    create: () => TValue | Promise<TValue>,
  ): Promise<TValue> {
    const key = `${organizationId}:${principal.principalId}:${operation}:${idempotencyKey}`;
    const fingerprint = JSON.stringify(input);
    const existing = this.#idempotency.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApplicationError(
          "idempotency_key_reused",
          "The Idempotency-Key was already used for a different request.",
        );
      }
      return clone((await existing.result) as TValue);
    }

    const result = Promise.resolve()
      .then(create)
      .then((value) => clone(value));
    const record = { fingerprint, result };
    this.#idempotency.set(key, record);
    try {
      return clone((await result) as TValue);
    } catch (error) {
      if (this.#idempotency.get(key) === record) {
        this.#idempotency.delete(key);
      }
      throw error;
    }
  }

  #notFound(): ApplicationError {
    return new ApplicationError(
      "not_found",
      "The requested resource is unavailable.",
    );
  }
}
