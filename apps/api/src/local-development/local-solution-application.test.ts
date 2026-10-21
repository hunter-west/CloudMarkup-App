import { createHash } from "node:crypto";
import { solutionRevisionToolSelectionsV1Schema } from "../application/solution-revision-builder.js";
import { ApplicationError } from "../application/errors.js";
import { acceptedIntentV1Schema } from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { testIntent } from "@cloudmarkup/model-gateway/testing";
import {
  digestCanonicalValue,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  DraftMetadataRecord,
  ProjectRecord,
  RevisionMetadataRecord,
  StoredObjectReference,
  StoredObjectState,
} from "../application/persistence.js";
import type { PrincipalContext } from "../application/ports.js";
import type {
  CreateSolutionRecordInput,
  SolutionRecordMetadata,
  SolutionRecordRepository,
} from "../application/solution-record-persistence.js";
import { InMemoryObjectStore } from "../adapters/persistence/memory-object-store.js";
import {
  createDocumentStageInput,
  getLocalDocumentStorage,
} from "./local-documents.js";
import {
  createSeedArchitectureDocument,
  LOCAL_PROJECT_SEEDS,
} from "./local-seed.js";
import {
  createRepositoryBackedSolutionApplicationOverrides,
  deriveInternalValidationRunId,
} from "../application/repository-backed-solution-application.js";
import type { RevisionValidation } from "../application/revision-validation.js";

const NOW = "2026-08-15T12:00:00.000Z";

function principal(): PrincipalContext {
  return {
    authenticatedAt: NOW,
    authenticationSource: "local-development",
    correlationId: "correlation_local_solution_test",
    expiresAt: "2026-08-16T12:00:00.000Z",
    principalId: "principal_local_owner",
    sessionId: "session_local_solution_test",
  };
}

