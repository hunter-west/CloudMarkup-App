import { awsEbsConnectionRules } from "./catalog/connections/ebs-connections.js";
import { awsElbConnectionRules } from "./catalog/connections/elb-connections.js";
import { awsCloudfrontConnectionRules } from "./catalog/connections/cloudfront-connections.js";
import { awsDnsConnectionRules } from "./catalog/connections/dns-acm-connections.js";
import { awsAuroraConnectionRules } from "./catalog/connections/aurora-connections.js";
import { awsRdsConnectionRules } from "./catalog/connections/rds-connections.js";
import { awsEcsConnectionRules } from "./catalog/connections/ecs-connections.js";
import { awsEc2ConnectionRules } from "./catalog/connections/ec2-connections.js";
import { awsSecretConnectionRules } from "./catalog/connections/secrets-connections.js";
import {
  createProviderConnectionResolverV1,
  defineProviderConnectionRuleRegistrationV1,
  type ProviderConnectionRecipeContextV1,
  type ProviderConnectionRecipeResultV1,
  type ProviderConnectionResolutionFindingV1,
} from "@cloudmarkup/provider-sdk";
import {
  serializeCanonicalJson,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import { awsLambdaS3ConnectionRules } from "./catalog/connections/lambda-s3-connections.js";
import { awsFsxConnectionRules } from "./catalog/connections/fsx-connections.js";
import { awsEventDrivenConnectionRulesV1 } from "./catalog/connections/event-driven-connections.js";

import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";

function literalString(
  context: ProviderConnectionRecipeContextV1,
  property: string,
): string | undefined {
  const value = (
    context.configuration as Readonly<
      Record<string, { kind: string; value?: unknown }>
    >
  )[property];
  return value?.kind === "string" && typeof value.value === "string"
    ? value.value
    : undefined;
}

function literalConfigurationValue(
  context: ProviderConnectionRecipeContextV1,
  property: string,
): string | number | boolean | undefined {
  const value = (
    context.configuration as Readonly<
      Record<string, { kind: string; value?: unknown }>
    >
  )[property]?.value;
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function ruleFinding(
  context: ProviderConnectionRecipeContextV1,
  trigger: "missing-prerequisite" | "ambiguous-prerequisite",
  severity: "error" | "warning" = "error",
): ProviderConnectionResolutionFindingV1 {
  const descriptor = context.rule.missingInformationFindings.find(
    (candidate) => candidate.trigger === trigger,
  );
  if (descriptor === undefined) {
    throw new TypeError(
      "Connection recipe is missing its catalog finding descriptor.",
    );
  }
  return Object.freeze({
    code: descriptor.code,
    severity,
    path: "$.document.edges",
    guidedMessage: descriptor.guidedMessage,
    professionalMessage: descriptor.professionalMessage,
  });
}

function ruleFindingByCode(
  context: ProviderConnectionRecipeContextV1,
  code: string,
): ProviderConnectionResolutionFindingV1 {
  const descriptor = context.rule.missingInformationFindings.find(
    (candidate) => candidate.code === code,
  );
  if (descriptor === undefined) {
    throw new TypeError(
      `Connection recipe is missing catalog finding descriptor ${code}.`,
    );
  }
  return Object.freeze({
    code: descriptor.code,
    severity: "error",
    path: "$.document.edges",
    guidedMessage: descriptor.guidedMessage,
    professionalMessage: descriptor.professionalMessage,
  });
}

function emptyPlan(): ProviderConnectionRecipeResultV1 {
  return Object.freeze({
    success: true,
    commands: Object.freeze([]),
    generatedResources: Object.freeze([]),
  });
}

const eventDrivenRegistrations = [
  ...awsEventDrivenConnectionRulesV1,
  ...awsLambdaS3ConnectionRules,
].map((rule) => {
  if (rule.implementation.status !== "implemented") {
    throw new TypeError(
      `Event connection rule ${String(rule.id)} must remain explicitly implemented.`,
    );
  }
  return defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: rule.id,
    ruleVersion: rule.ruleVersion,
    implementationId: rule.implementation.implementationId,
    resolve: resolveEventPermissions,
  });
});
type RecipeNode = ProviderConnectionRecipeContextV1["sourceNode"];

interface GeneratedPolicyScope {
  readonly node: RecipeNode;
  readonly nodeAttribute: string;
  readonly statementPort: string;
  readonly resourcePort: string;
  readonly relationshipType: string;
  readonly connectionRuleId: string;
  readonly edgeKey: string;
  readonly commandKey: string;
}

interface GeneratedPolicyDefinition {
  readonly ownerNode: RecipeNode;
  readonly ownerRelationshipType: string;
  readonly policyDocumentPort: string;
  readonly ownerPort: string;
  readonly ownerConnectionRuleId: string;
  readonly policyKind:
    | "trust"
    | "identity-inline"
    | "resource"
    | "generated-permission"
    | "service-grant";
  readonly policyName: string;
  readonly statementId: string;
  readonly actions: readonly string[];
  readonly principalKind:
    | "none"
    | "service"
    | "architecture-node"
    | "provider-identity"
    | "federated"
    | "all-principals";
  readonly principals: readonly string[];
  readonly label: string;
  readonly nodeOffset: Readonly<{ x: number; y: number }>;
  readonly policyDocumentKey: string;
  readonly policyStatementKey: string;
  readonly ownerEdgeKey: string;
  readonly statementEdgeKey: string;
  readonly commandPrefix: string;
  readonly scope?: GeneratedPolicyScope;
}

/** Reviewed relationships only; an IAM descriptor alone never selects a recipe. */
const eventPermissionRecipes: Readonly<
  Record<
    string,
    {
      actions: readonly string[];
      principal?: string;
      kind: "trust" | "service-grant" | "resource" | "generated-permission";
      role?: string;
      sourceScope?: boolean;
      parent?: string;
    }
  >
