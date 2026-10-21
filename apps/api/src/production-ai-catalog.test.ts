import { validateModelResponseAuthority } from "@cloudmarkup/model-gateway";
import {
  AWS_CATALOG_DIGEST_V1,
  AWS_FROZEN_MODEL_CATALOG_BINDING_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws";
import {
  architectureDocumentV3Schema,
  configurationKeySchema,
  digestCanonicalValue,
  modelGatewayResponseV1Schema,
  modelOperationProposalRequestV1Schema,
  type ModelInvocationDescriptorV1,
} from "@cloudmarkup/schemas";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createProductionAiCatalogGrounding as createBoundAiCatalogGrounding,
  createCurrentProductionAiCatalogGrounding as createProductionAiCatalogGrounding,
} from "./production-ai-catalog.js";

const syntheticArchitecture: unknown = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/test-fixtures/fixtures/architecture-document/v3/valid/representative.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const source = architectureDocumentV3Schema.parse(syntheticArchitecture);
const descriptor = {
  inferenceProfileId: "profile.catalog-test",
  inputDigest: digestCanonicalValue("synthetic-input"),
  invocationId: "invocation_catalog_test",
  modelId: "model.catalog-test",
  modelVersion: "1",
  promptDigest: digestCanonicalValue("synthetic-prompt"),
  promptTemplateId: "prompt.catalog-test",
  promptVersion: "1.0.0",
  providerId: "provider.catalog-test",
} as ModelInvocationDescriptorV1;

function proposal(commands: readonly unknown[]) {
  const catalog = createProductionAiCatalogGrounding();
  const architecture = architectureDocumentV3Schema.parse({
    ...source,
    nodes: [],
    edges: [],
    catalog: catalog.catalog,
  });
  const request = modelOperationProposalRequestV1Schema.parse({
    contractVersion: 1,
    operation: "operations.propose",
    requestedMode: "guided",
    architecture,
    catalogGrounding: catalog,
  });
  const envelope = {
    origin: "ai-accepted",
    schemaVersion: 1,
    target: {
      architectureId: architecture.architectureId,
      documentId: architecture.documentId,
      revisionId: architecture.revision.revisionId,
    },
  };
  const response = modelGatewayResponseV1Schema.parse({
    contractVersion: 1,
    operation: "operations.propose",
    proposalContext: {
      assumptions: [],
      unknowns: [],
      confidence: {
        basisPoints: 10000,
        evidenceReferences: [],
        rationale: "Synthetic catalog validation.",
      },
    },
    provenance: {
      ...descriptor,
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      ownership: "untrusted-proposal",
    },
    batches: [
      {
        kind: "graph",
        batch: {
          ...envelope,
          commandId: "catalog_batch",
          inverseCommandId: "catalog_inverse",
          kind: "batch",
          commands: commands.map((command, index) => ({
            ...envelope,
            commandId: `catalog_command_${String(index)}`,
            inverseCommandId: `catalog_inverse_${String(index)}`,
            ...(command as Record<string, unknown>),
          })),
        },
      },
    ],
  });
  return () => {
    validateModelResponseAuthority({
      allowedApprovalPathIds: new Set(),
      descriptor,
      request,
      response,
    });
  };
}

function node(
  serviceId: string,
  values: Record<string, unknown>,
  parent?: { nodeId: string; relationshipType: string },
) {
  const service = awsCatalogV1.requireService(serviceId);
  return {
    kind: "add-node",
    node: {
      id: serviceId,
      semantic: {
        deploymentKey: serviceId.replaceAll(/[.-]/gu, "_"),
        serviceType: service.id,
        resourceType:
          service.nodeKind.kind === "resource"
            ? service.nodeKind.resourceType
            : service.nodeKind.boundaryType,
        configuration: {
          schemaId: service.configuration.schemaId,
          schemaVersion: service.configuration.schemaVersion,
          values,
        },
        lifecycle: { ownership: "user", origin: "ai-accepted" },
        ...(parent === undefined ? {} : { parent }),
      },
      presentation: { label: service.displayName, position: { x: 0, y: 0 } },
    },
  };
}

