import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";

import { iamPolicySafetyValidationRuleDescriptor } from "../catalog/validation-rules/index.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  edgeLocation,
  finding,
  literalString,
  nodeConfigurationLocation,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationDocument,
  type AwsValidationEdge,
  type AwsValidationNode,
} from "./rule-helpers.js";

const membershipRelationship = "aws.iam.policy-contains-statement";
const conditionRelationship = "aws.iam.statement-owns-condition";
const resourceScopes = [
  {
    relationshipType: "aws.iam.authorizes-dynamodb-table",
    sourcePort: "aws.iam.policy-statement.dynamodb-resource",
    targetServiceType: "aws.dynamodb.table",
    targetPort: "aws.dynamodb.table.policy-resource",
  },
  {
    relationshipType: "aws.iam.authorizes-lambda-function",
    sourcePort: "aws.iam.policy-statement.lambda-resource",
    targetServiceType: "aws.lambda.function",
    targetPort: "aws.lambda.function.policy-resource",
  },
  {
    relationshipType: "aws.iam.authorizes-log-group",
    sourcePort: "aws.iam.policy-statement.log-group-resource",
    targetServiceType: "aws.cloudwatch.log-group",
    targetPort: "aws.cloudwatch.log-group.policy-resource",
  },
] as const;

const roleSlotBindings = {
  trust: {
    relationshipType: "aws.iam.role-owns-trust-policy",
    sourceServiceType: "aws.iam.policy-document",
    sourcePort: "aws.iam.policy-document.role-trust-policy",
    targetPort: "aws.iam.role.trust-policy",
  },
  permissionsBoundary: {
    relationshipType: "aws.iam.role-owns-permissions-boundary",
    sourceServiceType: "aws.iam.managed-policy-attachment",
    sourcePort: "aws.iam.managed-policy-attachment.role-permissions-boundary",
    targetPort: "aws.iam.role.permissions-boundary",
  },
} as const;

const expectedPolicyKindByOwnerRelationship = new Map<string, string>([
  ["aws.iam.role-owns-trust-policy", "trust"],
  ["aws.iam.role-owns-inline-policy", "identity-inline"],
  ["aws.iam.role-owns-generated-permission", "generated-permission"],
  ["aws.lambda.owns-invocation-permission", "service-grant"],
  ["aws.ec2.gateway-endpoint-owns-policy", "resource"],
  ["aws.s3.bucket-owns-resource-policy", "resource"],
  ["aws.kms.key-owns-resource-policy", "resource"],
  ["aws.sqs.queue-owns-resource-policy", "resource"],
  ["aws.sns.topic-owns-resource-policy", "resource"],
  ["aws.eventbridge.event-bus-owns-resource-policy", "resource"],
]);

// These relationships already exist in the pinned catalog. Unknown or malformed
// edges cannot establish ownership or satisfy resource scope.
const eventResourceScopes = new Set([
  "aws.iam.authorizes-secret",
  "aws.iam.authorizes-kms-key",
  "aws.iam.authorizes-s3-bucket",
  "aws.iam.authorizes-sqs-queue",
  "aws.iam.authorizes-sns-topic",
  "aws.iam.authorizes-eventbridge-bus",
]);
function matchesCatalogPolicyConnection(
  document: AwsValidationDocument,
  edge: AwsValidationEdge,
  catalog: AwsValidationCatalogV1,
): boolean {
  const rule = catalog.connectionRules.find(
    (candidate) =>
      candidate.relationshipType === edge.semantic.relationshipType,
  );
  if (rule === undefined) return false;
  return (
    edge.semantic.source.port === rule.source.portId &&
    edge.semantic.target.port === rule.target.portId &&
    edge.semantic.configuration.schemaId === rule.configuration.schemaId &&
    edge.semantic.configuration.schemaVersion ===
      rule.configuration.schemaVersion &&
    document.nodes.find((node) => node.id === edge.semantic.source.nodeId)
      ?.semantic.serviceType === rule.source.serviceId &&
    document.nodes.find((node) => node.id === edge.semantic.target.nodeId)
      ?.semantic.serviceType === rule.target.serviceId
  );
}

