import { readFile } from "node:fs/promises";

import {
  providerCatalogArtifactV1Schema,
  type ProviderConfigurationValidationIssueCode,
} from "@cloudmarkup/provider-sdk";
import {
  compileProviderCatalogV1,
  renderProviderCatalogAccessorModuleV1,
} from "@cloudmarkup/provider-sdk/compiler";
import { describe, expect, it } from "vitest";

import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogArtifactV1,
  awsCatalogV1,
} from "./catalog-v1-accessors.js";
import { awsCatalogSourceV1 } from "./catalog/source.js";
const cloudFormationImplementedServiceIds = new Set([
  "aws.wafv2.web-acl",
  "aws.wafv2.alb-association",
  "aws.ebs.volume",
  "aws.ebs.volume-attachment",
  "aws.elb.application-load-balancer",
  "aws.elb.target-group",
  "aws.elb.https-listener",
  "aws.cloudfront.distribution",
  "aws.cloudfront.cache-policy",
  "aws.acm.public-dns-certificate",
  "aws.route53.public-hosted-zone",
  "aws.aurora.postgresql-cluster",
  "aws.aurora.postgresql-instance",
  "aws.aurora.postgresql-cluster-parameter-group",
  "aws.rds.db-instance",
  "aws.rds.db-parameter-group",
  "aws.rds.db-subnet-group",
  "aws.apigateway.http-api",
  "aws.cloudwatch.log-group",
  "aws.cloudwatch.metric-alarm",
  "aws.cognito.user-pool",
  "aws.cognito.user-pool-client",
  "aws.dynamodb.table",
  "aws.ecr.repository",
  "aws.ecs.cluster",
  "aws.ecs.service",
  "aws.ecs.task-definition",
  "aws.fsx.lustre-file-system",
  "aws.fsx.windows-file-system",
  "aws.fsx.openzfs-file-system",
  "aws.fsx.ontap-file-system",
  "aws.fsx.ontap-storage-virtual-machine",
  "aws.fsx.ontap-volume",
  "aws.iam.instance-profile",
  "aws.iam.role",
  "aws.kms.key",
  "aws.lambda.function",
  "aws.secretsmanager.secret",
]);

interface ConfigurationFixture {
  readonly serviceId: string;
  readonly values: unknown;
}

interface ValidFixture {
  readonly catalogVersion: string;
  readonly configurations: readonly ConfigurationFixture[];
}

interface InvalidFixtureCase extends ConfigurationFixture {
  readonly id: string;
  readonly expectedIssueCodes: readonly ProviderConfigurationValidationIssueCode[];
}

interface InvalidFixture {
  readonly catalogVersion: string;
  readonly cases: readonly InvalidFixtureCase[];
}

