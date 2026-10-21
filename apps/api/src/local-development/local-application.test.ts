import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  CreateProjectWithDraftInput,
  DraftMetadataRecord,
  ObjectStore,
  ProjectRecord,
  StoredObjectReference,
  StoredObjectState,
} from "../application/persistence.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "../application/ports.js";
import { architectureDocumentV3Schema } from "@cloudmarkup/schemas";

import { InMemoryObjectStore } from "../adapters/persistence/memory-object-store.js";
import { createRepositoryBackedLocalApplication } from "./local-application.js";
import {
  createDocumentStageInput,
  getLocalDocumentStorage,
} from "./local-documents.js";
import {
  createSeedArchitectureDocument,
  LOCAL_PROJECT_SEEDS,
} from "./local-seed.js";

const NOW = "2026-08-15T12:00:00.000Z";

function principal(principalId = "principal_local_owner"): PrincipalContext {
  return {
    authenticatedAt: NOW,
    authenticationSource: "local-development",
    correlationId: "correlation_local_test",
    expiresAt: "2026-08-16T12:00:00.000Z",
    principalId,
    sessionId: "session_local_test",
  };
}

function application(
  repository: Partial<CloudMarkupRepository>,
  objectStore: ObjectStore = {} as ObjectStore,
) {
  return createRepositoryBackedLocalApplication({
    clock: () => new Date("2026-08-15T12:20:00.000Z"),
    fallback: {} as CloudMarkupApplication,
    objectStore,
    repository: repository as CloudMarkupRepository,
  });
}

