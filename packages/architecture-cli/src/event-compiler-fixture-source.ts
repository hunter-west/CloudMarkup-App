import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  applicationGenerationRequestV1Schema,
  architectureDocumentV3Schema,
  normalizeArchitectureDocumentV3,
  normalizedSolutionV1Schema,
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
  type NormalizedSolutionV1,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import {
  curatedEventApplicationFixture,
  multiWorkloadEventApplicationFixture,
} from "@cloudmarkup/solution-export-workflow/testing";

export const architectureCliGeneratedEventCases = [
  "s3-image-metadata",
  "sqs-consumer-dlq",
  "sns-fanout-multi",
  "eventbridge-scheduled",
  "eventbridge-target",
  "step-functions-task",
] as const;

export type ArchitectureCliGeneratedEventCase =
  (typeof architectureCliGeneratedEventCases)[number];

type SingleEventCase = Exclude<
  ArchitectureCliGeneratedEventCase,
  "sns-fanout-multi"
>;

const GO_COMPILER = {
  digest:
    "sha256:2c25a5610c825d171a167a38201c3090aa2278071ddd648bb957e67b7b98f203",
  id: "cloudmarkup.iac-compiler",
  version: "1.2.1",
} as const;

interface EventSourceBinding {
  readonly downstreamEdgeId?: string;
  readonly environmentNodeId?: string;
  readonly ownerNodeId: string;
  readonly triggerEdgeId: string;
  readonly workloadId: string;
}

const bindings: Record<
  ArchitectureCliGeneratedEventCase,
  readonly EventSourceBinding[]
> = {
  "s3-image-metadata": [
    {
      downstreamEdgeId: "edge_metadata_write",
      environmentNodeId: "image_metadata",
      ownerNodeId: "lambda",
      triggerEdgeId: "edge_upload_notification",
      workloadId: "workload_event_s3_image_metadata",
    },
  ],
  "sqs-consumer-dlq": [
    {
      ownerNodeId: "lambda",
      triggerEdgeId: "edge_queue_consumer",
      workloadId: "workload_event_sqs_consumer_dlq",
    },
  ],
  "sns-fanout-multi": [
    {
      ownerNodeId: "lambda",
      triggerEdgeId: "edge_primary_lambda",
      workloadId: "workload_event_sns_fanout_consumer_primary",
    },
    {
      ownerNodeId: "secondary_lambda",
      triggerEdgeId: "edge_secondary_lambda",
      workloadId: "workload_event_sns_fanout_consumer_secondary",
    },
  ],
  "eventbridge-scheduled": [
    {
      ownerNodeId: "lambda",
      triggerEdgeId: "edge_target_lambda",
      workloadId: "workload_event_eventbridge_scheduled",
    },
  ],
  "eventbridge-target": [
    {
      ownerNodeId: "lambda",
      triggerEdgeId: "edge_target_lambda",
      workloadId: "workload_event_eventbridge_target",
    },
  ],
  "step-functions-task": [
    {
      ownerNodeId: "lambda",
      triggerEdgeId: "edge_workflow_task",
      workloadId: "workload_event_step_functions_task",
    },
  ],
};

function baseFixture(eventCase: ArchitectureCliGeneratedEventCase) {
  return eventCase === "sns-fanout-multi"
    ? multiWorkloadEventApplicationFixture()
    : curatedEventApplicationFixture(eventCase satisfies SingleEventCase);
}

function sourcePort(
  relationshipType: string,
  port: string | undefined,
): string {
  return port === undefined || port === ""
    ? `${relationshipType}.source`
    : port;
}

function targetPort(
  relationshipType: string,
  port: string | undefined,
): string {
  return port === undefined || port === ""
    ? `${relationshipType}.target`
    : port;
}

