import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import {
  fsxFamilies,
  fsxDocumentation,
  fsxValidationRuleId,
} from "../services/fsx.js";
function rule(
  id: string,
  sourceId: string,
  sourcePort: string,
  targetId: string,
  targetPort: string,
  label: string,
  maxSource = 1,
): ReturnType<typeof defineProviderConnectionRuleV1> {
  return defineProviderConnectionRuleV1({
    id,
    ruleVersion: "1.0.0",
    relationshipType: id,
    category:
      id === "aws.fsx.lustre-imports-s3"
        ? "reads-or-writes-data"
        : "network-and-security",
    source: { serviceId: sourceId, portId: sourcePort },
    target: { serviceId: targetId, portId: targetPort },
    maximumConnectionsPerSource: maxSource,
    maximumConnectionsPerTarget: 256,
    maximumConnectionsPerEndpointPair: 1,
    configuration: {
      schemaId: id + ".connection",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:" + id + ".connection:1.0.0",
        type: "object",
        title: label,
        additionalProperties: false,
        properties: {},
        required: [],
      },
      uiHints: [],
    },
    questions: [],
    supportingChanges: [],
    iamEffects: [],
    missingInformationFindings: [],
    lifecycle: {
      provenance: "connection-rule",
      deletion: "release-generated-resources",
      adoption: "required-before-customization",
      sharedResource: "retain-while-referenced",
    },
    implementation: {
      status: "implemented",
      interfaceVersion: 1,
      implementationId: id + ".resolve",
    },
    validationRuleIds: [fsxValidationRuleId],
    education: {
      summary: label,
      guidedExplanation:
        label +
        ". Choose the exact resource in your diagram; review the combined network and access settings before export.",
      professionalExplanation:
        "Explicit same-Region graph association. Subnet/security-group relationships grant no ingress or IAM permission. Lustre S3 import uses the AWS FSx service-linked role and never a Lambda file-system mount.",
      considerations: [
        "Connections: Source and target identities are preserved in the immutable revision.",
        "Security: No broad IAM grant or implicit ingress rule is added.",
        "Cost: The associated file system retains its provisioned storage and throughput charges.",
        "Operations: S3 repository imports synchronize metadata; file contents load on access.",
      ],
      documentation: fsxDocumentation,
    },
  });
}
export const awsFsxConnectionRules = [
  ...fsxFamilies.flatMap((f) => {
    const id = "aws.fsx." + f.family + "-file-system";
    return [
      rule(
        id + "-uses-subnet",
        id,
        id + ".subnets",
        "aws.ec2.subnet",
        "aws.ec2.subnet.fsx",
        "Uses subnet",
        f.family === "windows" ? 2 : 1,
      ),
      rule(
        id + "-uses-security-group",
        id,
        id + ".security-groups",
        "aws.ec2.security-group",
        "aws.ec2.security-group.fsx",
        "Uses security group",
        5,
      ),
    ];
  }),
  rule(
    "aws.fsx.lustre-imports-s3",
    "aws.fsx.lustre-file-system",
    "aws.fsx.lustre-file-system.s3-repository",
    "aws.s3.bucket",
    "aws.s3.bucket.object-api",
    "Imports files from S3",
  ),
  rule(
    "aws.fsx.ontap-svm-uses-file-system",
    "aws.fsx.ontap-storage-virtual-machine",
    "aws.fsx.ontap-storage-virtual-machine.file-system",
    "aws.fsx.ontap-file-system",
    "aws.fsx.ontap-file-system.storage-virtual-machines",
    "Uses ONTAP file system",
  ),
  rule(
    "aws.fsx.ontap-volume-uses-svm",
    "aws.fsx.ontap-volume",
    "aws.fsx.ontap-volume.storage-virtual-machine",
    "aws.fsx.ontap-storage-virtual-machine",
    "aws.fsx.ontap-storage-virtual-machine.volumes",
    "Uses storage virtual machine",
  ),
];