const reviewedDynamoDbActions = new Set([
  "dynamodb:DeleteItem",
  "dynamodb:GetItem",
  "dynamodb:PutItem",
  "dynamodb:Query",
  "dynamodb:UpdateItem",
]);

function stringList(
  node: AwsValidationNode,
  key: string,
): readonly string[] | undefined {
  const value = configurationValue(node.semantic.configuration.values, key);
  return value?.kind === "string-list" ? value.value : undefined;
}

function statementMembershipEdges(
  document: AwsValidationDocument,
  statementId: string,
) {
  return document.edges.filter(
    (edge) =>
      edge.semantic.relationshipType === membershipRelationship &&
      edge.semantic.source.nodeId === statementId &&
      edge.semantic.source.port ===
        "aws.iam.policy-statement.policy-document" &&
      edge.semantic.target.port === "aws.iam.policy-document.statement",
  );
}

function statementConditionNodes(
  document: AwsValidationDocument,
  statementId: string,
): readonly AwsValidationNode[] {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  return document.edges
    .filter(
      (edge) =>
        edge.semantic.relationshipType === conditionRelationship &&
        edge.semantic.source.port ===
          "aws.iam.policy-condition.statement-condition" &&
        edge.semantic.target.nodeId === statementId &&
        edge.semantic.target.port === "aws.iam.policy-statement.condition",
    )
    .map((edge) => nodesById.get(edge.semantic.source.nodeId))
    .filter(
      (node): node is AwsValidationNode =>
        node?.semantic.serviceType === "aws.iam.policy-condition",
    );
}

function statementResourceKeys(
  document: AwsValidationDocument,
  statement: AwsValidationNode,
  catalog: AwsValidationCatalogV1,
): readonly string[] {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const graphResources = document.edges
    .filter((edge) => {
      if (edge.semantic.source.nodeId !== statement.id) {
        return false;
      }
      if (eventResourceScopes.has(edge.semantic.relationshipType)) {
        return matchesCatalogPolicyConnection(document, edge, catalog);
      }
      const scope = resourceScopes.find(
        (candidate) =>
          edge.semantic.relationshipType === candidate.relationshipType &&
          edge.semantic.source.port === candidate.sourcePort &&
          edge.semantic.target.port === candidate.targetPort,
      );
      return (
        scope !== undefined &&
        nodesById.get(edge.semantic.target.nodeId)?.semantic.serviceType ===
          scope.targetServiceType
      );
    })
    .map((edge) => `node:${String(edge.semantic.target.nodeId)}`);
  const expressions = (stringList(statement, "resourceExpressions") ?? []).map(
    (value) => `expression:${value}`,
  );
  const legacyReference = configurationValue(
    statement.semantic.configuration.values,
    "resourceNode",
  );
  if (legacyReference?.kind === "node-reference") {
    graphResources.push(`node:${String(legacyReference.nodeId)}`);
  }
  return [...new Set([...graphResources, ...expressions])].sort();
}

function conditionKey(node: AwsValidationNode): string {
  return JSON.stringify({
    operator: literalString(node.semantic.configuration.values, "operator"),
    key: literalString(node.semantic.configuration.values, "key"),
    values: [...(stringList(node, "values") ?? [])].sort(),
  });
}

function statementEquivalenceKey(
  document: AwsValidationDocument,
  statement: AwsValidationNode,
  catalog: AwsValidationCatalogV1,
): string {
  return JSON.stringify({
    effect: literalString(statement.semantic.configuration.values, "effect"),
    actions: [...(stringList(statement, "actions") ?? [])].sort(),
    resources: statementResourceKeys(document, statement, catalog),
    principalKind: literalString(
      statement.semantic.configuration.values,
      "principalKind",
    ),
    principals: [...(stringList(statement, "principals") ?? [])].sort(),
    conditions: statementConditionNodes(document, String(statement.id))
      .map(conditionKey)
      .sort(),
  });
}

