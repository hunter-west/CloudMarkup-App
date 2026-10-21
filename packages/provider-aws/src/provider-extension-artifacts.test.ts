import { readFile } from "node:fs/promises";

import {
  providerConnectionPresentationArtifactV1Schema,
  providerServiceExtensionArtifactV1Schema,
} from "@cloudmarkup/provider-sdk";
import {
  compileProviderCatalogV1,
  compileProviderConnectionPresentationV1,
  compileProviderServiceExtensionV1,
  renderProviderConnectionPresentationAccessorModuleV1,
  renderProviderServiceExtensionAccessorModuleV1,
} from "@cloudmarkup/provider-sdk/compiler";
import { describe, expect, it } from "vitest";

import {
  AWS_CONNECTION_PRESENTATION_DIGEST_V1,
  awsConnectionPresentationArtifactV1,
  awsConnectionPresentationV1,
} from "./connection-presentation-v1-accessors.js";
import { createAwsConnectionPresentationSourceV1 } from "./catalog/connection-presentation.js";
import { createAwsProviderServiceExtensionSourceV1 } from "./catalog/service-extension.js";
import { awsCatalogSourceV1 } from "./catalog/source.js";
import {
  AWS_SERVICE_EXTENSION_DIGEST_V1,
  awsServiceExtensionArtifactV1,
  awsServiceExtensionV1,
} from "./service-extension-v1-accessors.js";

function compileAwsProviderArtifacts() {
  const catalog = compileProviderCatalogV1(awsCatalogSourceV1);
  const presentation = compileProviderConnectionPresentationV1(
    createAwsConnectionPresentationSourceV1(catalog.artifact),
    catalog.artifact,
  );
  const serviceExtension = compileProviderServiceExtensionV1(
    createAwsProviderServiceExtensionSourceV1(catalog.artifact),
    catalog.artifact,
  );
  return { catalog, presentation, serviceExtension };
}

