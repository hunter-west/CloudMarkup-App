import {
  activeIssueIdSchema,
  configurationKeySchema,
  modelApplicationSourceGenerationRequestV1Schema,
  modelCandidateRepairRequestV1Schema,
  modelGatewayResponseV1Schema,
  modelOperationProposalRequestV1Schema,
  solutionRevisionManifestV1Schema,
  workloadIdSchema,
  type ModelGatewayRequestV1,
  type ModelGatewayResponseV1,
  type ModelInvocationDescriptorV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  ModelGatewayValidationError,
  digestStructuredValue,
  sha256Text,
  validateModelResponseAuthority,
} from "./security.js";
import {
  TEST_DIGEST,
  modelTestRequests,
  testArchitecture,
  testCatalogConfigurationValidation,
  testCandidateBoundary,
  testSolutionRevision,
  testValidationExpectations,
} from "./test-helpers.js";

const descriptor = {
  inferenceProfileId: "profile.p2-test",
  inputDigest: TEST_DIGEST,
  invocationId: "invocation_p2_test",
  modelId: "model.p2-test",
  modelVersion: "1",
  promptDigest: TEST_DIGEST,
  promptTemplateId: "prompt.p2-test",
  promptVersion: "1.0.0",
  providerId: "provider.p2-test",
} as ModelInvocationDescriptorV1;

const provenance = {
  contractVersion: 1 as const,
  gatewayId: "cloudmarkup.model-gateway",
  inferenceProfileId: descriptor.inferenceProfileId,
  inputDigest: descriptor.inputDigest,
  invocationId: descriptor.invocationId,
  modelId: descriptor.modelId,
  modelVersion: descriptor.modelVersion,
  ownership: "untrusted-proposal" as const,
  promptDigest: descriptor.promptDigest,
  promptTemplateId: descriptor.promptTemplateId,
  promptVersion: descriptor.promptVersion,
  providerId: descriptor.providerId,
};

const proposalContext = {
  assumptions: [],
  confidence: {
    basisPoints: 10_000,
    evidenceReferences: [],
    rationale: "Exact P2 grounding fixture.",
  },
  unknowns: [],
};

const allowedApprovalPathIds = new Set(["cloudmarkup.dependency-review.v1"]);

function validate(
  request: ModelGatewayRequestV1,
  response: ModelGatewayResponseV1,
): void {
  validateModelResponseAuthority({
    allowedApprovalPathIds,
    descriptor,
    request,
    response,
  });
}