function sourceGraph(
  eventCase: ArchitectureCliGeneratedEventCase,
  model: NormalizedSolutionV1,
) {
  if (model.resources.some((resource) => resource.parent !== undefined)) {
    throw new TypeError(
      "Event compiler fixture resources cannot use an implicit parent binding.",
    );
  }
  const ownerDeploymentKeys = new Map(
    bindings[eventCase].map(({ ownerNodeId, workloadId }) => [
      ownerNodeId,
      workloadId.slice("workload_".length),
    ]),
  );
  const edges: Record<string, unknown>[] = model.connections.map(
    (connection) => ({
      id: connection.id,
      semantic: {
        configuration: connection.configuration,
        lifecycle: connection.lifecycle,
        relationshipType: connection.relationshipType,
        source: {
          nodeId: connection.source.nodeId,
          port: sourcePort(connection.relationshipType, connection.source.port),
        },
        target: {
          nodeId: connection.target.nodeId,
          port: targetPort(connection.relationshipType, connection.target.port),
        },
      },
    }),
  );
  const nodes: Record<string, unknown>[] = model.resources.map(
    (resource, index) => {
      const ownerDeploymentKey = ownerDeploymentKeys.get(resource.id);
      let resourceConfiguration =
        eventCase === "s3-image-metadata" && resource.id === "image_metadata"
          ? {
              ...resource.configuration,
              values: {
                ...resource.configuration.values,
                partitionKeyName: { kind: "string", value: "key" },
              },
            }
          : resource.serviceType === "aws.iam.role" ||
              resource.serviceType === "aws.iam.policy-statement"
            ? { ...resource.configuration, schemaVersion: "2.0.0" }
            : resource.configuration;
      if (resource.serviceType === "aws.iam.policy-statement") {
        const statementId = resourceConfiguration.values["statementId"];
        if (
          statementId?.kind !== "string" ||
          typeof statementId.value !== "string"
        ) {
          throw new TypeError(
            "Event compiler fixture lacks a literal statement ID.",
          );
        }
        // Synthetic SIDs retain their prior rendered value and graph identity.
        resourceConfiguration = {
          ...resourceConfiguration,
          values: {
            ...resourceConfiguration.values,
            statementId: {
              ...statementId,
              value: statementId.value.replace(/[^A-Za-z0-9]/g, ""),
            },
          },
        };
      }
      return {
        id: resource.id,
        presentation: {
          label: resource.id.replaceAll("_", " "),
          position: {
            x: 80 + (index % 4) * 320,
            y: 120 + Math.floor(index / 4) * 220,
          },
        },
        semantic: {
          configuration: ownerDeploymentKey
            ? {
                ...resourceConfiguration,
                values: {
                  ...resourceConfiguration.values,
                  functionName: {
                    kind: "string",
                    value: ownerDeploymentKey,
                  },
                  timeoutSeconds: { kind: "integer", value: 30 },
                },
              }
            : resourceConfiguration,
          deploymentKey: ownerDeploymentKey ?? resource.deploymentKey,
          lifecycle: resource.lifecycle,
          resourceType: resource.resourceType,
          serviceType: resource.serviceType,
        },
      };
    },
  );
  const resourceIds = new Set(model.resources.map(({ id }) => id));
  for (const [index, binding] of bindings[eventCase].entries()) {
    const owner = model.resources.find(
      (resource) => resource.id === binding.ownerNodeId,
    );
    const ownerDeploymentKey = ownerDeploymentKeys.get(binding.ownerNodeId);
    const roleNodeId =
      binding.ownerNodeId === "secondary_lambda" ? "secondary_role" : "role";
    if (
      owner === undefined ||
      ownerDeploymentKey === undefined ||
      !resourceIds.has(roleNodeId)
    ) {
      throw new TypeError(
        `Event compiler fixture lacks logging authority for ${binding.workloadId}.`,
      );
    }
    const suffix =
      eventCase.replaceAll("-", "_") +
      (bindings[eventCase].length === 1 ? "" : `_${String(index + 1)}`);
    const logNodeId = `event_logs_${suffix}`;
    if (resourceIds.has(logNodeId)) {
      continue;
    }
    const logEdgeId = `edge_event_logs_${suffix}`;
    const policyId = `event_logs_policy_${suffix}`;
    const statementId = `${policyId}_statement`;
    const generatedLifecycle = {
      ownership: "generated",
      origin: "connection-rule",
      provenance: {
        dependentEdgeIds: [logEdgeId],
        dependentNodeIds: [],
        generatorId: "aws.cloudmarkup.connection-rule",
        generatorKind: "connection-rule",
        generatorVersion: "1.0.0",
        operationId: `operation_event_logs_${suffix}`,
      },
    } as const;
    const userLifecycle = { ownership: "user", origin: "user" } as const;
    nodes.push(
      {
        id: logNodeId,
        presentation: {
          label: `${binding.workloadId} logs`,
          position: { x: 80 + ((nodes.length + index) % 4) * 320, y: 980 },
        },
        semantic: {
          configuration: {
            schemaId: "aws.cloudwatch.log-group.configuration",
            schemaVersion: "1.0.0",
            values: {
              logClass: { kind: "string", value: "STANDARD" },
              logGroupName: {
                kind: "string",
                value: `/aws/lambda/${ownerDeploymentKey}`,
              },
              preventDestroy: { kind: "boolean", value: true },
              retentionDays: { kind: "integer", value: 30 },
            },
          },
          deploymentKey: logNodeId,
          lifecycle: userLifecycle,
          resourceType: "aws.cloudwatch.log-group",
          serviceType: "aws.cloudwatch.log-group",
        },
      },
      {
        id: policyId,
        presentation: {
          label: `${binding.workloadId} log policy`,
          position: { x: 400, y: 1200 + index * 160 },
        },
        semantic: {
          configuration: {
            schemaId: "aws.iam.policy-document.configuration",
            schemaVersion: "1.0.0",
            values: {
              policyKind: { kind: "string", value: "generated-permission" },
              policyName: { kind: "string", value: policyId },
            },
          },
          deploymentKey: policyId,
          lifecycle: generatedLifecycle,
          resourceType: "aws.iam.policy-document",
          serviceType: "aws.iam.policy-document",
        },
      },
      {
        id: statementId,
        presentation: {
          label: `${binding.workloadId} log statement`,
          position: { x: 720, y: 1200 + index * 160 },
        },
        semantic: {
          configuration: {
            schemaId: "aws.iam.policy-statement.configuration",
            schemaVersion: "2.0.0",
            values: {
              actions: {
                kind: "string-list",
                value: ["logs:CreateLogStream", "logs:PutLogEvents"],
              },
              effect: { kind: "string", value: "allow" },
              principalKind: { kind: "string", value: "none" },
              principals: { kind: "string-list", value: [] },
              resourceExpressions: { kind: "string-list", value: [] },
              statementId: {
                kind: "string",
                value: policyId.replace(/[^A-Za-z0-9]/g, ""),
              },
            },
          },
          deploymentKey: statementId,
          lifecycle: generatedLifecycle,
          resourceType: "aws.iam.policy-statement",
          serviceType: "aws.iam.policy-statement",
        },
      },
    );
    edges.push(
      {
        id: logEdgeId,
        semantic: {
          configuration: {
            schemaId: "aws.lambda.cloudwatch-logs.connection",
            schemaVersion: "1.0.0",
            values: {
              deliveryMode: { kind: "string", value: "application-logs" },
            },
          },
          lifecycle: userLifecycle,
          relationshipType: "aws.lambda.writes-log-group",
          source: {
            nodeId: binding.ownerNodeId,
            port: "aws.lambda.function.logs",
          },
          target: {
            nodeId: logNodeId,
            port: "aws.cloudwatch.log-group.logs",
          },
        },
      },
      {
        id: `${policyId}_owner`,
        semantic: {
          configuration: {
            schemaId: "aws.iam.role-owns-generated-permission.attachment",
            schemaVersion: "1.0.0",
            values: {},
          },
          lifecycle: userLifecycle,
          relationshipType: "aws.iam.role-owns-generated-permission",
          source: { nodeId: policyId, port: "aws.iam.policy.owner" },
          target: { nodeId: roleNodeId, port: "aws.iam.role.permission" },
        },
      },
      {
        id: `${policyId}_membership`,
        semantic: {
          configuration: {
            schemaId: "aws.iam.policy-membership.connection",
            schemaVersion: "1.0.0",
            values: {},
          },
          lifecycle: userLifecycle,
          relationshipType: "aws.iam.policy-contains-statement",
          source: {
            nodeId: statementId,
            port: "aws.iam.policy-statement.member",
          },
          target: { nodeId: policyId, port: "aws.iam.policy.statements" },
        },
      },
      {
        id: `${policyId}_scope`,
        semantic: {
          configuration: {
            schemaId: "aws.iam.policy-log-group.connection",
            schemaVersion: "1.0.0",
            values: {},
          },
          lifecycle: userLifecycle,
          relationshipType: "aws.iam.authorizes-log-group",
          source: {
            nodeId: statementId,
            port: "aws.iam.policy-statement.scope",
          },
          target: {
            nodeId: logNodeId,
            port: "aws.cloudwatch.log-group.authorized",
          },
        },
      },
    );
  }
  const orderedNodeIds = nodes
    .map((node) => String(node["id"]))
    .sort((left, right) => (left === right ? 0 : left < right ? -1 : 1));
  for (const node of nodes) {
    const id = String(node["id"]);
    const index = orderedNodeIds.indexOf(id);
    node["presentation"] = {
      label: id.replaceAll("_", " "),
      position: {
        x: 80 + (index % 4) * 320,
        y: 120 + Math.floor(index / 4) * 220,
      },
    };
  }
  return { edges, nodes };
}

