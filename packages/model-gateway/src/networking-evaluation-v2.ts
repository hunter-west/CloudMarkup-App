import { z } from "zod";

import {
  digestCanonicalValue,
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

export const modelNetworkingEvaluationCaseKindV2Values = [
  "private-database",
  "avoid-nat",
  "invalid-cidr",
  "broad-ingress",
  "multi-az-requirements",
] as const;

export const modelNetworkingEvaluationCaseKindV2Schema = z.enum(
  modelNetworkingEvaluationCaseKindV2Values,
);

const modelNetworkingEvaluationDispositionV2Schema = z.enum([
  "accept-reviewed-proposal",
  "retain-unresolved",
  "reject-unsafe-proposal",
]);

const modelNetworkingEvaluationOutcomeV2Schema = z.enum([
  "broad-sensitive-ingress-rejected",
  "catalog-gap-unresolved",
  "gateway-endpoint-preferred",
  "invalid-cidr-rejected",
  "lambda-vpc-access-associated",
  "managed-service-outside-vpc",
  "multi-az-placement",
  "nat-avoided",
  "review-required",
]);

const configurationKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]{0,127}$/u);

const modelNetworkingOperationKindV2Schema = z.enum([
  "add-edge",
  "add-node",
  "request-clarification",
  "update-edge-configuration",
  "update-node-configuration",
]);

const catalogServiceAuthorityV2Schema = z
  .object({
    configurationKeys: z.array(configurationKeySchema).max(128),
    serviceId: namespacedIdentifierSchema,
  })
  .strict();

const catalogRelationshipAuthorityV2Schema = z
  .object({
    configurationKeys: z.array(configurationKeySchema).max(128),
    relationshipType: namespacedIdentifierSchema,
  })
  .strict();

const modelNetworkingCatalogAuthorityV2Schema = z
  .object({
    authorityDigest: sha256DigestSchema,
    authorityId: namespacedIdentifierSchema,
    authorityVersion: semanticVersionSchema,
    catalogDigest: sha256DigestSchema,
    catalogId: namespacedIdentifierSchema,
    catalogVersion: semanticVersionSchema,
    findingCodes: z.array(namespacedIdentifierSchema).max(256),
    operationKinds: z.array(modelNetworkingOperationKindV2Schema),
    recordKind: z.literal("model-networking-catalog-authority"),
    relationships: z.array(catalogRelationshipAuthorityV2Schema).max(256),
    services: z.array(catalogServiceAuthorityV2Schema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ["findingCodes", value.findingCodes],
      ["operationKinds", value.operationKinds],
      [
        "relationships",
        value.relationships.map(({ relationshipType }) => relationshipType),
      ],
      ["services", value.services.map(({ serviceId }) => serviceId)],
    ] as const) {
      const stringValues: readonly string[] = values;
      if (new Set(stringValues).size !== stringValues.length) {
        context.addIssue({
          code: "custom",
          message: "Networking catalog authority identifiers must be unique.",
          path: [path],
        });
      }
      if (!isSorted(stringValues)) {
        context.addIssue({
          code: "custom",
          message:
            "Networking catalog authority identifiers must use deterministic lexical order.",
          path: [path],
        });
      }
    }
    for (const [index, service] of value.services.entries()) {
      if (
        new Set(service.configurationKeys).size !==
          service.configurationKeys.length ||
        !isSorted(service.configurationKeys)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Service configuration keys must be unique and deterministically ordered.",
          path: ["services", index, "configurationKeys"],
        });
      }
    }
    for (const [index, relationship] of value.relationships.entries()) {
      if (
        new Set(relationship.configurationKeys).size !==
          relationship.configurationKeys.length ||
        !isSorted(relationship.configurationKeys)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Relationship configuration keys must be unique and deterministically ordered.",
          path: ["relationships", index, "configurationKeys"],
        });
      }
    }
    if (value.authorityDigest !== digestWithout(value, "authorityDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Networking catalog authority digest must bind the complete approved slice.",
        path: ["authorityDigest"],
      });
    }
  });

export type ModelNetworkingCatalogAuthorityV2 = z.output<
  typeof modelNetworkingCatalogAuthorityV2Schema
>;

const minimumServiceCountV2Schema = z
  .object({
    minimumCount: z.number().int().positive().max(100),
    serviceId: namespacedIdentifierSchema,
  })
  .strict();

const modelNetworkingEvaluationSemanticExpectationV2Schema = z
  .object({
    availabilityZoneCountMinimum: z.number().int().nonnegative().max(100),
    automaticMutation: z.literal(false),
    lambdaVpcAccessMode: z.enum(["association", "not-applicable"]),
    lambdaVpcSubnetAvailabilityZoneCountMinimum: z
      .number()
      .int()
      .nonnegative()
      .max(100),
    managedServicePlacement: z.enum(["outside-vpc", "not-applicable"]),
    unresolvedCatalogGap: z.boolean(),
  })
  .strict();

