import type { ModelGateway } from "@cloudmarkup/model-gateway";
import { modelTestContext } from "@cloudmarkup/model-gateway/testing";
import {
  modelRepositoryInterpretationResponseV1Schema,
  repositorySnapshotIdSchema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  createGitHubRepositoryModelInterpretationPort,
  PRIVATE_REPOSITORY_MODEL_CONTENT_POLICY,
  type GitHubRepositoryModelInvocationAuthority,
} from "./github-import-model.js";

const digest = sha256DigestSchema.parse(`sha256:${"a".repeat(64)}`);
const snapshotId = repositorySnapshotIdSchema.parse(
  "repository_snapshot_model_adapter",
);

function context() {
  const base = modelTestContext("invocation_repository_import_adapter");
  return {
    ...base,
    idempotencyKeyDigest: digest,
    requestedMode: "professional" as const,
    scope: {
      ...base.scope,
      organizationId: "organization.1",
      projectId: "project.1",
      repositorySnapshotId: snapshotId,
      userId: "principal.1",
    },
  };
}

const input = {
  commitSha: "b".repeat(40),
  evidence: [
    {
      content: "const token=[REDACTED];\nexport const handler = () => table;",
      evidenceId: "evidence.application.connection",
      fileChecksum: digest,
      location: { endLine: 2, startLine: 1 },
      path: "application/index.ts",
      redacted: true,
    },
  ],
  idempotencyDigest: digest,
  organizationId: "organization.1",
  principalId: "principal.1",
  privateRepository: true,
  projectId: "project.1",
  repositorySnapshotDigest: digest,
  repositorySnapshotId: snapshotId,
  requestedMode: "professional" as const,
};

const response = modelRepositoryInterpretationResponseV1Schema.parse({
  claims: [
    {
      category: "connection",
      claimId: "claim.application.connection",
      confidence: {
        basisPoints: 7_500,
        evidenceReferences: [
          {
            digest,
            kind: "repository-evidence",
            location: { endLine: 2, startLine: 1 },
            path: "application/index.ts",
            referenceId: "evidence.application.connection",
          },
        ],
        rationale:
          "The source reference is explicit but ownership is unresolved.",
      },
      evidenceReferences: [
        {
          digest,
          kind: "repository-evidence",
          location: { endLine: 2, startLine: 1 },
          path: "application/index.ts",
          referenceId: "evidence.application.connection",
        },
      ],
      summary: "The handler appears to use the imported table.",
    },
  ],
  contractVersion: 1,
  operation: "repository.interpret",
  proposalContext: {
    assumptions: [],
    confidence: {
      basisPoints: 7_500,
      evidenceReferences: [],
      rationale: "Grounded in the selected sanitized excerpt.",
    },
    unknowns: [],
  },
  provenance: {
    contractVersion: 1,
    gatewayId: "cloudmarkup.model-gateway",
    inputDigest: digest,
    invocationId: "invocation_repository_import_adapter",
    modelId: "cloudmarkup.fake",
    modelVersion: "1",
    ownership: "untrusted-proposal",
    promptDigest: digest,
    promptTemplateId: "cloudmarkup.prompt.repository-interpretation",
    promptVersion: "1.0.0",
    providerId: "cloudmarkup.fake-provider",
  },
});

function authority(
  authorizedContext = context(),
): GitHubRepositoryModelInvocationAuthority {
  return {
    authorize: () =>
      Promise.resolve({
        context: authorizedContext,
        privateRepositoryContentPolicy: PRIVATE_REPOSITORY_MODEL_CONTENT_POLICY,
      }),
  };
}

describe("GitHub repository model interpretation adapter", () => {
  it("calls only the approved repository operation with sanitized exact-snapshot evidence", async () => {
    const interpretRepositoryEvidence = vi.fn<
      ModelGateway["interpretRepositoryEvidence"]
    >(() => Promise.resolve({ response } as never));
    const gateway = {
      interpretRepositoryEvidence,
    } satisfies Pick<ModelGateway, "interpretRepositoryEvidence">;
    const adapter = createGitHubRepositoryModelInterpretationPort({
      authority: authority(),
      gateway,
    });

    await expect(adapter.interpret(input)).resolves.toEqual(response);
    expect(interpretRepositoryEvidence).toHaveBeenCalledTimes(1);
    const gatewayCall = interpretRepositoryEvidence.mock.calls[0];
    if (gatewayCall === undefined) {
      throw new Error("Repository interpretation gateway was not called.");
    }
    const [gatewayRequest, gatewayContext] = gatewayCall;
    expect(gatewayRequest).toMatchObject({
      commitSha: input.commitSha,
      operation: "repository.interpret",
      repositorySnapshotDigest: digest,
      repositorySnapshotId: snapshotId,
    });
    expect(gatewayContext).toMatchObject({
      idempotencyKeyDigest: digest,
      scope: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        repositorySnapshotId: snapshotId,
        userId: input.principalId,
      },
    });
    expect(gatewayRequest.evidence[0]?.content).not.toContain("secret-value");
    expect(gatewayRequest.evidence[0]?.redaction).toEqual({
      categories: ["secret-candidate"],
      noSecretValues: true,
      status: "applied",
    });
  });

  it("fails closed when trusted model authority does not match the tenant snapshot", async () => {
    const bad = context();
    const interpretRepositoryEvidence = vi.fn<
      ModelGateway["interpretRepositoryEvidence"]
    >(() => Promise.resolve({ response } as never));
    const adapter = createGitHubRepositoryModelInterpretationPort({
      authority: authority({
        ...bad,
        scope: { ...bad.scope, projectId: "project.other" },
      }),
      gateway: { interpretRepositoryEvidence },
    });
    await expect(adapter.interpret(input)).rejects.toMatchObject({
      code: "authorization-denied",
    });
    expect(interpretRepositoryEvidence).not.toHaveBeenCalled();
  });
});