describe("real AWS catalog for AI planning", () => {
  it("includes every service and exact connection without changing the installed catalog", () => {
    const before = digestCanonicalValue(awsCatalogV1.artifact);
    const catalog = createProductionAiCatalogGrounding();
    expect(catalog.catalog.digest).toBe(AWS_CATALOG_DIGEST_V1);
    expect(catalog.nodes).toHaveLength(73);
    expect(() =>
      createProductionAiCatalogGrounding(AWS_FROZEN_MODEL_CATALOG_BINDING_V1),
    ).toThrow("unsupported AWS catalog");
    expect(
      createBoundAiCatalogGrounding(AWS_FROZEN_MODEL_CATALOG_BINDING_V1).nodes,
    ).toHaveLength(71);
    expect(catalog.nodes.map((node) => node.serviceType)).toEqual(
      awsCatalogV1.listServices().map((service) => service.id),
    );
    expect(catalog.connectionRules.map((rule) => rule.ruleId)).toEqual(
      awsCatalogV1.listConnectionRules().map((rule) => rule.id),
    );
    expect(digestCanonicalValue(awsCatalogV1.artifact)).toBe(before);
  });

  it("preserves every required field, default, constraint and typed value source", () => {
    const catalog = createProductionAiCatalogGrounding();
    for (const service of awsCatalogV1.listServices()) {
      const projected = catalog.nodes.find(
        (node) => node.serviceType === service.id,
      );
      expect(projected?.configurationValidation.jsonSchema).toEqual(
        service.configuration.jsonSchema,
      );
      expect(projected?.configurationValidation.valueSources).toEqual(
        Object.fromEntries(
          service.configuration.uiHints.map((hint) => [
            hint.property,
            hint.valueSource,
          ]),
        ),
      );
      expect(projected?.placement.allowedParentTypes).toEqual(
        service.placement.allowedParentTypes.map((parent) => ({
          serviceType: parent.serviceId,
          relationshipType: parent.relationshipType,
        })),
      );
    }
  });

  it("binds IAM references to reviewed service attributes only", () => {
    const node = createProductionAiCatalogGrounding().nodes.find(
      (entry) => entry.serviceType === "aws.iam.policy-statement",
    );
    expect(
      node?.configurationValidation.nodeReferenceAuthorities[
        configurationKeySchema.parse("resourceNode")
      ],
    ).toEqual([
      {
        serviceType: "aws.secretsmanager.secret",
        attribute: "aws.secretsmanager.secret.arn",
      },
      {
        serviceType: "aws.kms.key",
        attribute: "aws.kms.key.arn",
      },
      {
        serviceType: "aws.dynamodb.table",
        attribute: "aws.dynamodb.table.arn",
      },
      {
        serviceType: "aws.lambda.function",
        attribute: "aws.lambda.function.arn",
      },
      {
        serviceType: "aws.cloudwatch.log-group",
        attribute: "aws.cloudwatch.log-group.arn",
      },
      {
        serviceType: "aws.s3.bucket",
        attribute: "aws.s3.bucket.arn",
      },
      {
        serviceType: "aws.sqs.queue",
        attribute: "aws.sqs.queue.arn",
      },
    ]);
  });

  it.each([
    { serviceId: "aws.s3.bucket", action: "s3:ListBucket" },
    { serviceId: "aws.sqs.queue", action: "sqs:SendMessage" },
    {
      serviceId: "aws.secretsmanager.secret",
      action: "secretsmanager:GetSecretValue",
    },
  ])(
    "grounds exact $serviceId IAM resource references",
    ({ serviceId, action }) => {
      const commands = (attribute: string, targetId = serviceId) => [
        node(
          serviceId,
          serviceId === "aws.secretsmanager.secret"
            ? { name: { kind: "string", value: "application/credential" } }
            : {},
        ),
        node("aws.iam.role", {}),
        node(
          "aws.iam.policy-document",
          {
            policyName: { kind: "string", value: "ExactResourceAccess" },
            policyKind: { kind: "string", value: "identity-inline" },
          },
          {
            nodeId: "aws.iam.role",
            relationshipType: "aws.iam.role-owns-inline-policy",
          },
        ),
        node(
          "aws.iam.policy-statement",
          {
            actions: { kind: "string-list", value: [action] },
            resourceNode: {
              kind: "node-reference",
              nodeId: targetId,
              attribute,
            },
          },
          {
            nodeId: "aws.iam.policy-document",
            relationshipType: "aws.iam.policy-contains-statement",
          },
        ),
      ];
      expect(proposal(commands(serviceId + ".arn"))).not.toThrow();
      for (const invalid of [
        commands("aws.dynamodb.table.arn"),
        commands(serviceId + ".object-arn"),
        commands(serviceId + ".arn", "aws.iam.role"),
        commands(serviceId + ".arn", "missing_resource"),
      ]) {
        expect(proposal(invalid)).toThrow(
          "not grounded in its exact field, target service, and attribute authority",
        );
      }
    },
  );

  it("admits secret metadata without permitting secret values", () => {
    const metadata = {
      name: { kind: "string", value: "application/credential" },
    };
    expect(
      proposal([node("aws.secretsmanager.secret", metadata)]),
    ).not.toThrow();
    for (const property of [
      "secretString",
      "secretBinary",
      "generateSecretString",
      "rotationEnabled",
      "replicaRegions",
    ]) {
      expect(
        proposal([
          node("aws.secretsmanager.secret", {
            ...metadata,
            [property]: {
              kind: "string",
              value: "synthetic-sensitive-sentinel",
            },
          }),
        ]),
      ).toThrow("outside its allowlist");
    }
  });

  it("returns independent request data so mutation cannot widen later AI authority", () => {
    const first = createProductionAiCatalogGrounding();
    const second = createProductionAiCatalogGrounding();
    first.nodes.length = 0;
    first.connectionRules.length = 0;
    expect(createProductionAiCatalogGrounding()).toEqual(second);
  });

  // Full per-service schema/constraint projection is checked above. This guard
  // uses one generic unknown-key predicate; keep boundary, deployable and
  // nondeployable resources, including IAM's reviewed node-reference shape.
  it.each([
    "aws.region.boundary",
    "aws.ec2.availability-zone",
    "aws.ec2.vpc",
    "aws.lambda.function",
    "aws.s3.bucket",
    "aws.iam.role",
    "aws.iam.policy-statement",
  ])(
    "rejects an invented configuration field for %s before accepting a canvas command",
    (serviceId) => {
      expect(
        proposal([
          node(serviceId, {
            inventedField: { kind: "string", value: "unsupported" },
          }),
        ]),
      ).toThrow("outside its allowlist");
    },
  );

  it("accepts actual Region/VPC placement and schema defaults", () => {
    expect(
      proposal([
        node("aws.region.boundary", {
          regionName: { kind: "string", value: "us-east-1" },
        }),
        node(
          "aws.ec2.vpc",
          {},
          {
            nodeId: "aws.region.boundary",
            relationshipType: "aws.region.contains-vpc",
          },
        ),
      ]),
    ).not.toThrow();
  });

  it("rejects invalid VPC configuration and incorrect placement", () => {
    const region = node("aws.region.boundary", {
      regionName: { kind: "string", value: "us-east-1" },
    });
    expect(
      proposal([
        region,
        node(
          "aws.ec2.vpc",
          {
            enableDnsSupport: { kind: "string", value: "yes" },
          },
          {
            nodeId: "aws.region.boundary",
            relationshipType: "aws.region.contains-vpc",
          },
        ),
      ]),
    ).toThrow("violates its exact catalog schema");
    expect(proposal([node("aws.ec2.vpc", {})])).toThrow(
      "cannot be placed at the architecture root",
    );
  });
});