> = {
  "aws.iam.role-assumed-by-step-functions": {
    kind: "trust",
    actions: ["sts:AssumeRole"],
    principal: "states.amazonaws.com",
  },
  "aws.iam.role-assumed-by-eventbridge-target": {
    kind: "trust",
    actions: ["sts:AssumeRole"],
    principal: "events.amazonaws.com",
  },
  "aws.cloudfront.reads-s3-origin": {
    kind: "resource",
    actions: ["s3:GetObject"],
    principal: "cloudfront.amazonaws.com",
  },
  "aws.s3.notifies-lambda": {
    kind: "service-grant",
    actions: ["lambda:InvokeFunction"],
    principal: "s3.amazonaws.com",
  },
  "aws.sns.subscription-invokes-lambda": {
    kind: "service-grant",
    actions: ["lambda:InvokeFunction"],
    principal: "sns.amazonaws.com",
    parent: "aws.sns.topic-owns-subscription",
  },
  "aws.eventbridge.target-invokes-lambda": {
    kind: "service-grant",
    actions: ["lambda:InvokeFunction"],
    principal: "events.amazonaws.com",
    parent: "aws.eventbridge.rule-owns-target",
  },
  "aws.sns.subscription-sends-to-sqs": {
    kind: "resource",
    actions: ["sqs:SendMessage"],
    principal: "sns.amazonaws.com",
    parent: "aws.sns.topic-owns-subscription",
  },
  "aws.eventbridge.target-sends-to-sqs": {
    kind: "resource",
    actions: ["sqs:SendMessage"],
    principal: "events.amazonaws.com",
    parent: "aws.eventbridge.rule-owns-target",
  },
  "aws.eventbridge.target-publishes-to-sns": {
    kind: "resource",
    actions: ["sns:Publish"],
    principal: "events.amazonaws.com",
    parent: "aws.eventbridge.rule-owns-target",
  },
  "aws.eventbridge.target-uses-dead-letter-queue": {
    kind: "resource",
    actions: ["sqs:SendMessage"],
    principal: "events.amazonaws.com",
    parent: "aws.eventbridge.rule-owns-target",
  },
  "aws.lambda.sends-message-to-sqs": {
    kind: "generated-permission",
    actions: ["sqs:SendMessage"],
    role: "aws.iam.role-assumed-by-lambda",
  },
  "aws.lambda.uses-sqs-dead-letter-queue": {
    kind: "generated-permission",
    actions: ["sqs:SendMessage"],
    role: "aws.iam.role-assumed-by-lambda",
  },
  "aws.sqs.triggers-lambda": {
    kind: "generated-permission",
    actions: [
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
    ],
    role: "aws.iam.role-assumed-by-lambda",
    sourceScope: true,
  },
  "aws.lambda.publishes-to-sns": {
    kind: "generated-permission",
    actions: ["sns:Publish"],
    role: "aws.iam.role-assumed-by-lambda",
  },
  "aws.lambda.puts-events-on-eventbridge": {
    kind: "generated-permission",
    actions: ["events:PutEvents"],
    role: "aws.iam.role-assumed-by-lambda",
  },
  "aws.lambda.starts-step-functions-state-machine": {
    kind: "generated-permission",
    actions: ["states:StartExecution"],
    role: "aws.iam.role-assumed-by-lambda",
  },
  "aws.stepfunctions.state-machine-invokes-lambda": {
    kind: "generated-permission",
    actions: ["lambda:InvokeFunction"],
    role: "aws.iam.role-assumed-by-step-functions",
  },
  "aws.eventbridge.target-starts-state-machine": {
    kind: "generated-permission",
    actions: ["states:StartExecution"],
    role: "aws.iam.role-assumed-by-eventbridge-target",
    parent: "aws.eventbridge.rule-owns-target",
  },
  "aws.lambda.reads-s3-bucket": {
    kind: "generated-permission",
    actions: ["s3:GetObject"],
    role: "aws.iam.role-assumed-by-lambda",
  },
  "aws.lambda.writes-s3-bucket": {
    kind: "generated-permission",
    actions: ["s3:PutObject"],
    role: "aws.iam.role-assumed-by-lambda",
  },
};
function eventPermissionFinding(
  message: string,
): ProviderConnectionRecipeResultV1 {
  return {
    success: false,
    findings: [
      {
        code: "aws.eventing.finding.permission-prerequisite",
        severity: "error",
        path: "$.document.edges",
        guidedMessage: message,
        professionalMessage:
          message + " No connection or generated IAM resources were applied.",
      },
    ],
  };
}
function exactIncomingOwner(
  context: ProviderConnectionRecipeContextV1,
  node: RecipeNode,
  relationshipType: string,
): RecipeNode | undefined {
  const rules = awsCatalogArtifactV1.connectionRules.filter(
    (rule) => rule.relationshipType === relationshipType,
  );
  const rule = rules[0];
  if (rules.length !== 1 || !rule) return undefined;
  const edges = context.document.edges.filter(
    (edge) =>
      edge.semantic.relationshipType === relationshipType &&
      edge.semantic.target.nodeId === node.id,
  );
  const edge = edges[0];
  if (edges.length !== 1 || !edge) return undefined;
  if (
    edge.semantic.source.port !== rule.source.portId ||
    edge.semantic.target.port !== rule.target.portId ||
    node.semantic.serviceType !== rule.target.serviceId
  )
    return undefined;
  return context.document.nodes.find(
    (owner) =>
      owner.id === edge.semantic.source.nodeId &&
      owner.semantic.serviceType === rule.source.serviceId,
  );
}
function resolveEventPermissions(
  context: ProviderConnectionRecipeContextV1,
): ProviderConnectionRecipeResultV1 {
  if (
    context.rule.relationshipType === "aws.eventbridge.target-publishes-to-sns"
  ) {
    return eventPermissionFinding(
      "EventBridge cannot publish to the current AWS-managed KMS SNS topics. Customer-managed topic keys are outside this catalog; choose a supported Lambda or Standard SQS target.",
    );
  }
  const recipe = eventPermissionRecipes[context.rule.relationshipType];
  if (recipe === undefined) {
    if (context.rule.iamEffects.length !== 0)
      throw new TypeError(
        "Event IAM effects require a reviewed relationship recipe.",
      );
    return emptyPlan();
  }
  const effect = context.rule.iamEffects[0];
  if (
    context.rule.iamEffects.length !== 1 ||
    effect === undefined ||
    effect.when !== undefined ||
    effect.effect !== (recipe.kind === "trust" ? "trust" : "allow") ||
    effect.resourceScope !==
      (recipe.kind === "trust" || recipe.sourceScope
        ? "source-node"
        : "target-node") ||
    effect.principal !== recipe.principal ||
    serializeCanonicalJson(effect.actions) !==
      serializeCanonicalJson(recipe.actions)
  )
    throw new TypeError(
      "Event IAM recipe does not match the exact reviewed descriptor.",
    );
  if (
    recipe.parent !== undefined &&
    exactIncomingOwner(context, context.sourceNode, recipe.parent) === undefined
  )
    return eventPermissionFinding(
      "Connect exactly one owning topic or EventBridge rule before adding this delivery.",
    );
  const scopedNode = recipe.sourceScope
    ? context.sourceNode
    : context.targetNode;
  const workload = recipe.sourceScope ? context.targetNode : context.sourceNode;
  const owner =
    recipe.kind === "trust"
      ? context.sourceNode
      : recipe.role
        ? exactIncomingOwner(context, workload, recipe.role)
        : context.targetNode;
  if (owner === undefined)
    return eventPermissionFinding(
      "Connect exactly one execution role to the workload before adding this permission.",
    );
  const suffix =
    recipe.kind === "trust"
      ? "trust-policy"
      : recipe.kind === "generated-permission"
        ? "generated-permission"
        : recipe.kind === "service-grant"
          ? "invocation-permission"
          : "resource-policy";
  const ownership = awsCatalogArtifactV1.connectionRules.filter(
    (rule) =>
      rule.source.serviceId === "aws.iam.policy-document" &&
      rule.target.serviceId === owner.semantic.serviceType &&
      rule.target.portId === owner.semantic.serviceType + "." + suffix,
  );
  const ownerRule = ownership[0];
  if (ownership.length !== 1 || !ownerRule)
    throw new TypeError("Event permission owner slot is not exact.");
  if (
    (recipe.kind === "trust" || recipe.kind === "resource") &&
    (context.document.edges.some(
      (edge) =>
        edge.semantic.relationshipType === ownerRule.relationshipType &&
        edge.semantic.target.nodeId === owner.id,
    ) ||
      context.document.nodes.some(
        (node) =>
          node.semantic.parent?.nodeId === owner.id &&
          node.semantic.parent.relationshipType === ownerRule.relationshipType,
      ))
  )
    return eventPermissionFinding(
      "This resource already has a policy in its owner slot. Review its existing policy before adding another delivery or trust relationship.",
    );
  const scopes = awsCatalogArtifactV1.connectionRules.filter(
    (rule) =>
      rule.source.serviceId === "aws.iam.policy-statement" &&
      rule.target.serviceId === scopedNode.semantic.serviceType &&
      rule.relationshipType.startsWith("aws.iam.authorizes-"),
  );
  const scoped = recipe.kind !== "trust";
  if (scoped && scopes.length !== 1)
    throw new TypeError("Event permission resource scope is not exact.");
  const scopeRule = scopes[0];
  return materializeGeneratedPolicy(context, {
    ownerNode: owner,
    ownerRelationshipType: ownerRule.relationshipType,
    policyDocumentPort: ownerRule.source.portId,
    ownerPort: ownerRule.target.portId,
    ownerConnectionRuleId: ownerRule.id,
    policyKind: recipe.kind,
    policyName:
      "EventPermission" +
      digestCanonicalValue({
        operationId: context.operationId,
        ruleId: context.rule.id,
      }).slice(-32),
    statementId: "EventConnectionPermission",
    actions: recipe.actions,
    principalKind: recipe.principal === undefined ? "none" : "service",
    principals: recipe.principal === undefined ? [] : [recipe.principal],
    label:
      recipe.kind === "trust"
        ? "Service execution trust"
        : "Event connection permission",
    nodeOffset: { x: 160, y: 120 },
    policyDocumentKey: "event-policy-document",
    policyStatementKey: "event-policy-statement",
    ownerEdgeKey: "event-policy-owner",
    statementEdgeKey: "event-policy-membership",
    commandPrefix: "event-policy",
    ...(scoped && scopeRule
      ? {
          scope: {
            node: scopedNode,
            nodeAttribute: scopedNode.semantic.serviceType + ".arn",
            statementPort: scopeRule.source.portId,
            resourcePort: scopeRule.target.portId,
            relationshipType: scopeRule.relationshipType,
            connectionRuleId: scopeRule.id,
            edgeKey: "event-policy-scope",
            commandKey: "event-policy-scope",
          },
        }
      : {}),
  });
}

