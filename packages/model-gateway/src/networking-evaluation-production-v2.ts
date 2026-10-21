import {
  createValidationDocumentPath,
  createValidationFindingCode,
  defineValidationRuleV1,
  getArchitectureDocumentCanonicalHash,
  type ValidationFindingCandidate,
  type ValidationRuleV1,
} from "@cloudmarkup/domain";
import {
  architectureDocumentV3Schema,
  assistantOperationBatchV1Schema,
  digestCanonicalValue,
  graphCommandActionV1Schema,
  graphCommandBatchV1Schema,
  modelOperationCatalogGroundingV1Schema,
  modelOperationProposalRequestV1Schema,
  type ArchitectureDocumentV3,
  type ConfigurationValue,
  type ModelGatewayResponseV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import {
  CollectingModelUsageRecorder,
  CollectingSafeModelLogger,
  InMemoryModelInvocationStore,
  ScriptedFakeModelAdapter,
  deterministicFakeResponseV1,
  deterministicFakeRoutingV1,
} from "./fakes.js";
import { ProviderNeutralModelGateway } from "./gateway.js";
import type {
  ModelGatewayResultV1,
  ModelProviderInvocationV1,
  ModelProviderResultV1,
  ModelRequestFor,
} from "./ports.js";
import { digestStructuredValue } from "./security.js";
import {
  InMemoryRestrictedInvalidSolutionProposalStoreV1,
  ReviewOnlySolutionProposalPlannerV1,
  type SolutionPlanningGatewayV1,
  type SolutionProposalPlannerResultV1,
} from "./solution-planner.js";
import {
  modelTestContext,
  modelTestRequests,
  testIntent,
  testSolutionRevision,
} from "./test-helpers.js";
import {
  evaluateModelNetworkingObservationV2,
  frozenModelNetworkingEvaluationDatasetV2,
  modelNetworkingCatalogAuthorityV2,
  modelNetworkingEvaluationCaseKindV2Values,
  modelNetworkingEvaluationObservationV2Schema,
  type ModelNetworkingEvaluationCaseV2,
  type ModelNetworkingEvaluationObservationV2,
  type ModelNetworkingEvaluationReportV2,
  type ModelNetworkingEvaluationResultV2,
} from "./networking-evaluation-v2.js";

type OperationResponse = Extract<
  ModelGatewayResponseV1,
  { operation: "operations.propose" }
>;
type ModelNetworkingEvaluationCaseKindV2 =
  (typeof modelNetworkingEvaluationCaseKindV2Values)[number];

const productionPathV2 =
  "scripted-fake-adapter/provider-neutral-gateway/review-only-solution-planner" as const;
const createdAtV2 = "2026-08-26T12:00:00.000Z" as const;

const booleanConfigurationKeys = new Set([
  "assignIpv6AddressOnCreation",
  "deletionProtectionEnabled",
  "enableDnsHostnames",
  "enableDnsSupport",
  "ipv6AllowedForDualStack",
  "mapPublicIpOnLaunch",
  "pointInTimeRecoveryEnabled",
  "serverSideEncryptionEnabled",
  "tracingEnabled",
]);
const integerConfigurationKeys = new Set([
  "fromPort",
  "memoryMegabytes",
  "reservedConcurrency",
  "timeoutSeconds",
  "toPort",
]);

const relationshipEndpointsV2 = [
  {
    relationshipType: "aws.ec2.availability-zone-contains-subnet",
    source: {
      port: "aws.ec2.availability-zone.subnet-placement",
      serviceType: "aws.ec2.availability-zone",
    },
    target: {
      port: "aws.ec2.subnet.availability-zone",
      serviceType: "aws.ec2.subnet",
    },
  },
  {
    relationshipType: "aws.ec2.gateway-endpoint-associates-route-table",
    source: {
      port: "aws.ec2.gateway-vpc-endpoint.route-table-association",
      serviceType: "aws.ec2.gateway-vpc-endpoint",
    },
    target: {
      port: "aws.ec2.route-table.gateway-endpoint-association",
      serviceType: "aws.ec2.route-table",
    },
  },
  {
    relationshipType: "aws.ec2.route-table-association-targets-subnet",
    source: {
      port: "aws.ec2.route-table-association.subnet",
      serviceType: "aws.ec2.route-table-association",
    },
    target: {
      port: "aws.ec2.subnet.route-table-association",
      serviceType: "aws.ec2.subnet",
    },
  },
  {
    relationshipType: "aws.ec2.route-table-owns-route",
    source: {
      port: "aws.ec2.route.route-table",
      serviceType: "aws.ec2.route",
    },
    target: {
      port: "aws.ec2.route-table.route",
      serviceType: "aws.ec2.route-table",
    },
  },
  {
    relationshipType: "aws.ec2.route-table-owns-subnet-association",
    source: {
      port: "aws.ec2.route-table-association.route-table",
      serviceType: "aws.ec2.route-table-association",
    },
    target: {
      port: "aws.ec2.route-table.subnet-association",
      serviceType: "aws.ec2.route-table",
    },
  },
  {
    relationshipType: "aws.ec2.route-targets-internet-gateway",
    source: {
      port: "aws.ec2.route.internet-gateway-target",
      serviceType: "aws.ec2.route",
    },
    target: {
      port: "aws.ec2.internet-gateway.route-target",
      serviceType: "aws.ec2.internet-gateway",
    },
  },
  {
    relationshipType: "aws.ec2.route-targets-nat-gateway",
    source: {
      port: "aws.ec2.route.nat-gateway-target",
      serviceType: "aws.ec2.route",
    },
    target: {
      port: "aws.ec2.nat-gateway.route-target",
      serviceType: "aws.ec2.nat-gateway",
    },
  },
  {
    relationshipType: "aws.ec2.security-group-owns-egress-rule",
    source: {
      port: "aws.ec2.security-group-egress-rule.security-group",
      serviceType: "aws.ec2.security-group-egress-rule",
    },
    target: {
      port: "aws.ec2.security-group.egress-rule",
      serviceType: "aws.ec2.security-group",
    },
  },
  {
    relationshipType: "aws.ec2.security-group-owns-ingress-rule",
    source: {
      port: "aws.ec2.security-group-ingress-rule.security-group",
      serviceType: "aws.ec2.security-group-ingress-rule",
    },
    target: {
      port: "aws.ec2.security-group.ingress-rule",
      serviceType: "aws.ec2.security-group",
    },
  },
  {
    relationshipType: "aws.ec2.subnet-contains-nat-gateway",
    source: {
      port: "aws.ec2.subnet.nat-gateway-placement",
      serviceType: "aws.ec2.subnet",
    },
    target: {
      port: "aws.ec2.nat-gateway.subnet",
      serviceType: "aws.ec2.nat-gateway",
    },
  },
  {
    relationshipType: "aws.ec2.vpc-associates-security-group",
    source: {
      port: "aws.ec2.vpc.security-group-association",
      serviceType: "aws.ec2.vpc",
    },
    target: {
      port: "aws.ec2.security-group.vpc",
      serviceType: "aws.ec2.security-group",
    },
  },
  {
    relationshipType: "aws.ec2.vpc-attaches-internet-gateway",
    source: {
      port: "aws.ec2.vpc.internet-gateway-attachment",
      serviceType: "aws.ec2.vpc",
    },
    target: {
      port: "aws.ec2.internet-gateway.vpc-attachment",
      serviceType: "aws.ec2.internet-gateway",
    },
  },
  {
    relationshipType: "aws.ec2.vpc-contains-availability-zone",
    source: {
      port: "aws.ec2.vpc.availability-zone-placement",
      serviceType: "aws.ec2.vpc",
    },
    target: {
      port: "aws.ec2.availability-zone.vpc",
      serviceType: "aws.ec2.availability-zone",
    },
  },
  {
    relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
    source: {
      port: "aws.ec2.vpc.gateway-endpoint-placement",
      serviceType: "aws.ec2.vpc",
    },
    target: {
      port: "aws.ec2.gateway-vpc-endpoint.vpc",
      serviceType: "aws.ec2.gateway-vpc-endpoint",
    },
  },
  {
    relationshipType: "aws.ec2.vpc-contains-route-table",
    source: {
      port: "aws.ec2.vpc.route-table-placement",
      serviceType: "aws.ec2.vpc",
    },
    target: {
      port: "aws.ec2.route-table.vpc",
      serviceType: "aws.ec2.route-table",
    },
  },
  {
    relationshipType: "aws.lambda.owns-vpc-access-configuration",
    source: {
      port: "aws.lambda.vpc-access-configuration.function",
      serviceType: "aws.lambda.vpc-access-configuration",
    },
    target: {
      port: "aws.lambda.function.vpc-access",
      serviceType: "aws.lambda.function",
    },
  },
  {
    relationshipType: "aws.lambda.vpc-access-uses-security-group",
    source: {
      port: "aws.lambda.vpc-access-configuration.security-group",
      serviceType: "aws.lambda.vpc-access-configuration",
    },
    target: {
      port: "aws.ec2.security-group.lambda-vpc-access",
      serviceType: "aws.ec2.security-group",
    },
  },
  {
    relationshipType: "aws.lambda.vpc-access-uses-subnet",
    source: {
      port: "aws.lambda.vpc-access-configuration.subnet",
      serviceType: "aws.lambda.vpc-access-configuration",
    },
    target: {
      port: "aws.ec2.subnet.lambda-vpc-access",
      serviceType: "aws.ec2.subnet",
    },
  },
  {
    relationshipType: "aws.region.contains-vpc",
    source: {
      port: "aws.region.boundary.vpc-placement",
      serviceType: "aws.region.boundary",
    },
    target: {
      port: "aws.ec2.vpc.region",
      serviceType: "aws.ec2.vpc",
    },
  },
] as const;

const placementByServiceV2 = {
  "aws.dynamodb.table": {
    allowedParentTypes: [],
    rootPlacement: "allowed",
  },
  "aws.ec2.availability-zone": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
        serviceType: "aws.ec2.vpc",
      },
    ],
    maximumDepth: 3,
    rootPlacement: "forbidden",
  },
  "aws.ec2.gateway-vpc-endpoint": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
        serviceType: "aws.ec2.vpc",
      },
    ],
    maximumDepth: 3,
    rootPlacement: "forbidden",
  },
  "aws.ec2.internet-gateway": {
    allowedParentTypes: [],
    rootPlacement: "allowed",
  },
  "aws.ec2.nat-gateway": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.subnet-contains-nat-gateway",
        serviceType: "aws.ec2.subnet",
      },
    ],
    maximumDepth: 5,
    rootPlacement: "forbidden",
  },
  "aws.ec2.route": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.route-table-owns-route",
        serviceType: "aws.ec2.route-table",
      },
    ],
    maximumDepth: 4,
    rootPlacement: "forbidden",
  },
  "aws.ec2.route-table": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.vpc-contains-route-table",
        serviceType: "aws.ec2.vpc",
      },
    ],
    maximumDepth: 3,
    rootPlacement: "forbidden",
  },
  "aws.ec2.route-table-association": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
        serviceType: "aws.ec2.route-table",
      },
    ],
    maximumDepth: 4,
    rootPlacement: "forbidden",
  },
  "aws.ec2.security-group": {
    allowedParentTypes: [],
    rootPlacement: "allowed",
  },
  "aws.ec2.security-group-egress-rule": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.security-group-owns-egress-rule",
        serviceType: "aws.ec2.security-group",
      },
    ],
    maximumDepth: 2,
    rootPlacement: "forbidden",
  },
  "aws.ec2.security-group-ingress-rule": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.security-group-owns-ingress-rule",
        serviceType: "aws.ec2.security-group",
      },
    ],
    maximumDepth: 2,
    rootPlacement: "forbidden",
  },
  "aws.ec2.subnet": {
    allowedParentTypes: [
      {
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
        serviceType: "aws.ec2.availability-zone",
      },
    ],
    maximumDepth: 4,
    rootPlacement: "forbidden",
  },
  "aws.ec2.vpc": {
    allowedParentTypes: [
      {
        relationshipType: "aws.region.contains-vpc",
        serviceType: "aws.region.boundary",
      },
    ],
    maximumDepth: 2,
    rootPlacement: "forbidden",
  },
  "aws.lambda.function": {
    allowedParentTypes: [],
    rootPlacement: "allowed",
  },
  "aws.lambda.vpc-access-configuration": {
    allowedParentTypes: [
      {
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
        serviceType: "aws.lambda.function",
      },
    ],
    maximumDepth: 2,
    rootPlacement: "forbidden",
  },
  "aws.region.boundary": {
    allowedParentTypes: [],
    rootPlacement: "required",
  },
} as const;