it("grounds corrected FSx capacity descriptions and limits and rejects altered digests", () => {
  const current = createProductionAiCatalogGrounding();
  const key = configurationKeySchema.parse("storageCapacity");
  for (const family of ["lustre", "ontap"]) {
    const id = "aws.fsx." + family + "-file-system";
    const next = current.nodes.find(
      (n) => n.serviceType === id,
    )?.configurationValidation;
    if (family === "lustre")
      expect(next?.jsonSchema.properties[key]?.description).toContain(
        "1,200 GiB or a multiple of 2,400 GiB",
      );
    else
      expect(next?.jsonSchema.properties[key]).toMatchObject({
        maximum: 524288,
      });
  }
  expect(() =>
    createBoundAiCatalogGrounding({
      ...current.catalog,
      digest: "sha256:" + "0".repeat(64),
    }),
  ).toThrow();
});

it("grounds ECR/Fargate declarations with exact current fields", () => {
  expect(
    proposal([
      node("aws.ecr.repository", {
        name: { kind: "string", value: "synthetic/application" },
      }),
      node("aws.ecs.cluster", {
        name: { kind: "string", value: "SyntheticCluster" },
      }),
      node("aws.ecs.task-definition", {
        family: { kind: "string", value: "SyntheticTask" },
        cpu: { kind: "integer", value: 256 },
        memoryMiB: { kind: "integer", value: 512 },
        architecture: { kind: "string", value: "x86_64" },
      }),
      node("aws.ecs.service", {
        name: { kind: "string", value: "SyntheticService" },
      }),
    ]),
  ).not.toThrow();
  expect(proposal([node("aws.ecs.task-definition", {})])).toThrow(
    "omitted a required",
  );
  for (const field of [
    "environment",
    "command",
    "image",
    "launchType",
    "credential",
  ]) {
    expect(
      proposal([
        node("aws.ecs.service", {
          name: { kind: "string", value: "SyntheticService" },
          [field]: { kind: "string", value: "unsupported" },
        }),
      ]),
    ).toThrow("outside its allowlist");
  }
});