function materializeGeneratedPolicy(
  context: ProviderConnectionRecipeContextV1,
  definition: GeneratedPolicyDefinition,
): ProviderConnectionRecipeResultV1 {
  const policyDocumentNodeId = context.nodeId(definition.policyDocumentKey);
  const policyStatementNodeId = context.nodeId(definition.policyStatementKey);
  const ownerEdgeId = context.edgeId(definition.ownerEdgeKey);
  const membershipEdgeId = context.edgeId(definition.statementEdgeKey);
  const scopeEdgeId =
    definition.scope === undefined
      ? undefined
      : context.edgeId(definition.scope.edgeKey);
  const dependentLifecycle = context.generatedLifecycle([
    { kind: "edge", edgeId: context.connectionEdgeId },
  ]);
  const statementValues = {
    statementId: { kind: "string" as const, value: definition.statementId },
    effect: { kind: "string" as const, value: "allow" },
    actions: {
      kind: "string-list" as const,
      value: [...definition.actions],
    },
    principalKind: {
      kind: "string" as const,
      value: definition.principalKind,
    },
    principals: {
      kind: "string-list" as const,
      value: [...definition.principals],
    },
    resourceExpressions: {
      kind: "string-list" as const,
      value: [],
    },
    ...(definition.scope === undefined
      ? {}
      : {
          resourceNode: {
            kind: "node-reference" as const,
            nodeId: definition.scope.node.id,
            attribute: definition.scope.nodeAttribute,
          },
        }),
  };
  const commands: unknown[] = [
    {
      ...context.commandEnvelope(`${definition.commandPrefix}-document`),
      kind: "add-node",
      node: {
        id: policyDocumentNodeId,
        semantic: {
          deploymentKey: `${context.operationId}_${definition.policyDocumentKey.replaceAll("-", "_")}`,
          serviceType: "aws.iam.policy-document",
          resourceType: "aws.iam.policy-document",
          configuration: context.serviceConfiguration(
            "aws.iam.policy-document",
            {
              policyName: {
                kind: "string",
                value: definition.policyName,
              },
              policyKind: {
                kind: "string",
                value: definition.policyKind,
              },
            },
          ),
          parent: {
            nodeId: definition.ownerNode.id,
            relationshipType: definition.ownerRelationshipType,
          },
          lifecycle: dependentLifecycle,
        },
        presentation: {
          label: definition.label,
          position: {
            x:
              definition.ownerNode.presentation.position.x +
              definition.nodeOffset.x,
            y:
              definition.ownerNode.presentation.position.y +
              definition.nodeOffset.y,
          },
        },
      },
    },
    {
      ...context.commandEnvelope(`${definition.commandPrefix}-statement`),
      kind: "add-node",
      node: {
        id: policyStatementNodeId,
        semantic: {
          deploymentKey: `${context.operationId}_${definition.policyStatementKey.replaceAll("-", "_")}`,
          serviceType: "aws.iam.policy-statement",
          resourceType: "aws.iam.policy-statement",
          configuration: context.serviceConfiguration(
            "aws.iam.policy-statement",
            statementValues,
          ),
          parent: {
            nodeId: policyDocumentNodeId,
            relationshipType: "aws.iam.policy-contains-statement",
          },
          lifecycle: dependentLifecycle,
        },
        presentation: {
          label: definition.label,
          position: {
            x:
              definition.ownerNode.presentation.position.x +
              definition.nodeOffset.x,
            y:
              definition.ownerNode.presentation.position.y +
              definition.nodeOffset.y,
          },
        },
      },
    },
    {
      ...context.commandEnvelope(`${definition.commandPrefix}-owner`),
      kind: "add-edge",
      edge: {
        id: ownerEdgeId,
        semantic: {
          source: {
            nodeId: policyDocumentNodeId,
            port: definition.policyDocumentPort,
          },
          target: {
            nodeId: definition.ownerNode.id,
            port: definition.ownerPort,
          },
          relationshipType: definition.ownerRelationshipType,
          configuration: context.connectionConfiguration(
            definition.ownerConnectionRuleId,
            {},
          ),
          lifecycle: dependentLifecycle,
        },
      },
    },
    {
      ...context.commandEnvelope(`${definition.commandPrefix}-membership`),
      kind: "add-edge",
      edge: {
        id: membershipEdgeId,
        semantic: {
          source: {
            nodeId: policyStatementNodeId,
            port: "aws.iam.policy-statement.policy-document",
          },
          target: {
            nodeId: policyDocumentNodeId,
            port: "aws.iam.policy-document.statement",
          },
          relationshipType: "aws.iam.policy-contains-statement",
          configuration: context.connectionConfiguration(
            "aws.iam.policy-contains-statement",
            {},
          ),
          lifecycle: dependentLifecycle,
        },
      },
    },
  ];
  const generatedResources = [
    { kind: "node" as const, nodeId: policyDocumentNodeId },
    { kind: "node" as const, nodeId: policyStatementNodeId },
    { kind: "edge" as const, edgeId: ownerEdgeId },
    { kind: "edge" as const, edgeId: membershipEdgeId },
  ];

  if (definition.scope !== undefined && scopeEdgeId !== undefined) {
    commands.push({
      ...context.commandEnvelope(definition.scope.commandKey),
      kind: "add-edge",
      edge: {
        id: scopeEdgeId,
        semantic: {
          source: {
            nodeId: policyStatementNodeId,
            port: definition.scope.statementPort,
          },
          target: {
            nodeId: definition.scope.node.id,
            port: definition.scope.resourcePort,
          },
          relationshipType: definition.scope.relationshipType,
          configuration: context.connectionConfiguration(
            definition.scope.connectionRuleId,
            {},
          ),
          lifecycle: dependentLifecycle,
        },
      },
    });
    generatedResources.push({ kind: "edge" as const, edgeId: scopeEdgeId });
  }

  return {
    success: true,
    commands,
    generatedResources,
  };
}

