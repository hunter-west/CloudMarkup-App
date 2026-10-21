import { Buffer } from "node:buffer";

import type {
  ModelGateway,
  ModelGatewayInvocationContextV1,
} from "@cloudmarkup/model-gateway";
import { modelRepositoryInterpretationRequestV1Schema } from "@cloudmarkup/schemas";
import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import type { GitHubRepositoryInterpretationPort } from "@cloudmarkup/github-repository-export/repository-import";

export const PRIVATE_REPOSITORY_MODEL_CONTENT_POLICY =
  "tenant-isolated-no-cross-tenant-cache-or-training" as const;

export interface GitHubRepositoryModelInvocationAuthority {
  authorize(input: {
    readonly evidenceBytes: number;
    readonly evidenceFiles: number;
    readonly idempotencyDigest: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly privateRepository: boolean;
    readonly projectId: string;
    readonly repositorySnapshotId: string;
    readonly requestedMode: "guided" | "professional";
  }): Promise<{
    readonly context: ModelGatewayInvocationContextV1;
    readonly privateRepositoryContentPolicy: typeof PRIVATE_REPOSITORY_MODEL_CONTENT_POLICY;
  }>;
}

function assertAuthority(
  input: Parameters<GitHubRepositoryInterpretationPort["interpret"]>[0],
  authorized: Awaited<
    ReturnType<GitHubRepositoryModelInvocationAuthority["authorize"]>
  >,
): ModelGatewayInvocationContextV1 {
  const context = authorized.context;
  const privateRepositoryContentPolicy: unknown =
    authorized.privateRepositoryContentPolicy;
  if (
    privateRepositoryContentPolicy !==
      PRIVATE_REPOSITORY_MODEL_CONTENT_POLICY ||
    context.scope.organizationId !== input.organizationId ||
    context.scope.projectId !== input.projectId ||
    context.scope.repositorySnapshotId !== input.repositorySnapshotId ||
    context.scope.userId !== input.principalId ||
    context.requestedMode !== input.requestedMode ||
    context.idempotencyKeyDigest !== input.idempotencyDigest
  ) {
    throw new GitHubExportError("authorization-denied");
  }
  return context;
}

/**
 * Narrow API composition adapter for the single approved repository-analysis
 * operation. It has no repository client, mutation, credential, or cache port.
 */
export function createGitHubRepositoryModelInterpretationPort(options: {
  readonly authority: GitHubRepositoryModelInvocationAuthority;
  readonly gateway: Pick<ModelGateway, "interpretRepositoryEvidence">;
}): GitHubRepositoryInterpretationPort {
  return Object.freeze({
    async interpret(
      input: Parameters<GitHubRepositoryInterpretationPort["interpret"]>[0],
    ) {
      const authorized = await options.authority.authorize({
        evidenceBytes: input.evidence.reduce(
          (total, evidence) =>
            total + Buffer.byteLength(evidence.content, "utf8"),
          0,
        ),
        evidenceFiles: input.evidence.length,
        idempotencyDigest: input.idempotencyDigest,
        organizationId: input.organizationId,
        principalId: input.principalId,
        privateRepository: input.privateRepository,
        projectId: input.projectId,
        repositorySnapshotId: input.repositorySnapshotId,
        requestedMode: input.requestedMode,
      });
      const context = assertAuthority(input, authorized);
      const request = modelRepositoryInterpretationRequestV1Schema.parse({
        commitSha: input.commitSha,
        contractVersion: 1,
        evidence: input.evidence.map((evidence) => ({
          content: evidence.content,
          evidenceId: evidence.evidenceId,
          fileChecksum: evidence.fileChecksum,
          location: evidence.location,
          path: evidence.path,
          redaction: {
            categories: evidence.redacted ? ["secret-candidate" as const] : [],
            noSecretValues: true,
            status: evidence.redacted ? "applied" : "not-required",
          },
        })),
        operation: "repository.interpret",
        repositorySnapshotDigest: input.repositorySnapshotDigest,
        repositorySnapshotId: input.repositorySnapshotId,
        requestedMode: input.requestedMode,
      });
      return (
        await options.gateway.interpretRepositoryEvidence(request, context)
      ).response;
    },
  });
}