function configurationSchemaVersion(serviceType: string): string {
  return serviceType === "aws.lambda.vpc-access-configuration"
    ? "1.1.0"
    : "1.0.0";
}

function configurationProperty(key: string) {
  if (booleanConfigurationKeys.has(key)) return { type: "boolean" as const };
  if (integerConfigurationKeys.has(key)) return { type: "integer" as const };
  return { type: "string" as const };
}

function configurationAuthority(input: {
  readonly keys: readonly string[];
  readonly schemaId: string;
  readonly schemaVersion: string;
}) {
  const canonicalization =
    "cloudmarkup.provider-configuration-authority.canonical-json.v1" as const;
  const properties = Object.fromEntries(
    input.keys.map((key) => [key, configurationProperty(key)]),
  );
  const jsonSchema = {
    $id: `urn:cloudmarkup:configuration:${input.schemaId}:${input.schemaVersion}`,
    $schema: "https://json-schema.org/draft/2020-12/schema" as const,
    additionalProperties: false as const,
    properties,
    required: [...input.keys],
    title: `Frozen AWS networking authority for ${input.schemaId}`,
    type: "object" as const,
  };
  const nodeReferenceAuthorities = {};
  const valueSources = Object.fromEntries(
    input.keys.map((key) => [key, "literal" as const]),
  );
  return {
    canonicalization,
    jsonSchema,
    nodeReferenceAuthorities,
    schemaDigest: digestStructuredValue({
      canonicalization,
      jsonSchema,
      nodeReferenceAuthorities,
      schemaId: input.schemaId,
      schemaVersion: input.schemaVersion,
      valueSources,
    }),
    valueSources,
  };
}

function catalogPorts(serviceType: string) {
  const ports = new Map<string, "input" | "output">();
  for (const relationship of relationshipEndpointsV2) {
    if (relationship.source.serviceType === serviceType) {
      ports.set(relationship.source.port, "output");
    }
    if (relationship.target.serviceType === serviceType) {
      ports.set(relationship.target.port, "input");
    }
  }
  return [...ports.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([port, direction]) => ({ direction, port }));
}

export const modelNetworkingPlanningCatalogGroundingV2 =
  modelOperationCatalogGroundingV1Schema.parse({
    catalog: {
      digest: modelNetworkingCatalogAuthorityV2.catalogDigest,
      id: modelNetworkingCatalogAuthorityV2.catalogId,
      version: modelNetworkingCatalogAuthorityV2.catalogVersion,
    },
    connectionRules: relationshipEndpointsV2.map((relationship) => {
      const schemaId = `${relationship.relationshipType}.connection`;
      const schemaVersion = "1.0.0";
      return {
        configurationSchemaId: schemaId,
        configurationSchemaVersion: schemaVersion,
        configurationValidation: configurationAuthority({
          keys: [],
          schemaId,
          schemaVersion,
        }),
        relationshipType: relationship.relationshipType,
        ruleId: relationship.relationshipType,
        ruleVersion: "1.0.0",
        source: relationship.source,
        target: relationship.target,
      };
    }),
    manifestVersion: 1,
    nodes: modelNetworkingCatalogAuthorityV2.services.map((service) => {
      const schemaId = `${service.serviceId}.configuration`;
      const schemaVersion = configurationSchemaVersion(service.serviceId);
      return {
        configurationSchemaId: schemaId,
        configurationSchemaVersion: schemaVersion,
        configurationValidation: configurationAuthority({
          keys: service.configurationKeys,
          schemaId,
          schemaVersion,
        }),
        placement:
          placementByServiceV2[
            service.serviceId as keyof typeof placementByServiceV2
          ],
        ports: catalogPorts(service.serviceId),
        resourceType: service.serviceId,
        serviceType: service.serviceId,
      };
    }),
  });