it("grounds EC2 exact declarations with exact current fields", () => {
  const values = {
    imageId: { kind: "string", value: "ami-0123456789abcdef0" },
    imageRegion: { kind: "string", value: "us-east-1" },
    imageArchitecture: { kind: "string", value: "x86_64" },
    imageRootDeviceName: { kind: "string", value: "/dev/xvda" },
    imageRootMinimumGiB: { kind: "integer", value: 8 },
    instanceType: { kind: "string", value: "t3.small" },
    rootSizeGiB: { kind: "integer", value: 30 },
  };
  expect(
    proposal([
      node("aws.ec2.instance", values),
      node("aws.iam.instance-profile", {
        name: { kind: "string", value: "synthetic-instance-profile" },
      }),
    ]),
  ).not.toThrow();
  expect(proposal([node("aws.ec2.instance", {})])).toThrow(
    "omitted a required",
  );
  for (const field of [
    "userData",
    "keyName",
    "spotPrice",
    "launchTemplate",
    "password",
  ])
    expect(
      proposal([
        node("aws.ec2.instance", {
          ...values,
          [field]: { kind: "string", value: "unsupported" },
        }),
      ]),
    ).toThrow("outside its allowlist");
  expect(
    proposal([
      node("aws.ec2.instance", {
        ...values,
        rootThroughputMiBps: { kind: "integer", value: 250 },
      }),
    ]),
  ).toThrow("violates its exact catalog schema");
});

it("rejects an AI-proposed ONTAP size outside the modeled HA pair", () => {
  expect(
    proposal([
      node("aws.fsx.ontap-file-system", {
        storageCapacity: { kind: "integer", value: 524288 },
        throughputCapacity: { kind: "integer", value: 1536 },
      }),
    ]),
  ).not.toThrow();
  expect(
    proposal([
      node("aws.fsx.ontap-file-system", {
        storageCapacity: { kind: "integer", value: 524289 },
        throughputCapacity: { kind: "integer", value: 1536 },
      }),
    ]),
  ).toThrow("violates its exact catalog schema");
});

