import {
  createValidationDocumentPath,
  type ValidationFindingCandidate,
} from "@cloudmarkup/domain";
import { parseGraphCommandV1 } from "@cloudmarkup/schemas";

import {
  dynamoDbProtectionValidationRuleDescriptor,
  iamWildcardValidationRuleDescriptor,
  lambdaDynamoDbActionsValidationRuleDescriptor,
  lambdaRuntimeBoundsValidationRuleDescriptor,
  logRetentionValidationRuleDescriptor,
} from "../catalog/validation-rules/index.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  edgeLocation,
  finding,
  isLowerEnvironment,
  literalBoolean,
  literalInteger,
  literalString,
  nodeConfigurationLocation,
  type AwsConfigurationValue,
  type AwsValidationCatalogV1,
  type AwsValidationDocument,
  type AwsValidationNode,
} from "./rule-helpers.js";

function containsWildcard(value: AwsConfigurationValue | undefined): boolean {
  if (value?.kind === "string") {
    return value.value.includes("*");
  }
  if (value?.kind === "string-list") {
    return value.value.some((entry) => entry.includes("*"));
  }
  return false;
}

export function createIamWildcardRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = iamWildcardValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];

      document.nodes.forEach((node, nodeIndex) => {
        if (node.semantic.serviceType !== "aws.iam.policy-statement") {
          return;
        }
        const values = node.semantic.configuration.values;
        if (containsWildcard(configurationValue(values, "actions"))) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-wildcard-action",
              severity: "security-error",
              title: "IAM action contains a wildcard",
              beginnerExplanation:
                "This policy can allow more operations than the notes function needs.",
              technicalExplanation:
                "IAM action declarations must use the catalog's exact reviewed DynamoDB action set; '*' and partial wildcards are rejected.",
              affected: [nodeConfigurationLocation(node, nodeIndex, "actions")],
            }),
          );
        }
        if (containsWildcard(configurationValue(values, "resourceNode"))) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-wildcard-resource",
              severity: "security-error",
              title: "IAM resource contains a wildcard",
              beginnerExplanation:
                "This policy is not limited to the selected notes table.",
              technicalExplanation:
                "IAM resource scope must be a typed node reference; wildcard and inline resource strings are rejected.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "resourceNode"),
              ],
            }),
          );
        }
      });

      return findings;
    },
  });
}

export function createLambdaDynamoDbActionsRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = lambdaDynamoDbActionsValidationRuleDescriptor;
  const connectionRules = catalog.connectionRules.filter(
    (rule) =>
      rule.id === "aws.lambda.reads-dynamodb-table" ||
      rule.id === "aws.lambda.writes-dynamodb-table",
  );
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
      const findings: ValidationFindingCandidate[] = [];

      document.edges.forEach((edge, edgeIndex) => {
        const sourceNode = nodeById.get(edge.semantic.source.nodeId);
        const targetNode = nodeById.get(edge.semantic.target.nodeId);
        const connectionRule = connectionRules.find(
          (rule) =>
            sourceNode?.semantic.serviceType === rule.source.serviceId &&
            targetNode?.semantic.serviceType === rule.target.serviceId &&
            edge.semantic.relationshipType === rule.relationshipType &&
            edge.semantic.source.port === rule.source.portId &&
            edge.semantic.target.port === rule.target.portId,
        );
        if (connectionRule === undefined) {
          return;
        }

        const roleIds = new Set(
          document.edges
            .filter(
              (candidate) =>
                candidate.semantic.relationshipType ===
                  "aws.iam.role-assumed-by-lambda" &&
                candidate.semantic.source.port ===
                  "aws.iam.role.assumable-role" &&
                candidate.semantic.target.nodeId ===
                  edge.semantic.source.nodeId &&
                candidate.semantic.target.port ===
                  "aws.lambda.function.execution-role" &&
                nodeById.get(candidate.semantic.source.nodeId)?.semantic
                  .serviceType === "aws.iam.role",
            )
            .map((candidate) => candidate.semantic.source.nodeId),
        );
        // Explicit inline policies and connection-generated permissions have
        // the same IAM effect but retain distinct ownership/cleanup authority.
        const permissionDocumentIds = new Set(
          document.nodes
            .filter((node) => {
              const parent = node.semantic.parent;
              const kind = literalString(
                node.semantic.configuration.values,
                "policyKind",
              );
              const relationship =
                kind === "generated-permission"
                  ? "aws.iam.role-owns-generated-permission"
                  : kind === "identity-inline"
                    ? "aws.iam.role-owns-inline-policy"
                    : undefined;
              const ownerRule = catalog.connectionRules.find(
                (rule) => rule.relationshipType === relationship,
              );
              if (
                node.semantic.serviceType !== "aws.iam.policy-document" ||
                !parent ||
                !ownerRule ||
                parent.relationshipType !== relationship ||
                !roleIds.has(parent.nodeId)
              )
                return false;
              const owners = document.edges.filter(
                (candidate) =>
                  candidate.semantic.source.nodeId === node.id &&
                  (candidate.semantic.relationshipType ===
                    "aws.iam.role-owns-generated-permission" ||
                    candidate.semantic.relationshipType ===
                      "aws.iam.role-owns-inline-policy"),
              );
              return (
                owners.length === 1 &&
                owners.every(
                  (candidate) =>
                    candidate.semantic.relationshipType ===
                      ownerRule.relationshipType &&
                    candidate.semantic.source.port ===
                      ownerRule.source.portId &&
                    candidate.semantic.target.nodeId === parent.nodeId &&
                    candidate.semantic.target.port ===
                      ownerRule.target.portId &&
                    candidate.semantic.configuration.schemaId ===
                      ownerRule.configuration.schemaId &&
                    candidate.semantic.configuration.schemaVersion ===
                      ownerRule.configuration.schemaVersion,
                )
              );
            })
            .map((node) => node.id),
        );
        const grantedActions = new Set<string>();
        document.edges.forEach((membershipEdge) => {
          if (
            membershipEdge.semantic.relationshipType !==
              "aws.iam.policy-contains-statement" ||
            membershipEdge.semantic.source.port !==
              "aws.iam.policy-statement.policy-document" ||
            !permissionDocumentIds.has(membershipEdge.semantic.target.nodeId) ||
            membershipEdge.semantic.target.port !==
              "aws.iam.policy-document.statement"
          ) {
            return;
          }
          const node = nodeById.get(membershipEdge.semantic.source.nodeId);
          const parent = node?.semantic.parent;
          if (
            node?.semantic.serviceType !== "aws.iam.policy-statement" ||
            parent?.relationshipType !== "aws.iam.policy-contains-statement" ||
            parent.nodeId !== membershipEdge.semantic.target.nodeId
          ) {
            return;
          }
          const hasTableScope = document.edges.some(
            (candidate) =>
              candidate.semantic.relationshipType ===
                "aws.iam.authorizes-dynamodb-table" &&
              candidate.semantic.source.nodeId === node.id &&
              candidate.semantic.source.port ===
                "aws.iam.policy-statement.dynamodb-resource" &&
              candidate.semantic.target.nodeId ===
                edge.semantic.target.nodeId &&
              candidate.semantic.target.port ===
                "aws.dynamodb.table.policy-resource",
          );
          const effect = literalString(
            node.semantic.configuration.values,
            "effect",
          );
          if (!hasTableScope || effect !== "allow") {
            return;
          }
          const resource = configurationValue(
            node.semantic.configuration.values,
            "resourceNode",
          );
          if (
            resource !== undefined &&
            (resource.kind !== "node-reference" ||
              resource.nodeId !== edge.semantic.target.nodeId)
          ) {
            return;
          }
          const actions = configurationValue(
            node.semantic.configuration.values,
            "actions",
          );
          if (actions?.kind === "string-list") {
            actions.value.forEach((action) => grantedActions.add(action));
          }
        });

        const requiredActions =
          connectionRule.iamEffects.find(
            (effect) =>
              effect.effect === "allow" &&
              effect.resourceScope === "connected-target" &&
              effect.when === undefined,
          )?.actions ?? [];
        const missingActions = requiredActions.filter(
          (action) => !grantedActions.has(action),
        );
        if (requiredActions.length > 0 && missingActions.length === 0) {
          return;
        }

        findings.push(
          finding(descriptor, {
            code: "aws.validation.lambda-dynamodb-actions-missing",
            severity: "security-error",
            title: "Lambda table connection lacks required IAM actions",
            beginnerExplanation:
              "The function's table connection and its role policy do not grant the same read or write capability.",
            technicalExplanation:
              requiredActions.length === 0
                ? `The catalog declares no exact table-scoped IAM effect for ${String(connectionRule.id)}.`
                : `${String(connectionRule.id)} is missing these exact table-scoped actions: ${missingActions.join(", ")}.`,
            affected: [edgeLocation(edge, edgeIndex)],
          }),
        );
      });

      return findings;
    },
  });
}