function exactSingleIamEffect(
  context: ProviderConnectionRecipeContextV1,
  expected: Readonly<{
    id: string;
    effect: "allow" | "trust";
    resourceScope: "source-node" | "target-node" | "connected-target";
    principal?: string;
  }>,
): readonly string[] {
  const effect = context.rule.iamEffects.find(
    (candidate) => candidate.id === expected.id,
  );
  if (
    context.rule.iamEffects.length !== 1 ||
    effect?.effect !== expected.effect ||
    effect.resourceScope !== expected.resourceScope ||
    effect.principal !== expected.principal ||
    effect.actions.length === 0 ||
    effect.actions.some((action) => action.includes("*"))
  ) {
    throw new TypeError(
      `Connection rule ${context.rule.id} has drifted from its canonical IAM materialization contract.`,
    );
  }
  return [...effect.actions];
}

function exactConfiguration(
  configuration: Readonly<{
    schemaId: string;
    schemaVersion: string;
    values: unknown;
  }>,
  schemaId: string,
  schemaVersion: string,
  values: unknown,
): boolean {
  return (
    configuration.schemaId === schemaId &&
    configuration.schemaVersion === schemaVersion &&
    serializeCanonicalJson(configuration.values) ===
      serializeCanonicalJson(values)
  );
}