it("grounds RDS infrastructure with managed credentials and frozen ECS authority", () => {
  const input = {
    "aws.rds.db-instance": {
      identifier: {
        kind: "string",
        value: "synthetic-postgres",
      },
      engineVersion: {
        kind: "string",
        value: "16.6",
      },
      instanceClass: {
        kind: "string",
        value: "db.t4g.small",
      },
      databaseName: {
        kind: "string",
        value: "SyntheticApp",
      },
      masterUsername: {
        kind: "string",
        value: "SyntheticAdmin",
      },
      storageGiB: {
        kind: "integer",
        value: 30,
      },
      caIdentifier: {
        kind: "string",
        value: "rds-ca-rsa2048-g1",
      },
    },
    "aws.rds.db-subnet-group": {
      name: {
        kind: "string",
        value: "synthetic-db-subnets",
      },
      description: {
        kind: "string",
        value: "Explicit synthetic database subnets",
      },
    },
    "aws.rds.db-parameter-group": {
      name: {
        kind: "string",
        value: "synthetic-postgres-tls",
      },
      description: {
        kind: "string",
        value: "Explicit synthetic TLS parameters",
      },
    },
  };
  for (const [serviceId, values] of Object.entries(input))
    expect(proposal([node(serviceId, values)])).not.toThrow();
  for (const key of [
    "masterPassword",
    "masterUserSecretArn",
    "kmsKeyId",
    "snapshotIdentifier",
    "replicaSource",
    "parameters",
  ]) {
    expect(
      proposal([
        node("aws.rds.db-instance", {
          ...input["aws.rds.db-instance"],
          [key]: { kind: "string", value: "synthetic-sensitive-sentinel" },
        }),
      ]),
    ).toThrow();
  }
  const projected = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.rds.db-instance",
  );
  expect(
    projected?.configurationValidation.jsonSchema.additionalProperties,
  ).toBe(false);
});

it("grounds Aurora cluster/member authority while preserving exact RDS history", () => {
  const input = {
    "aws.aurora.postgresql-cluster": {
      identifier: { kind: "string", value: "synthetic-aurora" },
      engineVersion: { kind: "string", value: "16.6" },
      databaseName: { kind: "string", value: "SyntheticApp" },
      masterUsername: { kind: "string", value: "SyntheticAdmin" },
    },
    "aws.aurora.postgresql-instance": {
      identifier: { kind: "string", value: "synthetic-aurora-a" },
      availabilityZone: { kind: "string", value: "us-east-1a" },
      caIdentifier: { kind: "string", value: "rds-ca-rsa2048-g1" },
    },
    "aws.aurora.postgresql-cluster-parameter-group": {
      name: { kind: "string", value: "synthetic-aurora-tls" },
      description: {
        kind: "string",
        value: "Explicit synthetic Aurora TLS parameters",
      },
    },
  };
  for (const [serviceId, values] of Object.entries(input))
    expect(proposal([node(serviceId, values)])).not.toThrow();
  for (const key of [
    "masterPassword",
    "masterUserSecretArn",
    "kmsKeyId",
    "snapshotIdentifier",
    "parameters",
    "secondsUntilAutoPause",
    "storageGiB",
  ]) {
    expect(
      proposal([
        node("aws.aurora.postgresql-cluster", {
          ...input["aws.aurora.postgresql-cluster"],
          [key]: { kind: "string", value: "synthetic-sensitive-sentinel" },
        }),
      ]),
    ).toThrow();
  }
  for (const [key, value] of [
    ["minimumCapacityAcus", "0"],
    ["engineVersion", "17.1"],
    ["engineMode", "serverless"],
  ])
    expect(
      proposal([
        node("aws.aurora.postgresql-cluster", {
          ...input["aws.aurora.postgresql-cluster"],
          [key ?? ""]: { kind: "string", value },
        }),
      ]),
    ).toThrow();
  const projected = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.aurora.postgresql-cluster",
  );
  expect(
    projected?.configurationValidation.jsonSchema.additionalProperties,
  ).toBe(false);
});