function validatePolicyOwner(
  document: AwsValidationDocument,
  node: AwsValidationNode,
  nodeIndex: number,
  catalog: AwsValidationCatalogV1,
): readonly ValidationFindingCandidate[] {
  const descriptor = iamPolicySafetyValidationRuleDescriptor;
  const ownerEdges = document.edges.filter(
    (edge) =>
      expectedPolicyKindByOwnerRelationship.has(
        String(edge.semantic.relationshipType),
      ) && edge.semantic.source.nodeId === node.id,
  );
  const policyKind = literalString(
    node.semantic.configuration.values,
    "policyKind",
  );
  const ownerEdge = ownerEdges[0];
  const expectedKind = expectedPolicyKindByOwnerRelationship.get(
    String(ownerEdge?.semantic.relationshipType),
  );
  const exactResourceOwner =
    expectedKind !== "resource" ||
    (ownerEdge !== undefined &&
      matchesCatalogPolicyConnection(document, ownerEdge, catalog) &&
      node.semantic.parent?.nodeId === ownerEdge.semantic.target.nodeId &&
      node.semantic.parent.relationshipType ===
        ownerEdge.semantic.relationshipType);
  if (ownerEdges.length !== 1 || !exactResourceOwner) {
    return [
      finding(descriptor, {
        code: "aws.validation.iam-policy-owner-invalid",
        severity: "security-error",
        title: "IAM policy must have exactly one declared owner slot",
        beginnerExplanation:
          "This policy is not attached to one clear role or service configuration.",
        technicalExplanation:
          "A canonical policy-document node must have exactly one exact owner-slot edge; ownership is never inferred from layout or transient UI state.",
        affected: [nodeLocation(node, nodeIndex)],
      }),
    ];
  }
  if (policyKind === expectedKind) {
    return [];
  }
  return [
    finding(descriptor, {
      code: "aws.validation.iam-policy-kind-owner-mismatch",
      severity: "security-error",
      title: "IAM policy kind does not match its owner slot",
      beginnerExplanation:
        "This policy was placed in a role or service section with a different security purpose.",
      technicalExplanation: `The exact owner relationship requires policyKind=${String(expectedKind)} but the node declares ${String(policyKind)}.`,
      affected: [nodeConfigurationLocation(node, nodeIndex, "policyKind")],
    }),
  ];
}

function exactRoleSlotEdges(
  document: AwsValidationDocument,
  nodesById: ReadonlyMap<
    AwsValidationDocument["nodes"][number]["id"],
    AwsValidationNode
  >,
  roleNode: AwsValidationNode,
  binding: (typeof roleSlotBindings)[keyof typeof roleSlotBindings],
) {
  return document.edges
    .map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(
      ({ edge }) =>
        edge.semantic.relationshipType === binding.relationshipType &&
        edge.semantic.source.port === binding.sourcePort &&
        edge.semantic.target.nodeId === roleNode.id &&
        edge.semantic.target.port === binding.targetPort &&
        nodesById.get(edge.semantic.source.nodeId)?.semantic.serviceType ===
          binding.sourceServiceType,
    );
}