describe("repository-backed local API boundary", () => {
  it("requires tab proof when the real local server enables editing leases", async () => {
    const resolveOrganizationScope = vi.fn();
    const local = createRepositoryBackedLocalApplication({
      draftEditingLeases: "required",
      clock: () => new Date(NOW),
      fallback: {} as CloudMarkupApplication,
      objectStore: {} as ObjectStore,
      repository: {
        resolveOrganizationScope,
      } as unknown as CloudMarkupRepository,
    });
    await expect(
      local.saveDraft(
        principal(),
        "project_local_notes_api",
        { contractVersion: 1, architectureDocument: {} },
        '"draft:local:v1"',
      ),
    ).rejects.toMatchObject({ code: "precondition_required", status: 428 });
    expect(resolveOrganizationScope).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant organization before repository access", async () => {
    const resolveOrganizationScope = vi.fn();
    const createProjectWithInitialDraft = vi.fn();
    const local = application({
      createProjectWithInitialDraft,
      resolveOrganizationScope,
    });

    await expect(
      local.listProjects(principal(), "org_local_team", {
        filters: {},
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      local.createProject(
        principal(),
        "org_local_team",
        { creationMode: "blank", name: "Guessed tenant" },
        "cross-tenant-create",
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(resolveOrganizationScope).not.toHaveBeenCalled();
    expect(createProjectWithInitialDraft).not.toHaveBeenCalled();
  });

  it("hides a scope revoked after either organization or project resolution", async () => {
    const resolveOrganizationScope = vi.fn().mockResolvedValue(null);
    const listProjects = vi.fn();
    const getProject = vi.fn();
    const createProjectWithInitialDraft = vi.fn();
    const local = application({
      createProjectWithInitialDraft,
      getProject,
      listProjects,
      resolveOrganizationScope,
    });

    await expect(
      local.listProjects(principal(), "org_local", {
        filters: {},
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      local.createProject(
        principal(),
        "org_local",
        { creationMode: "blank", name: "Revoked tenant" },
        "revoked-tenant-create",
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      local.getProject(principal(), "project_revoked"),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(resolveOrganizationScope).toHaveBeenCalledTimes(3);
    expect(listProjects).not.toHaveBeenCalled();
    expect(createProjectWithInitialDraft).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
  });

  it("recovers a pending initial project publication on an identical retry", async () => {
    const objectStore = new InMemoryObjectStore();
    const scope: AuthorizedOrganizationScope = {
      ...principal(),
      capabilities: ["projects.create"],
      membershipId: "membership_local_owner",
      organizationId: "org_local",
      roleKey: "owner",
    };
    let stored: StoredObjectState | null = null;
    let createdProject: ProjectRecord | null = null;
    let createCalls = 0;
    let markCalls = 0;
    const local = application(
      {
        createProjectWithInitialDraft: vi.fn(
          async (
            _authorizedScope: AuthorizedOrganizationScope,
            input: CreateProjectWithDraftInput,
            object: StoredObjectReference,
          ) => {
            await Promise.resolve();
            createCalls += 1;
            stored ??= { ...object, lifecycleState: "publication-pending" };
            createdProject ??= {
              createdAt: NOW,
              currentDraftId: input.draft.draftId,
              lifecycleStatus: "active",
              name: input.name,
              organizationId: scope.organizationId,
              projectId: input.projectId,
              recordVersion: 1,
              updatedAt: NOW,
            };
            return createdProject;
          },
        ),
        getObject: vi.fn().mockImplementation(() => Promise.resolve(stored)),
        listProjectEnvironments: vi.fn().mockResolvedValue([]),
        markObjectPublished: vi.fn(async () => {
          await Promise.resolve();
          markCalls += 1;
          if (markCalls === 1) {
            throw new Error("controlled project finalize failure");
          }
          if (stored !== null) {
            stored = { ...stored, lifecycleState: "published" };
          }
        }),
        resolveOrganizationScope: vi.fn().mockResolvedValue(scope),
      },
      objectStore,
    );
    const input = { creationMode: "blank" as const, name: "Recovered beta" };

    await expect(
      local.createProject(
        principal(),
        scope.organizationId,
        input,
        "project-recovery-idempotency-v1",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      local.createProject(
        principal(),
        scope.organizationId,
        input,
        "project-recovery-idempotency-v1",
      ),
    ).resolves.toMatchObject({
      draft: { version: 1 },
      project: { name: input.name },
    });
    expect(createCalls).toBe(2);
    expect(markCalls).toBe(2);
    expect((stored as StoredObjectState | null)?.lifecycleState).toBe(
      "published",
    );
  });

  it("reads and updates presentation preferences through durable CAS metadata", async () => {
    const getPresentationPreferences = vi.fn().mockResolvedValue({
      contextualLearningEnabled: false,
      experienceMode: "professional",
      syncVersion: 4,
      updatedAt: NOW,
    });
    const updatePresentationPreferences = vi.fn().mockResolvedValue({
      contextualLearningEnabled: true,
      experienceMode: "guided",
      syncVersion: 5,
      updatedAt: "2026-08-15T12:01:00.000Z",
    });
    const local = application({
      getPresentationPreferences,
      updatePresentationPreferences,
    });

    await expect(
      local.getPresentationPreferences(principal()),
    ).resolves.toEqual({
      etag: '"preferences:principal_local_owner:v4"',
      value: {
        contextualLearningEnabled: false,
        contractVersion: 1,
        experienceMode: "professional",
        syncVersion: 4,
        updatedAt: NOW,
      },
    });
    await expect(
      local.updatePresentationPreferences(
        principal(),
        {
          contextualLearningEnabled: true,
          contractVersion: 1,
          experienceMode: "guided",
        },
        '"preferences:principal_local_owner:v4"',
      ),
    ).resolves.toMatchObject({
      etag: '"preferences:principal_local_owner:v5"',
      value: { contractVersion: 1, syncVersion: 5 },
    });
    expect(updatePresentationPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: "principal_local_owner" }),
      {
        contextualLearningEnabled: true,
        experienceMode: "guided",
      },
      4,
    );
  });

  it("rejects schema-valid full-document saves that replace server draft identity bindings", async () => {
    const seed = LOCAL_PROJECT_SEEDS[0];
    const document = createSeedArchitectureDocument(seed);
    const storage = getLocalDocumentStorage(document);
    const objectStore = new InMemoryObjectStore();
    const scope: AuthorizedOrganizationScope = {
      ...principal(),
      capabilities: ["projects.read", "projects.mutate"],
      membershipId: "membership_local_owner",
      organizationId: seed.organizationId,
      roleKey: "owner",
    };
    const staged = await objectStore.stage(
      scope,
      createDocumentStageInput({
        document,
        objectId: seed.objectId,
        organizationId: seed.organizationId,
        projectId: seed.projectId,
      }),
    );
    await objectStore.publish(scope, staged);
    const storedObject: StoredObjectState = {
      ...staged,
      lifecycleState: "published",
    };
    const project: ProjectRecord = {
      createdAt: NOW,
      currentDraftId: seed.draftId,
      lifecycleStatus: "active",
      name: seed.name,
      organizationId: seed.organizationId,
      projectId: seed.projectId,
      recordVersion: 1,
      updatedAt: NOW,
    };
    const draft: DraftMetadataRecord = {
      contentSha256: storage.contentSha256,
      documentObjectId: seed.objectId,
      documentSchemaVersion: 3,
      draftId: seed.draftId,
      draftVersion: 1,
      organizationId: seed.organizationId,
      projectId: seed.projectId,
      semanticSha256: storage.semanticSha256,
      visualSha256: storage.visualSha256,
    };
    const replacementRootRevision = {
      ...document.revision,
      revisionId: "revision_replacement",
    };
    const {
      sourceDraftId: replacementSourceDraftId,
      ...replacementNestedRevision
    } = replacementRootRevision;
    void replacementSourceDraftId;
    const candidates = [
      architectureDocumentV3Schema.parse({
        ...document,
        applicationContracts: {
          ...document.applicationContracts,
          contractSetId: "architecture_replacement",
          documentId: "document_replacement",
        },
        architectureId: "architecture_replacement",
        documentId: "document_replacement",
        externalResources: {
          ...document.externalResources,
          architectureId: "architecture_replacement",
          documentId: "document_replacement",
        },
      }),
      architectureDocumentV3Schema.parse({
        ...document,
        applicationContracts: {
          ...document.applicationContracts,
          revision: replacementNestedRevision,
        },
        externalResources: {
          ...document.externalResources,
          revision: replacementNestedRevision,
        },
        revision: replacementRootRevision,
      }),
      architectureDocumentV3Schema.parse({
        ...document,
        revision: {
          ...document.revision,
          sourceDraftId: "draft_replacement",
        },
      }),
      architectureDocumentV3Schema.parse({
        ...document,
        applicationContracts: {
          ...document.applicationContracts,
          contractSetId: "contractset_replacement",
        },
      }),
    ];
    const updateDraft = vi.fn();
    const local = application(
      {
        getDraft: vi.fn().mockResolvedValue(draft),
        getObject: vi.fn().mockResolvedValue(storedObject),
        getProject: vi.fn().mockResolvedValue(project),
        resolveOrganizationScope: vi.fn().mockResolvedValue(scope),
        updateDraft,
      },
      objectStore,
    );

    for (const candidate of candidates) {
      await expect(
        local.saveDraft(
          principal(),
          seed.projectId,
          { architectureDocument: candidate, contractVersion: 1 },
          `"draft:${seed.draftId}:v1"`,
        ),
      ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    }
    expect(updateDraft).not.toHaveBeenCalled();
  });
  it("requires recent verified authentication before project deletion", async () => {
    const scope: AuthorizedOrganizationScope = {
      ...principal(),
      capabilities: ["projects.delete"],
      membershipId: "membership_local_owner",
      organizationId: "org_local",
      roleKey: "owner",
    };
    const project: ProjectRecord = {
      createdAt: NOW,
      currentDraftId: "draft_local_notes_api",
      lifecycleStatus: "active",
      name: "notes-api",
      organizationId: "org_local",
      projectId: "project_local_notes_api",
      recordVersion: 1,
      updatedAt: NOW,
    };
    const deleteProject = vi.fn();
    const local = application({
      deleteProject,
      getProject: vi.fn().mockResolvedValue(project),
      resolveOrganizationScope: vi.fn().mockResolvedValue(scope),
    });

    await expect(
      local.deleteProject(
        principal(),
        project.projectId,
        '"project:project_local_notes_api:v1"',
        "local-delete-project-test-v1",
      ),
    ).rejects.toMatchObject({ code: "access_denied", status: 403 });
    expect(deleteProject).not.toHaveBeenCalled();
  });
});