function bindWorkloads(
  eventCase: ArchitectureCliGeneratedEventCase,
  model: NormalizedSolutionV1,
) {
  const base = baseFixture(eventCase).generationRequest.workloadBehavior;
  const byId = new Map<string, (typeof base.workloads)[number]>(
    base.workloads.map((workload) => [workload.id, workload]),
  );
  return {
    ...base,
    workloads: bindings[eventCase].map((binding) => {
      const workload = byId.get(binding.workloadId);
      if (workload === undefined) {
        throw new TypeError(
          `Event compiler fixture is missing workload ${binding.workloadId}.`,
        );
      }
      const owner = model.resources.find(
        (resource) => resource.id === binding.ownerNodeId,
      );
      const trigger = model.connections.find(
        (connection) => connection.id === binding.triggerEdgeId,
      );
      if (owner === undefined || trigger === undefined) {
        throw new TypeError(
          `Event compiler fixture graph is missing ${binding.workloadId} bindings.`,
        );
      }
      const stepMaximumAttempts =
        eventCase === "step-functions-task"
          ? trigger.configuration.values["maximumAttempts"]
          : undefined;
      if (
        eventCase === "step-functions-task" &&
        (stepMaximumAttempts?.kind !== "integer" ||
          stepMaximumAttempts.value !== 3)
      ) {
        throw new TypeError(
          "Step Functions fixture requires three total catalog executions.",
        );
      }
      const provenanceInput = {
        eventCase,
        ownerNodeId: binding.ownerNodeId,
        triggerEdgeId: binding.triggerEdgeId,
        workloadId: binding.workloadId,
      };
      return {
        ...workload,
        dataBindings: workload.dataBindings.map((dataBinding) => ({
          ...dataBinding,
          ...(binding.downstreamEdgeId === undefined
            ? {}
            : { edgeId: binding.downstreamEdgeId }),
        })),
        downstreamActions: workload.downstreamActions.map((action) => ({
          ...action,
          ...(binding.downstreamEdgeId === undefined
            ? {}
            : { edgeId: binding.downstreamEdgeId }),
        })),
        environment: workload.environment.map((environment) =>
          environment.value.kind !== "node-attribute-reference" ||
          binding.environmentNodeId === undefined
            ? environment
            : {
                ...environment,
                value: {
                  ...environment.value,
                  nodeId: binding.environmentNodeId,
                },
              },
        ),
        eventBindings: workload.eventBindings.map((eventBinding) => ({
          ...eventBinding,
          edgeId: binding.triggerEdgeId,
        })),
        executionAssumptions:
          stepMaximumAttempts === undefined
            ? workload.executionAssumptions
            : {
                ...workload.executionAssumptions,
                retry: {
                  kind: "bounded" as const,
                  maximumAttempts: stepMaximumAttempts.value,
                },
              },
        owningNodeId: binding.ownerNodeId,
        provenance: {
          ...workload.provenance,
          inputDigest: sha256Digest(serializeCanonicalJson(provenanceInput)),
        },
        schedules: workload.schedules.map((schedule) => ({
          ...schedule,
          triggerEdgeId: binding.triggerEdgeId,
        })),
        triggers: workload.triggers.map((triggerBinding) => ({
          ...triggerBinding,
          edgeId: binding.triggerEdgeId,
        })),
      };
    }),
  };
}

