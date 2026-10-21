import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/** Preparation only: deliberately absent from services/index and public exports. */
export const efsFileSystemCandidate = defineProviderServiceV1({
  id: "aws.efs.file-system",
  definitionVersion: "1.0.0",
  supportLevel: "proof",
  displayName: "EFS file system (prepared)",
  description:
    "Uninstalled regional encrypted file-system foundation; no mount or export support is enabled.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.efs.file-system",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.efs-file-system",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.efs.file-system.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.efs.file-system.configuration:1.0.0",
      type: "object",
      title: "Prepared regional encrypted EFS foundation",
      additionalProperties: false,
      properties: {
        fileSystemType: {
          type: "string",
          enum: ["regional"],
          default: "regional",
        },
        encrypted: { type: "boolean", const: true, default: true },
        encryptionMode: {
          type: "string",
          enum: ["aws-managed"],
          default: "aws-managed",
        },
        performanceMode: {
          type: "string",
          enum: ["generalPurpose"],
          default: "generalPurpose",
        },
        throughputMode: {
          type: "string",
          enum: ["bursting"],
          default: "bursting",
        },
        preventDestroy: { type: "boolean", const: true, default: true },
      },
      required: [
        "fileSystemType",
        "encrypted",
        "encryptionMode",
        "performanceMode",
        "throughputMode",
        "preventDestroy",
      ],
    },
    uiHints: (
      [
        [
          "fileSystemType",
          "Storage placement",
          "Regional storage omits a One Zone Availability Zone; mount targets are separate resources.",
        ],
        [
          "encrypted",
          "Encryption at rest",
          "Encryption is required at creation. Changing encryption requires a replacement file system.",
        ],
        [
          "encryptionMode",
          "Encryption key",
          "Use the default EFS AWS-managed key. Customer-managed keys and key-user grants are outside this candidate.",
        ],
        [
          "performanceMode",
          "Performance mode",
          "General Purpose is fixed in this candidate. Performance mode cannot be changed after creation.",
        ],
        [
          "throughputMode",
          "Throughput mode",
          "Bursting is fixed; no provisioned-throughput capacity or throughput guarantee is inferred.",
        ],
        [
          "preventDestroy",
          "Retain file system",
          "Future renderers must retain CloudFormation resources and prevent Terraform destruction while configuration remains. Retention is not backup.",
        ],
      ] as const
    ).map(([property, label, helpText], order) => ({
      property,
      label,
      helpText,
      control:
        property === "encrypted" || property === "preventDestroy"
          ? "checkbox"
          : "select",
      order,
      advanced: false,
      valueSource: "literal",
      securityImpact: [
        "encrypted",
        "encryptionMode",
        "preventDestroy",
      ].includes(property)
        ? "security-sensitive"
        : "none",
      costImpact: "cost-sensitive",
    })),
  },
  ports: [],
  validationRuleIds: [],
  education: {
    summary:
      "Prepared source only; an encrypted file system does not establish working NFS access.",
    guidedExplanation:
      "This candidate defines an empty regional file system encrypted with the default EFS key. It is not available in the editor or export targets. Mount targets, a reviewed network path and guest setup are required before a workload can use EFS.",
    professionalExplanation:
      "The proposed AWS::EFS::FileSystem and aws_efs_file_system metadata fixes Encrypted=true, General Purpose and Bursting. Regional placement omits AvailabilityZoneName/availability_zone_name, and AWS-managed encryption omits KmsKeyId/kms_key_id. No renderer, native mount target, NFS authorization or application generation is installed.",
    considerations: [
      "Connections: Mount targets, security groups, TCP/2049 access and workload mounting need their own reviewed graph contracts; this candidate exposes no connectable port.",
      "Cost: EFS storage, throughput and externally managed backup or retained resources may incur charges. Preparing source creates no AWS resource or platform fixed cost.",
      "Operations: General Purpose and encryption are creation-time choices. Retention does not provide restore capability; backups and lifecycle policies remain external.",
      "Security: At-rest encryption does not establish client identity, TLS, POSIX isolation or NFS authorization. Raw policies, keys, credentials and guest commands are not accepted.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.efs.documentation.file-system",
        title: "CloudFormation EFS file-system resource",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-efs-filesystem.html",
      },
      {
        kind: "official",
        id: "aws.efs.documentation.encryption",
        title: "EFS encryption at rest",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/efs/latest/ug/encryption-at-rest.html",
      },
      {
        kind: "official",
        id: "aws.efs.documentation.terraform",
        title: "AWS provider EFS file-system metadata, version 6.55.0",
        publisher: "HashiCorp",
        url: "https://github.com/hashicorp/terraform-provider-aws/blob/v6.55.0/website/docs/r/efs_file_system.html.markdown",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.efs.unsupported.activation",
      title: "Installed catalog and export support",
      explanation:
        "This proof is deliberately uninstalled. Compatibility for existing 0.30 projects, reviewed renderers, icon registration, readiness validation and deterministic goldens must precede activation or counting EFS as supported.",
    },
    {
      id: "aws.efs.unsupported.mounting",
      title: "Mount targets, access points and workload access",
      explanation:
        "NFS mount targets, security-group rules, access points, file-system policies, TLS/IAM/POSIX access and guest mounting or application behavior are not modeled or inferred.",
    },
    {
      id: "aws.efs.unsupported.advanced",
      title: "Other storage modes and lifecycle operations",
      explanation:
        "One Zone, Max I/O, Elastic or Provisioned throughput, customer-managed keys, lifecycle transitions, backup policy, replication, import/adoption and destructive cleanup remain outside this candidate.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.efs.file-system.terraform",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_efs_file_system",
      configurationBindings: [
        { configurationKey: "encrypted", targetName: "encrypted" },
        { configurationKey: "performanceMode", targetName: "performance_mode" },
        { configurationKey: "throughputMode", targetName: "throughput_mode" },
      ],
      semanticConfigurationKeys: [
        "fileSystemType",
        "encryptionMode",
        "preventDestroy",
      ],
      portBindings: [],
    },
    {
      mappingId: "aws.efs.file-system.cloudformation",
      declarationVersion: 1,
      implementationStatus: "metadata-only",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::EFS::FileSystem",
      configurationBindings: [
        { configurationKey: "encrypted", targetName: "Encrypted" },
        { configurationKey: "performanceMode", targetName: "PerformanceMode" },
        { configurationKey: "throughputMode", targetName: "ThroughputMode" },
      ],
      semanticConfigurationKeys: [
        "fileSystemType",
        "encryptionMode",
        "preventDestroy",
      ],
      portBindings: [],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed version-bound EFS regional inventory is installed; source preparation is not availability evidence.",
  },
});
