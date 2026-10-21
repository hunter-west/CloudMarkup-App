import { describe, expect, it } from "vitest";

import { reconciliationProposalV1Schema } from "./reconciliation-proposal-v1.js";
import { normalizeReconciliationProposalV1 } from "./solution-normalization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const graphBatch = {
  schemaVersion: 1,
  commandId: "reconcile_graph_batch",
  inverseCommandId: "reconcile_graph_batch_inverse",
  origin: "user",
  target: {
    documentId: "document_1",
    architectureId: "architecture_1",
    revisionId: "revision_1",
  },
  kind: "batch",
  commands: [
    {
      schemaVersion: 1,
      commandId: "reconcile_move",
      inverseCommandId: "reconcile_move_inverse",
      origin: "user",
      target: {
        documentId: "document_1",
        architectureId: "architecture_1",
        revisionId: "revision_1",
      },
      kind: "move-node",
      nodeId: "node_1",
      expectedPosition: { x: 10, y: 20 },
      position: { x: 30, y: 40 },
    },
  ],
} as const;

const domainOperation = (input: string, result = "9") => ({
  contractId: "cloudmarkup.domain.reconciliation-operation",
  contractVersion: "1.0.0",
  operationId: `domain_operation_${result}`,
  operationDigest: digest("8"),
  expectedInputDigest: input,
  expectedDesignDigest: digest("7"),
  resultingDesignDigest: digest(result),
});

const targets = {
  resource: {
    kind: "resource",
    observedResourceId: "observed_resource_1",
    recordDigest: digest("1"),
  },
  connection: {
    kind: "connection",
    observedConnectionId: "observed_connection_1",
    recordDigest: digest("2"),
  },
  workload: {
    kind: "workload",
    observedWorkloadId: "observed_workload_1",
    recordDigest: digest("3"),
  },
  external: {
    kind: "external-resource",
    candidateId: "external_candidate_1",
    recordDigest: digest("4"),
  },
  generatedFile: {
    kind: "generated-file",
    observedGeneratedFileId: "observed_generated_1",
    recordDigest: digest("5"),
  },
} as const;

const operations = [
  {
    operationId: "operation_accept_graph",
    kind: "accept-observed-graph-change",
    target: targets.resource,
    rationale: "Accept the parsed graph resource after review.",
    expectedArchitectureContentHash: digest("6"),
    resultingArchitectureContentHash: digest("7"),
    graphCommands: graphBatch,
  },
  {
    operationId: "operation_accept_workload",
    kind: "accept-observed-domain-change",
    target: targets.workload,
    rationale: "Accept the observed workload behavior after review.",
    domainOperation: domainOperation(targets.workload.recordDigest),
  },
  {
    operationId: "operation_keep_observed",
    kind: "keep-observed-only",
    target: targets.connection,
    rationale: "Retain this relationship as evidence without changing design.",
  },
  {
    operationId: "operation_external",
    kind: "mark-intentionally-external",
    target: targets.external,
    rationale: "The service is owned and managed by a third party.",
    ownershipState: "third-party-service-api",
    domainOperation: domainOperation(targets.external.recordDigest),
  },
  {
    operationId: "operation_regenerate",
    kind: "update-generated-output-to-design",
    target: targets.generatedFile,
    rationale: "Regenerate only from the approved design and exact manifest.",
    action: "regenerate-from-approved-design",
    expectedDesignDigest: digest("6"),
    expectedRepositoryManifestDigest: digest("7"),
    generator: {
      id: "cloudmarkup.application-generator",
      version: "1.0.0",
      digest: digest("8"),
    },
  },
  {
    operationId: "operation_ignore",
    kind: "ignore-observation",
    target: targets.connection,
    rationale: "Ignore this known test-only relationship until it is removed.",
    expiresAt: "2026-09-14T12:00:00.000Z",
  },
  {
    operationId: "operation_mapping",
    kind: "resolve-ambiguous-mapping",
    target: targets.resource,
    rationale: "Select the reviewed stable design identity.",
    candidates: [
      {
        mappingId: "mapping_1",
        observedTarget: targets.resource,
        designTarget: { kind: "architecture-node", nodeId: "node_1" },
        confidenceBasisPoints: 8_000,
        evidenceIds: ["evidence_1"],
      },
      {
        mappingId: "mapping_2",
        observedTarget: targets.resource,
        designTarget: { kind: "architecture-node", nodeId: "node_2" },
        confidenceBasisPoints: 6_000,
        evidenceIds: ["evidence_2"],
      },
    ],
    selectedMappingId: "mapping_1",
    domainOperation: domainOperation(targets.resource.recordDigest),
  },
  {
    operationId: "operation_remove_stale",
    kind: "remove-stale-imported-evidence",
    target: targets.resource,
    rationale: "Remove evidence superseded by the exact newer snapshot.",
    staleEvidenceIds: ["evidence_stale"],
    staleSince: "2026-08-01T12:00:00.000Z",
    expectedObservedContentHash: digest("a"),
    resultingObservedContentHash: digest("b"),
    domainOperation: {
      ...domainOperation(digest("a"), "b"),
      operationId: "domain_operation_remove_stale",
    },
  },
] as const;