async function readFixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(
      new URL(`../fixtures/notes-api/${name}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

describe("AWS notes API catalog v1", () => {
  it("matches all checked-in generated artifacts byte for byte", async () => {
    const compilation = compileProviderCatalogV1(awsCatalogSourceV1);
    const json = await readFile(
      new URL("./compiled/catalog-v1.json", import.meta.url),
      "utf8",
    );
    const digest = await readFile(
      new URL("./compiled/catalog-v1.sha256", import.meta.url),
      "utf8",
    );
    const accessorSource = await readFile(
      new URL("./catalog-v1-accessors.ts", import.meta.url),
      "utf8",
    );

    expect(json).toBe(compilation.canonicalJson);
    expect(digest).toBe(`${compilation.hash}\n`);
    expect(accessorSource).toBe(
      renderProviderCatalogAccessorModuleV1(compilation, {
        artifactImportPath: "./compiled/catalog-v1.json",
        artifactExportName: "awsCatalogArtifactV1",
        accessorsExportName: "awsCatalogV1",
        digestExportName: "AWS_CATALOG_DIGEST_V1",
      }),
    );
    expect(AWS_CATALOG_DIGEST_V1).toBe(compilation.hash);
    expect(awsCatalogArtifactV1).toEqual(compilation.artifact);
    expect(
      providerCatalogArtifactV1Schema.safeParse(compilation.artifact).success,
    ).toBe(true);
  });

  it("contains the exact additive AWS catalog with honest target readiness", () => {
    expect(awsCatalogV1.artifact.catalog).toMatchObject({
      version: "0.30.0",
      maturity: "curated",
      runtimeRetrieval: "forbidden",
      architectureDocumentSchemaVersions: [1, 2, 3],
    });
    expect(awsCatalogV1.listServices().map((service) => service.id)).toEqual([
      "aws.acm.public-dns-certificate",
      "aws.apigateway.http-api",
      "aws.aurora.postgresql-cluster",
      "aws.aurora.postgresql-cluster-parameter-group",
      "aws.aurora.postgresql-instance",
      "aws.cloudfront.alias-configuration",
      "aws.cloudfront.cache-policy",
      "aws.cloudfront.distribution",
      "aws.cloudwatch.log-group",
      "aws.cloudwatch.metric-alarm",
      "aws.cognito.user-pool",
      "aws.cognito.user-pool-client",
      "aws.dynamodb.table",
      "aws.ebs.volume",
      "aws.ebs.volume-attachment",
      "aws.ec2.availability-zone",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.instance",
      "aws.ec2.internet-gateway",
      "aws.ec2.nat-gateway",
      "aws.ec2.route",
      "aws.ec2.route-table",
      "aws.ec2.route-table-association",
      "aws.ec2.security-group",
      "aws.ec2.security-group-egress-rule",
      "aws.ec2.security-group-ingress-rule",
      "aws.ec2.subnet",
      "aws.ec2.vpc",
      "aws.ecr.image-reference",
      "aws.ecr.repository",
      "aws.ecs.cluster",
      "aws.ecs.container-definition",
      "aws.ecs.service",
      "aws.ecs.task-definition",
      "aws.elb.application-load-balancer",
      "aws.elb.backend-access-configuration",
      "aws.elb.https-listener",
      "aws.elb.target-group",
      "aws.eventbridge.event-bus",
      "aws.eventbridge.rule",
      "aws.eventbridge.target",
      "aws.fsx.lustre-file-system",
      "aws.fsx.ontap-file-system",
      "aws.fsx.ontap-storage-virtual-machine",
      "aws.fsx.ontap-volume",
      "aws.fsx.openzfs-file-system",
      "aws.fsx.windows-file-system",
      "aws.iam.instance-profile",
      "aws.iam.managed-policy-attachment",
      "aws.iam.policy-condition",
      "aws.iam.policy-document",
      "aws.iam.policy-statement",
      "aws.iam.role",
      "aws.kms.key",
      "aws.lambda.function",
      "aws.lambda.vpc-access-configuration",
      "aws.rds.db-instance",
      "aws.rds.db-parameter-group",
      "aws.rds.db-subnet-group",
      "aws.region.boundary",
      "aws.route53.public-hosted-zone",
      "aws.s3.bucket",
      "aws.s3.bucket-cors-configuration",
      "aws.s3.bucket-lifecycle-configuration",
      "aws.s3.bucket-notification-configuration",
      "aws.secretsmanager.secret",
      "aws.sns.subscription",
      "aws.sns.topic",
      "aws.sqs.queue",
      "aws.sqs.redrive-configuration",
      "aws.stepfunctions.state-machine",
      "aws.wafv2.alb-association",
      "aws.wafv2.web-acl",
    ]);
    expect(awsCatalogV1.listConnectionRules()).toHaveLength(139);
    const currentCatalogJson = JSON.stringify(awsCatalogV1.artifact);
    for (const legacyDirectPolicyToken of [
      ["aws", "iam", "contains-policy-statement"].join("."),
      ["aws", "iam", "policy-statement", "role-policy"].join("."),
      ["aws", "iam", "role", "inline-policy"].join("."),
    ]) {
      expect(currentCatalogJson).not.toContain(legacyDirectPolicyToken);
    }
    expect(awsCatalogV1.artifact.validationRules).toHaveLength(34);
    expect(
      awsCatalogV1.artifact.validationRules.map((rule) => rule.id),
    ).toEqual([
      "aws.cloudmarkup.validation.api-route-authentication",
      "aws.cloudmarkup.validation.aurora-postgres-readiness",
      "aws.cloudmarkup.validation.cloudfront-readiness",
      "aws.cloudmarkup.validation.compiler-readiness",
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.connection-questions",
      "aws.cloudmarkup.validation.dns-certificate-readiness",
      "aws.cloudmarkup.validation.dynamodb-protection",
      "aws.cloudmarkup.validation.ebs-readiness",
      "aws.cloudmarkup.validation.ec2-readiness",
      "aws.cloudmarkup.validation.ecs-fargate-readiness",
      "aws.cloudmarkup.validation.elb-readiness",
      "aws.cloudmarkup.validation.event-delivery",
      "aws.cloudmarkup.validation.event-topology",
      "aws.cloudmarkup.validation.fsx-readiness",
      "aws.cloudmarkup.validation.fsx-storage-capacity",
      "aws.cloudmarkup.validation.iam-policy-safety",
      "aws.cloudmarkup.validation.iam-wildcards",
      "aws.cloudmarkup.validation.kms-key-readiness",
      "aws.cloudmarkup.validation.lambda-dynamodb-actions",
      "aws.cloudmarkup.validation.lambda-execution-role",
      "aws.cloudmarkup.validation.lambda-runtime-bounds",
      "aws.cloudmarkup.validation.lambda-trigger-compatibility",
      "aws.cloudmarkup.validation.lambda-vpc-access",
      "aws.cloudmarkup.validation.log-retention",
      "aws.cloudmarkup.validation.network-placement",
      "aws.cloudmarkup.validation.network-routing",
      "aws.cloudmarkup.validation.rds-postgres-readiness",
      "aws.cloudmarkup.validation.region-availability",
      "aws.cloudmarkup.validation.regional-waf-readiness",
      "aws.cloudmarkup.validation.s3-bucket-name",
      "aws.cloudmarkup.validation.s3-notification-filters",
      "aws.cloudmarkup.validation.secret-readiness",
      "aws.cloudmarkup.validation.security-group-policy",
    ]);
    expect(
      awsCatalogV1
        .listConnectionRules()
        .filter((rule) => rule.implementation.status === "implemented"),
    ).toHaveLength(112);
    for (const rule of awsCatalogV1.listConnectionRules()) {
      expect(rule.lifecycle).toEqual({
        provenance: "connection-rule",
        deletion: "release-generated-resources",
        adoption: "required-before-customization",
        sharedResource: "retain-while-referenced",
      });
      expect(
        rule.iamEffects
          .flatMap((effect) => effect.actions)
          .every((action) => !action.includes("*")),
      ).toBe(true);
    }

    for (const service of awsCatalogV1.listServices()) {
      const serviceId = String(service.id);
      const isEventDriven =
        /^aws\.(eventbridge|s3|sns|sqs|stepfunctions)\./u.test(serviceId);
      const isTerraformOnlyEventConfiguration = [
        "aws.eventbridge.target",
        "aws.s3.bucket-cors-configuration",
        "aws.s3.bucket-lifecycle-configuration",
        "aws.s3.bucket-notification-configuration",
        "aws.sqs.redrive-configuration",
      ].includes(serviceId);
      expect(service).toMatchObject({
        supportLevel: serviceId.startsWith("aws.wafv2.")
          ? "proof"
          : "production-oriented",
        regionAvailability: {
          state: "unknown",
        },
      });
      expect(service.education.guidedExplanation.length).toBeGreaterThan(40);
      expect(service.education.professionalExplanation.length).toBeGreaterThan(
        40,
      );
      expect(
        service.education.documentation.some(
          (reference) => reference.kind === "official",
        ),
      ).toBe(true);
      expect(service.education.considerations).toHaveLength(4);
      expect(
        service.education.considerations.map(
          (consideration) => consideration.split(":", 1)[0],
        ),
      ).toEqual(["Connections", "Cost", "Operations", "Security"]);
      expect(
        service.education.considerations.every(
          (consideration) => consideration.length >= 70,
        ),
      ).toBe(true);
      expect(service.education.guidedExplanation).not.toBe(
        service.education.professionalExplanation,
      );
      expect(service.unsupportedCapabilities.length).toBeGreaterThan(0);
      const mappingTargets = service.mappings.map((mapping) => mapping.target);
      expect(mappingTargets).toEqual(
        serviceId.startsWith("aws.wafv2.")
          ? ["cloudformation"]
          : serviceId === "aws.lambda.vpc-access-configuration"
            ? ["terraform"]
            : isTerraformOnlyEventConfiguration
              ? ["terraform"]
              : mappingTargets.length === 0
                ? []
                : ["cloudformation", "terraform"],
      );
      const isNetworking =
        serviceId.startsWith("aws.ec2.") ||
        serviceId === "aws.lambda.vpc-access-configuration" ||
        serviceId === "aws.region.boundary";
      if (serviceId.startsWith("aws.wafv2.")) {
        expect(service.mappings).toHaveLength(1);
        expect(service.mappings[0]).toMatchObject({
          target: "cloudformation",
          implementationStatus: "implemented",
        });
      } else if (isNetworking && mappingTargets.length > 0) {
        expect(
          service.mappings.find((mapping) => mapping.target === "terraform")
            ?.implementationStatus,
        ).toBe("implemented");
        expect(
          service.mappings.find(
            (mapping) => mapping.target === "cloudformation",
          )?.implementationStatus,
        ).toBe(
          serviceId === "aws.lambda.vpc-access-configuration"
            ? undefined
            : "implemented",
        );
      } else if (isEventDriven) {
        expect(
          service.mappings.find((mapping) => mapping.target === "terraform")
            ?.implementationStatus,
        ).toBe("implemented");
        expect(
          service.mappings.find(
            (mapping) => mapping.target === "cloudformation",
          )?.implementationStatus,
        ).toBe(isTerraformOnlyEventConfiguration ? undefined : "implemented");
      } else if (!isNetworking && mappingTargets.length > 0) {
        expect(
          service.mappings.find((mapping) => mapping.target === "terraform")
            ?.implementationStatus,
        ).toBe("implemented");
        expect(
          service.mappings.find(
            (mapping) => mapping.target === "cloudformation",
          )?.implementationStatus,
        ).toBe(
          cloudFormationImplementedServiceIds.has(serviceId)
            ? "implemented"
            : "metadata-only",
        );
      }

      const hints = new Map<
        string,
        (typeof service.configuration.uiHints)[number]
      >(service.configuration.uiHints.map((hint) => [hint.property, hint]));
      for (const property of Object.keys(
        service.configuration.jsonSchema.properties,
      )) {
        const hint = hints.get(property);
        expect(hint).toBeDefined();
        expect([
          "literal",
          "node-reference",
          "secret-reference",
          "sensitive-variable-reference",
        ]).toContain(hint?.valueSource);
        expect(["none", "security-sensitive", "secret-reference"]).toContain(
          hint?.securityImpact,
        );
        expect(["none", "cost-sensitive"]).toContain(hint?.costImpact);
      }
    }
  });

  it("accepts every valid synthetic configuration and applies all defaults", async () => {
    const fixture = await readFixture<ValidFixture>(
      "valid-configurations.json",
    );

    expect(fixture.catalogVersion).toBe(awsCatalogV1.artifact.catalog.version);
    expect(fixture.configurations).toHaveLength(
      awsCatalogV1.listServices().length,
    );
    for (const entry of fixture.configurations) {
      const service = awsCatalogV1.requireService(entry.serviceId);
      const result = awsCatalogV1.validateConfiguration(
        entry.serviceId,
        entry.values,
      );
      expect(result.success, entry.serviceId).toBe(true);
      if (result.success) {
        expect(Object.keys(result.values)).toEqual(
          Object.keys(service.configuration.jsonSchema.properties).sort(),
        );
      }
    }
  });

  it("rejects invalid configurations with deterministic value-safe issues", async () => {
    const fixture = await readFixture<InvalidFixture>(
      "invalid-configurations.json",
    );

    expect(fixture.catalogVersion).toBe(awsCatalogV1.artifact.catalog.version);
    for (const testCase of fixture.cases) {
      const first = awsCatalogV1.validateConfiguration(
        testCase.serviceId,
        testCase.values,
      );
      const second = awsCatalogV1.validateConfiguration(
        testCase.serviceId,
        structuredClone(testCase.values),
      );
      expect(first, testCase.id).toEqual(second);
      expect(first.success, testCase.id).toBe(false);
      if (!first.success) {
        expect(
          first.issues.map((issue) => issue.code),
          testCase.id,
        ).toEqual(testCase.expectedIssueCodes);
        expect(JSON.stringify(first.issues)).not.toContain(
          "inline-table-resource",
        );
        expect(JSON.stringify(first.issues)).not.toContain("unexpected");
      }
    }
  });

  it("keeps source order out of the artifact and catalog version in the hash", () => {
    const baseline = compileProviderCatalogV1(awsCatalogSourceV1);
    const reordered = structuredClone(awsCatalogSourceV1);
    reordered.services.reverse();
    reordered.connectionRules.reverse();
    reordered.validationRules.reverse();

    expect(compileProviderCatalogV1(reordered)).toMatchObject({
      canonicalJson: baseline.canonicalJson,
      hash: baseline.hash,
    });

    const nextVersion = {
      ...awsCatalogSourceV1,
      catalog: {
        ...awsCatalogSourceV1.catalog,
        version: "0.4.1",
      },
    };
    expect(compileProviderCatalogV1(nextVersion).hash).not.toBe(baseline.hash);
  });

  it("forces the app client to remain secretless and IAM resources to remain bounded", () => {
    const appClient = awsCatalogV1.requireService(
      "aws.cognito.user-pool-client",
    );
    const policy = awsCatalogV1.requireService("aws.iam.policy-statement");

    expect(
      Object.entries(appClient.configuration.jsonSchema.properties).find(
        ([property]) => property === "generateClientSecret",
      )?.[1],
    ).toMatchObject({
      type: "boolean",
      const: false,
      default: false,
    });
    expect(
      policy.configuration.uiHints.find(
        (hint) => hint.property === "resourceNode",
      ),
    ).toMatchObject({
      valueSource: "node-reference",
      securityImpact: "security-sensitive",
    });
    expect(
      awsCatalogV1
        .listServices()
        .flatMap((service) => service.configuration.uiHints)
        .filter((hint) => hint.valueSource === "secret-reference"),
    ).toEqual([]);
  });
});