describe("AWS provider extension artifacts v1", () => {
  it("matches every checked-in extension output byte for byte", async () => {
    const { catalog, presentation, serviceExtension } =
      compileAwsProviderArtifacts();

    expect(
      await readFile(
        new URL("./compiled/connection-presentation-v1.json", import.meta.url),
        "utf8",
      ),
    ).toBe(presentation.canonicalJson);
    expect(
      await readFile(
        new URL(
          "./compiled/connection-presentation-v1.sha256",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(`${presentation.hash}\n`);
    expect(
      await readFile(
        new URL("./connection-presentation-v1-accessors.ts", import.meta.url),
        "utf8",
      ),
    ).toBe(
      renderProviderConnectionPresentationAccessorModuleV1(presentation, {
        artifactImportPath: "./compiled/connection-presentation-v1.json",
        artifactExportName: "awsConnectionPresentationArtifactV1",
        accessorsExportName: "awsConnectionPresentationV1",
        digestExportName: "AWS_CONNECTION_PRESENTATION_DIGEST_V1",
      }),
    );

    expect(
      await readFile(
        new URL("./compiled/service-extension-v1.json", import.meta.url),
        "utf8",
      ),
    ).toBe(serviceExtension.canonicalJson);
    expect(
      await readFile(
        new URL("./compiled/service-extension-v1.sha256", import.meta.url),
        "utf8",
      ),
    ).toBe(`${serviceExtension.hash}\n`);
    expect(
      await readFile(
        new URL("./service-extension-v1-accessors.ts", import.meta.url),
        "utf8",
      ),
    ).toBe(
      renderProviderServiceExtensionAccessorModuleV1(serviceExtension, {
        artifactImportPath: "./compiled/service-extension-v1.json",
        artifactExportName: "awsServiceExtensionArtifactV1",
        accessorsExportName: "awsServiceExtensionV1",
        digestExportName: "AWS_SERVICE_EXTENSION_DIGEST_V1",
      }),
    );

    expect(AWS_CONNECTION_PRESENTATION_DIGEST_V1).toBe(presentation.hash);
    expect(awsConnectionPresentationArtifactV1).toEqual(presentation.artifact);
    expect(AWS_SERVICE_EXTENSION_DIGEST_V1).toBe(serviceExtension.hash);
    expect(awsServiceExtensionArtifactV1).toEqual(serviceExtension.artifact);
    expect(
      providerConnectionPresentationArtifactV1Schema.safeParse(
        awsConnectionPresentationArtifactV1,
      ).success,
    ).toBe(true);
    expect(
      providerServiceExtensionArtifactV1Schema.safeParse(
        awsServiceExtensionArtifactV1,
      ).success,
    ).toBe(true);

    const exactCatalogBinding = {
      id: catalog.artifact.catalog.id,
      version: catalog.artifact.catalog.version,
      digest: catalog.artifact.digest,
    };
    expect(awsConnectionPresentationV1.artifact.catalog).toEqual(
      exactCatalogBinding,
    );
    expect(awsServiceExtensionV1.artifact.catalog).toEqual(exactCatalogBinding);
    expect(
      awsServiceExtensionV1.artifact.services.map(
        (service) => service.serviceId,
      ),
    ).toEqual(catalog.artifact.services.map((service) => service.id));
  });

  it("declares exact graph-backed role and Lambda ownership slots", () => {
    const roleSlots =
      awsServiceExtensionV1.getOwnedConfigurationSlots("aws.iam.role");
    expect(roleSlots.map((slot) => slot.id)).toEqual([
      "aws.iam.role.slot.custom-inline-policy",
      "aws.iam.role.slot.generated-permission",
      "aws.iam.role.slot.managed-policy",
      "aws.iam.role.slot.permissions-boundary",
      "aws.iam.role.slot.trust-policy",
    ]);

    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlot(
        "aws.iam.role",
        "aws.iam.role.slot.trust-policy",
      ),
    ).toMatchObject({
      graphBinding: {
        configurationServiceId: "aws.iam.policy-document",
        ownershipRelationshipType: "aws.iam.role-owns-trust-policy",
      },
      cardinality: { minimum: 1, maximum: 1 },
      allowedOwnership: ["generated", "user"],
      generatedAdoption: "allowed",
      policyKinds: ["trust"],
    });
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlot(
        "aws.iam.role",
        "aws.iam.role.slot.custom-inline-policy",
      ),
    ).toMatchObject({
      cardinality: { minimum: 0, maximum: "many" },
      allowedOwnership: ["user"],
      generatedAdoption: "not-applicable",
      policyKinds: ["identity-inline"],
    });
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlot(
        "aws.iam.role",
        "aws.iam.role.slot.generated-permission",
      ),
    ).toMatchObject({
      cardinality: { minimum: 0, maximum: "many" },
      allowedOwnership: ["generated"],
      generatedAdoption: "allowed",
      policyKinds: ["generated-permission"],
    });
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlot(
        "aws.iam.role",
        "aws.iam.role.slot.managed-policy",
      ),
    ).toMatchObject({
      graphBinding: {
        configurationServiceId: "aws.iam.managed-policy-attachment",
        ownershipRelationshipType:
          "aws.iam.role-owns-managed-policy-attachment",
      },
      cardinality: { minimum: 0, maximum: "many" },
      policyKinds: ["managed-policy-attachment"],
    });
    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlot(
        "aws.iam.role",
        "aws.iam.role.slot.permissions-boundary",
      ),
    ).toMatchObject({
      graphBinding: {
        configurationServiceId: "aws.iam.managed-policy-attachment",
        ownershipRelationshipType: "aws.iam.role-owns-permissions-boundary",
      },
      cardinality: { minimum: 0, maximum: 1 },
      policyKinds: ["permissions-boundary"],
    });

    expect(
      awsServiceExtensionV1.getOwnedConfigurationSlots("aws.lambda.function"),
    ).toEqual([
      expect.objectContaining({
        id: "aws.lambda.function.slot.invocation-permission",
        graphBinding: {
          configurationServiceId: "aws.iam.policy-document",
          ownershipRelationshipType: "aws.lambda.owns-invocation-permission",
        },
        cardinality: {
          minimum: 0,
          maximum: "many",
          enforcement: "provider-rule",
        },
        allowedOwnership: ["generated"],
        generatedAdoption: "allowed",
        policyKinds: ["service-grant"],
      }),
      expect.objectContaining({
        id: "aws.lambda.function.slot.vpc-access-configuration",
        graphBinding: {
          configurationServiceId: "aws.lambda.vpc-access-configuration",
          ownershipRelationshipType: "aws.lambda.owns-vpc-access-configuration",
        },
        cardinality: {
          minimum: 0,
          maximum: 1,
          enforcement: "provider-rule",
        },
        allowedOwnership: ["user"],
        generatedAdoption: "not-applicable",
        policyKinds: [],
      }),
    ]);

    const servicesWithOwnedConfiguration = new Set([
      "aws.cloudfront.distribution",
      "aws.ecr.repository",
      "aws.ecs.task-definition",
      "aws.elb.target-group",
      "aws.kms.key",
      "aws.ec2.gateway-vpc-endpoint",
      "aws.ec2.route-table",
      "aws.ec2.security-group",
      "aws.eventbridge.event-bus",
      "aws.eventbridge.rule",
      "aws.s3.bucket",
      "aws.sns.topic",
      "aws.sqs.queue",
      "aws.iam.role",
      "aws.lambda.function",
    ]);
    for (const service of awsServiceExtensionV1.artifact.services) {
      const serviceId = String(service.serviceId);
      if (!servicesWithOwnedConfiguration.has(serviceId)) {
        expect(service.ownedConfigurationSlots, service.serviceId).toEqual([]);
      }
      const isAmbientBoundary =
        serviceId === "aws.region.boundary" ||
        serviceId === "aws.ec2.availability-zone";
      expect(service.targetReadiness.terraform.status).toBe(
        isAmbientBoundary ? "not-applicable" : "supported",
      );
      expect(service.targetReadiness.cloudformation.status).toBe(
        isAmbientBoundary ? "not-applicable" : "supported",
      );
      for (const slot of service.ownedConfigurationSlots) {
        expect(slot.targetReadiness.terraform.status, slot.id).toBe(
          "supported",
        );
      }
    }

    const subnetExtension = awsServiceExtensionV1.artifact.services.find(
      (service) => service.serviceId === "aws.ec2.subnet",
    );
    expect(subnetExtension?.targetReadiness.terraform.reason).toContain(
      "deterministic reviewed Terraform renderer",
    );
    expect(subnetExtension?.targetReadiness.cloudformation.reason).toContain(
      "resolves VpcId",
    );

    const securityGroupExtension = awsServiceExtensionV1.artifact.services.find(
      (service) => service.serviceId === "aws.ec2.security-group",
    );
    expect(
      securityGroupExtension?.targetReadiness.cloudformation.reason,
    ).toContain("deterministic reviewed CloudFormation renderer");
    const egressSlot = securityGroupExtension?.ownedConfigurationSlots.find(
      (slot) => slot.id === "aws.ec2.security-group.slot.egress-rules",
    );
    expect(egressSlot?.targetReadiness.cloudformation.reason).toContain(
      "explicitly suppresses default allow-all egress",
    );

    const egressRuleExtension = awsServiceExtensionV1.artifact.services.find(
      (service) => service.serviceId === "aws.ec2.security-group-egress-rule",
    );
    expect(
      egressRuleExtension?.targetReadiness.cloudformation.reason,
    ).toContain("explicitly suppresses default allow-all egress");
  });

  it("is deterministic when reviewed source arrays are reordered", () => {
    const baseline = compileAwsProviderArtifacts();
    const presentationSource = createAwsConnectionPresentationSourceV1(
      baseline.catalog.artifact,
    );
    presentationSource.services.reverse();
    presentationSource.relationshipLabels.reverse();
    for (const service of presentationSource.services) {
      service.docks.reverse();
    }

    const serviceExtensionSource = createAwsProviderServiceExtensionSourceV1(
      baseline.catalog.artifact,
    );
    serviceExtensionSource.services.reverse();
    for (const service of serviceExtensionSource.services) {
      service.ownedConfigurationSlots.reverse();
    }

    expect(
      compileProviderConnectionPresentationV1(
        presentationSource,
        baseline.catalog.artifact,
      ),
    ).toMatchObject({
      canonicalJson: baseline.presentation.canonicalJson,
      hash: baseline.presentation.hash,
    });
    expect(
      compileProviderServiceExtensionV1(
        serviceExtensionSource,
        baseline.catalog.artifact,
      ),
    ).toMatchObject({
      canonicalJson: baseline.serviceExtension.canonicalJson,
      hash: baseline.serviceExtension.hash,
    });
  });
});