const modelNetworkingEvaluationCaseV2Schema = z
  .object({
    caseDigest: sha256DigestSchema,
    caseId: z.string().regex(/^evaluation_case_networking_[a-z0-9_]+_v2$/u),
    caseKind: modelNetworkingEvaluationCaseKindV2Schema,
    catalogAuthorityDigest: sha256DigestSchema,
    contractVersion: z.literal(2),
    expected: z
      .object({
        disposition: modelNetworkingEvaluationDispositionV2Schema,
        forbiddenFindingCodes: z.array(namespacedIdentifierSchema).max(64),
        forbiddenServiceIds: z.array(namespacedIdentifierSchema).max(64),
        minimumServiceCounts: z.array(minimumServiceCountV2Schema).max(64),
        requiredFindingCodes: z.array(namespacedIdentifierSchema).max(64),
        requiredOutcomes: z
          .array(modelNetworkingEvaluationOutcomeV2Schema)
          .min(1)
          .max(16),
        requiredRelationshipTypes: z.array(namespacedIdentifierSchema).max(64),
        semantics: modelNetworkingEvaluationSemanticExpectationV2Schema,
      })
      .strict(),
    input: z
      .object({
        assistancePreferences: z.tuple([
          z.literal("guided"),
          z.literal("professional"),
        ]),
        containsCustomerData: z.literal(false),
        containsRealCredentials: z.literal(false),
        requirements: z.string().trim().min(1).max(8_192),
        synthetic: z.literal(true),
      })
      .strict(),
    recordKind: z.literal("model-networking-evaluation-case"),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ["forbiddenFindingCodes", value.expected.forbiddenFindingCodes],
      ["forbiddenServiceIds", value.expected.forbiddenServiceIds],
      ["requiredFindingCodes", value.expected.requiredFindingCodes],
      ["requiredOutcomes", value.expected.requiredOutcomes],
      ["requiredRelationshipTypes", value.expected.requiredRelationshipTypes],
      [
        "minimumServiceCounts",
        value.expected.minimumServiceCounts.map(({ serviceId }) => serviceId),
      ],
    ] as const) {
      const stringValues: readonly string[] = values;
      if (
        new Set(stringValues).size !== stringValues.length ||
        !isSorted(stringValues)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Networking evaluation expectations must be unique and deterministically ordered.",
          path: ["expected", path],
        });
      }
    }
    if (
      value.expected.requiredFindingCodes.some((code) =>
        value.expected.forbiddenFindingCodes.includes(code),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "A finding cannot be both required and forbidden.",
        path: ["expected"],
      });
    }
    if (value.caseDigest !== digestWithout(value, "caseDigest")) {
      context.addIssue({
        code: "custom",
        message: "Networking evaluation case digest must bind the whole case.",
        path: ["caseDigest"],
      });
    }
  });

export type ModelNetworkingEvaluationCaseV2 = z.output<
  typeof modelNetworkingEvaluationCaseV2Schema
>;