function exactLifecycle(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function generatedTrustCollision(
  context: ProviderConnectionRecipeContextV1,
  resources: readonly { semantic: { lifecycle: { ownership: string } } }[],
): ProviderConnectionRecipeResultV1 | undefined {
  const deterministicNodeIds = [
    context.nodeId("lambda-trust-policy-document"),
    context.nodeId("lambda-trust-policy"),
  ];
  const deterministicEdgeIds = [
    context.edgeId("lambda-trust-policy-role"),
    context.edgeId("lambda-trust-policy-statement"),
  ];
  if (
    resources.some(
      (resource) => resource.semantic.lifecycle.ownership === "generated",
    ) ||
    context.document.nodes.some((node) =>
      deterministicNodeIds.includes(node.id),
    ) ||
    context.document.edges.some((edge) =>
      deterministicEdgeIds.includes(edge.id),
    )
  ) {
    return {
      success: false,
      findings: [
        ruleFindingByCode(
          context,
          "aws.iam.finding.lambda-trust-policy-generated-collision",
        ),
      ],
    };
  }
  return undefined;
}

function compatibleReusableLambdaTrust(
  context: ProviderConnectionRecipeContextV1,
  roleNode: RecipeNode,
): ProviderConnectionRecipeResultV1 | undefined {
  const candidateOwnerEdges = context.document.edges.filter(
    (edge) =>
      edge.semantic.relationshipType === "aws.iam.role-owns-trust-policy" &&
      edge.semantic.target.nodeId === roleNode.id,
  );
  const candidateDocuments = context.document.nodes.filter(
    (node) =>
      node.semantic.serviceType === "aws.iam.policy-document" &&
      (candidateOwnerEdges.some(
        (edge) => edge.semantic.source.nodeId === node.id,
      ) ||
        (node.semantic.parent?.nodeId === roleNode.id &&
          node.semantic.parent.relationshipType ===
            "aws.iam.role-owns-trust-policy")),
  );
  const collision = generatedTrustCollision(context, [
    ...candidateDocuments,
    ...candidateOwnerEdges,
  ]);
  if (collision !== undefined) {
    return collision;
  }
  if (candidateDocuments.length === 0 && candidateOwnerEdges.length === 0) {
    return undefined;
  }
  if (candidateDocuments.length !== 1 || candidateOwnerEdges.length !== 1) {
    return {
      success: false,
      findings: [
        ruleFindingByCode(
          context,
          "aws.iam.finding.lambda-trust-policy-ambiguous",
        ),
      ],
    };
  }
  const policyDocument = candidateDocuments[0];
  const ownerEdge = candidateOwnerEdges[0];
  if (policyDocument === undefined || ownerEdge === undefined) {
    throw new TypeError("Expected one trust document and owner edge.");
  }
  const lifecycle = policyDocument.semantic.lifecycle;
  const ownership = lifecycle.ownership;
  const documentValues = policyDocument.semantic.configuration
    .values as Readonly<Record<string, unknown>>;
  const policyName = documentValues["policyName"];
  const policyKind = documentValues["policyKind"];
  const memberEdges = context.document.edges.filter(
    (edge) =>
      edge.semantic.relationshipType === "aws.iam.policy-contains-statement" &&
      edge.semantic.target.nodeId === policyDocument.id,
  );
  const parentedStatements = context.document.nodes.filter(
    (node) =>
      node.semantic.serviceType === "aws.iam.policy-statement" &&
      node.semantic.parent?.nodeId === policyDocument.id &&
      node.semantic.parent.relationshipType ===
        "aws.iam.policy-contains-statement",
  );
  const statementIds = new Set([
    ...memberEdges.map((edge) => edge.semantic.source.nodeId),
    ...parentedStatements.map((node) => node.id),
  ]);
  const statement =
    statementIds.size === 1
      ? context.document.nodes.find((node) => node.id === [...statementIds][0])
      : undefined;
  const statementValues = statement?.semantic.configuration.values as
    Readonly<Record<string, unknown>> | undefined;
  const statementId = statementValues?.["statementId"];
  const hasConditionOrScope =
    statement === undefined ||
    context.document.edges.some(
      (edge) =>
        (edge.semantic.relationshipType ===
          "aws.iam.statement-owns-condition" &&
          edge.semantic.target.nodeId === statement.id) ||
        (edge.semantic.source.nodeId === statement.id &&
          String(edge.semantic.relationshipType).startsWith(
            "aws.iam.authorizes-",
          )),
    );
  const isCompatible =
    (ownership === "user" || ownership === "adopted") &&
    policyDocument.semantic.resourceType === "aws.iam.policy-document" &&
    policyDocument.semantic.parent?.nodeId === roleNode.id &&
    policyDocument.semantic.parent.relationshipType ===
      "aws.iam.role-owns-trust-policy" &&
    Object.keys(documentValues).length === 2 &&
    typeof policyName === "object" &&
    policyName !== null &&
    (policyName as { kind?: unknown }).kind === "string" &&
    typeof (policyName as { value?: unknown }).value === "string" &&
    (policyName as { value: string }).value.length > 0 &&
    serializeCanonicalJson(policyKind) ===
      serializeCanonicalJson({ kind: "string", value: "trust" }) &&
    policyDocument.semantic.configuration.schemaId ===
      "aws.iam.policy-document.configuration" &&
    policyDocument.semantic.configuration.schemaVersion === "1.0.0" &&
    ownerEdge.semantic.source.nodeId === policyDocument.id &&
    ownerEdge.semantic.source.port ===
      "aws.iam.policy-document.role-trust-policy" &&
    ownerEdge.semantic.target.port === "aws.iam.role.trust-policy" &&
    exactConfiguration(
      ownerEdge.semantic.configuration,
      "aws.iam.role-trust-policy.attachment",
      "1.0.0",
      {},
    ) &&
    exactLifecycle(ownerEdge.semantic.lifecycle, lifecycle) &&
    memberEdges.length === 1 &&
    parentedStatements.length === 1 &&
    statementIds.size === 1 &&
    statement?.semantic.serviceType === "aws.iam.policy-statement" &&
    statement.semantic.resourceType === "aws.iam.policy-statement" &&
    statement.semantic.parent?.nodeId === policyDocument.id &&
    statement.semantic.parent.relationshipType ===
      "aws.iam.policy-contains-statement" &&
    statement.semantic.configuration.schemaId ===
      "aws.iam.policy-statement.configuration" &&
    statement.semantic.configuration.schemaVersion === "2.0.0" &&
    statementValues !== undefined &&
    Object.keys(statementValues).length === 6 &&
    typeof statementId === "object" &&
    statementId !== null &&
    (statementId as { kind?: unknown }).kind === "string" &&
    typeof (statementId as { value?: unknown }).value === "string" &&
    (statementId as { value: string }).value.length > 0 &&
    serializeCanonicalJson(statementValues["effect"]) ===
      serializeCanonicalJson({ kind: "string", value: "allow" }) &&
    serializeCanonicalJson(statementValues["actions"]) ===
      serializeCanonicalJson({
        kind: "string-list",
        value: ["sts:AssumeRole"],
      }) &&
    serializeCanonicalJson(statementValues["principalKind"]) ===
      serializeCanonicalJson({ kind: "string", value: "service" }) &&
    serializeCanonicalJson(statementValues["principals"]) ===
      serializeCanonicalJson({
        kind: "string-list",
        value: ["lambda.amazonaws.com"],
      }) &&
    serializeCanonicalJson(statementValues["resourceExpressions"]) ===
      serializeCanonicalJson({ kind: "string-list", value: [] }) &&
    exactLifecycle(statement.semantic.lifecycle, lifecycle) &&
    memberEdges[0]?.semantic.source.nodeId === statement.id &&
    memberEdges[0].semantic.source.port ===
      "aws.iam.policy-statement.policy-document" &&
    memberEdges[0].semantic.target.port ===
      "aws.iam.policy-document.statement" &&
    exactConfiguration(
      memberEdges[0].semantic.configuration,
      "aws.iam.policy-membership.connection",
      "1.0.0",
      {},
    ) &&
    exactLifecycle(memberEdges[0].semantic.lifecycle, lifecycle) &&
    !hasConditionOrScope;

  return isCompatible
    ? emptyPlan()
    : {
        success: false,
        findings: [
          ruleFindingByCode(
            context,
            "aws.iam.finding.lambda-trust-policy-incompatible",
          ),
        ],
      };
}

function lambdaRoleEdges(context: ProviderConnectionRecipeContextV1) {
  return context.document.edges.filter(
    (edge) =>
      edge.semantic.relationshipType === "aws.iam.role-assumed-by-lambda" &&
      edge.semantic.source.port === "aws.iam.role.assumable-role" &&
      edge.semantic.target.nodeId === context.sourceNode.id &&
      edge.semantic.target.port === "aws.lambda.function.execution-role",
  );
}

const apiLambdaRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.apigateway.http-api-invokes-lambda",
  ruleVersion: "1.0.0",
  implementationId: "aws.apigateway.resolve-http-api-lambda-integration",
  resolve(context) {
    const routeKey = literalString(context, "routeKey");
    const duplicateRoute = context.document.edges.some((edge) => {
      if (
        edge.semantic.relationshipType !== "aws.apigateway.integrates-lambda" ||
        edge.semantic.source.nodeId !== context.sourceNode.id ||
        edge.semantic.source.port !== "aws.apigateway.http-api.invocation"
      ) {
        return false;
      }
      const existingRoute = (
        edge.semantic.configuration.values as Readonly<
          Record<string, { kind: string; value?: unknown }>
        >
      )["routeKey"];
      return (
        existingRoute?.kind === "string" &&
        typeof existingRoute.value === "string" &&
        existingRoute.value === routeKey
      );
    });
    if (duplicateRoute) {
      return {
        success: false,
        findings: [
          {
            code: "aws.apigateway.finding.duplicate-route-integration",
            severity: "error",
            path: "$.configuration.routeKey",
            guidedMessage:
              "That API route already has an integration. Reuse or remove it before choosing another function.",
            professionalMessage:
              "API Gateway route keys are exclusive within an HTTP API.",
          },
        ],
      };
    }
    const actions = exactSingleIamEffect(context, {
      id: "aws.apigateway.iam.invoke-lambda",
      effect: "allow",
      resourceScope: "target-node",
      principal: "apigateway.amazonaws.com",
    });
    return materializeGeneratedPolicy(context, {
      ownerNode: context.targetNode,
      ownerRelationshipType: "aws.lambda.owns-invocation-permission",
      policyDocumentPort: "aws.iam.policy-document.lambda-service-grant",
      ownerPort: "aws.lambda.function.invocation-permission",
      ownerConnectionRuleId: "aws.lambda.owns-invocation-permission",
      policyKind: "service-grant",
      policyName: "ApiGatewayInvokePermission",
      statementId: "ApiGatewayInvokePermission",
      actions,
      principalKind: "service",
      principals: ["apigateway.amazonaws.com"],
      label: "API invocation grant",
      nodeOffset: { x: -160, y: 120 },
      policyDocumentKey: "lambda-service-grant-document",
      policyStatementKey: "lambda-service-grant",
      ownerEdgeKey: "lambda-service-grant-owner",
      statementEdgeKey: "lambda-service-grant-statement",
      commandPrefix: "lambda-service-grant",
      scope: {
        node: context.targetNode,
        nodeAttribute: "aws.lambda.function.arn",
        statementPort: "aws.iam.policy-statement.lambda-resource",
        resourcePort: "aws.lambda.function.policy-resource",
        relationshipType: "aws.iam.authorizes-lambda-function",
        connectionRuleId: "aws.iam.policy-statement-authorizes-lambda-function",
        edgeKey: "lambda-service-grant-scope",
        commandKey: "lambda-service-grant-scope",
      },
    });
  },
});

const userPoolApiRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.cognito.user-pool-authorizes-http-api",
  ruleVersion: "1.0.0",
  implementationId: "aws.cognito.resolve-user-pool-api-authorizer",
  resolve(context) {
    const hasAudience = context.document.edges.some(
      (edge) =>
        edge.semantic.relationshipType ===
          "aws.cognito.provides-jwt-audience" &&
        edge.semantic.target.nodeId === context.targetNode.id &&
        edge.semantic.target.port === "aws.apigateway.http-api.jwt-audience",
    );
    return {
      success: true,
      commands: [],
      generatedResources: [],
      findings: hasAudience
        ? []
        : [ruleFinding(context, "missing-prerequisite", "warning")],
    };
  },
});

const appClientApiRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.cognito.app-client-authorizes-http-api",
  ruleVersion: "1.0.0",
  implementationId: "aws.cognito.resolve-app-client-api-audience",
  resolve(context) {
    const hasIssuer = context.document.edges.some(
      (edge) =>
        edge.semantic.relationshipType === "aws.cognito.provides-jwt-issuer" &&
        edge.semantic.target.nodeId === context.targetNode.id &&
        edge.semantic.target.port === "aws.apigateway.http-api.jwt-issuer",
    );
    return {
      success: true,
      commands: [],
      generatedResources: [],
      findings: hasIssuer
        ? []
        : [ruleFinding(context, "missing-prerequisite", "warning")],
    };
  },
});

const lambdaRoleRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.iam.role-assumed-by-lambda",
  ruleVersion: "1.0.0",
  implementationId: "aws.iam.resolve-lambda-role-attachment",
  resolve(context) {
    exactSingleIamEffect(context, {
      id: "aws.iam.effect.lambda-assume-role",
      effect: "trust",
      resourceScope: "source-node",
      principal: "lambda.amazonaws.com",
    });
    const reusableTrust = compatibleReusableLambdaTrust(
      context,
      context.sourceNode,
    );
    if (reusableTrust !== undefined) {
      return reusableTrust;
    }
    return materializeGeneratedPolicy(context, {
      ownerNode: context.sourceNode,
      ownerRelationshipType: "aws.iam.role-owns-trust-policy",
      policyDocumentPort: "aws.iam.policy-document.role-trust-policy",
      ownerPort: "aws.iam.role.trust-policy",
      ownerConnectionRuleId: "aws.iam.role-owns-trust-policy",
      policyKind: "trust",
      policyName: "LambdaTrustPolicy",
      statementId: "LambdaTrust",
      actions: ["sts:AssumeRole"],
      principalKind: "service",
      principals: ["lambda.amazonaws.com"],
      label: "Lambda trust policy",
      nodeOffset: { x: 160, y: 120 },
      policyDocumentKey: "lambda-trust-policy-document",
      policyStatementKey: "lambda-trust-policy",
      ownerEdgeKey: "lambda-trust-policy-role",
      statementEdgeKey: "lambda-trust-policy-statement",
      commandPrefix: "lambda-trust-policy",
    });
  },
});