const proposal = {
  contractVersion: 1,
  kind: "cloudmarkup.reconciliation-proposal",
  proposalId: "proposal_1",
  authority: "proposal-only",
  applyPolicy: "explicit-review-and-deterministic-operation",
  repositorySnapshotId: "snapshot_1",
  repositorySnapshotDigest: digest("c"),
  observedSolutionId: "observed_solution_1",
  observedContentHash: digest("d"),
  provenance: {
    actor: {
      kind: "deterministic-tool",
      tool: {
        id: "cloudmarkup.reconciliation-engine",
        version: "1.0.0",
        digest: digest("e"),
      },
    },
    createdAt: "2026-08-14T12:00:00.000Z",
    inputDigests: [digest("c"), digest("d")],
  },
  operations,
  review: { state: "pending-review" },
} as const;

describe("Reconciliation Proposal v1 schema", () => {
  it("covers every requested explicit reconciliation outcome", () => {
    const parsed = reconciliationProposalV1Schema.parse(proposal);
    expect(parsed.operations.map((operation) => operation.kind)).toEqual([
      "accept-observed-graph-change",
      "accept-observed-domain-change",
      "keep-observed-only",
      "mark-intentionally-external",
      "update-generated-output-to-design",
      "ignore-observation",
      "resolve-ambiguous-mapping",
      "remove-stale-imported-evidence",
    ]);
  });

  it("requires graph acceptance to use an atomic Graph Command v1 batch", () => {
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        operations: [
          {
            ...operations[0],
            graphCommands: graphBatch.commands[0],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds workload, external, mapping, and evidence changes to exact inputs", () => {
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        operations: [
          {
            ...operations[1],
            domainOperation: {
              ...operations[1].domainOperation,
              expectedInputDigest: digest("f"),
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        operations: [
          { ...operations[6], selectedMappingId: "missing_mapping" },
        ],
      }).success,
    ).toBe(false);
  });

  it("keeps proposals non-authoritative and rejects executable callbacks", () => {
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        authority: "apply-directly",
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        shellCommand: "git merge",
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        operations: [
          {
            ...operations[1],
            domainOperation: {
              ...operations[1].domainOperation,
              callback: "applyWithoutReview",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires reviewed operation decisions to be unique and exhaustive", () => {
    const allOperationIds = operations.map(
      (operation) => operation.operationId,
    );
    const acceptedReview = {
      state: "accepted",
      reviewedBy: "actor_1",
      reviewedAt: "2026-08-14T13:00:00.000Z",
    } as const;

    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: {
          ...acceptedReview,
          acceptedOperationIds: ["missing_operation"],
        },
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: {
          ...acceptedReview,
          acceptedOperationIds: [operations[0].operationId],
        },
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: { ...acceptedReview, acceptedOperationIds: allOperationIds },
      }).success,
    ).toBe(true);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: {
          ...acceptedReview,
          acceptedOperationIds: [...allOperationIds, allOperationIds[0]],
        },
      }).success,
    ).toBe(false);

    const [acceptedOperationId, ...rejectedOperationIds] = allOperationIds;
    const firstRejectedOperationId = rejectedOperationIds[0];
    if (
      acceptedOperationId === undefined ||
      firstRejectedOperationId === undefined
    ) {
      throw new Error(
        "The reconciliation fixture must contain two operations.",
      );
    }
    const partialReview = {
      state: "partially-accepted",
      reviewedBy: "actor_1",
      reviewedAt: "2026-08-14T13:00:00.000Z",
      acceptedOperationIds: [acceptedOperationId],
      rejectedOperationIds,
      reason: "Only one observed change is accepted.",
    } as const;

    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: partialReview,
      }).success,
    ).toBe(true);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: {
          ...partialReview,
          rejectedOperationIds: [acceptedOperationId, ...rejectedOperationIds],
        },
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: {
          ...partialReview,
          rejectedOperationIds: rejectedOperationIds.slice(1),
        },
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        review: {
          ...partialReview,
          rejectedOperationIds: [
            ...rejectedOperationIds,
            firstRejectedOperationId,
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects future versions and unknown fields", () => {
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        contractVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      reconciliationProposalV1Schema.safeParse({
        ...proposal,
        repositoryCredential: "forbidden",
      }).success,
    ).toBe(false);
  });
});

describe("Reconciliation Proposal v1 canonical normalization", () => {
  it("sorts proposal operations and reviewable evidence while preserving command order", () => {
    const parsed = reconciliationProposalV1Schema.parse(proposal);
    const reordered = reconciliationProposalV1Schema.parse({
      ...parsed,
      provenance: {
        ...parsed.provenance,
        inputDigests: [...parsed.provenance.inputDigests].reverse(),
      },
      operations: [...parsed.operations].reverse().map((operation) => {
        if (operation.kind === "resolve-ambiguous-mapping") {
          return {
            ...operation,
            candidates: [...operation.candidates]
              .reverse()
              .map((candidate) => ({
                ...candidate,
                evidenceIds: [...candidate.evidenceIds].reverse(),
              })),
          };
        }
        if (operation.kind === "remove-stale-imported-evidence") {
          return {
            ...operation,
            staleEvidenceIds: [...operation.staleEvidenceIds].reverse(),
          };
        }
        return operation;
      }),
    });
    const before = JSON.stringify(reordered);
    const normalized = normalizeReconciliationProposalV1(reordered);

    expect(normalized).toEqual(normalizeReconciliationProposalV1(parsed));
    expect(
      normalized.operations
        .find((operation) => operation.kind === "accept-observed-graph-change")
        ?.graphCommands.commands.map((command) => command.commandId),
    ).toEqual(graphBatch.commands.map((command) => command.commandId));
    expect(JSON.stringify(reordered)).toBe(before);
  });
});
