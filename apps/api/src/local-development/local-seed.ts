import { createHash } from "node:crypto";

import type {
  CloudMarkupRepository,
  ObjectStore,
  ProjectRecord,
  VerifiedPrincipalContext,
} from "../application/persistence.js";
import { ObjectPublicationCoordinator } from "../adapters/persistence/publication.js";
import {
  createDocumentStageInput,
  createLocalArchitectureDocument,
  getLocalDocumentStorage,
} from "./local-documents.js";

export interface LocalProjectSeed {
  readonly description: string;
  readonly draftId: string;
  readonly infrastructureOnly: boolean;
  readonly name: "infrastructure-only" | "notes-api" | "workload";
  readonly objectId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly projectId: string;
}

export const LOCAL_PROJECT_SEEDS = [
  {
    description:
      "Credentialless local notes API with an explicit Workload Document v2.",
    draftId: "draft_local_notes_api",
    infrastructureOnly: false,
    name: "notes-api",
    objectId: "object_local_notes_api_draft_v1",
    organizationId: "org_local",
    principalId: "principal_local_owner",
    projectId: "project_local_notes_api",
  },
  {
    description:
      "Infrastructure-only local project with no application-generation workload.",
    draftId: "draft_local_infrastructure_only",
    infrastructureOnly: true,
    name: "infrastructure-only",
    objectId: "object_local_infrastructure_only_draft_v1",
    organizationId: "org_local",
    principalId: "principal_local_owner",
    projectId: "project_local_infrastructure_only",
  },
  {
    description:
      "Team-owned local project with an explicit user-provided workload contract.",
    draftId: "draft_local_workload",
    infrastructureOnly: false,
    name: "workload",
    objectId: "object_local_workload_draft_v1",
    organizationId: "org_local_team",
    principalId: "principal_local_team_owner",
    projectId: "project_local_workload",
  },
] as const satisfies readonly LocalProjectSeed[];

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function principal(seed: LocalProjectSeed): VerifiedPrincipalContext {
  return {
    correlationId: `correlation_seed_${seed.projectId}`,
    principalId: seed.principalId,
    sessionId: `session_seed_${seed.principalId}`,
  };
}

export function createSeedArchitectureDocument(seed: LocalProjectSeed) {
  return createLocalArchitectureDocument({
    identity: {
      architectureId: `architecture_${seed.projectId}`,
      documentId: `document_${seed.projectId}`,
      draftId: seed.draftId,
      principalId: seed.principalId,
      revisionId: `document_revision_${seed.projectId}_v1`,
    },
    infrastructureOnly: seed.infrastructureOnly,
  });
}

export async function seedLocalProjects(input: {
  readonly objectStore: ObjectStore;
  readonly repository: CloudMarkupRepository;
}): Promise<readonly ProjectRecord[]> {
  const coordinator = new ObjectPublicationCoordinator(
    input.repository,
    input.objectStore,
  );
  const created: ProjectRecord[] = [];

  for (const seed of LOCAL_PROJECT_SEEDS) {
    const verifiedPrincipal = principal(seed);
    const scope = await input.repository.resolveOrganizationScope(
      verifiedPrincipal,
      seed.organizationId,
    );
    if (scope === null) {
      throw new Error(
        `The local project seed principal cannot access ${seed.organizationId}.`,
      );
    }

    const document = createSeedArchitectureDocument(seed);
    const storage = getLocalDocumentStorage(document);
    const request = {
      description: seed.description,
      documentContentSha256: storage.contentSha256,
      name: seed.name,
      organizationId: seed.organizationId,
      projectId: seed.projectId,
    };
    const project = await coordinator.publish(
      scope,
      createDocumentStageInput({
        document,
        objectId: seed.objectId,
        organizationId: seed.organizationId,
        projectId: seed.projectId,
      }),
      (object) =>
        input.repository.createProjectWithInitialDraft(
          scope,
          {
            description: seed.description,
            draft: {
              contentSha256: storage.contentSha256,
              documentSchemaVersion: 3,
              draftId: seed.draftId,
              semanticSha256: storage.semanticSha256,
              visualSha256: storage.visualSha256,
            },
            idempotencyKey: `local-seed-project-${seed.name}-v1`,
            name: seed.name,
            projectId: seed.projectId,
            requestSha256: sha256(request),
          },
          object,
        ),
    );
    created.push(project);
  }

  return created;
}