function encryptionFix(
  document: AwsValidationDocument,
  node: AwsValidationNode,
) {
  const target = {
    documentId: document.documentId,
    architectureId: document.architectureId,
    revisionId: document.revision.revisionId,
  };
  const prefix = `validation_${String(node.semantic.deploymentKey)}_ddb_encryption`;
  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: `${prefix}_batch`,
    inverseCommandId: `${prefix}_batch_inverse`,
    origin: "user",
    target,
    kind: "batch",
    commands: [
      {
        schemaVersion: 1,
        commandId: `${prefix}_update`,
        inverseCommandId: `${prefix}_update_inverse`,
        origin: "user",
        target,
        kind: "update-node-configuration",
        nodeId: node.id,
        expectedConfiguration: node.semantic.configuration,
        configuration: {
          ...node.semantic.configuration,
          values: {
            ...node.semantic.configuration.values,
            serverSideEncryptionEnabled: {
              kind: "boolean",
              value: true,
            },
          },
        },
      },
    ],
  });
  if (command.kind !== "batch") {
    throw new TypeError("Expected an encryption auto-fix batch.");
  }
  return command;
}

export function createDynamoDbProtectionRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = dynamoDbProtectionValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];

      document.nodes.forEach((node, nodeIndex) => {
        if (node.semantic.serviceType !== "aws.dynamodb.table") {
          return;
        }
        const values = node.semantic.configuration.values;
        const encryptionValue = configurationValue(
          values,
          "serverSideEncryptionEnabled",
        );
        if (encryptionValue?.kind !== "boolean" || !encryptionValue.value) {
          const canFix =
            encryptionValue === undefined &&
            node.semantic.lifecycle.ownership !== "generated";
          findings.push(
            finding(descriptor, {
              code: "aws.validation.dynamodb-encryption-not-enabled",
              severity: "security-error",
              title: "DynamoDB encryption is not explicitly enabled",
              beginnerExplanation:
                "The notes table must explicitly keep server-side encryption enabled.",
              technicalExplanation:
                "The catalog requires serverSideEncryptionEnabled to be the literal boolean true.",
              affected: [
                nodeConfigurationLocation(
                  node,
                  nodeIndex,
                  "serverSideEncryptionEnabled",
                ),
              ],
              ...(canFix ? { autoFix: encryptionFix(document, node) } : {}),
            }),
          );
        }

        if (!literalBoolean(values, "pointInTimeRecoveryEnabled")) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.dynamodb-recovery-not-enabled",
              severity: isLowerEnvironment(context.environment)
                ? "recommendation"
                : "warning",
              title: "DynamoDB point-in-time recovery is not enabled",
              beginnerExplanation:
                "Without point-in-time recovery, accidental note changes or deletion are harder to recover.",
              technicalExplanation:
                "pointInTimeRecoveryEnabled is not the literal boolean true for this environment; enabling it has an explicit cost impact and is not auto-fixed.",
              affected: [
                nodeConfigurationLocation(
                  node,
                  nodeIndex,
                  "pointInTimeRecoveryEnabled",
                ),
              ],
            }),
          );
        }
      });

      return findings;
    },
  });
}

export function createLogRetentionRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = logRetentionValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }

      return document.nodes.flatMap((node, nodeIndex) => {
        if (node.semantic.serviceType !== "aws.cloudwatch.log-group") {
          return [];
        }
        const findings: ValidationFindingCandidate[] = [];
        if (
          literalString(
            node.semantic.configuration.values,
            "logGroupName",
          )?.startsWith("aws/") === true
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.log-group-name-reserved",
              severity: "error",
              title: "Log group name uses the reserved aws/ prefix",
              beginnerExplanation:
                "Choose a log group name that does not begin with aws/. The standard /aws/lambda/ prefix is allowed.",
              technicalExplanation:
                "CloudWatch Logs CreateLogGroup rejects names starting with the exact aws/ string. Existing names are not rewritten automatically.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "logGroupName"),
              ],
            }),
          );
        }
        const retentionDays = literalInteger(
          node.semantic.configuration.values,
          "retentionDays",
        );
        if (
          retentionDays !== undefined &&
          Number.isInteger(retentionDays) &&
          retentionDays > 0
        ) {
          return findings;
        }

        return [
          ...findings,
          finding(descriptor, {
            code: "aws.validation.log-retention-unbounded",
            severity: isLowerEnvironment(context.environment)
              ? "recommendation"
              : "warning",
            title: "CloudWatch log retention is absent or unbounded",
            beginnerExplanation:
              "The log group needs a positive retention period so old application logs do not remain indefinitely.",
            technicalExplanation:
              "retentionDays must be a positive tagged integer. A retention value is not auto-selected because changing retention can delete log data.",
            affected: [
              nodeConfigurationLocation(node, nodeIndex, "retentionDays"),
            ],
          }),
        ];
      });
    },
  });
}