const validationRuleMetadataV2 = [
  {
    kind: "placement" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.placement",
  },
  {
    kind: "connection" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.connection",
  },
  {
    kind: "policy" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.policy",
  },
  {
    kind: "security" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.security",
  },
  {
    kind: "cost-sensitive" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.cost",
  },
  {
    kind: "coverage" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.coverage",
  },
  {
    kind: "target-readiness" as const,
    ruleId: "cloudmarkup.model-evaluation.networking.target-readiness",
  },
] as const;

function literalString(
  values: Readonly<Record<string, ConfigurationValue>>,
  key: string,
): string | undefined {
  const value = values[key];
  return value?.kind === "string" ? value.value : undefined;
}

function literalInteger(
  values: Readonly<Record<string, ConfigurationValue>>,
  key: string,
): number | undefined {
  const value = values[key];
  return value?.kind === "integer" ? value.value : undefined;
}

function isAlignedIpv4Cidr(value: string): boolean {
  const match =
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/u.exec(
      value,
    );
  if (match === null) return false;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const address =
    (((octets[0] ?? 0) << 24) |
      ((octets[1] ?? 0) << 16) |
      ((octets[2] ?? 0) << 8) |
      (octets[3] ?? 0)) >>>
    0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) >>> 0 === address;
}

function finding(input: {
  readonly code: string;
  readonly index: number;
  readonly key: string;
  readonly nodeId: ArchitectureDocumentV3["nodes"][number]["id"];
  readonly severity: "error" | "security-error";
  readonly title: string;
}): ValidationFindingCandidate {
  return {
    affected: [
      {
        key: input.key,
        kind: "configuration",
        owner: { kind: "node", nodeId: input.nodeId },
        path: createValidationDocumentPath(
          `$.nodes[${String(input.index)}].semantic.configuration.values.${input.key}`,
        ),
      },
    ],
    beginnerExplanation: input.title,
    code: createValidationFindingCode(input.code),
    documentationReferences: [],
    severity: input.severity,
    technicalExplanation:
      "The deterministic networking evaluation rule rejected the exact catalog-grounded configuration value.",
    title: input.title,
  };
}

function productionValidationRules(
  recordedFindingCodes: Set<string>,
): readonly ValidationRuleV1[] {
  return validationRuleMetadataV2.map((metadata) =>
    defineValidationRuleV1({
      applicability: {
        catalogs: { kind: "all" },
        environments: ["development"],
        providers: { kind: "all" },
        targets: ["compilation"],
      },
      evaluate: (context) => {
        const document = context.document;
        if (document === undefined) return [];
        const findings: ValidationFindingCandidate[] = [];
        if (metadata.kind === "placement") {
          document.nodes.forEach((node, index) => {
            if (node.semantic.serviceType !== "aws.ec2.vpc") return;
            const cidr = literalString(
              node.semantic.configuration.values,
              "cidrBlock",
            );
            if (cidr !== undefined && !isAlignedIpv4Cidr(cidr)) {
              const code = "aws.validation.vpc-cidr-invalid";
              recordedFindingCodes.add(code);
              findings.push(
                finding({
                  code,
                  index,
                  key: "cidrBlock",
                  nodeId: node.id,
                  severity: "error",
                  title: "The VPC CIDR is not a valid network boundary.",
                }),
              );
            }
          });
        }
        if (metadata.kind === "security") {
          document.nodes.forEach((node, index) => {
            if (
              node.semantic.serviceType !==
              "aws.ec2.security-group-ingress-rule"
            ) {
              return;
            }
            const values = node.semantic.configuration.values;
            const protocol = literalString(values, "protocol");
            const source = literalString(values, "sourceIpv4Cidr");
            const fromPort = literalInteger(values, "fromPort");
            const toPort = literalInteger(values, "toPort");
            const exposesSensitivePort =
              protocol === "-1" ||
              (protocol === "tcp" &&
                fromPort !== undefined &&
                toPort !== undefined &&
                ((fromPort <= 22 && toPort >= 22) ||
                  (fromPort <= 3389 && toPort >= 3389)));
            if (source === "0.0.0.0/0" && exposesSensitivePort) {
              const code = "aws.validation.security-group-admin-ingress-open";
              recordedFindingCodes.add(code);
              findings.push(
                finding({
                  code,
                  index,
                  key: "sourceIpv4Cidr",
                  nodeId: node.id,
                  severity: "security-error",
                  title:
                    "Sensitive administrative ingress is open to the internet.",
                }),
              );
            }
          });
        }
        return findings;
      },
      id: metadata.ruleId,
      input: "architecture-document",
      interfaceVersion: 1,
      ruleVersion: "1.0.0",
    }),
  );
}

function operationsRequestFor(
  evaluationCase: ModelNetworkingEvaluationCaseV2,
): ModelRequestFor<"operations.propose"> {
  const base = modelTestRequests().find(
    (request) => request.operation === "operations.propose",
  );
  if (base?.operation !== "operations.propose") {
    throw new Error("The deterministic operations request fixture is missing.");
  }
  const architecture = architectureDocumentV3Schema.parse({
    ...base.architecture,
    applicationContracts: {
      ...base.architecture.applicationContracts,
      contracts: [],
    },
    assumptions: [],
    catalog: modelNetworkingPlanningCatalogGroundingV2.catalog,
    edges: [],
    externalResources: {
      ...base.architecture.externalResources,
      resources: [],
    },
    nodes: [],
    outputs: [],
    provider: { id: "aws.cloudmarkup", region: "us-east-1" },
    unresolvedRequirements: [],
    variables: [],
    workloadBehavior: { contractVersion: 2, workloads: [] },
  });
  return modelOperationProposalRequestV1Schema.parse({
    ...base,
    architecture,
    catalogGrounding: modelNetworkingPlanningCatalogGroundingV2,
    planningContext: {
      allowedAssistantOperationKinds: ["request-clarification"],
      allowedGraphCommandKinds: ["add-edge", "add-node"],
      allowedPolicyKinds: [],
      approvedIntent: {
        ...testIntent,
        application: {
          ...testIntent.application,
          summary: evaluationCase.input.requirements,
        },
      },
      assistantLimits: {
        maximumApplicationContracts: 0,
        maximumOperations: 8,
        maximumSourceOwnershipDeclarations: 0,
        maximumTestScenarios: 0,
        maximumWorkloadOperations: 0,
        maximumWorkloads: 0,
      },
      limits: {
        maximumAddedNodes: 64,
        maximumEdges: 128,
        maximumExternalResources: 0,
        maximumNodes: 64,
      },
      target: "terraform",
      targetReadiness: modelNetworkingCatalogAuthorityV2.services.map(
        ({ serviceId }) => ({
          rationale:
            "The exact frozen AWS networking catalog marks this evaluation service ready for reviewed Terraform planning.",
          serviceType: serviceId,
          status: "ready" as const,
          target: "terraform" as const,
        }),
      ),
      validationRules: validationRuleMetadataV2,
    },
  });
}

function graphTarget(request: ModelRequestFor<"operations.propose">) {
  return {
    architectureId: request.architecture.architectureId,
    documentId: request.architecture.documentId,
    revisionId: request.architecture.revision.revisionId,
  };
}