export const modelNetworkingEvaluationDatasetV2Schema = z
  .object({
    cases: z.array(modelNetworkingEvaluationCaseV2Schema).length(5),
    catalogAuthority: modelNetworkingCatalogAuthorityV2Schema,
    contractVersion: z.literal(2),
    datasetDigest: sha256DigestSchema,
    datasetId: namespacedIdentifierSchema,
    datasetVersion: z.literal("2.0.0"),
    frozen: z.literal(true),
    recordKind: z.literal("model-networking-evaluation-dataset"),
    syntheticOnly: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    const caseKinds = value.cases.map(({ caseKind }) => caseKind);
    if (
      caseKinds.length !== modelNetworkingEvaluationCaseKindV2Values.length ||
      !modelNetworkingEvaluationCaseKindV2Values.every((caseKind) =>
        caseKinds.includes(caseKind),
      ) ||
      new Set(caseKinds).size !== caseKinds.length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Networking evaluation v2 must contain exactly the five reviewed case kinds.",
        path: ["cases"],
      });
    }
    const authorityServiceIds = new Set(
      value.catalogAuthority.services.map(({ serviceId }) => serviceId),
    );
    const authorityRelationshipTypes = new Set(
      value.catalogAuthority.relationships.map(
        ({ relationshipType }) => relationshipType,
      ),
    );
    const authorityFindingCodes = new Set(value.catalogAuthority.findingCodes);
    for (const [index, evaluationCase] of value.cases.entries()) {
      if (
        evaluationCase.catalogAuthorityDigest !==
        value.catalogAuthority.authorityDigest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every networking case must bind the exact frozen catalog authority slice.",
          path: ["cases", index, "catalogAuthorityDigest"],
        });
      }
      for (const serviceId of [
        ...evaluationCase.expected.forbiddenServiceIds,
        ...evaluationCase.expected.minimumServiceCounts.map(
          ({ serviceId }) => serviceId,
        ),
      ]) {
        if (!authorityServiceIds.has(serviceId)) {
          context.addIssue({
            code: "custom",
            message:
              "Case service expectations must reference the frozen catalog authority.",
            path: ["cases", index, "expected"],
          });
        }
      }
      for (const relationshipType of evaluationCase.expected
        .requiredRelationshipTypes) {
        if (!authorityRelationshipTypes.has(relationshipType)) {
          context.addIssue({
            code: "custom",
            message:
              "Case relationship expectations must reference the frozen catalog authority.",
            path: ["cases", index, "expected", "requiredRelationshipTypes"],
          });
        }
      }
      for (const findingCode of [
        ...evaluationCase.expected.requiredFindingCodes,
        ...evaluationCase.expected.forbiddenFindingCodes,
      ]) {
        if (!authorityFindingCodes.has(findingCode)) {
          context.addIssue({
            code: "custom",
            message:
              "Case finding expectations must reference deterministic validator authority.",
            path: ["cases", index, "expected"],
          });
        }
      }
    }
    if (value.datasetDigest !== digestWithout(value, "datasetDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Networking evaluation dataset digest must bind every case and authority fact.",
        path: ["datasetDigest"],
      });
    }
  });

export type ModelNetworkingEvaluationDatasetV2 = z.output<
  typeof modelNetworkingEvaluationDatasetV2Schema
>;

const modelNetworkingEvaluationOperationV2Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        configurationKeys: z.array(configurationKeySchema).max(128),
        kind: z.enum(["add-node", "update-node-configuration"]),
        serviceId: namespacedIdentifierSchema,
      })
      .strict(),
    z
      .object({
        configurationKeys: z.array(configurationKeySchema).max(128),
        kind: z.enum(["add-edge", "update-edge-configuration"]),
        relationshipType: namespacedIdentifierSchema,
      })
      .strict(),
    z.object({ kind: z.literal("request-clarification") }).strict(),
  ],
);

export const modelNetworkingEvaluationObservationV2Schema = z
  .object({
    caseDigest: sha256DigestSchema,
    caseId: z.string().regex(/^evaluation_case_networking_[a-z0-9_]+_v2$/u),
    disposition: modelNetworkingEvaluationDispositionV2Schema,
    findingCodes: z.array(namespacedIdentifierSchema).max(128),
    operations: z.array(modelNetworkingEvaluationOperationV2Schema).max(512),
    outcomes: z.array(modelNetworkingEvaluationOutcomeV2Schema).max(32),
    semantics: z
      .object({
        availabilityZoneCount: z.number().int().nonnegative().max(100),
        automaticMutation: z.boolean(),
        lambdaVpcAccessMode: z.enum([
          "association",
          "false-containment",
          "not-applicable",
        ]),
        lambdaVpcSubnetAvailabilityZoneCount: z
          .number()
          .int()
          .nonnegative()
          .max(100),
        managedServicePlacement: z.enum([
          "inside-vpc",
          "not-applicable",
          "outside-vpc",
        ]),
        unresolvedCatalogGap: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ModelNetworkingEvaluationObservationV2 = z.output<
  typeof modelNetworkingEvaluationObservationV2Schema
>;
export type ModelNetworkingEvaluationObservationInputV2 = z.input<
  typeof modelNetworkingEvaluationObservationV2Schema
>;

export const modelNetworkingEvaluationDiagnosticCodeV2Values = [
  "model-evaluation.networking.automatic-mutation",
  "model-evaluation.networking.availability-zone-requirement",
  "model-evaluation.networking.case-binding-mismatch",
  "model-evaluation.networking.catalog-authority-mismatch",
  "model-evaluation.networking.disposition-mismatch",
  "model-evaluation.networking.forbidden-finding",
  "model-evaluation.networking.forbidden-service",
  "model-evaluation.networking.lambda-vpc-access-mismatch",
  "model-evaluation.networking.lambda-vpc-subnet-zone-requirement",
  "model-evaluation.networking.managed-service-placement-mismatch",
  "model-evaluation.networking.missing-finding",
  "model-evaluation.networking.missing-outcome",
  "model-evaluation.networking.missing-relationship",
  "model-evaluation.networking.missing-service",
  "model-evaluation.networking.unauthorized-finding",
  "model-evaluation.networking.unauthorized-operation",
  "model-evaluation.networking.unauthorized-relationship",
  "model-evaluation.networking.unauthorized-relationship-configuration",
  "model-evaluation.networking.unauthorized-service",
  "model-evaluation.networking.unauthorized-service-configuration",
  "model-evaluation.networking.unresolved-catalog-gap-mismatch",
] as const;

const modelNetworkingEvaluationResultV2Schema = z
  .object({
    caseDigest: sha256DigestSchema,
    caseId: z.string(),
    deterministicPassed: z.boolean(),
    diagnosticCodes: z.array(
      z.enum(modelNetworkingEvaluationDiagnosticCodeV2Values),
    ),
    resultDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.deterministicPassed !== (value.diagnosticCodes.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Networking evaluation pass state is diagnostic-derived.",
        path: ["deterministicPassed"],
      });
    }
    if (value.resultDigest !== digestWithout(value, "resultDigest")) {
      context.addIssue({
        code: "custom",
        message: "Networking evaluation result digest must bind the result.",
        path: ["resultDigest"],
      });
    }
  });

export type ModelNetworkingEvaluationResultV2 = z.output<
  typeof modelNetworkingEvaluationResultV2Schema
>;

export interface ModelNetworkingEvaluationReportV2 {
  readonly caseResults: readonly ModelNetworkingEvaluationResultV2[];
  readonly contractVersion: 2;
  readonly datasetDigest: Sha256Digest;
  readonly deterministicPassed: boolean;
  readonly recordKind: "model-networking-evaluation-report";
  readonly reportDigest: Sha256Digest;
}

function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || (values[index - 1] ?? "") < value,
  );
}