export function createIamPolicySafetyRuleV1(catalog: AwsValidationCatalogV1) {
  const descriptor = iamPolicySafetyValidationRuleDescriptor;
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (document === undefined) {
        return [];
      }
      const findings: ValidationFindingCandidate[] = [];
      const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
      const statementKeysByDocument = new Map<string, Map<string, string>>();
      const rolesByName = new Map<
        string,
        { readonly node: AwsValidationNode; readonly index: number }
      >();

      document.nodes.forEach((node, nodeIndex) => {
        if (
          [
            "aws.iam.role",
            "aws.iam.policy-document",
            "aws.iam.policy-statement",
            "aws.iam.policy-condition",
            "aws.iam.managed-policy-attachment",
          ].includes(String(node.semantic.serviceType))
        ) {
          const service = catalog.services.find(
            (entry) => entry.id === node.semantic.serviceType,
          );
          if (service !== undefined) {
            const result = validateProviderConfigurationV1(
              service.configuration,
              node.semantic.configuration.values,
            );
            if (!result.success)
              for (const issue of result.issues) {
                const key = /^\$\.values\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(
                  issue.path,
                )?.[1];
                findings.push(
                  finding(descriptor, {
                    code: "aws.validation.iam-configuration-invalid",
                    severity: "error",
                    title:
                      "IAM configuration does not satisfy its catalog field",
                    beginnerExplanation:
                      "Correct the indicated IAM setting before exporting. Declared values and permissions are never replaced automatically.",
                    technicalExplanation: issue.message,
                    affected: [
                      key === undefined
                        ? nodeLocation(
                            node,
                            nodeIndex,
                            ".semantic.configuration.values",
                          )
                        : nodeConfigurationLocation(node, nodeIndex, key),
                    ],
                  }),
                );
              }
          }
        }
        if (node.semantic.serviceType === "aws.iam.role") {
          const name = literalString(
            node.semantic.configuration.values,
            "roleName",
          );
          if (name !== undefined && name.length > 0) {
            const key = name.toLowerCase();
            const previous = rolesByName.get(key);
            if (previous !== undefined) {
              findings.push(
                finding(descriptor, {
                  code: "aws.validation.iam-role-name-duplicate",
                  severity: "error",
                  title: "IAM role names must be unique within the account",
                  beginnerExplanation:
                    "Give these roles different names. AWS compares role names without letter case; export never renames a role automatically.",
                  technicalExplanation:
                    "One Architecture models one AWS account. Distinct role nodes cannot declare the same case-insensitive account-wide IAM role name; existing AWS availability still requires separate verification.",
                  affected: [
                    nodeConfigurationLocation(
                      previous.node,
                      previous.index,
                      "roleName",
                    ),
                    nodeConfigurationLocation(node, nodeIndex, "roleName"),
                  ],
                }),
              );
            } else rolesByName.set(key, { node, index: nodeIndex });
          }
          const trustEdges = exactRoleSlotEdges(
            document,
            nodesById,
            node,
            roleSlotBindings.trust,
          );
          if (trustEdges.length === 0) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-role-trust-policy-missing",
                severity:
                  context.target === "draft" ? "warning" : "security-error",
                title: "IAM role needs exactly one trust policy",
                beginnerExplanation:
                  "Choose who or what may use this role before treating the architecture as ready.",
                technicalExplanation:
                  "A deployable IAM role requires one exact canonical role-trust-policy owner binding.",
                affected: [nodeLocation(node, nodeIndex)],
              }),
            );
          } else if (trustEdges.length > 1) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-role-trust-policy-duplicate",
                severity: "security-error",
                title: "IAM role has multiple trust policies",
                beginnerExplanation:
                  "Keep exactly one trust policy that clearly identifies who may use this role.",
                technicalExplanation:
                  "The exclusive role trust-policy slot has multiple exact canonical owner bindings.",
                affected: trustEdges.map(({ edge, edgeIndex }) =>
                  edgeLocation(edge, edgeIndex),
                ),
              }),
            );
          }

          const boundaryEdges = exactRoleSlotEdges(
            document,
            nodesById,
            node,
            roleSlotBindings.permissionsBoundary,
          );
          if (boundaryEdges.length > 1) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-role-permissions-boundary-duplicate",
                severity: "security-error",
                title: "IAM role has multiple permissions boundaries",
                beginnerExplanation:
                  "Keep at most one boundary that limits this role's maximum permissions.",
                technicalExplanation:
                  "The exclusive permissions-boundary slot has multiple exact canonical owner bindings.",
                affected: boundaryEdges.map(({ edge, edgeIndex }) =>
                  edgeLocation(edge, edgeIndex),
                ),
              }),
            );
          }
          return;
        }
        if (node.semantic.serviceType === "aws.iam.policy-document") {
          findings.push(
            ...validatePolicyOwner(document, node, nodeIndex, catalog),
          );
          return;
        }
        if (node.semantic.serviceType === "aws.iam.managed-policy-attachment") {
          const kind = literalString(
            node.semantic.configuration.values,
            "attachmentKind",
          );
          const ownerEdges = document.edges.filter(
            (edge) =>
              edge.semantic.source.nodeId === node.id &&
              (edge.semantic.relationshipType ===
                "aws.iam.role-owns-managed-policy-attachment" ||
                edge.semantic.relationshipType ===
                  "aws.iam.role-owns-permissions-boundary"),
          );
          const expected =
            ownerEdges[0]?.semantic.relationshipType ===
            "aws.iam.role-owns-permissions-boundary"
              ? "permissions-boundary"
              : "managed-policy-attachment";
          if (ownerEdges.length !== 1 || kind !== expected) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-managed-policy-owner-invalid",
                severity: "security-error",
                title: "Managed policy kind does not match one role slot",
                beginnerExplanation:
                  "Choose whether this reference grants permissions or limits them as a permissions boundary.",
                technicalExplanation:
                  "The attachment node requires one exact owner edge and a matching attachmentKind.",
                affected: [
                  nodeConfigurationLocation(node, nodeIndex, "attachmentKind"),
                ],
              }),
            );
          }
          return;
        }
        if (node.semantic.serviceType === "aws.iam.policy-condition") {
          const conditionEdges = document.edges.filter(
            (edge) =>
              edge.semantic.relationshipType === conditionRelationship &&
              edge.semantic.source.nodeId === node.id,
          );
          const values = stringList(node, "values");
          if (
            conditionEdges.length !== 1 ||
            literalString(node.semantic.configuration.values, "operator") ===
              undefined ||
            literalString(node.semantic.configuration.values, "key") ===
              undefined ||
            values === undefined ||
            values.length === 0
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-condition-malformed",
                severity: "security-error",
                title: "IAM policy condition is incomplete",
                beginnerExplanation:
                  "Choose one supported operator, key, value set, and parent statement.",
                technicalExplanation:
                  "A canonical condition requires one exact membership edge plus non-empty typed operator, key, and values.",
                affected: [nodeLocation(node, nodeIndex)],
              }),
            );
          }
          return;
        }
        if (node.semantic.serviceType !== "aws.iam.policy-statement") {
          return;
        }

        const membershipEdges = statementMembershipEdges(document, node.id);
        if (membershipEdges.length !== 1) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-statement-owner-invalid",
              severity: "security-error",
              title: "IAM statement must belong to exactly one policy document",
              beginnerExplanation:
                "Move this statement into one clear trust, custom, generated, or service policy.",
              technicalExplanation:
                "Canonical statements require one exact policy-membership edge. Legacy direct-role statements require the explicit catalog migration.",
              affected: [nodeLocation(node, nodeIndex)],
            }),
          );
          return;
        }
        const membershipEdge = membershipEdges[0];
        if (membershipEdge === undefined) {
          return;
        }
        const documentId = String(membershipEdge.semantic.target.nodeId);
        const policyDocument = nodesById.get(
          membershipEdge.semantic.target.nodeId,
        );
        if (
          policyDocument?.semantic.serviceType !== "aws.iam.policy-document"
        ) {
          return;
        }

        const values = node.semantic.configuration.values;
        const effect = literalString(values, "effect");
        const actions = stringList(node, "actions");
        const principalKind = literalString(values, "principalKind");
        const principals = stringList(node, "principals");
        const policyKind = literalString(
          policyDocument.semantic.configuration.values,
          "policyKind",
        );
        const resources = statementResourceKeys(document, node, catalog);

        if (effect !== "allow" && effect !== "deny") {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-effect-invalid",
              severity: "security-error",
              title: "IAM statement effect is invalid",
              beginnerExplanation: "Choose Allow or Deny for this statement.",
              technicalExplanation:
                "Canonical policy effects are the closed lower-case values allow and deny.",
              affected: [nodeConfigurationLocation(node, nodeIndex, "effect")],
            }),
          );
        }
        if (actions === undefined || actions.length === 0) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-actions-empty",
              severity: "security-error",
              title: "IAM statement needs at least one action",
              beginnerExplanation:
                "Choose the exact operations this permission should allow or deny.",
              technicalExplanation:
                "Canonical statements reject empty action collections.",
              affected: [nodeConfigurationLocation(node, nodeIndex, "actions")],
            }),
          );
        }
        for (const action of actions ?? []) {
          if (action.includes("*")) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-wildcard-action",
                severity: "security-error",
                title: "IAM action contains a wildcard",
                beginnerExplanation:
                  "Choose exact operations instead of all actions.",
                technicalExplanation:
                  "Unrestricted or partial action wildcards block target readiness.",
                affected: [
                  nodeConfigurationLocation(node, nodeIndex, "actions"),
                ],
              }),
            );
          }
          if (
            action.startsWith("dynamodb:") &&
            !reviewedDynamoDbActions.has(action)
          ) {
            findings.push(
              finding(descriptor, {
                code: "aws.validation.iam-action-service-unsupported",
                severity: "security-error",
                title: "IAM action is outside the reviewed DynamoDB set",
                beginnerExplanation:
                  "This DynamoDB operation has not been reviewed for the current catalog.",
                technicalExplanation: `${action} is not present in the version-bound DynamoDB action evidence.`,
                affected: [
                  nodeConfigurationLocation(node, nodeIndex, "actions"),
                ],
              }),
            );
          }
        }
        if (resources.some((resource) => resource.includes("*"))) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-wildcard-resource",
              severity: "security-error",
              title: "IAM resource contains a wildcard",
              beginnerExplanation:
                "Choose architecture resources or approved exact values instead of every resource.",
              technicalExplanation:
                "Unrestricted or partial resource wildcards block target readiness.",
              affected: [
                nodeConfigurationLocation(
                  node,
                  nodeIndex,
                  "resourceExpressions",
                ),
              ],
            }),
          );
        }
        const forbidsPrincipals =
          policyKind === "identity-inline" ||
          policyKind === "generated-permission";
        const requiresPrincipals =
          policyKind === "trust" ||
          policyKind === "resource" ||
          policyKind === "service-grant";
        if (
          principalKind === undefined ||
          principals === undefined ||
          (principalKind === "none" && principals.length > 0) ||
          (principalKind !== "none" && principals.length === 0) ||
          (forbidsPrincipals && principals.length > 0) ||
          (requiresPrincipals && principals.length === 0)
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-principal-invalid",
              severity: "security-error",
              title: "IAM principals do not match the policy kind",
              beginnerExplanation:
                "Trust and service policies identify who may act; role permission policies must not add a principal.",
              technicalExplanation:
                "Principal kind, values, and policy-kind constraints are inconsistent.",
              affected: [
                nodeConfigurationLocation(node, nodeIndex, "principals"),
              ],
            }),
          );
        }
        if (policyKind !== "trust" && resources.length === 0) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-resource-missing",
              severity: "security-error",
              title: "IAM statement needs a resource scope",
              beginnerExplanation:
                "Choose the architecture resources this permission may affect.",
              technicalExplanation:
                "Every non-trust canonical statement requires at least one typed resource or explicit advanced expression.",
              affected: [nodeLocation(node, nodeIndex)],
            }),
          );
        }

        const equivalenceKey = statementEquivalenceKey(document, node, catalog);
        const statementKeys =
          statementKeysByDocument.get(documentId) ?? new Map<string, string>();
        const duplicateNodeId = statementKeys.get(equivalenceKey);
        if (duplicateNodeId !== undefined) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-statement-duplicate",
              severity: "warning",
              title: "IAM policy contains an equivalent duplicate statement",
              beginnerExplanation:
                "These two statements describe the same permission and may be confusing.",
              technicalExplanation: `Statement ${String(node.id)} is equivalent to ${duplicateNodeId} after deterministic normalization.`,
              affected: [nodeLocation(node, nodeIndex)],
            }),
          );
        } else {
          statementKeys.set(equivalenceKey, String(node.id));
          statementKeysByDocument.set(documentId, statementKeys);
        }
      });

      document.edges.forEach((edge, edgeIndex) => {
        if (
          edge.semantic.relationshipType ===
            "aws.iam.role-owns-generated-permission" &&
          nodesById.get(edge.semantic.source.nodeId)?.semantic.lifecycle
            .ownership === "user"
        ) {
          findings.push(
            finding(descriptor, {
              code: "aws.validation.iam-generated-ownership-invalid",
              severity: "security-error",
              title: "Generated permission lost its generated provenance",
              beginnerExplanation:
                "Adopt a generated permission explicitly before customizing its ownership.",
              technicalExplanation:
                "The generated-permission slot cannot contain a user-owned node without the explicit adopted lifecycle.",
              affected: [edgeLocation(edge, edgeIndex)],
            }),
          );
        }
      });

      return findings;
    },
  });
}