it("grounds DNS/ACM authority and preserves frozen Aurora context", () => {
  const input = {
    "aws.route53.public-hosted-zone": {
      domainName: { kind: "string", value: "example.test" },
      comment: { kind: "string", value: "Synthetic public DNS authority" },
      domainControlAttested: { kind: "boolean", value: true },
    },
    "aws.acm.public-dns-certificate": {
      domainName: { kind: "string", value: "app.example.test" },
      certificateRegion: { kind: "string", value: "us-east-1" },
    },
  };
  for (const [id, values] of Object.entries(input))
    expect(proposal([node(id, values)])).not.toThrow();
  for (const key of [
    "privateKey",
    "certificateBody",
    "certificateAuthorityArn",
    "subjectAlternativeNames",
    "externalHostedZoneId",
    "validationDomain",
  ]) {
    expect(
      proposal([
        node("aws.acm.public-dns-certificate", {
          ...input["aws.acm.public-dns-certificate"],
          [key]: { kind: "string", value: "synthetic-sensitive-sentinel" },
        }),
      ]),
    ).toThrow();
  }
  expect(
    proposal([
      node("aws.route53.public-hosted-zone", {
        domainName: input["aws.route53.public-hosted-zone"].domainName,
        comment: input["aws.route53.public-hosted-zone"].comment,
      }),
    ]),
  ).toThrow();
  const projected = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.route53.public-hosted-zone",
  );
  expect(
    projected?.configurationValidation.jsonSchema.additionalProperties,
  ).toBe(false);
  expect(
    Object.entries(
      projected?.configurationValidation.jsonSchema.properties ?? {},
    ).find(([key]) => key === "domainControlAttested")?.[1],
  ).not.toHaveProperty("default");
});

it("grounds public-content and static-cache intent with current DNS", () => {
  const input = {
    "aws.cloudfront.distribution": {
      comment: {
        kind: "string",
        value: "Synthetic public object distribution",
      },
      enabled: {
        kind: "boolean",
        value: false,
      },
      publicContentAttested: {
        kind: "boolean",
        value: true,
      },
      defaultRootObject: {
        kind: "string",
        value: "index.html",
      },
      priceClass: {
        kind: "string",
        value: "PriceClass_100",
      },
    },
    "aws.cloudfront.cache-policy": {
      name: {
        kind: "string",
        value: "SyntheticStaticCache",
      },
      comment: {
        kind: "string",
        value: "Synthetic bounded static cache",
      },
      defaultTtl: {
        kind: "integer",
        value: 3600,
      },
      maxTtl: {
        kind: "integer",
        value: 86400,
      },
    },
    "aws.cloudfront.alias-configuration": {
      domainName: {
        kind: "string",
        value: "app.example.test",
      },
    },
  };
  for (const id of [
    "aws.cloudfront.distribution",
    "aws.cloudfront.cache-policy",
  ])
    expect(proposal([node(id, input[id as keyof typeof input])])).not.toThrow();
  const projected = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.cloudfront.distribution",
  );
  expect(
    projected?.configurationValidation.jsonSchema.additionalProperties,
  ).toBe(false);
  for (const key of ["enabled", "publicContentAttested"])
    expect(
      projected?.configurationValidation.jsonSchema.properties[
        configurationKeySchema.parse(key)
      ],
    ).not.toHaveProperty("default");
  for (const key of [
    "webAclId",
    "customOriginDomainName",
    "originRequestPolicyId",
    "rawBucketPolicy",
  ])
    expect(
      proposal([
        node("aws.cloudfront.distribution", {
          ...input["aws.cloudfront.distribution"],
          [key]: { kind: "string", value: "unreviewed" },
        }),
      ]),
    ).toThrow();
});

it("grounds exact ELB configuration with current CloudFront", () => {
  const input = {
    "aws.elb.application-load-balancer": {
      name: { kind: "string", value: "synthetic-alb" },
      scheme: { kind: "string", value: "internal" },
    },
    "aws.elb.target-group": {
      name: { kind: "string", value: "synthetic-target" },
      backendMode: { kind: "string", value: "ec2-instance" },
      port: { kind: "integer", value: 8080 },
      healthPath: { kind: "string", value: "/health" },
      startupGraceSeconds: { kind: "integer", value: 0 },
    },
  };
  for (const [id, values] of Object.entries(input))
    expect(proposal([node(id, values)])).not.toThrow();
  const projected = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.elb.target-group",
  );
  expect(
    projected?.configurationValidation.jsonSchema.additionalProperties,
  ).toBe(false);
  for (const key of [
    "backendMode",
    "port",
    "healthPath",
    "startupGraceSeconds",
  ])
    expect(
      projected?.configurationValidation.jsonSchema.properties[
        configurationKeySchema.parse(key)
      ],
    ).not.toHaveProperty("default");
  for (const key of [
    "lambdaArn",
    "targetIps",
    "listenerRules",
    "rawSecurityPolicy",
  ])
    expect(
      proposal([
        node("aws.elb.target-group", {
          ...input["aws.elb.target-group"],
          [key]: { kind: "string", value: "unreviewed" },
        }),
      ]),
    ).toThrow();
});