function resolveLambdaDynamoDb(
  context: ProviderConnectionRecipeContextV1,
  statementId: string,
  label: string,
): ProviderConnectionRecipeResultV1 {
  const roleEdges = lambdaRoleEdges(context);
  if (roleEdges.length === 0) {
    return {
      success: false,
      findings: [ruleFinding(context, "missing-prerequisite")],
    };
  }
  if (roleEdges.length !== 1) {
    return {
      success: false,
      findings: [ruleFinding(context, "ambiguous-prerequisite")],
    };
  }
  const roleEdge = roleEdges[0];
  if (roleEdge === undefined) {
    throw new TypeError("Expected one Lambda role edge.");
  }
  const roleNode = context.document.nodes.find(
    (node) =>
      node.id === roleEdge.semantic.source.nodeId &&
      node.semantic.serviceType === "aws.iam.role",
  );
  if (roleNode === undefined) {
    return {
      success: false,
      findings: [ruleFinding(context, "missing-prerequisite")],
    };
  }

  const selectedIamEffects = context.rule.iamEffects.filter(
    (effect) =>
      effect.when === undefined ||
      literalConfigurationValue(context, effect.when.property) ===
        effect.when.equals,
  );
  const selectedIamEffect = selectedIamEffects[0];
  if (
    selectedIamEffects.length !== 1 ||
    selectedIamEffect?.effect !== "allow" ||
    selectedIamEffect.resourceScope !== "connected-target" ||
    selectedIamEffect.principal !== undefined
  ) {
    throw new TypeError(
      "Lambda DynamoDB recipes require one selected connected-target Allow effect.",
    );
  }
  const actions = [...selectedIamEffect.actions];
  const policyDocumentNodeId = context.nodeId("dynamodb-policy-document");
  const policyNodeId = context.nodeId("dynamodb-policy");
  const policyRoleEdgeId = context.edgeId("policy-role");
  const policyStatementEdgeId = context.edgeId("policy-document-statement");
  const policyTableEdgeId = context.edgeId("policy-table");
  const dependentLifecycle = context.generatedLifecycle([
    { kind: "edge", edgeId: context.connectionEdgeId },
  ]);

  return {
    success: true,
    commands: [
      {
        ...context.commandEnvelope("add-policy-document"),
        kind: "add-node",
        node: {
          id: policyDocumentNodeId,
          semantic: {
            deploymentKey: `${context.operationId}_policy_document`,
            serviceType: "aws.iam.policy-document",
            resourceType: "aws.iam.policy-document",
            configuration: context.serviceConfiguration(
              "aws.iam.policy-document",
              {
                policyName: { kind: "string", value: statementId },
                policyKind: {
                  kind: "string",
                  value: "generated-permission",
                },
              },
            ),
            parent: {
              nodeId: roleNode.id,
              relationshipType: "aws.iam.role-owns-generated-permission",
            },
            lifecycle: dependentLifecycle,
          },
          presentation: {
            label,
            position: {
              x: context.sourceNode.presentation.position.x + 160,
              y: context.sourceNode.presentation.position.y + 120,
            },
          },
        },
      },
      {
        ...context.commandEnvelope("add-policy-statement"),
        kind: "add-node",
        node: {
          id: policyNodeId,
          semantic: {
            deploymentKey: `${context.operationId}_policy`,
            serviceType: "aws.iam.policy-statement",
            resourceType: "aws.iam.policy-statement",
            configuration: context.serviceConfiguration(
              "aws.iam.policy-statement",
              {
                statementId: { kind: "string", value: statementId },
                effect: { kind: "string", value: "allow" },
                actions: { kind: "string-list", value: actions },
                principalKind: { kind: "string", value: "none" },
                principals: { kind: "string-list", value: [] },
                resourceExpressions: {
                  kind: "string-list",
                  value: [],
                },
                resourceNode: {
                  kind: "node-reference",
                  nodeId: context.targetNode.id,
                  attribute: "aws.dynamodb.table.arn",
                },
              },
            ),
            parent: {
              nodeId: policyDocumentNodeId,
              relationshipType: "aws.iam.policy-contains-statement",
            },
            lifecycle: dependentLifecycle,
          },
          presentation: {
            label,
            position: {
              x: context.sourceNode.presentation.position.x + 160,
              y: context.sourceNode.presentation.position.y + 120,
            },
          },
        },
      },
      {
        ...context.commandEnvelope("attach-policy"),
        kind: "add-edge",
        edge: {
          id: policyRoleEdgeId,
          semantic: {
            source: {
              nodeId: policyDocumentNodeId,
              port: "aws.iam.policy-document.role-generated-permission",
            },
            target: {
              nodeId: roleNode.id,
              port: "aws.iam.role.generated-permission",
            },
            relationshipType: "aws.iam.role-owns-generated-permission",
            configuration: context.connectionConfiguration(
              "aws.iam.role-owns-generated-permission",
              {},
            ),
            lifecycle: dependentLifecycle,
          },
        },
      },
      {
        ...context.commandEnvelope("contain-policy-statement"),
        kind: "add-edge",
        edge: {
          id: policyStatementEdgeId,
          semantic: {
            source: {
              nodeId: policyNodeId,
              port: "aws.iam.policy-statement.policy-document",
            },
            target: {
              nodeId: policyDocumentNodeId,
              port: "aws.iam.policy-document.statement",
            },
            relationshipType: "aws.iam.policy-contains-statement",
            configuration: context.connectionConfiguration(
              "aws.iam.policy-contains-statement",
              {},
            ),
            lifecycle: dependentLifecycle,
          },
        },
      },
      {
        ...context.commandEnvelope("scope-policy"),
        kind: "add-edge",
        edge: {
          id: policyTableEdgeId,
          semantic: {
            source: {
              nodeId: policyNodeId,
              port: "aws.iam.policy-statement.dynamodb-resource",
            },
            target: {
              nodeId: context.targetNode.id,
              port: "aws.dynamodb.table.policy-resource",
            },
            relationshipType: "aws.iam.authorizes-dynamodb-table",
            configuration: context.connectionConfiguration(
              "aws.iam.policy-statement-authorizes-dynamodb-table",
              {},
            ),
            lifecycle: dependentLifecycle,
          },
        },
      },
    ],
    generatedResources: [
      { kind: "node" as const, nodeId: policyDocumentNodeId },
      { kind: "node" as const, nodeId: policyNodeId },
      { kind: "edge" as const, edgeId: policyRoleEdgeId },
      { kind: "edge" as const, edgeId: policyStatementEdgeId },
      { kind: "edge" as const, edgeId: policyTableEdgeId },
    ],
  };
}

const lambdaDynamoReadRegistration = defineProviderConnectionRuleRegistrationV1(
  {
    interfaceVersion: 1,
    ruleId: "aws.lambda.reads-dynamodb-table",
    ruleVersion: "1.0.0",
    implementationId: "aws.lambda.resolve-dynamodb-read",
    resolve: (context) =>
      resolveLambdaDynamoDb(context, "DynamoDbReadAccess", "Table read policy"),
  },
);

const lambdaDynamoWriteRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.lambda.writes-dynamodb-table",
    ruleVersion: "1.0.0",
    implementationId: "aws.lambda.resolve-dynamodb-write",
    resolve: (context) =>
      resolveLambdaDynamoDb(
        context,
        "DynamoDbWriteAccess",
        "Table write policy",
      ),
  });

const lambdaLogsRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.lambda.writes-log-group",
  ruleVersion: "1.0.0",
  implementationId: "aws.lambda.resolve-cloudwatch-logging",
  resolve(context) {
    const roleEdges = lambdaRoleEdges(context);
    if (roleEdges.length === 0) {
      return {
        success: false,
        findings: [ruleFinding(context, "missing-prerequisite")],
      };
    }
    if (roleEdges.length !== 1) {
      return {
        success: false,
        findings: [ruleFinding(context, "ambiguous-prerequisite")],
      };
    }
    const roleEdge = roleEdges[0];
    const roleNode = context.document.nodes.find(
      (node) =>
        node.id === roleEdge?.semantic.source.nodeId &&
        node.semantic.serviceType === "aws.iam.role",
    );
    if (roleNode === undefined) {
      return {
        success: false,
        findings: [ruleFinding(context, "missing-prerequisite")],
      };
    }
    const actions = exactSingleIamEffect(context, {
      id: "aws.lambda.iam.cloudwatch-log-delivery",
      effect: "allow",
      resourceScope: "target-node",
    });
    return materializeGeneratedPolicy(context, {
      ownerNode: roleNode,
      ownerRelationshipType: "aws.iam.role-owns-generated-permission",
      policyDocumentPort: "aws.iam.policy-document.role-generated-permission",
      ownerPort: "aws.iam.role.generated-permission",
      ownerConnectionRuleId: "aws.iam.role-owns-generated-permission",
      policyKind: "generated-permission",
      policyName: "LambdaLogDelivery",
      statementId: "LambdaLogDelivery",
      actions,
      principalKind: "none",
      principals: [],
      label: "Log delivery policy",
      nodeOffset: { x: 160, y: 120 },
      policyDocumentKey: "logs-policy-document",
      policyStatementKey: "logs-policy",
      ownerEdgeKey: "logs-policy-role",
      statementEdgeKey: "logs-policy-statement",
      commandPrefix: "logs-policy",
      scope: {
        node: context.targetNode,
        nodeAttribute: "aws.cloudwatch.log-group.arn",
        statementPort: "aws.iam.policy-statement.log-group-resource",
        resourcePort: "aws.cloudwatch.log-group.policy-resource",
        relationshipType: "aws.iam.authorizes-log-group",
        connectionRuleId: "aws.iam.policy-statement-authorizes-log-group",
        edgeKey: "logs-policy-scope",
        commandKey: "logs-policy-scope",
      },
    });
  },
});

const routeTableAssociationSubnetRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.ec2.route-table-association-targets-subnet",
    ruleVersion: "1.0.0",
    implementationId: "aws.ec2.resolve-route-table-association-subnet",
    resolve: () => emptyPlan(),
  });

const vpcInternetGatewayAttachmentRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.ec2.vpc-attaches-internet-gateway",
    ruleVersion: "1.0.0",
    implementationId: "aws.ec2.resolve-vpc-internet-gateway-attachment",
    resolve: () => emptyPlan(),
  });

const routeInternetGatewayTargetRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.ec2.route-targets-internet-gateway",
    ruleVersion: "1.0.0",
    implementationId: "aws.ec2.resolve-route-internet-gateway-target",
    resolve: () => emptyPlan(),
  });

const routeNatGatewayTargetRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.ec2.route-targets-nat-gateway",
    ruleVersion: "1.0.0",
    implementationId: "aws.ec2.resolve-route-nat-gateway-target",
    resolve: () => emptyPlan(),
  });

const gatewayEndpointRouteTableRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.ec2.gateway-endpoint-associates-route-table",
    ruleVersion: "1.0.0",
    implementationId:
      "aws.ec2.resolve-gateway-endpoint-route-table-association",
    resolve: () => emptyPlan(),
  });

const vpcSecurityGroupRegistration = defineProviderConnectionRuleRegistrationV1(
  {
    interfaceVersion: 1,
    ruleId: "aws.ec2.vpc-associates-security-group",
    ruleVersion: "1.0.0",
    implementationId: "aws.ec2.resolve-vpc-security-group-association",
    resolve: () => emptyPlan(),
  },
);

const lambdaVpcSubnetRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.lambda.vpc-access-uses-subnet",
  ruleVersion: "1.0.0",
  implementationId: "aws.lambda.resolve-vpc-access-subnet",
  resolve: () => emptyPlan(),
});

const lambdaVpcSecurityGroupRegistration =
  defineProviderConnectionRuleRegistrationV1({
    interfaceVersion: 1,
    ruleId: "aws.lambda.vpc-access-uses-security-group",
    ruleVersion: "1.0.0",
    implementationId: "aws.lambda.resolve-vpc-access-security-group",
    resolve: () => emptyPlan(),
  });

const lambdaAlarmRegistration = defineProviderConnectionRuleRegistrationV1({
  interfaceVersion: 1,
  ruleId: "aws.lambda.monitored-by-alarm",
  ruleVersion: "1.0.0",
  implementationId: "aws.lambda.resolve-cloudwatch-errors-alarm",
  resolve(context) {
    const values = context.targetNode.semantic.configuration.values as Readonly<
      Record<string, { kind: string; value?: unknown }>
    >;
    const namespace = values["namespace"];
    const metricName = values["metricName"];
    const statistic = values["statistic"];
    if (
      namespace?.kind !== "string" ||
      namespace.value !== "AWS/Lambda" ||
      metricName?.kind !== "string" ||
      metricName.value !== "Errors" ||
      statistic?.kind !== "string" ||
      statistic.value !== "Sum"
    ) {
      return {
        success: false,
        findings: [
          {
            code: "aws.lambda.finding.unsupported-alarm-metric",
            severity: "error",
            path: "$.target.nodeId",
            guidedMessage:
              "Use the catalog's basic Lambda Errors alarm for this connection.",
            professionalMessage:
              "The initial resolver supports only AWS/Lambda Errors with Sum aggregation and a FunctionName dimension.",
          },
        ],
      };
    }
    return emptyPlan();
  },
});

export const awsConnectionRuleRegistrationsV1 = Object.freeze([
  ...awsEbsConnectionRules.map((rule) => {
    if (rule.implementation.status !== "implemented")
      throw new TypeError("EBS binding must be implemented");
    return defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      implementationId: rule.implementation.implementationId,
      resolve: emptyPlan,
    });
  }),
  ...awsElbConnectionRules.map((rule) => {
    if (rule.implementation.status !== "implemented")
      throw new TypeError("ELB binding must be implemented");
    return defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      implementationId: rule.implementation.implementationId,
      resolve: emptyPlan,
    });
  }),
  ...awsCloudfrontConnectionRules.map((rule) => {
    if (rule.implementation.status !== "implemented")
      throw new TypeError("CloudFront binding must be implemented");
    return defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      implementationId: rule.implementation.implementationId,
      resolve:
        rule.id === "aws.cloudfront.reads-s3-origin"
          ? resolveEventPermissions
          : emptyPlan,
    });
  }),
  ...[
    ...awsDnsConnectionRules,
    ...awsAuroraConnectionRules,
    ...awsRdsConnectionRules,
    ...awsEcsConnectionRules,
  ].map((rule) => {
    if (rule.implementation.status !== "implemented")
      throw new TypeError("ECS binding must be implemented");
    return defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      implementationId: rule.implementation.implementationId,
      resolve: emptyPlan,
    });
  }),
  ...awsEc2ConnectionRules.map((rule) => {
    if (rule.implementation.status !== "implemented")
      throw new TypeError("EC2 binding must be implemented");
    return defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      implementationId: rule.implementation.implementationId,
      resolve: emptyPlan,
    });
  }),
  ...awsSecretConnectionRules
    .filter((rule) => rule.implementation.status === "implemented")
    .map((rule) =>
      defineProviderConnectionRuleRegistrationV1({
        interfaceVersion: 1,
        ruleId: rule.id,
        ruleVersion: rule.ruleVersion,
        implementationId: "aws.kms.resolve-secret-encryption",
        resolve: emptyPlan,
      }),
    ),
  apiLambdaRegistration,
  userPoolApiRegistration,
  appClientApiRegistration,
  lambdaRoleRegistration,
  lambdaDynamoReadRegistration,
  lambdaDynamoWriteRegistration,
  lambdaLogsRegistration,
  lambdaAlarmRegistration,
  routeTableAssociationSubnetRegistration,
  vpcInternetGatewayAttachmentRegistration,
  routeInternetGatewayTargetRegistration,
  routeNatGatewayTargetRegistration,
  gatewayEndpointRouteTableRegistration,
  vpcSecurityGroupRegistration,
  lambdaVpcSubnetRegistration,
  lambdaVpcSecurityGroupRegistration,
  ...eventDrivenRegistrations,
  ...awsFsxConnectionRules.map((rule) => {
    if (rule.implementation.status !== "implemented")
      throw new TypeError("FSx connection must be implemented.");
    return defineProviderConnectionRuleRegistrationV1({
      interfaceVersion: 1,
      ruleId: rule.id,
      ruleVersion: rule.ruleVersion,
      implementationId: rule.implementation.implementationId,
      resolve: emptyPlan,
    });
  }),
]);

export const awsConnectionResolverV1 = createProviderConnectionResolverV1(
  awsCatalogArtifactV1,
  awsConnectionRuleRegistrationsV1,
);
