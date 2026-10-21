import { readFile } from "node:fs/promises";

import {
  actorIdSchema,
  architectureDocumentV3Schema,
  assistantOperationBatchV1Schema,
  graphCommandBatchV1Schema,
  externalResourceV1Schema,
  utcTimestampSchema,
  type AssistantOperationV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  AssistantOperationApplicationError,
  applyAssistantOperationBatchV1,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  applyGraphCommand,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
  hashCanonicalValue,
  type AssistantOperationLimitsV1,
  type AssistantOperationTrustedProvenanceV1,
} from "./index.js";

async function representativeDocument() {
  return architectureDocumentV3Schema.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../../test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
}

const limits: AssistantOperationLimitsV1 = {
  maximumApplicationContracts: 64,
  maximumEdges: 64,
  maximumExternalResources: 64,
  maximumNodes: 64,
  maximumOperations: 64,
  maximumSourceOwnershipDeclarations: 64,
  maximumTestScenarios: 64,
  maximumWorkloadOperations: 64,
  maximumWorkloads: 64,
};

const trustedProvenance: AssistantOperationTrustedProvenanceV1 = {
  applicationContract: {
    recordedAt: utcTimestampSchema.parse("2026-08-22T12:00:00.000Z"),
    recordedBy: actorIdSchema.parse("actor_assistant_test"),
    source: "designed",
    sourceReferenceIds: [],
  },
  workload: {
    recordedAt: utcTimestampSchema.parse("2026-08-22T12:00:00.000Z"),
    recordedBy: actorIdSchema.parse("actor_assistant_test"),
    source: "manual",
  },
};

function batch(
  document: Awaited<ReturnType<typeof representativeDocument>>,
  operations: readonly unknown[],
) {
  return assistantOperationBatchV1Schema.parse({
    baseArchitectureDigest: getArchitectureDocumentCanonicalHash(document),
    contractVersion: 1,
    kind: "cloudmarkup.assistant-operation-batch",
    operations,
  });
}

function apply(
  document: Awaited<ReturnType<typeof representativeDocument>>,
  operations: readonly unknown[],
) {
  return applyAssistantOperationBatchV1({
    batch: batch(document, operations),
    document,
    limits,
    provenance: trustedProvenance,
  });
}

function externalResource() {
  return externalResourceV1Schema.parse({
    addresses: [
      {
        addressId: "external_address_api",
        kind: "url",
        value: "https://api.example.test/v1",
      },
    ],
    architectureNodeIds: ["node_worker"],
    availability: { assumption: "unknown" },
    capability: "external.http-api",
    dataClassifications: ["confidential"],
    displayName: "Existing customer API",
    evidence: [],
    extractedCandidates: [],
    id: "external_resource_api",
    interfaces: [
      {
        authentication: { method: "none" },
        contracts: [],
        direction: "bidirectional",
        interfaceId: "external_interface_api",
        protocol: "external.https",
      },
    ],
    lifecycle: {
      behavior: {
        create: "forbidden",
        dataSource: "allowed",
        import: "unsupported",
        reference: "required",
      },
      iacTargets: [{ readiness: "reference-ready", target: "terraform" }],
      lifecycleAuthority: "third-party-owner",
      ownershipState: "third-party-service-api",
    },
    provider: {
      providerId: "external.provider",
      serviceFamily: "external.http-api",
      state: "known",
    },
    scope: { location: "global" },
    trustBoundary: "public-internet",
    unresolvedInformation: [],
  });
}