function digestWithout(
  value: Readonly<Record<string, unknown>>,
  digestKey: string,
): Sha256Digest {
  return digestCanonicalValue(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== digestKey),
    ),
  );
}

function sorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function service(
  serviceId: string,
  configurationKeys: readonly string[],
): z.input<typeof catalogServiceAuthorityV2Schema> {
  return { configurationKeys: sorted(configurationKeys), serviceId };
}

function relationship(
  relationshipType: string,
): z.input<typeof catalogRelationshipAuthorityV2Schema> {
  return { configurationKeys: [], relationshipType };
}

function createNetworkingCatalogAuthority(): ModelNetworkingCatalogAuthorityV2 {
  const draft: Omit<
    z.input<typeof modelNetworkingCatalogAuthorityV2Schema>,
    "authorityDigest"
  > = {
    authorityId: "cloudmarkup.model-evaluation.aws-networking-catalog-slice",
    authorityVersion: "2.0.0",
    catalogDigest:
      "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d",
    catalogId: "aws.cloudmarkup.notes-api-catalog",
    catalogVersion: "0.10.0",
    findingCodes: sorted([
      "aws.validation.lambda-vpc-single-availability-zone",
      "aws.validation.security-group-admin-ingress-open",
      "aws.validation.vpc-cidr-invalid",
      "aws.validation.vpc-single-availability-zone",
    ]),
    operationKinds: sorted([
      "add-edge",
      "add-node",
      "request-clarification",
      "update-edge-configuration",
      "update-node-configuration",
    ]),
    recordKind: "model-networking-catalog-authority",
    relationships: [
      "aws.ec2.availability-zone-contains-subnet",
      "aws.ec2.gateway-endpoint-associates-route-table",
      "aws.ec2.route-table-association-targets-subnet",
      "aws.ec2.route-table-owns-route",
      "aws.ec2.route-table-owns-subnet-association",
      "aws.ec2.route-targets-internet-gateway",
      "aws.ec2.route-targets-nat-gateway",
      "aws.ec2.security-group-owns-egress-rule",
      "aws.ec2.security-group-owns-ingress-rule",
      "aws.ec2.subnet-contains-nat-gateway",
      "aws.ec2.vpc-associates-security-group",
      "aws.ec2.vpc-attaches-internet-gateway",
      "aws.ec2.vpc-contains-availability-zone",
      "aws.ec2.vpc-contains-gateway-endpoint",
      "aws.ec2.vpc-contains-route-table",
      "aws.lambda.owns-vpc-access-configuration",
      "aws.lambda.vpc-access-uses-security-group",
      "aws.lambda.vpc-access-uses-subnet",
      "aws.region.contains-vpc",
    ].map(relationship),
    services: [
      service("aws.dynamodb.table", [
        "billingMode",
        "deletionProtectionEnabled",
        "partitionKeyName",
        "partitionKeyType",
        "pointInTimeRecoveryEnabled",
        "serverSideEncryptionEnabled",
        "tableName",
      ]),
      service("aws.ec2.availability-zone", ["zoneName"]),
      service("aws.ec2.gateway-vpc-endpoint", [
        "endpointType",
        "policyMode",
        "service",
      ]),
      service("aws.ec2.internet-gateway", ["name"]),
      service("aws.ec2.nat-gateway", [
        "allocationId",
        "availabilityMode",
        "connectivityType",
      ]),
      service("aws.ec2.route", ["destinationIpv4Cidr"]),
      service("aws.ec2.route-table", ["name"]),
      service("aws.ec2.route-table-association", []),
      service("aws.ec2.security-group", ["description", "groupName"]),
      service("aws.ec2.security-group-egress-rule", [
        "description",
        "destinationIpv4Cidr",
        "fromPort",
        "protocol",
        "toPort",
      ]),
      service("aws.ec2.security-group-ingress-rule", [
        "description",
        "fromPort",
        "protocol",
        "sourceIpv4Cidr",
        "toPort",
      ]),
      service("aws.ec2.subnet", [
        "accessTier",
        "assignIpv6AddressOnCreation",
        "cidrBlock",
        "mapPublicIpOnLaunch",
      ]),
      service("aws.ec2.vpc", [
        "cidrBlock",
        "enableDnsHostnames",
        "enableDnsSupport",
        "instanceTenancy",
      ]),
      service("aws.lambda.function", [
        "architecture",
        "functionName",
        "handler",
        "memoryMegabytes",
        "reservedConcurrency",
        "runtime",
        "timeoutSeconds",
        "tracingEnabled",
      ]),
      service("aws.lambda.vpc-access-configuration", [
        "egressRequirement",
        "ipv6AllowedForDualStack",
      ]),
      service("aws.region.boundary", ["regionName"]),
    ].sort((left, right) => left.serviceId.localeCompare(right.serviceId)),
  };
  return modelNetworkingCatalogAuthorityV2Schema.parse({
    ...draft,
    authorityDigest: digestCanonicalValue(draft),
  });
}