it("grounds explicit EBS size/encryption without guest preparation or frozen ELB expansion", () => {
  const values = {
    name: { kind: "string", value: "synthetic-data" },
    sizeGiB: { kind: "integer", value: 100 },
    encryptionMode: { kind: "string", value: "account-default" },
    volumeType: { kind: "string", value: "gp3" },
    iops: { kind: "integer", value: 3000 },
    throughputMiBps: { kind: "integer", value: 125 },
    encrypted: { kind: "boolean", value: true },
    multiAttach: { kind: "boolean", value: false },
    retain: { kind: "boolean", value: true },
  };
  const parents = [
    node("aws.region.boundary", {
      regionName: { kind: "string", value: "us-east-1" },
    }),
    node(
      "aws.ec2.vpc",
      {},
      {
        nodeId: "aws.region.boundary",
        relationshipType: "aws.region.contains-vpc",
      },
    ),
    node(
      "aws.ec2.availability-zone",
      { zoneName: { kind: "string", value: "us-east-1a" } },
      {
        nodeId: "aws.ec2.vpc",
        relationshipType: "aws.ec2.vpc-contains-availability-zone",
      },
    ),
  ];
  const volumeParent = {
    nodeId: "aws.ec2.availability-zone",
    relationshipType: "aws.ebs.availability-zone-contains-volume",
  };
  const attachmentParent = {
    nodeId: "aws.ebs.volume",
    relationshipType: "aws.ebs.volume-owns-attachment",
  };
  const volume = node("aws.ebs.volume", values, volumeParent);
  expect(proposal([...parents, volume])).not.toThrow();
  const attachmentValues = {
    deviceName: { kind: "string", value: "/dev/sdf" },
    guestPreparation: { kind: "string", value: "external" },
    retain: { kind: "boolean", value: true },
    forceDetach: { kind: "boolean", value: false },
  };
  expect(
    proposal([
      ...parents,
      volume,
      node("aws.ebs.volume-attachment", attachmentValues, attachmentParent),
    ]),
  ).not.toThrow();
  const attachment = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.ebs.volume-attachment",
  );
  expect(
    attachment?.configurationValidation.jsonSchema.properties[
      configurationKeySchema.parse("deviceName")
    ],
  ).not.toHaveProperty("default");
  for (const deviceName of ["/dev/xvda", "/dev/nvme1n1"])
    expect(
      proposal([
        ...parents,
        volume,
        node(
          "aws.ebs.volume-attachment",
          {
            ...attachmentValues,
            deviceName: { kind: "string", value: deviceName },
          },
          attachmentParent,
        ),
      ]),
    ).toThrow();
  expect(
    proposal([
      ...parents,
      volume,
      node(
        "aws.ebs.volume-attachment",
        {
          ...attachmentValues,
          guestPreparation: { kind: "string", value: "format-and-mount" },
        },
        attachmentParent,
      ),
    ]),
  ).toThrow();
  const grounding = createProductionAiCatalogGrounding().nodes.find(
    (n) => n.serviceType === "aws.ebs.volume",
  );
  expect(
    grounding?.configurationValidation.jsonSchema.additionalProperties,
  ).toBe(false);
  for (const key of ["sizeGiB", "encryptionMode"])
    expect(
      grounding?.configurationValidation.jsonSchema.properties[
        configurationKeySchema.parse(key)
      ],
    ).not.toHaveProperty("default");
  for (const key of ["snapshotId", "rawVolumeId", "mountPath", "formatCommand"])
    expect(
      proposal([
        ...parents,
        node(
          "aws.ebs.volume",
          {
            ...values,
            [key]: { kind: "string", value: "unreviewed" },
          },
          volumeParent,
        ),
      ]),
    ).toThrow();
});