describe("Prompt 37 deterministic Assistant operation application", () => {
  it("accepts repository content hashes while preserving later layout and checking exact semantic results", async () => {
    const document = await representativeDocument();
    const node = document.nodes.find(
      (entry) => entry.semantic.lifecycle.ownership === "user",
    );
    if (node === undefined) throw new Error("Missing user-owned fixture node.");
    const target = {
      documentId: document.documentId,
      architectureId: document.architectureId,
      revisionId: document.revision.revisionId,
    };
    const graphCommands = graphCommandBatchV1Schema.parse({
      schemaVersion: 1,
      commandId: "command_import_batch",
      inverseCommandId: "command_import_batch_inverse",
      origin: "migration",
      target,
      kind: "batch",
      commands: [
        {
          schemaVersion: 1,
          commandId: "command_import_node",
          inverseCommandId: "command_import_node_inverse",
          origin: "migration",
          target,
          kind: "add-node",
          node: {
            ...node,
            id: "node_import_extra",
            semantic: { ...node.semantic, deploymentKey: "import_extra" },
          },
        },
      ],
    });
    const expected = getArchitectureDocumentContentHash(document);
    const resulting = getArchitectureDocumentContentHash(
      applyGraphCommand(document, graphCommands).document,
    );
    expect(expected).not.toBe(getArchitectureDocumentCanonicalHash(document));
    const operation = {
      kind: "review-repository-difference",
      operationId: "assistant_accept_import",
      decision: "accept",
      observedContentHash: hashCanonicalValue("observed-exact-node"),
      proposalId: "reconciliation_proposal_node",
      rationale: "Accept the exact reviewed node.",
      reconciliationOperation: {
        kind: "accept-observed-graph-change",
        operationId: "reconciliation_accept_node",
        rationale: "Add the reviewed resource.",
        target: {
          kind: "resource",
          observedResourceId: "observed_resource_extra",
          recordDigest: hashCanonicalValue("observed-exact-node"),
        },
        expectedArchitectureContentHash: expected,
        resultingArchitectureContentHash: resulting,
        graphCommands,
      },
    };
    const relocated = architectureDocumentV3Schema.parse({
      ...document,
      nodes: document.nodes.map((entry) => ({
        ...entry,
        presentation: { ...entry.presentation, position: { x: 901, y: 407 } },
      })),
    });
    const before = structuredClone(relocated);
    const accepted = apply(relocated, [operation]);
    expect(getArchitectureDocumentContentHash(accepted.candidate)).toBe(
      resulting,
    );
    expect(
      accepted.candidate.nodes.find((entry) => entry.id === node.id)
        ?.presentation.position,
    ).toEqual({ x: 901, y: 407 });
    for (const field of [
      "expectedArchitectureContentHash",
      "resultingArchitectureContentHash",
    ]) {
      expect(() =>
        apply(relocated, [
          {
            ...operation,
            reconciliationOperation: {
              ...operation.reconciliationOperation,
              [field]: hashCanonicalValue("different"),
            },
          },
        ]),
      ).toThrow(AssistantOperationApplicationError);
    }
    expect(relocated).toEqual(before);
  });

  it("edits only allow-listed Workload fields and preserves graph positions and unrelated configuration", async () => {
    const document = await representativeDocument();
    const original = structuredClone(document);
    const result = apply(document, [
      {
        expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
          document.workloadBehavior,
        ),
        kind: "edit-workload",
        operationId: "assistant_edit_workload",
        patch: {
          executionAssumptions: {
            retry: { kind: "bounded", maximumAttempts: 4 },
            timeout: { kind: "duration", milliseconds: 45_000 },
          },
        },
        rationale: "Increase the reviewed timeout and retry budget.",
        workloadId: "workload_worker",
      },
    ]);

    expect(
      result.candidate.workloadBehavior.workloads[0]?.executionAssumptions,
    ).toEqual({
      retry: { kind: "bounded", maximumAttempts: 4 },
      timeout: { kind: "duration", milliseconds: 45_000 },
    });
    expect(result.candidate.nodes).toEqual(original.nodes);
    expect(result.candidate.edges).toEqual(original.edges);
    expect(document).toEqual(original);
    expect(result.writeAuthority).toBe("none");
  });

  it("adds a bounded behavior operation without replacing the Workload", async () => {
    const document = await representativeDocument();
    const result = apply(document, [
      {
        expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
          document.workloadBehavior,
        ),
        kind: "add-workload-operation",
        operation: {
          capability: "example.workload.health",
          id: "workload_operation_health",
          inputContract: { kind: "none" },
          outputContract: { kind: "none" },
        },
        operationId: "assistant_add_workload_operation",
        rationale: "Add a health operation without changing other behavior.",
        workloadId: "workload_worker",
      },
    ]);

    const workload = result.candidate.workloadBehavior.workloads[0];
    expect(workload?.operations.map(({ id }) => id)).toEqual([
      "workload_operation_handle",
      "workload_operation_health",
    ]);
    expect(workload?.environment).toEqual(
      document.workloadBehavior.workloads[0]?.environment,
    );
  });

  it("adds and edits an External Resource while retaining unrelated design", async () => {
    const document = await representativeDocument();
    const resource = externalResource();
    const added = apply(document, [
      {
        expectedExternalResourcesContentHash:
          getExternalResourceReferenceContentHash(document.externalResources),
        kind: "add-external-resource",
        operationId: "assistant_add_external_resource",
        rationale: "Reference the existing customer API.",
        resource,
      },
    ]);
    const prior = added.candidate.externalResources.resources[0];
    expect(prior?.id).toBe("external_resource_api");
    const edited = apply(added.candidate, [
      {
        expectedExternalResourcesContentHash:
          getExternalResourceReferenceContentHash(
            added.candidate.externalResources,
          ),
        expectedResourceDigest: hashCanonicalValue(prior),
        externalResourceId: "external_resource_api",
        kind: "edit-external-resource",
        operationId: "assistant_edit_external_resource",
        patch: { displayName: "Primary customer API" },
        rationale: "Use the reviewed display name.",
      },
    ]);
    expect(edited.candidate.externalResources.resources[0]?.displayName).toBe(
      "Primary customer API",
    );
    expect(edited.candidate.nodes).toEqual(document.nodes);
    expect(edited.candidate.workloadBehavior).toEqual(
      document.workloadBehavior,
    );
  });

  it("rejects External Resource nested identity or authority replacement during an edit", async () => {
    const document = await representativeDocument();
    const added = apply(document, [
      {
        expectedExternalResourcesContentHash:
          getExternalResourceReferenceContentHash(document.externalResources),
        kind: "add-external-resource",
        operationId: "assistant_add_external_for_identity_test",
        rationale: "Add the reviewed External Resource.",
        resource: externalResource(),
      },
    ]);
    const existing = added.candidate.externalResources.resources[0];
    if (existing === undefined)
      throw new Error("Missing added External Resource.");
    expect(() =>
      apply(added.candidate, [
        {
          expectedExternalResourcesContentHash:
            getExternalResourceReferenceContentHash(
              added.candidate.externalResources,
            ),
          expectedResourceDigest: hashCanonicalValue(existing),
          externalResourceId: existing.id,
          kind: "edit-external-resource",
          operationId: "assistant_replace_external_interface_id",
          patch: {
            interfaces: existing.interfaces.map((externalInterface) => ({
              ...externalInterface,
              interfaceId: "model_selected_replacement_interface",
            })),
          },
          rationale: "Attempt to replace a stable nested identity.",
        },
      ]),
    ).toThrow(AssistantOperationApplicationError);
    expect(added.candidate.externalResources.resources[0]).toEqual(existing);
  });
  it("records extension, repository, and clarification proposals without mutating canonical documents", async () => {
    const document = await representativeDocument();
    const operations: AssistantOperationV1[] =
      assistantOperationBatchV1Schema.parse({
        baseArchitectureDigest: getArchitectureDocumentCanonicalHash(document),
        contractVersion: 1,
        kind: "cloudmarkup.assistant-operation-batch",
        operations: [
          {
            blocking: true,
            evidenceIds: [],
            kind: "request-clarification",
            operationId: "assistant_clarify_runtime",
            question: "Which runtime family should own this handler?",
            questionId: "question_runtime",
            rationale: "Runtime authority is required before generation.",
          },
          {
            extensionRequestId: "extension_worker_handler",
            kind: "upsert-ai-extension-request",
            operationId: "assistant_request_extension",
            ownedPaths: [
              {
                conflictPolicy: "propose-patch",
                path: "application/src/worker.ts",
              },
            ],
            rationale: "Request a bounded custom handler extension.",
            regenerationPolicy: "propose-patch",
            request: {
              acceptanceCriteria: ["The handler passes contract tests."],
              capabilityIds: ["example.workload.handle-event"],
              constraints: ["Preserve user-owned files."],
              objective: "Implement the missing handler behavior.",
              prohibitedCapabilities: ["cloudmarkup.deployment"],
            },
            sourceReferences: [
              { kind: "workload", workloadId: "workload_worker" },
            ],
            target: {
              fileType: "application.typescript",
              kind: "application",
              language: "application.typescript",
              workloadId: "workload_worker",
            },
          },
          {
            decision: "reject",
            kind: "review-repository-difference",
            observedContentHash: hashCanonicalValue("observed-connection"),
            operationId: "assistant_review_repository_difference",
            proposalId: "reconciliation_proposal_connection",
            rationale: "Reject the observed difference after review.",
            reconciliationOperation: {
              kind: "keep-observed-only",
              operationId: "reconciliation_keep_connection_observed",
              rationale: "Keep the imported relationship as evidence only.",
              target: {
                kind: "connection",
                observedConnectionId: "observed_connection_worker_api",
                recordDigest: hashCanonicalValue("observed-connection"),
              },
            },
          },
        ],
      }).operations;
    const result = apply(document, operations);
    expect(result.candidate).toEqual(document);
    expect(result.clarifications).toHaveLength(1);
    expect(result.extensionRequests).toHaveLength(1);
    expect(result.reconciliationReviews).toHaveLength(1);
    expect(result.diffs.map(({ category }) => category)).toEqual([
      "clarification",
      "custom-generation",
      "repository-observation",
    ]);
  });

  it("adds an exact source ownership declaration while preserving user files and unrelated design", async () => {
    const document = await representativeDocument();
    const result = apply(document, [
      {
        action: "add",
        declaration: {
          conflictBehavior: "require-reviewed-resolution",
          declarationId: "ownership_worker_user_file",
          ownerId: "application.user-owner",
          ownership: "user-owned",
          path: "application/src/user-handler.ts",
          pathKind: "file",
          regeneration: "never",
          semanticDiff: { strategy: "structured-language" },
        },
        expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
          document.workloadBehavior,
        ),
        kind: "set-source-ownership",
        operationId: "assistant_add_user_file_ownership",
        rationale: "Preserve the reviewed user-owned handler.",
        workloadId: "workload_worker",
      },
    ]);
    expect(
      result.candidate.workloadBehavior.workloads[0]?.sourceOwnership,
    ).toContainEqual(
      expect.objectContaining({
        declarationId: "ownership_worker_user_file",
        ownership: "user-owned",
        regeneration: "never",
      }),
    );
    expect(result.candidate.nodes).toEqual(document.nodes);
    expect(result.candidate.edges).toEqual(document.edges);
  });
  it("rejects a partially valid atomic batch without changing the source", async () => {
    const document = await representativeDocument();
    const original = structuredClone(document);
    expect(() =>
      apply(document, [
        {
          expectedWorkloadContentHash: getWorkloadBehaviorContentHash(
            document.workloadBehavior,
          ),
          kind: "edit-workload",
          operationId: "assistant_valid_first",
          patch: {
            executionAssumptions: {
              retry: { kind: "none" },
              timeout: { kind: "duration", milliseconds: 25_000 },
            },
          },
          rationale: "First operation is valid.",
          workloadId: "workload_worker",
        },
        {
          expectedExternalResourcesContentHash:
            getExternalResourceReferenceContentHash(document.externalResources),
          expectedResourceDigest:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          externalResourceId: "external_missing",
          kind: "edit-external-resource",
          operationId: "assistant_invalid_second",
          patch: { displayName: "Never applied" },
          rationale: "Second operation is invalid.",
        },
      ]),
    ).toThrow(AssistantOperationApplicationError);
    expect(document).toEqual(original);
  });

  it("rejects stale preconditions, unknown operation fields, and plan-limit overflow", async () => {
    const document = await representativeDocument();
    expect(() =>
      apply(document, [
        {
          expectedWorkloadContentHash:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          kind: "edit-workload",
          operationId: "assistant_stale_workload",
          patch: {
            executionAssumptions: {
              retry: { kind: "none" },
              timeout: { kind: "duration", milliseconds: 20_000 },
            },
          },
          rationale: "This stale edit must fail.",
          workloadId: "workload_worker",
        },
      ]),
    ).toThrow(/changed after this operation was proposed/u);
    expect(() =>
      assistantOperationBatchV1Schema.parse({
        baseArchitectureDigest: getArchitectureDocumentCanonicalHash(document),
        contractVersion: 1,
        kind: "cloudmarkup.assistant-operation-batch",
        operations: [
          {
            kind: "deploy-now",
            operationId: "assistant_forbidden",
            rationale: "Forbidden.",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      applyAssistantOperationBatchV1({
        batch: batch(document, [
          {
            blocking: false,
            evidenceIds: [],
            kind: "request-clarification",
            operationId: "assistant_over_limit",
            question: "Confirm this detail?",
            questionId: "question_limit",
            rationale: "Limit test.",
          },
        ]),
        document,
        limits: { ...limits, maximumOperations: 0 },
        provenance: trustedProvenance,
      }),
    ).toThrow(/operation count exceeds/u);
  });
});