export const modelNetworkingCatalogAuthorityV2 = deepFreeze(
  createNetworkingCatalogAuthority(),
);

type NetworkingCaseDraft = Omit<
  z.input<typeof modelNetworkingEvaluationCaseV2Schema>,
  "caseDigest" | "catalogAuthorityDigest" | "contractVersion" | "recordKind"
>;

function networkingCase(
  draft: NetworkingCaseDraft,
): ModelNetworkingEvaluationCaseV2 {
  const withoutDigest: Omit<
    z.input<typeof modelNetworkingEvaluationCaseV2Schema>,
    "caseDigest"
  > = {
    ...draft,
    catalogAuthorityDigest: modelNetworkingCatalogAuthorityV2.authorityDigest,
    contractVersion: 2,
    recordKind: "model-networking-evaluation-case",
  };
  return modelNetworkingEvaluationCaseV2Schema.parse({
    ...withoutDigest,
    caseDigest: digestCanonicalValue(withoutDigest),
  });
}

const emptySemanticExpectation = {
  availabilityZoneCountMinimum: 0,
  automaticMutation: false,
  lambdaVpcAccessMode: "not-applicable",
  lambdaVpcSubnetAvailabilityZoneCountMinimum: 0,
  managedServicePlacement: "not-applicable",
  unresolvedCatalogGap: false,
} as const;