export interface ArchitectureCliEventCompilerSource {
  readonly applicationContracts: unknown;
  readonly architectureDocument: unknown;
  readonly case: ArchitectureCliGeneratedEventCase;
  readonly solutionRevision: unknown;
  readonly workloadBehavior: unknown;
}

export function architectureCliEventCompilerSourceFromModel(
  eventCase: ArchitectureCliGeneratedEventCase,
  rawModel: unknown,
): ArchitectureCliEventCompilerSource {
  const model = normalizedSolutionV1Schema.parse(rawModel);
  const baseRequest = baseFixture(eventCase).generationRequest;
  const workloadBehavior = bindWorkloads(eventCase, model);
  const boundRevision = {
    createdAt: baseRequest.architectureDocument.revision.createdAt,
    createdBy: baseRequest.architectureDocument.revision.createdBy,
    revisionId: baseRequest.architectureDocument.revision.revisionId,
    revisionNumber: baseRequest.architectureDocument.revision.revisionNumber,
  };
  const applicationContracts = {
    ...baseRequest.architectureDocument.applicationContracts,
    contractSetId: baseRequest.architectureDocument.architectureId,
    documentId: baseRequest.architectureDocument.documentId,
    revision: boundRevision,
  };
  const externalResources = {
    ...baseRequest.architectureDocument.externalResources,
    architectureId: baseRequest.architectureDocument.architectureId,
    documentId: baseRequest.architectureDocument.documentId,
    revision: boundRevision,
  };
  const graph = sourceGraph(eventCase, model);
  const architectureDocument = normalizeArchitectureDocumentV3(
    architectureDocumentV3Schema.parse({
      ...baseRequest.architectureDocument,
      ...graph,
      applicationContracts,
      externalResources,
      workloadBehavior,
    }),
  );
  const solutionRevision = solutionRevisionManifestV1Schema.parse({
    ...baseRequest.solutionRevision,
    architecture: {
      ...baseRequest.solutionRevision.architecture,
      contentHash: getArchitectureDocumentContentHash(architectureDocument),
      documentHash: getArchitectureDocumentCanonicalHash(architectureDocument),
      revisionId: architectureDocument.revision.revisionId,
      visualHash: getArchitectureDocumentVisualHash(architectureDocument),
    },
    contracts: {
      ...baseRequest.solutionRevision.contracts,
      contentHash: getApplicationContractsContentHash(
        architectureDocument.applicationContracts,
      ),
    },
    externalResources: {
      ...baseRequest.solutionRevision.externalResources,
      contentHash: getExternalResourceReferenceContentHash(externalResources),
    },
    versions: {
      ...baseRequest.solutionRevision.versions,
      compiler: { state: "pinned", tool: GO_COMPILER },
    },
    workload: {
      ...baseRequest.solutionRevision.workload,
      contentHash: getWorkloadBehaviorContentHash(
        architectureDocument.workloadBehavior,
      ),
    },
  });
  return {
    applicationContracts: architectureDocument.applicationContracts,
    architectureDocument,
    case: eventCase,
    solutionRevision,
    workloadBehavior: architectureDocument.workloadBehavior,
  };
}

export function architectureCliEventGenerationRequestFromCompilerBundle(
  eventCase: ArchitectureCliGeneratedEventCase,
  rawSource: unknown,
  rawModel: unknown,
) {
  const model = normalizedSolutionV1Schema.parse(rawModel);
  const source = architectureCliEventCompilerSourceFromModel(eventCase, model);
  if (serializeCanonicalJson(rawSource) !== serializeCanonicalJson(source)) {
    throw new TypeError(
      `Event compiler source bundle drifted for ${eventCase}.`,
    );
  }
  const baseRequest = baseFixture(eventCase).generationRequest;
  return applicationGenerationRequestV1Schema.parse({
    ...baseRequest,
    architectureDocument: source.architectureDocument,
    normalizedSolution: model,
    solutionRevision: source.solutionRevision,
    workloadBehavior: source.workloadBehavior,
  });
}