describe("restart-safe repository-backed Solution Revision application", () => {
  it("namespaces caller validation IDs by organization and project", () => {
    const shared = {
      callerValidationRunId: "validation_shared_external",
      identifierNamespace: "beta",
      projectId: "project_shared_validation",
    };
    const first = deriveInternalValidationRunId({
      ...shared,
      organizationId: "organization_first",
    });
    const second = deriveInternalValidationRunId({
      ...shared,
      organizationId: "organization_second",
    });
    const otherProject = deriveInternalValidationRunId({
      ...shared,
      organizationId: "organization_first",
      projectId: "project_other_validation",
    });

    expect(first).toMatch(/^validation_beta_[a-f0-9]{64}$/u);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(second).not.toBe(first);
    expect(otherProject).not.toBe(first);
    expect(
      deriveInternalValidationRunId({
        ...shared,
        organizationId: "organization_first",
      }),
    ).toBe(first);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, false],
    [false, true, true],
    [true, false, true],
  ])(
    "preserves an immutable revision across restart (Intent=%s, selected tools=%s, interrupted=%s)",
    async (includeIntent, includeTools, interruptPublication) => {
      const seed = LOCAL_PROJECT_SEEDS[1];
      const document = createSeedArchitectureDocument(seed);
      const storage = getLocalDocumentStorage(document);
      const objectStore = new InMemoryObjectStore();
      const scope: AuthorizedOrganizationScope = {
        ...principal(),
        capabilities: ["projects.read", "projects.mutate", "revisions.create"],
        membershipId: "membership_local_owner",
        organizationId: "org_local",
        roleKey: "owner",
      };
      const initialObject = await objectStore.stage(
        scope,
        createDocumentStageInput({
          document,
          objectId: seed.objectId,
          organizationId: seed.organizationId,
          projectId: seed.projectId,
        }),
      );
      await objectStore.publish(scope, initialObject);

      let project: ProjectRecord = {
        createdAt: NOW,
        currentDraftId: seed.draftId,
        description: seed.description,
        lifecycleStatus: "active",
        name: seed.name,
        organizationId: seed.organizationId,
        projectId: seed.projectId,
        recordVersion: 1,
        updatedAt: NOW,
      };
      let draft: DraftMetadataRecord = {
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
      const objects = new Map<string, StoredObjectState>([
        [
          initialObject.objectId,
          { ...initialObject, lifecycleState: "published" },
        ],
      ]);
      const revisions = new Map<string, RevisionMetadataRecord>();
      const records = new Map<string, SolutionRecordMetadata>();

      const repository = {
        createRevision: vi.fn(
          async (
            _authorizedScope: AuthorizedOrganizationScope,
            input: Parameters<CloudMarkupRepository["createRevision"]>[1],
            object: StoredObjectReference,
          ) => {
            await Promise.resolve();
            objects.set(object.objectId, {
              ...object,
              lifecycleState: "publication-pending",
            });
            const revision: RevisionMetadataRecord = {
              catalogId: input.catalogId,
              catalogSha256: input.catalogSha256,
              catalogVersion: input.catalogVersion,
              compilerInputContractVersion: input.compilerInputContractVersion,
              contentSha256: input.contentSha256,
              createdAt: input.createdAt,
              documentObjectId: object.objectId,
              graphSchemaVersion: input.graphSchemaVersion,
              ...(input.maximumCompilerVersionExclusive === undefined
                ? {}
                : {
                    maximumCompilerVersionExclusive:
                      input.maximumCompilerVersionExclusive,
                  }),
              minimumCompilerVersion: input.minimumCompilerVersion,
              name: input.name,
              organizationId: scope.organizationId,
              ...(input.previousRevisionId === undefined
                ? {}
                : { previousRevisionId: input.previousRevisionId }),
              projectId: input.projectId,
              revisionId: input.revisionId,
              revisionNumber: input.revisionNumber,
              semanticSha256: input.semanticSha256,
              sourceDraftId: input.sourceDraftId,
              sourceDraftVersion: input.expectedDraftVersion,
              validationRunId: input.validationRunId,
              visualSha256: input.visualSha256,
              workloadBehaviorVersion: input.workloadBehaviorVersion,
            };
            revisions.set(revision.revisionId, revision);
            return revision;
          },
        ),
        getDraft: vi.fn().mockImplementation(() => Promise.resolve(draft)),
        getObject: vi.fn(
          (_scope: AuthorizedOrganizationScope, objectId: string) =>
            Promise.resolve(objects.get(objectId) ?? null),
        ),
        getProject: vi.fn().mockImplementation(() => Promise.resolve(project)),
        getRevision: vi.fn(
          (
            _scope: AuthorizedOrganizationScope,
            _projectId: string,
            revisionId: string,
          ) => Promise.resolve(revisions.get(revisionId) ?? null),
        ),
        listRevisions: vi
          .fn()
          .mockImplementation(() => Promise.resolve([...revisions.values()])),
        markObjectPublished: vi.fn(
          async (_scope: AuthorizedOrganizationScope, objectId: string) => {
            await Promise.resolve();
            const object = objects.get(objectId);
            if (object !== undefined) {
              objects.set(objectId, { ...object, lifecycleState: "published" });
            }
            const revision = [...revisions.values()].find(
              (candidate) => candidate.documentObjectId === objectId,
            );
            if (revision !== undefined) {
              project = {
                ...project,
                latestRevisionId: revision.revisionId,
                recordVersion: project.recordVersion + 1,
              };
            }
          },
        ),
        resolveOrganizationScope: vi.fn().mockResolvedValue(scope),
      } as unknown as CloudMarkupRepository;

      const solutionRecords: SolutionRecordRepository = {
        create: vi.fn(
          async (
            _authorizedScope: AuthorizedOrganizationScope,
            input: CreateSolutionRecordInput,
            object: StoredObjectReference,
          ) => {
            await Promise.resolve();
            objects.set(object.objectId, {
              ...object,
              lifecycleState: "publication-pending",
            });
            const record: SolutionRecordMetadata = {
              ...(input.architectureRevisionId === undefined
                ? {}
                : { architectureRevisionId: input.architectureRevisionId }),
              contentObjectId: object.objectId,
              contentSha256: input.contentSha256,
              contractVersion: input.contractVersion,
              createdAt: NOW,
              createdByPrincipalId: scope.principalId,
              organizationId: scope.organizationId,
              projectId: input.projectId,
              recordKind: input.recordKind,
              solutionRecordId: input.solutionRecordId,
              subjectId: input.subjectId,
            };
            records.set(record.solutionRecordId, record);
            return record;
          },
        ),
        get: vi.fn(
          (
            _scope: AuthorizedOrganizationScope,
            _projectId: string,
            solutionRecordId: string,
          ) => {
            const record = records.get(solutionRecordId);
            return Promise.resolve(
              record !== undefined &&
                objects.get(record.contentObjectId)?.lifecycleState ===
                  "published"
                ? record
                : null,
            );
          },
        ),
        getManifestForPublication: vi.fn(
          (
            _scope: AuthorizedOrganizationScope,
            _projectId: string,
            solutionRecordId: string,
          ) => Promise.resolve(records.get(solutionRecordId) ?? null),
        ),
        list: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              [...records.values()].filter(
                (record) =>
                  objects.get(record.contentObjectId)?.lifecycleState ===
                  "published",
              ),
            ),
          ),
      };
      const ensureComplete = vi
        .fn<RevisionValidation["ensureComplete"]>()
        .mockResolvedValue(undefined);
      const intentDocument = parseIntentDocument(testIntent);
      const accepted = acceptedIntentV1Schema.parse({
        contractVersion: 1,
        acceptedIntentId: "accepted_intent_" + "a".repeat(48),
        projectId: seed.projectId,
        createdAt: NOW,
        createdByPrincipalId: scope.principalId,
        sourceDraftId: seed.draftId,
        sourceDraftVersion: 1,
        invocationId: "preview_test_immutable",
        outputDigest: "sha256:" + "b".repeat(64),
        intentDigest: digestCanonicalValue(intentDocument),
        intentDocument,
      });
      const getAccepted = vi.fn().mockResolvedValue(accepted);
      const intentSelection = includeIntent
        ? { acceptedIntentId: accepted.acceptedIntentId }
        : {};
      const options = {
        ...(includeIntent ? { acceptedIntents: { get: getAccepted } } : {}),
        identifierNamespace: "beta",
        objectStore,
        organizationForProject: () => scope.organizationId,
        principalDisplayName: () => "Beta Owner",
        repository,
        solutionRecords,
        validation: {
          ensureComplete,
        } satisfies RevisionValidation,
      };

      const selectedTools = solutionRevisionToolSelectionsV1Schema.parse({
        compiler: {
          state: "pinned",
          tool: {
            id: "cloudmarkup.iac-compiler",
            version: "1.1.0",
            digest: "sha256:" + "a".repeat(64),
          },
        },
        diagramRenderer: {
          state: "pinned",
          tool: {
            id: "cloudmarkup.diagram-renderer",
            version: "1.1.0",
            digest: "sha256:" + "b".repeat(64),
          },
        },
      });
      const selectToolsForFreeze = vi.fn().mockResolvedValue(selectedTools);
      const unavailableSelector = vi
        .fn()
        .mockRejectedValue(
          new ApplicationError(
            "service_unavailable",
            "Current tools are unavailable.",
          ),
        );
      const unavailableProcess =
        createRepositoryBackedSolutionApplicationOverrides({
          ...options,
          selectToolsForFreeze: unavailableSelector,
        });
      await expect(
        unavailableProcess.createSolutionRevision(
          principal(),
          seed.projectId,
          {
            contractVersion: 1,
            draftId: seed.draftId,
            draftVersion: 1,
            name: "Unavailable freeze",
            ...intentSelection,
          },
          '"draft:' + seed.draftId + ':v1"',
          "unavailable-freeze",
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(revisions.size).toBe(0);
      expect(records.size).toBe(0);
      expect(objects.size).toBe(1);
      let interruptManifest = interruptPublication;
      const publish = objectStore.publish.bind(objectStore);
      vi.spyOn(objectStore, "publish").mockImplementation(
        (authorized, object) => {
          if (
            interruptManifest &&
            object.purpose === "solution-revision-manifest"
          ) {
            interruptManifest = false;
            return Promise.reject(
              new Error("Interrupted after immutable metadata commit"),
            );
          }
          return publish(authorized, object);
        },
      );
      const firstProcess = createRepositoryBackedSolutionApplicationOverrides({
        ...options,
        ...(includeTools ? { selectToolsForFreeze } : {}),
      });
      const create = () =>
        firstProcess.createSolutionRevision(
          principal(),
          seed.projectId,
          {
            contractVersion: 1,
            draftId: seed.draftId,
            draftVersion: 1,
            name: "Infrastructure baseline",
            ...intentSelection,
          },
          `"draft:${seed.draftId}:v1"`,
          "local-solution-restart-test-v1",
        );
      if (interruptPublication) {
        await expect(create()).rejects.toMatchObject({
          code: "service_unavailable",
        });
        const pendingRecord = [...records.values()][0];
        if (pendingRecord === undefined)
          throw new Error("Pending manifest missing");
        await expect(
          firstProcess.getSolutionRevision(
            principal(),
            seed.projectId,
            pendingRecord.subjectId,
          ),
        ).rejects.toMatchObject({ code: "not_found" });
        const recovery = createRepositoryBackedSolutionApplicationOverrides({
          ...options,
          selectToolsForFreeze: unavailableSelector,
        });
        await expect(
          recovery.createSolutionRevision(
            principal(),
            seed.projectId,
            {
              contractVersion: 1,
              draftId: seed.draftId,
              draftVersion: 1,
              name: "Changed pending request",
              ...intentSelection,
            },
            '"draft:' + seed.draftId + ':v1"',
            "local-solution-restart-test-v1",
          ),
        ).rejects.toMatchObject({ code: "idempotency_key_reused" });
        expect(objects.get(pendingRecord.contentObjectId)?.lifecycleState).toBe(
          "publication-pending",
        );
        selectToolsForFreeze.mockRejectedValue(
          new Error("Tools changed after interruption"),
        );
        const recovered = await recovery.createSolutionRevision(
          principal(),
          seed.projectId,
          {
            contractVersion: 1,
            draftId: seed.draftId,
            draftVersion: 1,
            name: "Infrastructure baseline",
            ...intentSelection,
          },
          '"draft:' + seed.draftId + ':v1"',
          "local-solution-restart-test-v1",
        );
        expect(recovered.manifest.versions.compiler.state).toBe(
          includeTools ? "pinned" : "not-applicable",
        );
        expect(unavailableSelector).toHaveBeenCalledOnce();
      }
      const created = await create();
      expect(created.summary.generationCoverage.state).toBe(
        "infrastructure-only",
      );
      expect(created.summary.sourceDraftVersion).toBe(1);
      expect(created.manifest.versions.compiler).toEqual(
        includeTools
          ? selectedTools.compiler
          : {
              state: "not-applicable",
              reason:
                "Infrastructure compilation has not run for this revision.",
            },
      );
      expect(created.manifest.generationCoverage.evidence).toEqual([]);
      selectToolsForFreeze.mockRejectedValue(
        new Error("Current selection changed after freeze"),
      );
      expect(created.manifest.intent).toEqual(
        includeIntent
          ? {
              state: "included",
              id: accepted.acceptedIntentId,
              version: 1,
              contentHash: accepted.intentDigest,
            }
          : {
              state: "not-applicable",
              reason:
                "No separately versioned Intent Document is bound to this Architecture Revision.",
            },
      );
      if (!includeIntent) expect(getAccepted).not.toHaveBeenCalled();
      expect(created.revision.id).toBe(
        created.revision.architectureDocument.revision.revisionId,
      );
      const { sourceDraftId, ...rootNestedRevision } =
        created.revision.architectureDocument.revision;
      expect(sourceDraftId).toBe(seed.draftId);
      expect(
        created.revision.architectureDocument.applicationContracts.revision,
      ).toEqual(rootNestedRevision);
      expect(
        created.revision.architectureDocument.externalResources.revision,
      ).toEqual(rootNestedRevision);
      expect(created.revision.documentDigest).not.toBe(
        `sha256:${storage.contentSha256}`,
      );
      expect(ensureComplete).toHaveBeenCalledWith(
        scope,
        expect.objectContaining({
          contentSha256: storage.contentSha256,
          draftId: seed.draftId,
          draftVersion: 1,
        }),
      );

      const ordinary = await firstProcess.createRevision(
        principal(),
        seed.projectId,
        {
          contractVersion: 1,
          draftId: seed.draftId,
          draftVersion: 1,
          name: "Reviewed architecture baseline",
          validationRunId: "validation_beta_external_complete",
        },
        `"draft:${seed.draftId}:v1"`,
        "ordinary-revision-restart-test-v1",
      );
      expect(ordinary.id).toMatch(/^revision_beta_/u);
      expect(ensureComplete).toHaveBeenCalledWith(
        scope,
        expect.objectContaining({
          draftId: seed.draftId,
          draftVersion: 1,
        }),
      );
      expect(ensureComplete.mock.calls.at(-1)?.[1].validationRunId).toMatch(
        /^validation_beta_[a-f0-9]{64}$/u,
      );
      await expect(
        firstProcess.getRevision(principal(), seed.projectId, ordinary.id),
      ).resolves.toEqual(ordinary);
      const listedRevisions = await firstProcess.listRevisions(
        principal(),
        seed.projectId,
        {
          filters: {},
          limit: 25,
          sort: "-createdAt",
        },
      );
      expect(
        listedRevisions.items.some(
          (item) =>
            item.id === ordinary.id && item.projectId === seed.projectId,
        ),
      ).toBe(true);

      project = {
        ...project,
        lifecycleStatus: "archived",
        recordVersion: project.recordVersion + 1,
      };
      draft = { ...draft, draftVersion: 2 };
      await expect(
        firstProcess.createSolutionRevision(
          principal(),
          seed.projectId,
          {
            contractVersion: 1,
            draftId: seed.draftId,
            draftVersion: 1,
            name: "Infrastructure baseline",
            ...intentSelection,
          },
          `"draft:${seed.draftId}:v1"`,
          "local-solution-restart-test-v1",
        ),
      ).resolves.toEqual(created);
      expect(ensureComplete).toHaveBeenCalledTimes(2);

      await expect(
        firstProcess.createSolutionRevision(
          principal(),
          seed.projectId,
          {
            contractVersion: 1,
            draftId: seed.draftId,
            draftVersion: 1,
            name: "Different immutable name",
            ...intentSelection,
          },
          `"draft:${seed.draftId}:v1"`,
          "local-solution-restart-test-v1",
        ),
      ).rejects.toMatchObject({
        code: "idempotency_key_reused",
        status: 409,
      });
      const restartedProcess =
        createRepositoryBackedSolutionApplicationOverrides({
          ...options,
          selectToolsForFreeze: unavailableSelector,
        });
      await expect(
        restartedProcess.getSolutionRevision(
          principal(),
          seed.projectId,
          created.summary.solutionRevisionId,
        ),
      ).resolves.toEqual(created);
      await expect(
        restartedProcess.listSolutionRevisions(principal(), seed.projectId, {
          filters: {},
          limit: 25,
          sort: "-createdAt",
        }),
      ).resolves.toEqual({ items: [created.summary] });
      await expect(
        restartedProcess.createSolutionRevision(
          principal(),
          seed.projectId,
          {
            contractVersion: 1,
            draftId: seed.draftId,
            draftVersion: 1,
            name: "Infrastructure baseline",
            ...intentSelection,
          },
          '"draft:' + seed.draftId + ':v1"',
          "local-solution-restart-test-v1",
        ),
      ).resolves.toEqual(created);
      expect(unavailableSelector).toHaveBeenCalledOnce();
      expect(selectToolsForFreeze).toHaveBeenCalledTimes(includeTools ? 1 : 0);
      if (includeIntent) {
        expect(getAccepted).toHaveBeenCalledWith(
          principal(),
          seed.projectId,
          accepted.acceptedIntentId,
        );
        await expect(
          restartedProcess.createSolutionRevision(
            principal(),
            seed.projectId,
            {
              contractVersion: 1,
              draftId: seed.draftId,
              draftVersion: 1,
              name: "Infrastructure baseline",
              acceptedIntentId: "accepted_intent_other",
            },
            `"draft:${seed.draftId}:v1"`,
            "local-solution-restart-test-v1",
          ),
        ).rejects.toMatchObject({ code: "idempotency_key_reused" });
        getAccepted.mockResolvedValueOnce({
          ...accepted,
          acceptedIntentId: "accepted_intent_other",
        });
        await expect(
          restartedProcess.getSolutionRevision(
            principal(),
            seed.projectId,
            created.summary.solutionRevisionId,
          ),
        ).rejects.toMatchObject({ code: "conflict" });
        getAccepted.mockResolvedValueOnce({
          ...accepted,
          intentDigest: "sha256:" + "c".repeat(64),
        });
        await expect(
          restartedProcess.getSolutionRevision(
            principal(),
            seed.projectId,
            created.summary.solutionRevisionId,
          ),
        ).rejects.toBeDefined();
        const { acceptedIntents, ...withoutAcceptedReader } = options;
        void acceptedIntents;
        const unavailable = createRepositoryBackedSolutionApplicationOverrides(
          withoutAcceptedReader,
        );
        await expect(
          unavailable.getSolutionRevision(
            principal(),
            seed.projectId,
            created.summary.solutionRevisionId,
          ),
        ).rejects.toMatchObject({ code: "service_unavailable" });
      }
      const record = records.get(created.summary.solutionRevisionId);
      if (record === undefined)
        throw new Error("Created manifest record missing");
      records.set(record.solutionRecordId, {
        ...record,
        contentSha256: "c".repeat(64),
      });
      await expect(
        restartedProcess.getSolutionRevision(
          principal(),
          seed.projectId,
          created.summary.solutionRevisionId,
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      records.set(record.solutionRecordId, record);
      // Authentically stored but independently altered non-tool data still fails
      // reconstruction; accepting frozen pins does not trust other fields.
      const changedBytes = new TextEncoder().encode(
        serializeCanonicalJson({
          ...created.manifest,
          assumptions: ["assumption.unapproved"],
        }),
      );
      const changedSha = createHash("sha256")
        .update(changedBytes)
        .digest("hex");
      const changed = await objectStore.stage(scope, {
        objectId: "object_changed_manifest",
        contentSha256: changedSha,
        mediaType: "application/json",
        sizeBytes: changedBytes.length,
        owner: {
          organizationId: scope.organizationId,
          projectId: seed.projectId,
        },
        purpose: "solution-revision-manifest",
        open: async function* () {
          await Promise.resolve();
          yield changedBytes;
        },
      });
      await objectStore.publish(scope, changed);
      objects.set(changed.objectId, {
        ...changed,
        lifecycleState: "published",
      });
      records.set(record.solutionRecordId, {
        ...record,
        contentObjectId: changed.objectId,
        contentSha256: changedSha,
      });
      await expect(
        restartedProcess.getSolutionRevision(
          principal(),
          seed.projectId,
          created.summary.solutionRevisionId,
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    },
  );

  it("hides a cross-tenant revision selector before project or object lookup", async () => {
    const getProject = vi.fn();
    const getObject = vi.fn();
    const solutionGet = vi.fn();
    const application = createRepositoryBackedSolutionApplicationOverrides({
      identifierNamespace: "beta",
      objectStore: new InMemoryObjectStore(),
      organizationForProject: () => "org_beta_attacker",
      repository: {
        getObject,
        getProject,
        resolveOrganizationScope: vi.fn().mockResolvedValue(null),
      } as unknown as CloudMarkupRepository,
      solutionRecords: {
        get: solutionGet,
      } as unknown as SolutionRecordRepository,
      validation: {
        ensureComplete: vi.fn(),
      },
    });

    await expect(
      application.getSolutionRevision(
        {
          ...principal(),
          principalId: "principal_beta_attacker",
        },
        "project_beta_other_tenant",
        "solution_revision_beta_secret",
      ),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(getProject).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    expect(solutionGet).not.toHaveBeenCalled();
  });
});