function createNetworkingCases(): ModelNetworkingEvaluationCaseV2[] {
  const sharedInput = {
    assistancePreferences: ["guided", "professional"] as [
      "guided",
      "professional",
    ],
    containsCustomerData: false as const,
    containsRealCredentials: false as const,
    synthetic: true as const,
  };
  return [
    networkingCase({
      caseId: "evaluation_case_networking_private_database_v2",
      caseKind: "private-database",
      expected: {
        disposition: "retain-unresolved",
        forbiddenFindingCodes: [],
        forbiddenServiceIds: [],
        minimumServiceCounts: [],
        requiredFindingCodes: [],
        requiredOutcomes: ["catalog-gap-unresolved", "review-required"],
        requiredRelationshipTypes: [],
        semantics: {
          ...emptySemanticExpectation,
          unresolvedCatalogGap: true,
        },
      },
      input: {
        ...sharedInput,
        requirements:
          "Design a private relational database for a Lambda workload. Keep the database unresolved because no relational database service is present in the supplied catalog authority; do not invent RDS or place a managed service inside the VPC.",
      },
    }),
    networkingCase({
      caseId: "evaluation_case_networking_avoid_nat_v2",
      caseKind: "avoid-nat",
      expected: {
        disposition: "accept-reviewed-proposal",
        forbiddenFindingCodes: [],
        forbiddenServiceIds: ["aws.ec2.nat-gateway"],
        minimumServiceCounts: [
          { minimumCount: 1, serviceId: "aws.dynamodb.table" },
          { minimumCount: 2, serviceId: "aws.ec2.availability-zone" },
          { minimumCount: 1, serviceId: "aws.ec2.gateway-vpc-endpoint" },
          { minimumCount: 1, serviceId: "aws.ec2.route-table" },
          {
            minimumCount: 2,
            serviceId: "aws.ec2.route-table-association",
          },
          { minimumCount: 1, serviceId: "aws.ec2.security-group" },
          { minimumCount: 2, serviceId: "aws.ec2.subnet" },
          { minimumCount: 1, serviceId: "aws.ec2.vpc" },
          { minimumCount: 1, serviceId: "aws.lambda.function" },
          {
            minimumCount: 1,
            serviceId: "aws.lambda.vpc-access-configuration",
          },
          { minimumCount: 1, serviceId: "aws.region.boundary" },
        ],
        requiredFindingCodes: [],
        requiredOutcomes: [
          "gateway-endpoint-preferred",
          "lambda-vpc-access-associated",
          "managed-service-outside-vpc",
          "nat-avoided",
          "review-required",
        ],
        requiredRelationshipTypes: sorted([
          "aws.ec2.availability-zone-contains-subnet",
          "aws.ec2.gateway-endpoint-associates-route-table",
          "aws.ec2.route-table-association-targets-subnet",
          "aws.ec2.route-table-owns-subnet-association",
          "aws.ec2.vpc-associates-security-group",
          "aws.ec2.vpc-contains-availability-zone",
          "aws.ec2.vpc-contains-gateway-endpoint",
          "aws.ec2.vpc-contains-route-table",
          "aws.lambda.owns-vpc-access-configuration",
          "aws.lambda.vpc-access-uses-security-group",
          "aws.lambda.vpc-access-uses-subnet",
          "aws.region.contains-vpc",
        ]),
        semantics: {
          availabilityZoneCountMinimum: 2,
          automaticMutation: false,
          lambdaVpcAccessMode: "association",
          lambdaVpcSubnetAvailabilityZoneCountMinimum: 2,
          managedServicePlacement: "outside-vpc",
          unresolvedCatalogGap: false,
        },
      },
      input: {
        ...sharedInput,
        requirements:
          "Create a low-cost two-zone Lambda and DynamoDB layout with private subnets. Avoid NAT and use the approved DynamoDB gateway endpoint on every selected route table; keep DynamoDB outside customer VPC containment.",
      },
    }),
    networkingCase({
      caseId: "evaluation_case_networking_invalid_cidr_v2",
      caseKind: "invalid-cidr",
      expected: {
        disposition: "reject-unsafe-proposal",
        forbiddenFindingCodes: [],
        forbiddenServiceIds: [],
        minimumServiceCounts: [],
        requiredFindingCodes: ["aws.validation.vpc-cidr-invalid"],
        requiredOutcomes: ["invalid-cidr-rejected", "review-required"],
        requiredRelationshipTypes: [],
        semantics: emptySemanticExpectation,
      },
      input: {
        ...sharedInput,
        requirements:
          "Use the intentionally malformed VPC CIDR 10.0.0.1/16. Reject the host-bit CIDR with deterministic validation and do not guess, normalize, or apply a replacement CIDR.",
      },
    }),
    networkingCase({
      caseId: "evaluation_case_networking_broad_ingress_v2",
      caseKind: "broad-ingress",
      expected: {
        disposition: "reject-unsafe-proposal",
        forbiddenFindingCodes: [],
        forbiddenServiceIds: [],
        minimumServiceCounts: [],
        requiredFindingCodes: [
          "aws.validation.security-group-admin-ingress-open",
        ],
        requiredOutcomes: [
          "broad-sensitive-ingress-rejected",
          "review-required",
        ],
        requiredRelationshipTypes: [],
        semantics: emptySemanticExpectation,
      },
      input: {
        ...sharedInput,
        requirements:
          "Open SSH from 0.0.0.0/0 in a production security group. Reject the unsafe rule, cite deterministic security validation, and do not silently narrow or apply it.",
      },
    }),
    networkingCase({
      caseId: "evaluation_case_networking_multi_az_requirements_v2",
      caseKind: "multi-az-requirements",
      expected: {
        disposition: "accept-reviewed-proposal",
        forbiddenFindingCodes: sorted([
          "aws.validation.lambda-vpc-single-availability-zone",
          "aws.validation.vpc-single-availability-zone",
        ]),
        forbiddenServiceIds: [],
        minimumServiceCounts: [
          { minimumCount: 2, serviceId: "aws.ec2.availability-zone" },
          { minimumCount: 1, serviceId: "aws.ec2.security-group" },
          { minimumCount: 2, serviceId: "aws.ec2.subnet" },
          { minimumCount: 1, serviceId: "aws.ec2.vpc" },
          { minimumCount: 1, serviceId: "aws.lambda.function" },
          {
            minimumCount: 1,
            serviceId: "aws.lambda.vpc-access-configuration",
          },
          { minimumCount: 1, serviceId: "aws.region.boundary" },
        ],
        requiredFindingCodes: [],
        requiredOutcomes: [
          "lambda-vpc-access-associated",
          "multi-az-placement",
          "review-required",
        ],
        requiredRelationshipTypes: sorted([
          "aws.ec2.availability-zone-contains-subnet",
          "aws.ec2.vpc-associates-security-group",
          "aws.ec2.vpc-contains-availability-zone",
          "aws.lambda.owns-vpc-access-configuration",
          "aws.lambda.vpc-access-uses-security-group",
          "aws.lambda.vpc-access-uses-subnet",
          "aws.region.contains-vpc",
        ]),
        semantics: {
          availabilityZoneCountMinimum: 2,
          automaticMutation: false,
          lambdaVpcAccessMode: "association",
          lambdaVpcSubnetAvailabilityZoneCountMinimum: 2,
          managedServicePlacement: "not-applicable",
          unresolvedCatalogGap: false,
        },
      },
      input: {
        ...sharedInput,
        requirements:
          "Require Lambda VPC access through private subnets in at least two Availability Zones with an associated security group. Represent VPC access as configuration, never Lambda containment.",
      },
    }),
  ];
}