function commandEnvelope(
  request: ModelRequestFor<"operations.propose">,
  id: string,
) {
  return {
    commandId: `command_${id}`,
    inverseCommandId: `command_${id}_inverse`,
    origin: "ai-accepted" as const,
    schemaVersion: 1 as const,
    target: graphTarget(request),
  };
}

function addNode(
  request: ModelRequestFor<"operations.propose">,
  input: {
    readonly id: string;
    readonly label: string;
    readonly parent?: {
      readonly nodeId: string;
      readonly relationshipType: string;
    };
    readonly serviceType: string;
    readonly values: Readonly<Record<string, ConfigurationValue>>;
    readonly x: number;
    readonly y: number;
  },
): ReturnType<typeof graphCommandActionV1Schema.parse> {
  const schemaVersion = configurationSchemaVersion(input.serviceType);
  return graphCommandActionV1Schema.parse({
    ...commandEnvelope(request, `add_${input.id}`),
    kind: "add-node",
    node: {
      id: input.id,
      presentation: {
        label: input.label,
        position: { x: input.x, y: input.y },
      },
      semantic: {
        configuration: {
          schemaId: `${input.serviceType}.configuration`,
          schemaVersion,
          values: { ...input.values },
        },
        deploymentKey: input.id.replace(/^node_model_/u, "eval_"),
        lifecycle: { origin: "ai-accepted", ownership: "user" },
        ...(input.parent === undefined ? {} : { parent: input.parent }),
        resourceType: input.serviceType,
        serviceType: input.serviceType,
      },
    },
  });
}

function addEdge(
  request: ModelRequestFor<"operations.propose">,
  input: {
    readonly id: string;
    readonly relationshipType: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
  },
): ReturnType<typeof graphCommandActionV1Schema.parse> {
  const relationship = relationshipEndpointsV2.find(
    ({ relationshipType }) => relationshipType === input.relationshipType,
  );
  if (relationship === undefined) {
    throw new Error(
      `Missing frozen relationship endpoint authority ${input.relationshipType}.`,
    );
  }
  return graphCommandActionV1Schema.parse({
    ...commandEnvelope(request, `add_${input.id}`),
    edge: {
      id: input.id,
      semantic: {
        configuration: {
          schemaId: `${input.relationshipType}.connection`,
          schemaVersion: "1.0.0",
          values: {},
        },
        lifecycle: { origin: "ai-accepted", ownership: "user" },
        relationshipType: input.relationshipType,
        source: {
          nodeId: input.sourceNodeId,
          port: relationship.source.port,
        },
        target: {
          nodeId: input.targetNodeId,
          port: relationship.target.port,
        },
      },
    },
    kind: "add-edge",
  });
}

function graphBatch(
  request: ModelRequestFor<"operations.propose">,
  caseKind: ModelNetworkingEvaluationCaseKindV2,
  commands: readonly ReturnType<typeof graphCommandActionV1Schema.parse>[],
): OperationResponse["batches"][number] {
  return {
    batch: graphCommandBatchV1Schema.parse({
      ...commandEnvelope(
        request,
        `batch_networking_${caseKind.replaceAll("-", "_")}`,
      ),
      commands: [...commands],
      kind: "batch",
    }),
    kind: "graph",
  };
}