function expectDenied(
  request: ModelGatewayRequestV1,
  response: ModelGatewayResponseV1,
  code: string,
): void {
  try {
    validate(request, response);
    throw new Error("Expected authority validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ModelGatewayValidationError);
    expect((error as ModelGatewayValidationError).code).toBe(code);
  }
}

function requestFor<Operation extends ModelGatewayRequestV1["operation"]>(
  operation: Operation,
): Extract<ModelGatewayRequestV1, { operation: Operation }> {
  const request = modelTestRequests().find(
    (candidate) => candidate.operation === operation,
  );
  if (request === undefined) {
    throw new Error(
      "Missing ModelGateway request fixture for " + operation + ".",
    );
  }
  return request as Extract<ModelGatewayRequestV1, { operation: Operation }>;
}

function operationRequest() {
  const source = testArchitecture.nodes.find(
    (node) => node.id === "node_source",
  );
  const worker = testArchitecture.nodes.find(
    (node) => node.id === "node_worker",
  );
  if (source === undefined || worker === undefined) {
    throw new Error("Representative nodes are missing.");
  }
  return modelOperationProposalRequestV1Schema.parse({
    architecture: testArchitecture,
    catalogGrounding: {
      catalog: testArchitecture.catalog,
      connectionRules: [
        {
          configurationSchemaId: "example.relationship.invokes-config",
          configurationSchemaVersion: "1.0.0",
          configurationValidation: testCatalogConfigurationValidation(
            "example.relationship.invokes-config",
            "1.0.0",
          ),
          relationshipType: "example.relationship.invokes",
          ruleId: "example.rule.invokes",
          ruleVersion: "1.0.0",
          source: {
            port: "example.port.event",
            serviceType: source.semantic.serviceType,
          },
          target: {
            port: "example.port.invocation",
            serviceType: worker.semantic.serviceType,
          },
        },
        {
          configurationSchemaId: "example.relationship.writes-config",
          configurationSchemaVersion: "1.0.0",
          configurationValidation: testCatalogConfigurationValidation(
            "example.relationship.writes-config",
            "1.0.0",
          ),
          relationshipType: "example.relationship.writes",
          ruleId: "example.rule.writes",
          ruleVersion: "1.0.0",
          source: {
            port: "example.port.data-write",
            serviceType: worker.semantic.serviceType,
          },
          target: {
            port: "example.port.data",
            serviceType: source.semantic.serviceType,
          },
        },
      ],
      manifestVersion: 1,
      nodes: [
        {
          configurationSchemaId: source.semantic.configuration.schemaId,
          configurationSchemaVersion:
            source.semantic.configuration.schemaVersion,
          configurationValidation: testCatalogConfigurationValidation(
            source.semantic.configuration.schemaId,
            source.semantic.configuration.schemaVersion,
          ),
          placement: {
            allowedParentTypes: [
              {
                relationshipType: "example.relationship.contains",
                serviceType: worker.semantic.serviceType,
              },
            ],
            maximumDepth: 2,
            rootPlacement: "allowed",
          },
          ports: [
            { direction: "output", port: "example.port.event" },
            { direction: "input", port: "example.port.data" },
          ],
          resourceType: source.semantic.resourceType,
          serviceType: source.semantic.serviceType,
        },
        {
          configurationSchemaId: worker.semantic.configuration.schemaId,
          configurationSchemaVersion:
            worker.semantic.configuration.schemaVersion,
          configurationValidation: testCatalogConfigurationValidation(
            worker.semantic.configuration.schemaId,
            worker.semantic.configuration.schemaVersion,
          ),
          placement: {
            allowedParentTypes: [],
            maximumDepth: 1,
            rootPlacement: "allowed",
          },
          ports: [
            { direction: "input", port: "example.port.invocation" },
            { direction: "output", port: "example.port.data-write" },
          ],
          resourceType: worker.semantic.resourceType,
          serviceType: worker.semantic.serviceType,
        },
      ],
    },
    contractVersion: 1,
    operation: "operations.propose",
    requestedMode: "guided",
  });
}

function operationBatchesResponse(batches: readonly unknown[]) {
  return modelGatewayResponseV1Schema.parse({
    batches,
    contractVersion: 1,
    operation: "operations.propose",
    proposalContext,
    provenance,
  });
}

function operationResponse(command: unknown) {
  return operationBatchesResponse([
    {
      batch: {
        commandId: "batch_p2_test",
        commands: [command],
        inverseCommandId: "batch_p2_inverse_test",
        kind: "batch",
        origin: "ai-accepted",
        schemaVersion: 1,
        target: {
          architectureId: testArchitecture.architectureId,
          documentId: testArchitecture.documentId,
          revisionId: testArchitecture.revision.revisionId,
        },
      },
      kind: "graph",
    },
  ]);
}

function graphEnvelope(id: string) {
  return {
    commandId: id,
    inverseCommandId: `${id}_inverse`,
    origin: "ai-accepted" as const,
    schemaVersion: 1 as const,
    target: {
      architectureId: testArchitecture.architectureId,
      documentId: testArchitecture.documentId,
      revisionId: testArchitecture.revision.revisionId,
    },
  };
}

function generationRequest() {
  const revision = solutionRevisionManifestV1Schema.parse(testSolutionRevision);
  const ownership = revision.sourceOwnership[0];
  if (ownership === undefined) throw new Error("Ownership fixture is missing.");
  return modelApplicationSourceGenerationRequestV1Schema.parse({
    acceptanceCriteria: ["Remain inside the exact candidate boundary."],
    architecture: testArchitecture,
    boundary: testCandidateBoundary,
    contractVersion: 1,
    operation: "application-source.generate",
    requestedMode: "guided",
    solutionRevision: revision,
    sourceOwnershipAuthority: {
      authority: "solution-revision-candidate-generation",
      candidateRoots: ["application"],
      canonicalization:
        "cloudmarkup.solution-source-ownership.canonical-json.v1",
      ownedPaths: testCandidateBoundary.ownedPaths,
      solutionRevisionId: revision.solutionRevisionId,
      sourceOwnership: [ownership],
    },
    sourceReferences: [{ kind: "workload", referenceId: "workload_worker" }],
    validationExpectations: testValidationExpectations,
    workloadId: "workload_worker",
  });
}

function candidateResponse(
  request: ReturnType<typeof generationRequest>,
  content = "// exact generated candidate\n",
): Extract<
  ModelGatewayResponseV1,
  { operation: "application-source.generate" }
> {
  const response = modelGatewayResponseV1Schema.parse({
    candidateBundle: {
      boundary: request.boundary,
      candidates: [
        {
          candidateId: "candidate_p2_generation",
          content,
          contentDigest: sha256Text(content),
          encoding: "utf-8",
          kind: "file",
          ownership: "ai-authored-candidate",
          path: request.boundary.ownedPaths[0],
        },
      ],
      dependencies: [],
      generationPlan: {
        objective: "Generate one exact candidate.",
        planId: "plan_p2_generation",
        steps: [
          {
            action: "create-file",
            rationale: "Exercise exact generation authority.",
            sourceReferences: request.sourceReferences,
            stepId: "step_p2_generation",
            targetPath: request.boundary.ownedPaths[0],
          },
        ],
      },
      provenance,
      validationExpectations: request.validationExpectations,
    },
    contractVersion: 1,
    operation: "application-source.generate",
    proposalContext,
    provenance,
  });
  if (response.operation !== "application-source.generate") {
    throw new Error("Application generation response fixture is invalid.");
  }
  return response;
}

function fixResponse(
  request: Extract<ModelGatewayRequestV1, { operation: "fix.propose" }>,
): Extract<ModelGatewayResponseV1, { operation: "fix.propose" }> {
  const path = request.boundary.ownedPaths[0];
  if (path === undefined) throw new Error("Fix candidate path is missing.");
  const content = "// exact fix candidate\n";
  const parsedResponse = modelGatewayResponseV1Schema.parse({
    candidateBundle: {
      boundary: request.boundary,
      candidates: [
        {
          candidateId: "candidate_p2_fix",
          content,
          contentDigest: sha256Text(content),
          encoding: "utf-8",
          kind: "file",
          ownership: "ai-authored-candidate",
          path,
        },
      ],
      dependencies: [],
      generationPlan: {
        objective: "Propose one exact issue-bound fix candidate.",
        planId: "plan_p2_fix",
        steps: [
          {
            action: "create-file",
            rationale: "Bind the candidate to the exact requested issue.",
            sourceReferences: [
              {
                digest: request.issue.currentRecordDigest,
                kind: "active-issue",
                referenceId: request.issue.id,
              },
            ],
            stepId: "step_p2_fix",
            targetPath: path,
          },
        ],
      },
      provenance,
      validationExpectations: request.validationExpectations,
    },
    contractVersion: 1,
    issueId: request.issue.id,
    operation: "fix.propose",
    proposalContext,
    provenance,
  });
  if (parsedResponse.operation !== "fix.propose") {
    throw new Error("Fix proposal response fixture is invalid.");
  }
  return parsedResponse;
}

function repairFixture() {
  const failedContent = "// failed exact candidate\n";
  const failedCandidates = [
    {
      candidateId: "candidate_p2_failed",
      content: failedContent,
      contentDigest: sha256Text(failedContent),
      encoding: "utf-8" as const,
      kind: "file" as const,
      ownership: "ai-authored-candidate" as const,
      path: "application/fake.ts",
    },
  ];
  const request = modelCandidateRepairRequestV1Schema.parse({
    boundary: testCandidateBoundary,
    contractVersion: 1,
    currentAttempt: 1,
    diagnostics: [
      {
        candidateId: "candidate_p2_failed",
        checkKind: "parse",
        diagnosticId: "diagnostic_p2_test",
        message: "The exact candidate failed parsing.",
        noSecretValues: true,
        path: "application/fake.ts",
        redactionStatus: "not-required",
        toolId: "cloudmarkup.test-parser",
        toolVersion: "1.0.0",
      },
    ],
    failedCandidates,
    failedCandidatesCanonicalization:
      "cloudmarkup.model-failed-candidates.canonical-json.v1",
    failedOutputDigest: digestStructuredValue(failedCandidates),
    maximumRepairAttempts: 2,
    operation: "candidate.repair",
    requestedMode: "guided",
    validationExpectations: testValidationExpectations,
  });
  const repairedContent = "// repaired exact candidate\n";
  const parsedResponse = modelGatewayResponseV1Schema.parse({
    candidateBundle: {
      boundary: request.boundary,
      candidates: [
        {
          candidateId: "candidate_p2_repaired",
          content: repairedContent,
          contentDigest: sha256Text(repairedContent),
          encoding: "utf-8",
          kind: "file",
          ownership: "ai-authored-candidate",
          path: "application/fake.ts",
          priorDigest: failedCandidates[0]?.contentDigest,
        },
      ],
      dependencies: [],
      generationPlan: {
        objective: "Repair the exact diagnosed candidate.",
        planId: "plan_p2_repair",
        steps: [
          {
            action: "replace-owned-file",
            rationale: "Apply only the diagnosed repair.",
            sourceReferences: [
              {
                digest: request.failedOutputDigest,
                kind: "candidate-artifact",
                referenceId: "candidate_p2_failed",
              },
            ],
            stepId: "step_p2_repair",
            targetPath: "application/fake.ts",
          },
        ],
      },
      provenance,
      validationExpectations: request.validationExpectations,
    },
    contractVersion: 1,
    operation: "candidate.repair",
    proposalContext,
    provenance,
    repairedFromDigest: request.failedOutputDigest,
    resolvedDiagnosticIds: ["diagnostic_p2_test"],
  });
  if (parsedResponse.operation !== "candidate.repair") {
    throw new Error("Repair response fixture is invalid.");
  }
  const response = parsedResponse;
  return { failedCandidates, request, response };
}

describe("ModelGateway P2 grounding contracts", () => {
  it("binds an exact fix response to the requested issue ID", () => {
    const request = requestFor("fix.propose");
    const response = fixResponse(request);
    validate(request, response);
    expectDenied(
      request,
      {
        ...response,
        issueId: activeIssueIdSchema.parse("issue_p2_invented"),
      },
      "model-gateway.issue-mismatch",
    );
  });

  it("rejects duplicate architecture candidate IDs across proposal kinds", () => {
    const request = requestFor("architecture.propose");
    const serviceId = request.catalog.allowedServiceIds[0];
    const relationshipType = request.catalog.allowedRelationshipTypes[0];
    if (serviceId === undefined || relationshipType === undefined) {
      throw new Error("Architecture allowlist fixture is incomplete.");
    }
    const sourceCandidateId = "service_candidate_p2_source";
    const targetCandidateId = "service_candidate_p2_target";
    const responseWithRelationshipId = (
      candidateId: string,
    ): Extract<
      ModelGatewayResponseV1,
      { operation: "architecture.propose" }
    > => {
      const parsed = modelGatewayResponseV1Schema.parse({
        contractVersion: 1,
        operation: "architecture.propose",
        proposalContext,
        provenance,
        relationships: [
          {
            candidateId,
            rationale: "Connect the two exact catalog candidates.",
            relationshipType,
            sourceCandidateId,
            targetCandidateId,
          },
        ],
        services: [
          {
            candidateId: sourceCandidateId,
            capability: "cloudmarkup.p2-source-capability",
            catalogServiceId: serviceId,
            evidenceReferences: [],
            rationale: "Propose the exact allow-listed source service.",
          },
          {
            candidateId: targetCandidateId,
            capability: "cloudmarkup.p2-target-capability",
            catalogServiceId: serviceId,
            evidenceReferences: [],
            rationale: "Propose the exact allow-listed target service.",
          },
        ],
      });
      if (parsed.operation !== "architecture.propose") {
        throw new Error("Architecture proposal response fixture is invalid.");
      }
      return parsed;
    };

    validate(
      request,
      responseWithRelationshipId("relationship_candidate_p2_unique"),
    );
    expectDenied(
      request,
      responseWithRelationshipId(sourceCandidateId),
      "model-gateway.ambiguous-architecture-candidate",
    );
    const firstRelationship = responseWithRelationshipId(
      "relationship_candidate_p2_first",
    );
    const relationship = firstRelationship.relationships[0];
    if (relationship === undefined) {
      throw new Error("Architecture relationship fixture is missing.");
    }
    const chainedRelationship = modelGatewayResponseV1Schema.parse({
      ...firstRelationship,
      relationships: [
        ...firstRelationship.relationships,
        {
          ...relationship,
          candidateId: "relationship_candidate_p2_chained",
          sourceCandidateId: "relationship_candidate_p2_first",
        },
      ],
    });
    if (chainedRelationship.operation !== "architecture.propose") {
      throw new Error("Architecture proposal response fixture is invalid.");
    }
    expectDenied(
      request,
      chainedRelationship,
      "model-gateway.unknown-relationship",
    );
  });

  it("rejects duplicate workload candidate IDs", () => {
    const request = requestFor("workload.propose");
    const owningNodeId = request.architecture.nodes[0]?.id;
    if (owningNodeId === undefined) {
      throw new Error("Workload owner fixture is missing.");
    }
    const workload = {
      candidateId: "workload_candidate_p2_duplicate",
      implementationMode: "infrastructure-only",
      owningNodeId,
      responsibilities: ["Exercise exact workload candidate identity."],
      sourceReferences: [
        { kind: "architecture-node", referenceId: owningNodeId },
      ],
    };
    const responseWithWorkloads = (workloads: readonly unknown[]) =>
      modelGatewayResponseV1Schema.parse({
        contractVersion: 1,
        operation: "workload.propose",
        proposalContext,
        provenance,
        workloads,
      });

    validate(request, responseWithWorkloads([workload]));
    expectDenied(
      request,
      responseWithWorkloads([
        workload,
        {
          ...workload,
          responsibilities: ["Attempt to reuse the same candidate identity."],
        },
      ]),
      "model-gateway.ambiguous-workload-candidate",
    );
  });

  it("requires a unique catalog manifest bound to the exact Architecture catalog", () => {
    const request = operationRequest();
    expect(request.catalogGrounding.catalog).toEqual(testArchitecture.catalog);
    expect(
      modelOperationProposalRequestV1Schema.safeParse({
        ...request,
        catalogGrounding: {
          ...request.catalogGrounding,
          catalog: {
            ...request.catalogGrounding.catalog,
            digest: TEST_DIGEST,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      modelOperationProposalRequestV1Schema.safeParse({
        ...request,
        catalogGrounding: {
          ...request.catalogGrounding,
          nodes: [
            request.catalogGrounding.nodes[0],
            request.catalogGrounding.nodes[0],
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("binds node-reference fields to exact target service and attribute tuples", () => {
    const base = operationRequest();
    const source = base.architecture.nodes.find(
      (node) => node.id === "node_source",
    );
    const target = base.architecture.nodes.find(
      (node) => node.id === "node_worker",
    );
    if (source === undefined || target === undefined) {
      throw new Error("Representative node-reference fixtures are missing.");
    }
    const sourceAuthority = base.catalogGrounding.nodes.find(
      (authority) => authority.serviceType === source.semantic.serviceType,
    );
    if (sourceAuthority === undefined) {
      throw new Error("Source catalog authority is missing.");
    }
    const field = "endpointReference";
    const exactAttribute = "example.attribute.endpoint";
    const exactAuthority = {
      attribute: exactAttribute,
      serviceType: target.semantic.serviceType,
    } as const;
    const createRequest = (
      nodeId: string,
      attribute: string,
      nodeReferenceAuthorities: Readonly<
        Record<
          string,
          readonly {
            readonly attribute: string;
            readonly serviceType: string;
          }[]
        >
      > = {
        [field]: [exactAuthority],
      },
    ) => {
      const jsonSchema = {
        ...sourceAuthority.configurationValidation.jsonSchema,
        properties: {
          ...sourceAuthority.configurationValidation.jsonSchema.properties,
          [field]: { type: "string" as const },
        },
        required: [
          ...sourceAuthority.configurationValidation.jsonSchema.required,
          field,
        ],
      };
      const valueSources = {
        ...sourceAuthority.configurationValidation.valueSources,
        [field]: "node-reference" as const,
      };
      const configurationValidation = {
        ...sourceAuthority.configurationValidation,
        jsonSchema,
        nodeReferenceAuthorities,
        schemaDigest: digestStructuredValue({
          canonicalization:
            sourceAuthority.configurationValidation.canonicalization,
          jsonSchema,
          nodeReferenceAuthorities,
          schemaId: sourceAuthority.configurationSchemaId,
          schemaVersion: sourceAuthority.configurationSchemaVersion,
          valueSources,
        }),
        valueSources,
      };
      return modelOperationProposalRequestV1Schema.parse({
        ...base,
        architecture: {
          ...base.architecture,
          nodes: base.architecture.nodes.map((node) =>
            node.id === source.id
              ? {
                  ...node,
                  semantic: {
                    ...node.semantic,
                    configuration: {
                      ...node.semantic.configuration,
                      values: {
                        ...node.semantic.configuration.values,
                        [field]: {
                          attribute,
                          kind: "node-reference",
                          nodeId,
                        },
                      },
                    },
                  },
                }
              : node,
          ),
        },
        catalogGrounding: {
          ...base.catalogGrounding,
          nodes: base.catalogGrounding.nodes.map((authority) =>
            authority.serviceType === source.semantic.serviceType
              ? { ...authority, configurationValidation }
              : authority,
          ),
        },
      });
    };
    const response = operationResponse({
      ...graphEnvelope("command_p2_node_reference_authority"),
      expectedPosition: source.presentation.position,
      kind: "move-node",
      nodeId: source.id,
      position: source.presentation.position,
    });

    const exact = createRequest(target.id, exactAttribute);
    validate(exact, response);
    expectDenied(
      createRequest(source.id, exactAttribute),
      response,
      "model-gateway.ungrounded-graph-command",
    );
    expectDenied(
      createRequest(target.id, "example.attribute.invented"),
      response,
      "model-gateway.ungrounded-graph-command",
    );

    const exactValidation = exact.catalogGrounding.nodes.find(
      (authority) => authority.serviceType === source.semantic.serviceType,
    )?.configurationValidation;
    if (exactValidation === undefined) {
      throw new Error("Exact node-reference validation fixture is missing.");
    }
    const withValidation = (nodeReferenceAuthorities: unknown) => ({
      ...exact,
      catalogGrounding: {
        ...exact.catalogGrounding,
        nodes: exact.catalogGrounding.nodes.map((authority) =>
          authority.serviceType === source.semantic.serviceType
            ? {
                ...authority,
                configurationValidation: {
                  ...exactValidation,
                  nodeReferenceAuthorities,
                },
              }
            : authority,
        ),
      },
    });
    expect(
      modelOperationProposalRequestV1Schema.safeParse(withValidation({}))
        .success,
    ).toBe(false);
    expect(
      modelOperationProposalRequestV1Schema.safeParse(
        withValidation({
          [field]: [
            {
              attribute: exactAttribute,
              serviceType: "example.service.invented",
            },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      modelOperationProposalRequestV1Schema.safeParse(
        withValidation({
          [field]: [exactAuthority, exactAuthority],
        }),
      ).success,
    ).toBe(false);
  });

  it("allowlists add-node semantics and ordered connection-rule tuples exactly", () => {
    const request = operationRequest();
    const source = testArchitecture.nodes[0];
    const worker = testArchitecture.nodes.find(
      (candidate) => candidate.id === "node_worker",
    );
    const edge = testArchitecture.edges.find(
      (candidate) =>
        candidate.semantic.relationshipType === "example.relationship.writes",
    );
    if (source === undefined || worker === undefined || edge === undefined) {
      throw new Error("Representative graph fixture is incomplete.");
    }
    const added = {
      ...source,
      id: "node_p2_added",
      semantic: {
        ...source.semantic,
        deploymentKey: "p2_added",
        lifecycle: { origin: "ai-accepted", ownership: "user" },
      },
    };
    const addedEdge = {
      ...edge,
      id: "edge_p2_added",
      semantic: {
        ...edge.semantic,
        lifecycle: { origin: "ai-accepted", ownership: "user" },
      },
    };
    validate(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_add_node"),
        kind: "add-node",
        node: added,
      }),
    );
    validate(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_add_edge"),
        edge: addedEdge,
        kind: "add-edge",
      }),
    );
    validate(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_add_nested_node"),
        kind: "add-node",
        node: {
          ...added,
          id: "node_p2_nested",
          semantic: {
            ...added.semantic,
            deploymentKey: "p2_nested",
            parent: {
              nodeId: worker.id,
              relationshipType: "example.relationship.contains",
            },
          },
        },
      }),
    );
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_invented_node"),
        kind: "add-node",
        node: {
          ...added,
          id: "node_p2_invented",
          semantic: {
            ...added.semantic,
            resourceType: "example.resource.invented",
          },
        },
      }),
      "model-gateway.ungrounded-graph-command",
    );
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_unknown_node_field"),
        kind: "add-node",
        node: {
          ...added,
          id: "node_p2_unknown_field",
          semantic: {
            ...added.semantic,
            configuration: {
              ...added.semantic.configuration,
              values: {
                invented: { kind: "string", value: "not-allow-listed" },
              },
            },
            deploymentKey: "p2_unknown_field",
          },
        },
      }),
      "model-gateway.ungrounded-graph-command",
    );
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_wrong_parent_service"),
        kind: "add-node",
        node: {
          ...added,
          id: "node_p2_wrong_parent",
          semantic: {
            ...added.semantic,
            deploymentKey: "p2_wrong_parent",
            parent: {
              nodeId: source.id,
              relationshipType: "example.relationship.contains",
            },
          },
        },
      }),
      "model-gateway.ungrounded-graph-command",
    );
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_reversed_edge"),
        edge: {
          ...edge,
          id: "edge_p2_reversed",
          semantic: {
            ...edge.semantic,
            lifecycle: { origin: "ai-accepted", ownership: "user" },
            source: edge.semantic.target,
            target: edge.semantic.source,
          },
        },
        kind: "add-edge",
      }),
      "model-gateway.ungrounded-graph-command",
    );
  });

  it("requires user-owned AI-accepted lifecycle metadata on model-added elements", () => {
    const request = operationRequest();
    const source = testArchitecture.nodes[0];
    const edge = testArchitecture.edges[0];
    if (source === undefined || edge === undefined) {
      throw new Error("Representative graph fixture is incomplete.");
    }
    const generatedProvenance = {
      dependentEdgeIds: [],
      dependentNodeIds: [source.id],
      generatorId: "example.generator.support",
      generatorKind: "connection-rule" as const,
      generatorVersion: "1.0.0",
      operationId: "operation_generator",
    };
    const disallowedLifecycles = [
      { origin: "user", ownership: "user" },
      { origin: "template", ownership: "user" },
      { origin: "migration", ownership: "user" },
      {
        origin: "connection-rule",
        ownership: "generated",
        provenance: generatedProvenance,
      },
    ] as const;

    for (const [index, lifecycle] of disallowedLifecycles.entries()) {
      const suffix = String(index);
      expectDenied(
        request,
        operationResponse({
          ...graphEnvelope(`command_p2_disallowed_node_lifecycle_${suffix}`),
          kind: "add-node",
          node: {
            ...source,
            id: `node_p2_disallowed_lifecycle_${suffix}`,
            semantic: {
              ...source.semantic,
              deploymentKey: `p2_disallowed_lifecycle_${suffix}`,
              lifecycle,
            },
          },
        }),
        "model-gateway.ungrounded-graph-command",
      );
      expectDenied(
        request,
        operationResponse({
          ...graphEnvelope(`command_p2_disallowed_edge_lifecycle_${suffix}`),
          edge: {
            ...edge,
            id: `edge_p2_disallowed_lifecycle_${suffix}`,
            semantic: { ...edge.semantic, lifecycle },
          },
          kind: "add-edge",
        }),
        "model-gateway.ungrounded-graph-command",
      );
    }
  });

  it("reserves original element identities after removal during response simulation", () => {
    const request = operationRequest();
    const node = testArchitecture.nodes[0];
    const edge = testArchitecture.edges[0];
    if (node === undefined || edge === undefined) {
      throw new Error("Representative graph fixture is incomplete.");
    }

    expectDenied(
      request,
      operationBatchesResponse([
        {
          batch: {
            ...graphEnvelope("batch_p2_replace_original_node"),
            commands: [
              {
                ...graphEnvelope("command_p2_remove_original_node"),
                expectedNode: node,
                kind: "remove-node",
                nodeId: node.id,
              },
              {
                ...graphEnvelope("command_p2_readd_original_node"),
                kind: "add-node",
                node: {
                  ...node,
                  semantic: {
                    ...node.semantic,
                    lifecycle: {
                      origin: "ai-accepted",
                      ownership: "user",
                    },
                  },
                },
              },
            ],
            kind: "batch",
          },
          kind: "graph",
        },
      ]),
      "model-gateway.ungrounded-graph-command",
    );
    expectDenied(
      request,
      operationBatchesResponse([
        {
          batch: {
            ...graphEnvelope("batch_p2_replace_original_edge"),
            commands: [
              {
                ...graphEnvelope("command_p2_remove_original_edge"),
                edgeId: edge.id,
                expectedEdge: edge,
                kind: "remove-edge",
              },
              {
                ...graphEnvelope("command_p2_readd_original_edge"),
                edge: {
                  ...edge,
                  semantic: {
                    ...edge.semantic,
                    lifecycle: {
                      origin: "ai-accepted",
                      ownership: "user",
                    },
                  },
                },
                kind: "add-edge",
              },
            ],
            kind: "batch",
          },
          kind: "graph",
        },
      ]),
      "model-gateway.ungrounded-graph-command",
    );
  });

  it("rejects unknown node and edge fields on configuration updates", () => {
    const request = operationRequest();
    const source = testArchitecture.nodes[0];
    const edge = testArchitecture.edges[0];
    if (source === undefined || edge === undefined) {
      throw new Error("Representative graph fixture is incomplete.");
    }
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_update_unknown_node_field"),
        configuration: {
          ...source.semantic.configuration,
          values: { invented: { kind: "boolean", value: true } },
        },
        expectedConfiguration: source.semantic.configuration,
        kind: "update-node-configuration",
        nodeId: source.id,
      }),
      "model-gateway.ungrounded-graph-command",
    );
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_update_unknown_edge_field"),
        configuration: {
          ...edge.semantic.configuration,
          values: { invented: { kind: "integer", value: 1 } },
        },
        edgeId: edge.id,
        expectedConfiguration: edge.semantic.configuration,
        kind: "update-edge-configuration",
      }),
      "model-gateway.ungrounded-graph-command",
    );
  });

  it("validates ordered parent service types on reparent commands", () => {
    const request = operationRequest();
    const source = testArchitecture.nodes.find(
      (candidate) => candidate.id === "node_source",
    );
    const worker = testArchitecture.nodes.find(
      (candidate) => candidate.id === "node_worker",
    );
    if (source === undefined || worker === undefined) {
      throw new Error("Representative nodes are missing.");
    }
    validate(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_reparent_exact"),
        expectedParent: null,
        kind: "reparent-node",
        nodeId: source.id,
        parent: {
          nodeId: worker.id,
          relationshipType: "example.relationship.contains",
        },
      }),
    );
    expectDenied(
      request,
      operationResponse({
        ...graphEnvelope("command_p2_reparent_wrong_service"),
        expectedParent: null,
        kind: "reparent-node",
        nodeId: source.id,
        parent: {
          nodeId: source.id,
          relationshipType: "example.relationship.contains",
        },
      }),
      "model-gateway.ungrounded-graph-command",
    );
  });

  it("rejects duplicate workload operation IDs across batches", () => {
    const request = operationRequest();
    const owningNodeId = request.architecture.nodes[0]?.id;
    if (owningNodeId === undefined) {
      throw new Error("Workload operation owner fixture is missing.");
    }
    const workloadBatch = (operationId: string, workloadId: string) => ({
      kind: "workload",
      operations: [
        {
          action: "add",
          expectedWorkloadContentHash:
            testSolutionRevision.workload.contentHash,
          operationId,
          proposal: {
            implementationMode: "infrastructure-only",
            owningNodeId,
            responsibilities: ["Exercise exact workload operation identity."],
            workloadId,
          },
        },
      ],
    });
    const firstBatch = workloadBatch(
      "workload_operation_p2_first",
      "workload_p2_added_first",
    );
    const secondBatch = workloadBatch(
      "workload_operation_p2_second",
      "workload_p2_added_second",
    );

    validate(request, operationBatchesResponse([firstBatch, secondBatch]));
    expectDenied(
      request,
      operationBatchesResponse([
        firstBatch,
        workloadBatch(
          "workload_operation_p2_first",
          "workload_p2_added_duplicate",
        ),
      ]),
      "model-gateway.ambiguous-workload-operation-identity",
    );
  });

  it("rejects duplicate Graph Command and inverse IDs across batches", () => {
    const request = operationRequest();
    const node = request.architecture.nodes[0];
    if (node === undefined) throw new Error("Graph node fixture is missing.");
    const graphBatch = (
      batchId: string,
      batchInverseId: string,
      commandId: string,
      commandInverseId: string,
    ) => ({
      batch: {
        ...graphEnvelope(batchId),
        commands: [
          {
            ...graphEnvelope(commandId),
            expectedPosition: node.presentation.position,
            inverseCommandId: commandInverseId,
            kind: "move-node",
            nodeId: node.id,
            position: node.presentation.position,
          },
        ],
        inverseCommandId: batchInverseId,
        kind: "batch",
      },
      kind: "graph",
    });
    const firstBatch = graphBatch(
      "batch_p2_graph_first",
      "batch_p2_graph_first_inverse",
      "command_p2_graph_first",
      "command_p2_graph_first_inverse",
    );
    const secondBatch = graphBatch(
      "batch_p2_graph_second",
      "batch_p2_graph_second_inverse",
      "command_p2_graph_second",
      "command_p2_graph_second_inverse",
    );

    validate(request, operationBatchesResponse([firstBatch, secondBatch]));
    expectDenied(
      request,
      operationBatchesResponse([
        firstBatch,
        graphBatch(
          "batch_p2_graph_second",
          "batch_p2_graph_second_inverse",
          "command_p2_graph_first",
          "command_p2_graph_second_inverse",
        ),
      ]),
      "model-gateway.ambiguous-graph-command-identity",
    );
    expectDenied(
      request,
      operationBatchesResponse([
        firstBatch,
        graphBatch(
          "batch_p2_graph_second",
          "batch_p2_graph_second_inverse",
          "command_p2_graph_second",
          "command_p2_graph_first",
        ),
      ]),
      "model-gateway.ambiguous-graph-command-identity",
    );
  });

  it("rejoins generation Architecture, revision, catalog, workload, ownership, and sources", () => {
    const request = generationRequest();
    const response = candidateResponse(request);
    const firstNode = request.architecture.nodes[0];
    if (firstNode === undefined)
      throw new Error("Architecture node is missing.");
    validate(request, response);
    expectDenied(
      {
        ...request,
        workloadId: workloadIdSchema.parse("workload_invented"),
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
    expectDenied(
      {
        ...request,
        solutionRevision: {
          ...request.solutionRevision,
          workload: {
            ...request.solutionRevision.workload,
            contentHash: TEST_DIGEST,
          },
        },
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
    expectDenied(
      {
        ...request,
        sourceReferences: [
          { kind: "workload", referenceId: "workload_invented" },
        ],
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
    expectDenied(
      {
        ...request,
        architecture: {
          ...request.architecture,
          nodes: [
            {
              ...firstNode,
              semantic: {
                ...firstNode.semantic,
                configuration: {
                  ...firstNode.semantic.configuration,
                  values: {
                    [configurationKeySchema.parse("forged")]: {
                      kind: "string",
                      value: "mutated",
                    },
                  },
                },
              },
            },
            ...request.architecture.nodes.slice(1),
          ],
        },
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
    expectDenied(
      {
        ...request,
        architecture: {
          ...request.architecture,
          applicationContracts: {
            ...request.architecture.applicationContracts,
            revision: {
              ...request.architecture.applicationContracts.revision,
              revisionNumber:
                request.architecture.applicationContracts.revision
                  .revisionNumber + 1,
            },
          },
        },
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
    expectDenied(
      {
        ...request,
        architecture: {
          ...request.architecture,
          externalResources: {
            ...request.architecture.externalResources,
            revision: {
              ...request.architecture.externalResources.revision,
              revisionNumber:
                request.architecture.externalResources.revision.revisionNumber +
                1,
            },
          },
        },
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
  });

  it("rejects altered source ownership and incoherent candidate paths", () => {
    const request = generationRequest();
    const response = candidateResponse(request);
    const ownership = request.sourceOwnershipAuthority.sourceOwnership[0];
    if (ownership === undefined) throw new Error("Ownership is missing.");
    const candidate = response.candidateBundle.candidates[0];
    if (candidate === undefined) throw new Error("Candidate is missing.");
    expectDenied(
      {
        ...request,
        sourceOwnershipAuthority: {
          ...request.sourceOwnershipAuthority,
          sourceOwnership: [{ ...ownership, ownerId: "owner_invented" }],
        },
      },
      response,
      "model-gateway.ungrounded-generation-input",
    );
    const duplicatePathResponse = modelGatewayResponseV1Schema.parse({
      ...response,
      candidateBundle: {
        ...response.candidateBundle,
        candidates: [
          ...response.candidateBundle.candidates,
          {
            ...candidate,
            candidateId: "candidate_p2_duplicate_path",
          },
        ],
      },
    });
    if (duplicatePathResponse.operation !== "application-source.generate") {
      throw new Error("Application generation response fixture is invalid.");
    }
    expectDenied(
      request,
      duplicatePathResponse,
      "model-gateway.ambiguous-candidate-path",
    );
  });

  it("requires bounded attempts and exact candidate/path diagnostics", () => {
    const { request } = repairFixture();
    expect(
      modelCandidateRepairRequestV1Schema.safeParse({
        ...request,
        currentAttempt: 3,
        maximumRepairAttempts: 2,
      }).success,
    ).toBe(false);
    const diagnostic = request.diagnostics[0];
    expect(
      modelCandidateRepairRequestV1Schema.safeParse({
        ...request,
        diagnostics: [{ ...diagnostic, candidateId: undefined }],
      }).success,
    ).toBe(false);
    expect(
      modelCandidateRepairRequestV1Schema.safeParse({
        ...request,
        diagnostics: [diagnostic, diagnostic],
      }).success,
    ).toBe(false);
  });

  it("binds the canonical failed set and exact repair prior digest", () => {
    const { failedCandidates, request, response } = repairFixture();
    validate(request, response);
    expectDenied(
      { ...request, failedOutputDigest: TEST_DIGEST },
      response,
      "model-gateway.repair-input-digest-mismatch",
    );
    const repaired = response.candidateBundle.candidates[0];
    if (repaired?.kind !== "file") throw new Error("Repair file is missing.");
    expectDenied(
      request,
      {
        ...response,
        candidateBundle: {
          ...response.candidateBundle,
          candidates: [{ ...repaired, priorDigest: TEST_DIGEST }],
        },
      },
      "model-gateway.repair-prior-digest-mismatch",
    );
    const inventedDiagnosticRequest = modelCandidateRepairRequestV1Schema.parse(
      {
        ...request,
        diagnostics: [
          { ...request.diagnostics[0], candidateId: "candidate_invented" },
        ],
      },
    );
    expectDenied(
      inventedDiagnosticRequest,
      response,
      "model-gateway.ungrounded-repair-diagnostic",
    );

    const secondContent = "// second failed candidate\n";
    const secondFailed = {
      ...failedCandidates[0],
      candidateId: "candidate_p2_failed_undiagnosed",
      content: secondContent,
      contentDigest: sha256Text(secondContent),
      path: "application/other.ts",
    };
    const expandedFailed = [...failedCandidates, secondFailed];
    const expandedRequest = modelCandidateRepairRequestV1Schema.parse({
      ...request,
      boundary: {
        ...request.boundary,
        ownedPaths: ["application/fake.ts", "application/other.ts"],
      },
      failedCandidates: expandedFailed,
      failedOutputDigest: digestStructuredValue(expandedFailed),
    });
    const undiagnosedContent = "// undiagnosed repair output\n";
    const undiagnosedResponse = modelGatewayResponseV1Schema.parse({
      ...response,
      candidateBundle: {
        ...response.candidateBundle,
        boundary: expandedRequest.boundary,
        candidates: [
          {
            candidateId: "candidate_p2_repaired_undiagnosed",
            content: undiagnosedContent,
            contentDigest: sha256Text(undiagnosedContent),
            encoding: "utf-8",
            kind: "file",
            ownership: "ai-authored-candidate",
            path: secondFailed.path,
            priorDigest: secondFailed.contentDigest,
          },
        ],
        generationPlan: {
          ...response.candidateBundle.generationPlan,
          steps: [
            {
              action: "replace-owned-file",
              rationale: "Attempt an undiagnosed path.",
              sourceReferences: [
                {
                  digest: expandedRequest.failedOutputDigest,
                  kind: "candidate-artifact",
                  referenceId: secondFailed.candidateId,
                },
              ],
              stepId: "step_p2_repair_undiagnosed",
              targetPath: secondFailed.path,
            },
          ],
        },
      },
      repairedFromDigest: expandedRequest.failedOutputDigest,
      resolvedDiagnosticIds: [],
    });
    if (undiagnosedResponse.operation !== "candidate.repair") {
      throw new Error("Repair response fixture is invalid.");
    }
    expectDenied(
      expandedRequest,
      undiagnosedResponse,
      "model-gateway.ungrounded-repair-input",
    );
  });

  it("rejects mismatched and multifile unified diffs in failed repair input", () => {
    const { failedCandidates, request, response } = repairFixture();
    const failed = failedCandidates[0];
    const responseStep = response.candidateBundle.generationPlan.steps[0];
    const responseReference = responseStep?.sourceReferences[0];
    if (
      failed?.kind !== "file" ||
      responseStep === undefined ||
      responseReference === undefined
    ) {
      throw new Error("Failed patch repair fixture is incomplete.");
    }
    const requestWithFailedPatch = (unifiedDiff: string) => {
      const failedPatch = {
        baseDigest: TEST_DIGEST,
        candidateId: failed.candidateId,
        kind: "patch" as const,
        ownership: "ai-authored-candidate" as const,
        path: failed.path,
        proposedResultDigest: failed.contentDigest,
        unifiedDiff,
      };
      return modelCandidateRepairRequestV1Schema.parse({
        ...request,
        failedCandidates: [failedPatch],
        failedOutputDigest: digestStructuredValue([failedPatch]),
      });
    };
    const responseFor = (
      repairRequest: ReturnType<typeof requestWithFailedPatch>,
    ): ModelGatewayResponseV1 => ({
      ...response,
      candidateBundle: {
        ...response.candidateBundle,
        generationPlan: {
          ...response.candidateBundle.generationPlan,
          steps: [
            {
              ...responseStep,
              sourceReferences: [
                {
                  ...responseReference,
                  digest: repairRequest.failedOutputDigest,
                },
              ],
            },
          ],
        },
      },
      repairedFromDigest: repairRequest.failedOutputDigest,
    });
    const exactDiff =
      "--- a/application/fake.ts\n" +
      "+++ b/application/fake.ts\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-failed\n" +
      "+still failed\n";
    const exactRequest = requestWithFailedPatch(exactDiff);
    validate(exactRequest, responseFor(exactRequest));

    const mismatchedRequest = requestWithFailedPatch(
      exactDiff.replace(
        "+++ b/application/fake.ts",
        "+++ b/application/other.ts",
      ),
    );
    expectDenied(
      mismatchedRequest,
      responseFor(mismatchedRequest),
      "model-gateway.patch-path-mismatch",
    );
    const multifileRequest = requestWithFailedPatch(
      exactDiff +
        "--- a/application/other.ts\n" +
        "+++ b/application/other.ts\n" +
        "@@ -1,1 +1,1 @@\n-old\n+new\n",
    );
    expectDenied(
      multifileRequest,
      responseFor(multifileRequest),
      "model-gateway.patch-multiple-files",
    );
  });

  it("binds a patch to one exact owned unified-diff path", () => {
    const { failedCandidates, request, response } = repairFixture();
    const failed = failedCandidates[0];
    if (failed === undefined) throw new Error("Failed candidate is missing.");
    const step = response.candidateBundle.generationPlan.steps[0];
    if (step === undefined) throw new Error("Repair plan step is missing.");
    const responseWithDiff = (
      unifiedDiff: string,
    ): Extract<ModelGatewayResponseV1, { operation: "candidate.repair" }> => {
      const parsed = modelGatewayResponseV1Schema.parse({
        ...response,
        candidateBundle: {
          ...response.candidateBundle,
          candidates: [
            {
              baseDigest: failed.contentDigest,
              candidateId: "candidate_p2_patch",
              kind: "patch",
              ownership: "ai-authored-candidate",
              path: failed.path,
              proposedResultDigest: TEST_DIGEST,
              unifiedDiff,
            },
          ],
          generationPlan: {
            ...response.candidateBundle.generationPlan,
            steps: [{ ...step, action: "propose-patch" }],
          },
        },
      });
      if (parsed.operation !== "candidate.repair") {
        throw new Error("Repair response fixture is invalid.");
      }
      return parsed;
    };
    const exactDiff =
      "--- a/application/fake.ts\n" +
      "+++ b/application/fake.ts\n" +
      "@@ -1,1 +1,1 @@\n" +
      "-failed\n" +
      "+repaired\n";
    validate(request, responseWithDiff(exactDiff));
    expectDenied(
      request,
      responseWithDiff(
        exactDiff.replace(
          "+++ b/application/fake.ts",
          "+++ b/application/other.ts",
        ),
      ),
      "model-gateway.patch-path-mismatch",
    );
    expectDenied(
      request,
      responseWithDiff(
        exactDiff +
          "--- a/application/other.ts\n" +
          "+++ b/application/other.ts\n" +
          "@@ -1,1 +1,1 @@\n-old\n+new\n",
      ),
      "model-gateway.patch-multiple-files",
    );
  });
});