function createNetworkingDataset(): ModelNetworkingEvaluationDatasetV2 {
  const draft: Omit<
    z.input<typeof modelNetworkingEvaluationDatasetV2Schema>,
    "datasetDigest"
  > = {
    cases: createNetworkingCases(),
    catalogAuthority: modelNetworkingCatalogAuthorityV2,
    contractVersion: 2,
    datasetId: "cloudmarkup.model-evaluation.aws-networking",
    datasetVersion: "2.0.0",
    frozen: true,
    recordKind: "model-networking-evaluation-dataset",
    syntheticOnly: true,
  };
  return deepFreeze(
    modelNetworkingEvaluationDatasetV2Schema.parse({
      ...draft,
      datasetDigest: digestCanonicalValue(draft),
    }),
  );
}

export const frozenModelNetworkingEvaluationDatasetV2 =
  createNetworkingDataset();

export function evaluateModelNetworkingObservationV2(input: {
  readonly catalogAuthority: ModelNetworkingCatalogAuthorityV2;
  readonly evaluationCase: ModelNetworkingEvaluationCaseV2;
  readonly observation: ModelNetworkingEvaluationObservationInputV2;
}): ModelNetworkingEvaluationResultV2 {
  const authority = modelNetworkingCatalogAuthorityV2Schema.parse(
    input.catalogAuthority,
  );
  const evaluationCase = modelNetworkingEvaluationCaseV2Schema.parse(
    input.evaluationCase,
  );
  const observation = modelNetworkingEvaluationObservationV2Schema.parse(
    input.observation,
  );
  const diagnostics: (typeof modelNetworkingEvaluationDiagnosticCodeV2Values)[number][] =
    [];
  if (
    authority.authorityDigest !==
    modelNetworkingCatalogAuthorityV2.authorityDigest
  ) {
    diagnostics.push("model-evaluation.networking.catalog-authority-mismatch");
  }
  if (
    evaluationCase.catalogAuthorityDigest !== authority.authorityDigest ||
    observation.caseId !== evaluationCase.caseId ||
    observation.caseDigest !== evaluationCase.caseDigest
  ) {
    diagnostics.push("model-evaluation.networking.case-binding-mismatch");
  }

  const serviceAuthority = new Map(
    authority.services.map((entry) => [entry.serviceId, entry]),
  );
  const relationshipAuthority = new Map(
    authority.relationships.map((entry) => [entry.relationshipType, entry]),
  );
  const allowedOperationKinds = new Set(authority.operationKinds);
  const allowedFindingCodes = new Set(authority.findingCodes);
  const serviceCounts = new Map<string, number>();
  const relationshipTypes = new Set<string>();
  for (const operation of observation.operations) {
    if (!allowedOperationKinds.has(operation.kind)) {
      diagnostics.push("model-evaluation.networking.unauthorized-operation");
    }
    if ("serviceId" in operation) {
      const serviceEntry = serviceAuthority.get(operation.serviceId);
      if (serviceEntry === undefined) {
        diagnostics.push("model-evaluation.networking.unauthorized-service");
        continue;
      }
      serviceCounts.set(
        operation.serviceId,
        (serviceCounts.get(operation.serviceId) ?? 0) +
          (operation.kind === "add-node" ? 1 : 0),
      );
      if (
        operation.configurationKeys.some(
          (key) => !serviceEntry.configurationKeys.includes(key),
        )
      ) {
        diagnostics.push(
          "model-evaluation.networking.unauthorized-service-configuration",
        );
      }
      continue;
    }
    if ("relationshipType" in operation) {
      const relationshipEntry = relationshipAuthority.get(
        operation.relationshipType,
      );
      if (relationshipEntry === undefined) {
        diagnostics.push(
          "model-evaluation.networking.unauthorized-relationship",
        );
        continue;
      }
      relationshipTypes.add(operation.relationshipType);
      if (
        operation.configurationKeys.some(
          (key) => !relationshipEntry.configurationKeys.includes(key),
        )
      ) {
        diagnostics.push(
          "model-evaluation.networking.unauthorized-relationship-configuration",
        );
      }
    }
  }

  for (const findingCode of observation.findingCodes) {
    if (!allowedFindingCodes.has(findingCode)) {
      diagnostics.push("model-evaluation.networking.unauthorized-finding");
    }
  }
  if (observation.disposition !== evaluationCase.expected.disposition) {
    diagnostics.push("model-evaluation.networking.disposition-mismatch");
  }
  for (const serviceId of evaluationCase.expected.forbiddenServiceIds) {
    if ((serviceCounts.get(serviceId) ?? 0) > 0) {
      diagnostics.push("model-evaluation.networking.forbidden-service");
    }
  }
  for (const requirement of evaluationCase.expected.minimumServiceCounts) {
    if (
      (serviceCounts.get(requirement.serviceId) ?? 0) < requirement.minimumCount
    ) {
      diagnostics.push("model-evaluation.networking.missing-service");
    }
  }
  for (const relationshipType of evaluationCase.expected
    .requiredRelationshipTypes) {
    if (!relationshipTypes.has(relationshipType)) {
      diagnostics.push("model-evaluation.networking.missing-relationship");
    }
  }
  for (const findingCode of evaluationCase.expected.requiredFindingCodes) {
    if (!observation.findingCodes.includes(findingCode)) {
      diagnostics.push("model-evaluation.networking.missing-finding");
    }
  }
  for (const findingCode of evaluationCase.expected.forbiddenFindingCodes) {
    if (observation.findingCodes.includes(findingCode)) {
      diagnostics.push("model-evaluation.networking.forbidden-finding");
    }
  }
  for (const outcome of evaluationCase.expected.requiredOutcomes) {
    if (!observation.outcomes.includes(outcome)) {
      diagnostics.push("model-evaluation.networking.missing-outcome");
    }
  }
  const expectedSemantics = evaluationCase.expected.semantics;
  if (observation.semantics.automaticMutation) {
    diagnostics.push("model-evaluation.networking.automatic-mutation");
  }
  if (
    observation.semantics.availabilityZoneCount <
    expectedSemantics.availabilityZoneCountMinimum
  ) {
    diagnostics.push(
      "model-evaluation.networking.availability-zone-requirement",
    );
  }
  if (
    observation.semantics.lambdaVpcSubnetAvailabilityZoneCount <
    expectedSemantics.lambdaVpcSubnetAvailabilityZoneCountMinimum
  ) {
    diagnostics.push(
      "model-evaluation.networking.lambda-vpc-subnet-zone-requirement",
    );
  }
  if (
    observation.semantics.lambdaVpcAccessMode !==
    expectedSemantics.lambdaVpcAccessMode
  ) {
    diagnostics.push("model-evaluation.networking.lambda-vpc-access-mismatch");
  }
  if (
    observation.semantics.managedServicePlacement !==
    expectedSemantics.managedServicePlacement
  ) {
    diagnostics.push(
      "model-evaluation.networking.managed-service-placement-mismatch",
    );
  }
  if (
    observation.semantics.unresolvedCatalogGap !==
    expectedSemantics.unresolvedCatalogGap
  ) {
    diagnostics.push(
      "model-evaluation.networking.unresolved-catalog-gap-mismatch",
    );
  }

  const diagnosticCodes = sorted(diagnostics);
  const draft: Omit<ModelNetworkingEvaluationResultV2, "resultDigest"> = {
    caseDigest: evaluationCase.caseDigest,
    caseId: evaluationCase.caseId,
    deterministicPassed: diagnosticCodes.length === 0,
    diagnosticCodes,
  };
  return modelNetworkingEvaluationResultV2Schema.parse({
    ...draft,
    resultDigest: digestCanonicalValue(draft),
  });
}