function baseNetworkCommands(
  request: ModelRequestFor<"operations.propose">,
  input: { readonly includeDynamoDb: boolean },
): ReturnType<typeof graphCommandActionV1Schema.parse>[] {
  const region = "node_model_region";
  const vpc = "node_model_vpc";
  const zoneA = "node_model_zone_a";
  const zoneB = "node_model_zone_b";
  const subnetA = "node_model_subnet_a";
  const subnetB = "node_model_subnet_b";
  const securityGroup = "node_model_security_group";
  const lambda = "node_model_lambda";
  const vpcAccess = "node_model_lambda_vpc_access";
  const commands: ReturnType<typeof graphCommandActionV1Schema.parse>[] = [
    addNode(request, {
      id: region,
      label: "US East (N. Virginia)",
      serviceType: "aws.region.boundary",
      values: { regionName: { kind: "string", value: "us-east-1" } },
      x: 0,
      y: 0,
    }),
    addNode(request, {
      id: vpc,
      label: "Application VPC",
      parent: { nodeId: region, relationshipType: "aws.region.contains-vpc" },
      serviceType: "aws.ec2.vpc",
      values: {
        cidrBlock: { kind: "string", value: "10.0.0.0/16" },
        enableDnsHostnames: { kind: "boolean", value: true },
        enableDnsSupport: { kind: "boolean", value: true },
        instanceTenancy: { kind: "string", value: "default" },
      },
      x: 20,
      y: 40,
    }),
    addNode(request, {
      id: zoneA,
      label: "Availability Zone A",
      parent: {
        nodeId: vpc,
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
      serviceType: "aws.ec2.availability-zone",
      values: { zoneName: { kind: "string", value: "us-east-1a" } },
      x: 40,
      y: 80,
    }),
    addNode(request, {
      id: zoneB,
      label: "Availability Zone B",
      parent: {
        nodeId: vpc,
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
      serviceType: "aws.ec2.availability-zone",
      values: { zoneName: { kind: "string", value: "us-east-1b" } },
      x: 280,
      y: 80,
    }),
    addNode(request, {
      id: subnetA,
      label: "Private subnet A",
      parent: {
        nodeId: zoneA,
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      serviceType: "aws.ec2.subnet",
      values: {
        accessTier: { kind: "string", value: "private" },
        assignIpv6AddressOnCreation: { kind: "boolean", value: false },
        cidrBlock: { kind: "string", value: "10.0.1.0/24" },
        mapPublicIpOnLaunch: { kind: "boolean", value: false },
      },
      x: 60,
      y: 120,
    }),
    addNode(request, {
      id: subnetB,
      label: "Private subnet B",
      parent: {
        nodeId: zoneB,
        relationshipType: "aws.ec2.availability-zone-contains-subnet",
      },
      serviceType: "aws.ec2.subnet",
      values: {
        accessTier: { kind: "string", value: "private" },
        assignIpv6AddressOnCreation: { kind: "boolean", value: false },
        cidrBlock: { kind: "string", value: "10.0.2.0/24" },
        mapPublicIpOnLaunch: { kind: "boolean", value: false },
      },
      x: 300,
      y: 120,
    }),
    addNode(request, {
      id: securityGroup,
      label: "Lambda security group",
      serviceType: "aws.ec2.security-group",
      values: {
        description: {
          kind: "string",
          value: "Reviewed Lambda outbound traffic",
        },
        groupName: { kind: "string", value: "lambda-private-access" },
      },
      x: 540,
      y: 120,
    }),
    addNode(request, {
      id: lambda,
      label: "Application function",
      serviceType: "aws.lambda.function",
      values: {
        architecture: { kind: "string", value: "arm64" },
        functionName: { kind: "string", value: "networking-eval" },
        handler: { kind: "string", value: "index.handler" },
        memoryMegabytes: { kind: "integer", value: 256 },
        reservedConcurrency: { kind: "integer", value: 10 },
        runtime: { kind: "string", value: "nodejs24.x" },
        timeoutSeconds: { kind: "integer", value: 10 },
        tracingEnabled: { kind: "boolean", value: true },
      },
      x: 540,
      y: 200,
    }),
    addNode(request, {
      id: vpcAccess,
      label: "Lambda VPC access",
      parent: {
        nodeId: lambda,
        relationshipType: "aws.lambda.owns-vpc-access-configuration",
      },
      serviceType: "aws.lambda.vpc-access-configuration",
      values: {
        egressRequirement: {
          kind: "string",
          value: input.includeDynamoDb ? "dynamodb" : "none",
        },
        ipv6AllowedForDualStack: { kind: "boolean", value: false },
      },
      x: 540,
      y: 240,
    }),
  ];
  if (input.includeDynamoDb) {
    commands.push(
      addNode(request, {
        id: "node_model_dynamodb",
        label: "Application table",
        serviceType: "aws.dynamodb.table",
        values: {
          billingMode: { kind: "string", value: "PAY_PER_REQUEST" },
          deletionProtectionEnabled: { kind: "boolean", value: true },
          partitionKeyName: { kind: "string", value: "noteId" },
          partitionKeyType: { kind: "string", value: "S" },
          pointInTimeRecoveryEnabled: { kind: "boolean", value: true },
          serverSideEncryptionEnabled: { kind: "boolean", value: true },
          tableName: { kind: "string", value: "networking-eval" },
        },
        x: 760,
        y: 120,
      }),
    );
  }
  commands.push(
    addEdge(request, {
      id: "edge_model_region_vpc",
      relationshipType: "aws.region.contains-vpc",
      sourceNodeId: region,
      targetNodeId: vpc,
    }),
    addEdge(request, {
      id: "edge_model_vpc_zone_a",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
      sourceNodeId: vpc,
      targetNodeId: zoneA,
    }),
    addEdge(request, {
      id: "edge_model_vpc_zone_b",
      relationshipType: "aws.ec2.vpc-contains-availability-zone",
      sourceNodeId: vpc,
      targetNodeId: zoneB,
    }),
    addEdge(request, {
      id: "edge_model_zone_a_subnet",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
      sourceNodeId: zoneA,
      targetNodeId: subnetA,
    }),
    addEdge(request, {
      id: "edge_model_zone_b_subnet",
      relationshipType: "aws.ec2.availability-zone-contains-subnet",
      sourceNodeId: zoneB,
      targetNodeId: subnetB,
    }),
    addEdge(request, {
      id: "edge_model_vpc_security_group",
      relationshipType: "aws.ec2.vpc-associates-security-group",
      sourceNodeId: vpc,
      targetNodeId: securityGroup,
    }),
    addEdge(request, {
      id: "edge_model_lambda_vpc_access",
      relationshipType: "aws.lambda.owns-vpc-access-configuration",
      sourceNodeId: vpcAccess,
      targetNodeId: lambda,
    }),
    addEdge(request, {
      id: "edge_model_lambda_security_group",
      relationshipType: "aws.lambda.vpc-access-uses-security-group",
      sourceNodeId: vpcAccess,
      targetNodeId: securityGroup,
    }),
    addEdge(request, {
      id: "edge_model_lambda_subnet_a",
      relationshipType: "aws.lambda.vpc-access-uses-subnet",
      sourceNodeId: vpcAccess,
      targetNodeId: subnetA,
    }),
    addEdge(request, {
      id: "edge_model_lambda_subnet_b",
      relationshipType: "aws.lambda.vpc-access-uses-subnet",
      sourceNodeId: vpcAccess,
      targetNodeId: subnetB,
    }),
  );
  return commands;
}

function caseBatches(
  request: ModelRequestFor<"operations.propose">,
  caseKind: ModelNetworkingEvaluationCaseKindV2,
): OperationResponse["batches"] {
  if (caseKind === "private-database") {
    return [
      {
        batch: assistantOperationBatchV1Schema.parse({
          baseArchitectureDigest: getArchitectureDocumentCanonicalHash(
            request.architecture,
          ),
          contractVersion: 1,
          kind: "cloudmarkup.assistant-operation-batch",
          operations: [
            {
              blocking: true,
              evidenceIds: [],
              kind: "request-clarification",
              operationId: "assistant_private_database_clarification",
              question:
                "The approved catalog has no relational database service. Which catalog extension should be reviewed before planning the private database?",
              questionId: "question_private_database_catalog_gap",
              rationale:
                "Keep the private relational database unresolved instead of inventing RDS authority.",
            },
          ],
        }),
        kind: "assistant",
      },
    ];
  }
  if (caseKind === "invalid-cidr") {
    const region = "node_model_invalid_region";
    const vpc = "node_model_invalid_vpc";
    return [
      graphBatch(request, caseKind, [
        addNode(request, {
          id: region,
          label: "US East (N. Virginia)",
          serviceType: "aws.region.boundary",
          values: { regionName: { kind: "string", value: "us-east-1" } },
          x: 0,
          y: 0,
        }),
        addNode(request, {
          id: vpc,
          label: "Invalid VPC candidate",
          parent: {
            nodeId: region,
            relationshipType: "aws.region.contains-vpc",
          },
          serviceType: "aws.ec2.vpc",
          values: {
            cidrBlock: { kind: "string", value: "10.0.0.1/16" },
            enableDnsHostnames: { kind: "boolean", value: true },
            enableDnsSupport: { kind: "boolean", value: true },
            instanceTenancy: { kind: "string", value: "default" },
          },
          x: 20,
          y: 40,
        }),
        addEdge(request, {
          id: "edge_model_invalid_region_vpc",
          relationshipType: "aws.region.contains-vpc",
          sourceNodeId: region,
          targetNodeId: vpc,
        }),
      ]),
    ];
  }
  if (caseKind === "broad-ingress") {
    const region = "node_model_ingress_region";
    const vpc = "node_model_ingress_vpc";
    const securityGroup = "node_model_ingress_security_group";
    const ingress = "node_model_ingress_rule";
    return [
      graphBatch(request, caseKind, [
        addNode(request, {
          id: region,
          label: "US East (N. Virginia)",
          serviceType: "aws.region.boundary",
          values: { regionName: { kind: "string", value: "us-east-1" } },
          x: 0,
          y: 0,
        }),
        addNode(request, {
          id: vpc,
          label: "Application VPC",
          parent: {
            nodeId: region,
            relationshipType: "aws.region.contains-vpc",
          },
          serviceType: "aws.ec2.vpc",
          values: {
            cidrBlock: { kind: "string", value: "10.0.0.0/16" },
            enableDnsHostnames: { kind: "boolean", value: true },
            enableDnsSupport: { kind: "boolean", value: true },
            instanceTenancy: { kind: "string", value: "default" },
          },
          x: 20,
          y: 40,
        }),
        addNode(request, {
          id: securityGroup,
          label: "Production security group",
          serviceType: "aws.ec2.security-group",
          values: {
            description: {
              kind: "string",
              value: "Candidate administrative access",
            },
            groupName: { kind: "string", value: "production-admin" },
          },
          x: 280,
          y: 80,
        }),
        addNode(request, {
          id: ingress,
          label: "Unsafe SSH ingress",
          parent: {
            nodeId: securityGroup,
            relationshipType: "aws.ec2.security-group-owns-ingress-rule",
          },
          serviceType: "aws.ec2.security-group-ingress-rule",
          values: {
            description: { kind: "string", value: "SSH from anywhere" },
            fromPort: { kind: "integer", value: 22 },
            protocol: { kind: "string", value: "tcp" },
            sourceIpv4Cidr: { kind: "string", value: "0.0.0.0/0" },
            toPort: { kind: "integer", value: 22 },
          },
          x: 320,
          y: 120,
        }),
        addEdge(request, {
          id: "edge_model_ingress_region_vpc",
          relationshipType: "aws.region.contains-vpc",
          sourceNodeId: region,
          targetNodeId: vpc,
        }),
        addEdge(request, {
          id: "edge_model_ingress_vpc_security_group",
          relationshipType: "aws.ec2.vpc-associates-security-group",
          sourceNodeId: vpc,
          targetNodeId: securityGroup,
        }),
        addEdge(request, {
          id: "edge_model_ingress_rule_security_group",
          relationshipType: "aws.ec2.security-group-owns-ingress-rule",
          sourceNodeId: ingress,
          targetNodeId: securityGroup,
        }),
      ]),
    ];
  }
  const commands = baseNetworkCommands(request, {
    includeDynamoDb: caseKind === "avoid-nat",
  });
  if (caseKind === "avoid-nat") {
    const vpc = "node_model_vpc";
    const routeTable = "node_model_route_table";
    const associationA = "node_model_route_association_a";
    const associationB = "node_model_route_association_b";
    const endpoint = "node_model_dynamodb_endpoint";
    commands.splice(
      10,
      0,
      addNode(request, {
        id: routeTable,
        label: "Private route table",
        parent: {
          nodeId: vpc,
          relationshipType: "aws.ec2.vpc-contains-route-table",
        },
        serviceType: "aws.ec2.route-table",
        values: { name: { kind: "string", value: "private-endpoint-routes" } },
        x: 60,
        y: 180,
      }),
      addNode(request, {
        id: associationA,
        label: "Subnet A route association",
        parent: {
          nodeId: routeTable,
          relationshipType: "aws.ec2.route-table-owns-subnet-association",
        },
        serviceType: "aws.ec2.route-table-association",
        values: {},
        x: 80,
        y: 220,
      }),
      addNode(request, {
        id: associationB,
        label: "Subnet B route association",
        parent: {
          nodeId: routeTable,
          relationshipType: "aws.ec2.route-table-owns-subnet-association",
        },
        serviceType: "aws.ec2.route-table-association",
        values: {},
        x: 260,
        y: 220,
      }),
      addNode(request, {
        id: endpoint,
        label: "DynamoDB gateway endpoint",
        parent: {
          nodeId: vpc,
          relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
        },
        serviceType: "aws.ec2.gateway-vpc-endpoint",
        values: {
          endpointType: { kind: "string", value: "Gateway" },
          policyMode: { kind: "string", value: "restricted" },
          service: { kind: "string", value: "dynamodb" },
        },
        x: 420,
        y: 180,
      }),
    );
    commands.push(
      addEdge(request, {
        id: "edge_model_vpc_route_table",
        relationshipType: "aws.ec2.vpc-contains-route-table",
        sourceNodeId: vpc,
        targetNodeId: routeTable,
      }),
      addEdge(request, {
        id: "edge_model_route_table_association_a",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
        sourceNodeId: associationA,
        targetNodeId: routeTable,
      }),
      addEdge(request, {
        id: "edge_model_route_table_association_b",
        relationshipType: "aws.ec2.route-table-owns-subnet-association",
        sourceNodeId: associationB,
        targetNodeId: routeTable,
      }),
      addEdge(request, {
        id: "edge_model_association_a_subnet",
        relationshipType: "aws.ec2.route-table-association-targets-subnet",
        sourceNodeId: associationA,
        targetNodeId: "node_model_subnet_a",
      }),
      addEdge(request, {
        id: "edge_model_association_b_subnet",
        relationshipType: "aws.ec2.route-table-association-targets-subnet",
        sourceNodeId: associationB,
        targetNodeId: "node_model_subnet_b",
      }),
      addEdge(request, {
        id: "edge_model_vpc_dynamodb_endpoint",
        relationshipType: "aws.ec2.vpc-contains-gateway-endpoint",
        sourceNodeId: vpc,
        targetNodeId: endpoint,
      }),
      addEdge(request, {
        id: "edge_model_dynamodb_endpoint_route_table",
        relationshipType: "aws.ec2.gateway-endpoint-associates-route-table",
        sourceNodeId: endpoint,
        targetNodeId: routeTable,
      }),
    );
  }
  return [graphBatch(request, caseKind, commands)];
}

function responseForCase(
  invocation: ModelProviderInvocationV1,
  caseKind: ModelNetworkingEvaluationCaseKindV2,
): OperationResponse {
  const response = deterministicFakeResponseV1(invocation);
  if (
    response.operation !== "operations.propose" ||
    response.solutionProposal === undefined
  ) {
    throw new Error(
      "The deterministic fake did not return a planning response.",
    );
  }
  return {
    ...response,
    batches: caseBatches(
      invocation.request as ModelRequestFor<"operations.propose">,
      caseKind,
    ),
    solutionProposal: {
      ...response.solutionProposal,
      rationale:
        "The scripted deterministic fake proposes only exact operations from the supplied frozen AWS networking catalog grounding for review.",
    },
  };
}

function providerResult(
  invocation: ModelProviderInvocationV1,
  input: unknown,
): ModelProviderResultV1 {
  return {
    content: {
      input,
      kind: "tool-use",
      toolName: invocation.responseTool.toolName,
    },
    usage: {
      cacheReadUnits: "0",
      cacheWriteUnits: "0",
      inputUnits: "100",
      outputUnits: "50",
      providerRequestId: `networking_eval_${invocation.descriptor.invocationId}`,
      thinkingUnits: "0",
    },
  };
}

function operationsFromResponse(
  response: OperationResponse,
): ModelNetworkingEvaluationObservationV2["operations"] {
  const operations: ModelNetworkingEvaluationObservationV2["operations"][number][] =
    [];
  for (const batch of response.batches) {
    if (batch.kind === "assistant") {
      for (const operation of batch.batch.operations) {
        if (operation.kind === "request-clarification") {
          operations.push({ kind: "request-clarification" });
        }
      }
      continue;
    }
    if (batch.kind !== "graph") continue;
    for (const command of batch.batch.commands) {
      if (command.kind === "add-node") {
        operations.push({
          configurationKeys: Object.keys(
            command.node.semantic.configuration.values,
          ).sort(),
          kind: "add-node",
          serviceId: command.node.semantic.serviceType,
        });
      }
      if (command.kind === "add-edge") {
        operations.push({
          configurationKeys: Object.keys(
            command.edge.semantic.configuration.values,
          ).sort(),
          kind: "add-edge",
          relationshipType: command.edge.semantic.relationshipType,
        });
      }
    }
  }
  return operations;
}

function plannerDisposition(
  result: SolutionProposalPlannerResultV1,
): ModelNetworkingEvaluationObservationV2["disposition"] {
  if (result.disposition === "rejected") return "reject-unsafe-proposal";
  return result.disposition === "needs-user-input"
    ? "retain-unresolved"
    : "accept-reviewed-proposal";
}

function relationExists(
  document: ArchitectureDocumentV3,
  relationshipType: string,
  sourceNodeId?: string,
  targetNodeId?: string,
): boolean {
  return document.edges.some(
    (edge) =>
      edge.semantic.relationshipType === relationshipType &&
      (sourceNodeId === undefined ||
        edge.semantic.source.nodeId === sourceNodeId) &&
      (targetNodeId === undefined ||
        edge.semantic.target.nodeId === targetNodeId),
  );
}

function semanticObservation(input: {
  readonly automaticMutation: boolean;
  readonly document: ArchitectureDocumentV3;
  readonly response: OperationResponse;
}) {
  const { document } = input;
  const availabilityZones = document.nodes.filter(
    (node) => node.semantic.serviceType === "aws.ec2.availability-zone",
  );
  const vpcAccess = document.nodes.find(
    (node) =>
      node.semantic.serviceType === "aws.lambda.vpc-access-configuration",
  );
  const lambda = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.lambda.function",
  );
  const selectedSubnets =
    vpcAccess === undefined
      ? []
      : document.edges
          .filter(
            (edge) =>
              edge.semantic.relationshipType ===
                "aws.lambda.vpc-access-uses-subnet" &&
              edge.semantic.source.nodeId === vpcAccess.id,
          )
          .map((edge) =>
            document.nodes.find(
              (node) => node.id === edge.semantic.target.nodeId,
            ),
          )
          .filter((node): node is ArchitectureDocumentV3["nodes"][number] =>
            Boolean(node),
          );
  const selectedAvailabilityZones = new Set(
    selectedSubnets.flatMap((subnet) =>
      subnet.semantic.parent?.relationshipType ===
      "aws.ec2.availability-zone-contains-subnet"
        ? [subnet.semantic.parent.nodeId]
        : [],
    ),
  );
  const lambdaAssociation =
    vpcAccess !== undefined &&
    lambda !== undefined &&
    vpcAccess.semantic.parent?.nodeId === lambda.id &&
    vpcAccess.semantic.parent.relationshipType ===
      "aws.lambda.owns-vpc-access-configuration" &&
    relationExists(
      document,
      "aws.lambda.owns-vpc-access-configuration",
      vpcAccess.id,
      lambda.id,
    ) &&
    document.edges.some(
      (edge) =>
        edge.semantic.relationshipType ===
          "aws.lambda.vpc-access-uses-security-group" &&
        edge.semantic.source.nodeId === vpcAccess.id,
    ) &&
    selectedSubnets.length > 0;
  const lambdaFalseContainment =
    lambda?.semantic.parent !== undefined &&
    document.nodes.find((node) => node.id === lambda.semantic.parent?.nodeId)
      ?.semantic.serviceType === "aws.ec2.vpc";
  const managedService = document.nodes.find(
    (node) => node.semantic.serviceType === "aws.dynamodb.table",
  );
  const blockingClarification = input.response.batches.some(
    (batch) =>
      batch.kind === "assistant" &&
      batch.batch.operations.some(
        (operation) =>
          operation.kind === "request-clarification" && operation.blocking,
      ),
  );
  return {
    availabilityZoneCount: availabilityZones.length,
    automaticMutation: input.automaticMutation,
    lambdaVpcAccessMode:
      vpcAccess === undefined
        ? ("not-applicable" as const)
        : lambdaFalseContainment
          ? ("false-containment" as const)
          : lambdaAssociation
            ? ("association" as const)
            : ("not-applicable" as const),
    lambdaVpcSubnetAvailabilityZoneCount: selectedAvailabilityZones.size,
    managedServicePlacement:
      managedService === undefined
        ? ("not-applicable" as const)
        : managedService.semantic.parent === undefined
          ? ("outside-vpc" as const)
          : ("inside-vpc" as const),
    unresolvedCatalogGap:
      blockingClarification &&
      !document.nodes.some((node) =>
        node.semantic.serviceType.startsWith("aws.rds."),
      ),
  };
}

function outcomesFor(input: {
  readonly findingCodes: readonly string[];
  readonly observationDocument: ArchitectureDocumentV3;
  readonly plannerResult: SolutionProposalPlannerResultV1;
  readonly response: OperationResponse;
  readonly semantics: ReturnType<typeof semanticObservation>;
}) {
  const outcomes: ModelNetworkingEvaluationObservationV2["outcomes"][number][] =
    ["review-required"];
  if (input.semantics.unresolvedCatalogGap) {
    outcomes.push("catalog-gap-unresolved");
  }
  if (
    input.plannerResult.disposition === "rejected" &&
    input.findingCodes.includes("aws.validation.vpc-cidr-invalid")
  ) {
    outcomes.push("invalid-cidr-rejected");
  }
  if (
    input.plannerResult.disposition === "rejected" &&
    input.findingCodes.includes(
      "aws.validation.security-group-admin-ingress-open",
    )
  ) {
    outcomes.push("broad-sensitive-ingress-rejected");
  }
  if (input.semantics.lambdaVpcAccessMode === "association") {
    outcomes.push("lambda-vpc-access-associated");
  }
  if (input.semantics.managedServicePlacement === "outside-vpc") {
    outcomes.push("managed-service-outside-vpc");
  }
  if (input.semantics.availabilityZoneCount >= 2) {
    outcomes.push("multi-az-placement");
  }
  const hasNat = input.observationDocument.nodes.some(
    (node) => node.semantic.serviceType === "aws.ec2.nat-gateway",
  );
  const hasGatewayEndpoint = input.observationDocument.nodes.some(
    (node) => node.semantic.serviceType === "aws.ec2.gateway-vpc-endpoint",
  );
  if (!hasNat && hasGatewayEndpoint) outcomes.push("nat-avoided");
  if (
    hasGatewayEndpoint &&
    relationExists(
      input.observationDocument,
      "aws.ec2.gateway-endpoint-associates-route-table",
    )
  ) {
    outcomes.push("gateway-endpoint-preferred");
  }
  return [...new Set(outcomes)].sort((left, right) =>
    left.localeCompare(right),
  );
}

export interface ModelNetworkingProductionExecutionV2 {
  readonly adapterInvocationCount: number;
  readonly adapterProviderId: "cloudmarkup.fake";
  readonly caseId: string;
  readonly catalogDigest: Sha256Digest;
  readonly gatewayInvocationCount: number;
  readonly plannerDiagnosticCodes: readonly string[];
  readonly plannerDisposition:
    "needs-user-input" | "ready-for-review" | "rejected";
  readonly productionPath: typeof productionPathV2;
  readonly requestDigest: Sha256Digest;
  readonly writeAuthority: "none";
}

export interface ModelNetworkingProductionEvaluationReportV2 extends ModelNetworkingEvaluationReportV2 {
  readonly executions: readonly ModelNetworkingProductionExecutionV2[];
  readonly observations: readonly ModelNetworkingEvaluationObservationV2[];
}

async function executeCase(
  evaluationCase: ModelNetworkingEvaluationCaseV2,
): Promise<{
  readonly execution: ModelNetworkingProductionExecutionV2;
  readonly observation: ModelNetworkingEvaluationObservationV2;
  readonly result: ModelNetworkingEvaluationResultV2;
}> {
  const request = operationsRequestFor(evaluationCase);
  const originalDigest = getArchitectureDocumentCanonicalHash(
    request.architecture,
  );
  const recordedFindingCodes = new Set<string>();
  const restricted = new InMemoryRestrictedInvalidSolutionProposalStoreV1();
  const adapter = new ScriptedFakeModelAdapter([
    (invocation) =>
      providerResult(
        invocation,
        responseForCase(invocation, evaluationCase.caseKind),
      ),
  ]);
  const gateway = new ProviderNeutralModelGateway({
    adapters: [adapter],
    allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
    invalidProposalStore: restricted,
    invocationStore: new InMemoryModelInvocationStore(),
    logger: new CollectingSafeModelLogger(),
    routing: deterministicFakeRoutingV1,
    usageRecorder: new CollectingModelUsageRecorder(),
  });
  let gatewayInvocationCount = 0;
  let gatewayResult: ModelGatewayResultV1<"operations.propose"> | undefined;
  const recordingGateway: SolutionPlanningGatewayV1 = {
    proposeOperations: async (currentRequest, context, signal) => {
      gatewayInvocationCount += 1;
      const result = await gateway.proposeOperations(
        currentRequest,
        context,
        signal,
      );
      gatewayResult = result;
      return result;
    },
  };
  const planner = new ReviewOnlySolutionProposalPlannerV1({
    allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
    gateway: recordingGateway,
    invalidProposalStore: restricted,
    validationRules: productionValidationRules(recordedFindingCodes),
  });
  const invocationId = `invocation_networking_${evaluationCase.caseKind.replaceAll("-", "_")}_v2`;
  const plannerResult = await planner.propose({
    createdAt: createdAtV2,
    gatewayContext: modelTestContext(invocationId),
    maximumRepairAttempts: 0,
    modelRequest: request,
    solutionRevisionId: testSolutionRevision.solutionRevisionId,
    validationEnvironment: "development",
  });
  if (gatewayResult === undefined) {
    throw new Error(
      `The production gateway did not return a result for ${evaluationCase.caseId}.`,
    );
  }
  const response = gatewayResult.response;
  const observationDocument =
    plannerResult.disposition === "rejected"
      ? request.architecture
      : plannerResult.candidateArchitecture;
  const semantics = semanticObservation({
    automaticMutation:
      originalDigest !==
      getArchitectureDocumentCanonicalHash(request.architecture),
    document: observationDocument,
    response,
  });
  const findingCodes = [...recordedFindingCodes].sort((left, right) =>
    left.localeCompare(right),
  );
  const observation = modelNetworkingEvaluationObservationV2Schema.parse({
    caseDigest: evaluationCase.caseDigest,
    caseId: evaluationCase.caseId,
    disposition: plannerDisposition(plannerResult),
    findingCodes,
    operations: operationsFromResponse(response),
    outcomes: outcomesFor({
      findingCodes,
      observationDocument,
      plannerResult,
      response,
      semantics,
    }),
    semantics,
  });
  const result = evaluateModelNetworkingObservationV2({
    catalogAuthority: modelNetworkingCatalogAuthorityV2,
    evaluationCase,
    observation,
  });
  return {
    execution: {
      adapterInvocationCount: adapter.invocations.length,
      adapterProviderId: "cloudmarkup.fake",
      caseId: evaluationCase.caseId,
      catalogDigest: modelNetworkingCatalogAuthorityV2.catalogDigest,
      gatewayInvocationCount,
      plannerDiagnosticCodes:
        plannerResult.disposition === "rejected"
          ? plannerResult.diagnostics.map(({ code }) => code).sort()
          : [],
      plannerDisposition: plannerResult.disposition,
      productionPath: productionPathV2,
      requestDigest: digestStructuredValue(request),
      writeAuthority: plannerResult.writeAuthority,
    },
    observation,
    result,
  };
}

export async function runFrozenModelNetworkingEvaluationV2(): Promise<ModelNetworkingProductionEvaluationReportV2> {
  const executions: Awaited<ReturnType<typeof executeCase>>[] = [];
  for (const evaluationCase of frozenModelNetworkingEvaluationDatasetV2.cases) {
    executions.push(await executeCase(evaluationCase));
  }
  const caseResults = executions.map(({ result }) => result);
  const observations = executions.map(({ observation }) => observation);
  const productionExecutions = executions.map(({ execution }) => execution);
  const withoutDigest = {
    caseResults,
    contractVersion: 2 as const,
    datasetDigest: frozenModelNetworkingEvaluationDatasetV2.datasetDigest,
    deterministicPassed: caseResults.every(
      ({ deterministicPassed }) => deterministicPassed,
    ),
    executions: productionExecutions,
    observations,
    recordKind: "model-networking-evaluation-report" as const,
  };
  return deepFreeze({
    ...withoutDigest,
    reportDigest: digestCanonicalValue(withoutDigest),
  });
}

export const modelNetworkingProductionProbeV2Values = [
  "invented-operation-kind",
  "invented-relationship",
  "invented-service",
  "noncatalog-operation",
  "ungrounded-reference",
] as const;

export type ModelNetworkingProductionProbeV2 =
  (typeof modelNetworkingProductionProbeV2Values)[number];

export interface ModelNetworkingProductionProbeResultV2 {
  readonly adapterInvocationCount: number;
  readonly diagnosticCodes: readonly string[];
  readonly disposition: "gateway-rejected" | "planner-rejected";
  readonly mutation: ModelNetworkingProductionProbeV2;
  readonly productionPath: typeof productionPathV2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function mutateProbeResponse(
  response: OperationResponse,
  mutation: ModelNetworkingProductionProbeV2,
): unknown {
  const output: unknown = structuredClone(response);
  if (!isRecord(output) || !isUnknownArray(output["batches"])) return output;
  const graph: unknown = output["batches"].find(
    (batch) => isRecord(batch) && batch["kind"] === "graph",
  );
  if (!isRecord(graph) || !isRecord(graph["batch"])) return output;
  const commands: unknown = graph["batch"]["commands"];
  if (!isUnknownArray(commands)) return output;
  const firstNode: unknown = commands.find(
    (command) => isRecord(command) && command["kind"] === "add-node",
  );
  const firstEdge: unknown = commands.find(
    (command) => isRecord(command) && command["kind"] === "add-edge",
  );
  if (mutation === "invented-service" && isRecord(firstNode)) {
    const node = firstNode["node"];
    if (isRecord(node) && isRecord(node["semantic"])) {
      node["semantic"]["serviceType"] = "aws.rds.db-instance";
      node["semantic"]["resourceType"] = "aws.rds.db-instance";
      const configuration = node["semantic"]["configuration"];
      if (isRecord(configuration)) {
        configuration["schemaId"] = "aws.rds.db-instance.configuration";
      }
    }
  }
  if (mutation === "invented-relationship" && isRecord(firstEdge)) {
    const edge = firstEdge["edge"];
    if (isRecord(edge) && isRecord(edge["semantic"])) {
      edge["semantic"]["relationshipType"] =
        "aws.ec2.subnet-magically-connects-database";
      const configuration = edge["semantic"]["configuration"];
      if (isRecord(configuration)) {
        configuration["schemaId"] =
          "aws.ec2.subnet-magically-connects-database.connection";
      }
    }
  }
  if (mutation === "ungrounded-reference" && isRecord(firstEdge)) {
    const edge = firstEdge["edge"];
    if (isRecord(edge) && isRecord(edge["semantic"])) {
      const target = edge["semantic"]["target"];
      if (isRecord(target)) target["nodeId"] = "node_model_missing";
    }
  }
  if (mutation === "noncatalog-operation" && isRecord(firstNode)) {
    const node = firstNode["node"];
    const envelope = {
      commandId: "command_probe_reparent",
      expectedParent: null,
      inverseCommandId: "command_probe_reparent_inverse",
      kind: "reparent-node",
      nodeId: isRecord(node) ? node["id"] : "node_model_region",
      origin: "ai-accepted",
      parent: null,
      schemaVersion: 1,
      target: firstNode["target"],
    };
    commands.push(envelope);
  }
  if (mutation === "invented-operation-kind" && isRecord(firstNode)) {
    firstNode["kind"] = "deploy-now";
  }
  return output;
}

function diagnosticCode(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "model-evaluation.networking.unexpected-probe-failure";
}

export async function runModelNetworkingProductionProbeV2(
  mutation: ModelNetworkingProductionProbeV2,
): Promise<ModelNetworkingProductionProbeResultV2> {
  const evaluationCase = frozenModelNetworkingEvaluationDatasetV2.cases.find(
    ({ caseKind }) => caseKind === "multi-az-requirements",
  );
  if (evaluationCase === undefined) {
    throw new Error("The multi-AZ networking evaluation case is missing.");
  }
  const request = operationsRequestFor(evaluationCase);
  const restricted = new InMemoryRestrictedInvalidSolutionProposalStoreV1();
  const adapter = new ScriptedFakeModelAdapter([
    (invocation) =>
      providerResult(
        invocation,
        mutateProbeResponse(
          responseForCase(invocation, evaluationCase.caseKind),
          mutation,
        ),
      ),
  ]);
  const gateway = new ProviderNeutralModelGateway({
    adapters: [adapter],
    allowedApprovalPathIds: ["cloudmarkup.dependency-review.v1"],
    invalidProposalStore: restricted,
    invocationStore: new InMemoryModelInvocationStore(),
    logger: new CollectingSafeModelLogger(),
    routing: deterministicFakeRoutingV1,
    usageRecorder: new CollectingModelUsageRecorder(),
  });
  const planner = new ReviewOnlySolutionProposalPlannerV1({
    allowedApprovalPathIds: new Set(["cloudmarkup.dependency-review.v1"]),
    gateway,
    invalidProposalStore: restricted,
    validationRules: productionValidationRules(new Set()),
  });
  try {
    const result = await planner.propose({
      createdAt: createdAtV2,
      gatewayContext: modelTestContext(
        `invocation_networking_probe_${mutation.replaceAll("-", "_")}_v2`,
      ),
      maximumRepairAttempts: 0,
      modelRequest: request,
      solutionRevisionId: testSolutionRevision.solutionRevisionId,
      validationEnvironment: "development",
    });
    if (result.disposition !== "rejected") {
      throw new Error("The unsafe networking production probe was accepted.");
    }
    return {
      adapterInvocationCount: adapter.invocations.length,
      diagnosticCodes: result.diagnostics.map(({ code }) => code).sort(),
      disposition: "planner-rejected",
      mutation,
      productionPath: productionPathV2,
    };
  } catch (error) {
    return {
      adapterInvocationCount: adapter.invocations.length,
      diagnosticCodes: [diagnosticCode(error)],
      disposition: "gateway-rejected",
      mutation,
      productionPath: productionPathV2,
    };
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