export function createLambdaRuntimeBoundsRuleV1(
  catalog: AwsValidationCatalogV1,
) {
  const descriptor = lambdaRuntimeBoundsValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];

      document.nodes.forEach((node, nodeIndex) => {
        if (node.semantic.serviceType !== "aws.lambda.function") {
          return;
        }
        const values = node.semantic.configuration.values;
        const timeoutSeconds = literalInteger(values, "timeoutSeconds");
        if (
          timeoutSeconds === undefined ||
          timeoutSeconds < 1 ||
          timeoutSeconds > 30
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-timeout-invalid",
              severity: "error",
              title: "Lambda timeout is outside the supported range",
              beginnerExplanation:
                "Choose a timeout from 1 through 30 seconds for the initial notes API.",
              technicalExplanation:
                "timeoutSeconds must be a tagged integer between 1 and 30 inclusive.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "timeoutSeconds"),
              ],
            }),
          );
        }

        const memoryMegabytes = literalInteger(values, "memoryMegabytes");
        if (
          memoryMegabytes === undefined ||
          ![128, 256, 512, 1024].includes(memoryMegabytes)
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-memory-invalid",
              severity: "error",
              title: "Lambda memory is outside the supported set",
              beginnerExplanation:
                "Choose one of the reviewed memory sizes for predictable notes API performance and cost.",
              technicalExplanation:
                "memoryMegabytes must be a tagged integer equal to 128, 256, 512, or 1024.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "memoryMegabytes"),
              ],
            }),
          );
        }

        if (!("workloadBehavior" in document)) {
          return;
        }
        const workloadIndex = document.workloadBehavior.workloads.findIndex(
          (workload) => workload.owningNodeId === node.id,
        );
        const workload = document.workloadBehavior.workloads[workloadIndex];
        if (
          workload === undefined ||
          workload.implementation.mode === "infrastructure-only"
        ) {
          return;
        }
        const mismatchSeverity =
          context.target === "draft" ? "warning" : "error";
        const runtime = literalString(values, "runtime");
        const expectedRuntimeFamily =
          runtime === "nodejs24.x"
            ? "aws.lambda.runtime-family.nodejs24"
            : undefined;
        if (workload.implementation.runtimeFamily !== expectedRuntimeFamily) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-workload-runtime-mismatch",
              severity: mismatchSeverity,
              title: "Lambda workload runtime does not match its function",
              beginnerExplanation:
                "Use the reviewed Node.js 24 workload family for this Lambda configuration.",
              technicalExplanation:
                "The catalog maps Lambda runtime nodejs24.x only to workload runtimeFamily aws.lambda.runtime-family.nodejs24; neither value is inferred or mutated.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "runtime"),
                {
                  kind: "document",
                  path: createValidationDocumentPath(
                    `$.workloadBehavior.workloads[${String(workloadIndex)}].implementation.runtimeFamily`,
                  ),
                },
              ],
            }),
          );
        }
        const handler = literalString(values, "handler");
        if (workload.implementation.handler !== handler) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.lambda-workload-handler-mismatch",
              severity: mismatchSeverity,
              title: "Lambda workload handler does not match its function",
              beginnerExplanation:
                "Use the same handler in the function and workload implementation settings.",
              technicalExplanation:
                "The Workload Behavior handler must exactly equal the Lambda node's tagged handler configuration; neither value is inferred or mutated.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "handler"),
                {
                  kind: "document",
                  path: createValidationDocumentPath(
                    `$.workloadBehavior.workloads[${String(workloadIndex)}].implementation.handler`,
                  ),
                },
              ],
            }),
          );
        }
      });

      return findings;
    },
  });
}
