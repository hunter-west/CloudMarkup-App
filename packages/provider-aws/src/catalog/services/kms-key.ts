import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

export const kmsReadinessRuleId =
  "aws.cloudmarkup.validation.kms-key-readiness";
export const kmsDocumentation = [
  {
    kind: "official" as const,
    id: "aws.kms.documentation.key",
    title: "AWS KMS key resource and policy requirements",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-kms-key.html",
  },
];

const properties: ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"] =
  {
    description: {
      type: "string",
      maxLength: 8192,
      default: "Application encryption key",
    },
    keySpec: {
      type: "string",
      enum: ["SYMMETRIC_DEFAULT"],
      default: "SYMMETRIC_DEFAULT",
    },
    keyUsage: {
      type: "string",
      enum: ["ENCRYPT_DECRYPT"],
      default: "ENCRYPT_DECRYPT",
    },
    origin: { type: "string", enum: ["AWS_KMS"], default: "AWS_KMS" },
    multiRegion: { type: "boolean", const: false, default: false },
    enabled: { type: "boolean", default: true },
    rotationEnabled: { type: "boolean", default: true },
    rotationPeriodDays: {
      type: "integer",
      minimum: 90,
      maximum: 2560,
      default: 365,
    },
    deletionWindowDays: {
      type: "integer",
      minimum: 7,
      maximum: 30,
      default: 30,
    },
    preventDestroy: { type: "boolean", const: true, default: true },
  };
const labels: Record<string, string> = {
  description: "Key purpose",
  keySpec: "Key type",
  keyUsage: "Key usage",
  origin: "Key material",
  multiRegion: "Multi-Region key",
  enabled: "Enable key",
  rotationEnabled: "Rotate key material",
  rotationPeriodDays: "Rotation period (days)",
  deletionWindowDays: "Deletion waiting period (days)",
  preventDestroy: "Retain key on removal",
};
const help: Record<string, string> = {
  description: "Describe the purpose without secrets or customer data.",
  keySpec:
    "This variant supports symmetric encryption only. Key type changes require a separately reviewed resource.",
  keyUsage: "The supported encryption/decryption usage is fixed.",
  origin:
    "AWS generates the regional key material; no key bytes or credentials enter the graph.",
  multiRegion:
    "Multi-Region primary keys and replicas are outside this variant.",
  enabled:
    "Disabling the key prevents cryptographic use. Review every dependent workload before changing it.",
  rotationEnabled:
    "Automatic rotation retains old material so existing ciphertext remains decryptable.",
  rotationPeriodDays:
    "90–2,560 days. Export applies this period only while rotation is enabled.",
  deletionWindowDays:
    "7–30 days if deletion is separately authorized. Retention does not schedule deletion.",
  preventDestroy:
    "Terraform prevents destruction while this resource remains in configuration; CloudFormation retains it on removal and replacement. Review lifecycle changes outside this variant.",
};
const targetNames: Record<string, [string, string]> = {
  description: ["description", "Description"],
  keySpec: ["customer_master_key_spec", "KeySpec"],
  keyUsage: ["key_usage", "KeyUsage"],
  multiRegion: ["multi_region", "MultiRegion"],
  enabled: ["is_enabled", "Enabled"],
  rotationEnabled: ["enable_key_rotation", "EnableKeyRotation"],
  rotationPeriodDays: ["rotation_period_in_days", "RotationPeriodInDays"],
  deletionWindowDays: ["deletion_window_in_days", "PendingWindowInDays"],
};

export const kmsKey = defineProviderServiceV1({
  id: "aws.kms.key",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "KMS symmetric encryption key",
  description:
    "A regional AWS-generated symmetric encryption key with explicit reviewed administration and retained lifecycle.",
  nodeKind: { kind: "resource", resourceType: "aws.kms.key", deployable: true },
  iconId: "aws.cloudmarkup.icons.kms-key",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.kms.key.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.kms.key.configuration:1.0.0",
      type: "object",
      title: "Regional symmetric KMS key",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
    uiHints: Object.keys(properties).map((property, order) => ({
      property,
      label: labels[property] ?? property,
      helpText: help[property] ?? "Review before export.",
      order,
      control:
        properties[property]?.type === "boolean"
          ? "checkbox"
          : properties[property]?.type === "integer"
            ? "number"
            : property === "description"
              ? "text"
              : "select",
      advanced: [
        "keySpec",
        "keyUsage",
        "origin",
        "multiRegion",
        "deletionWindowDays",
      ].includes(property),
      valueSource: "literal",
      securityImpact:
        property === "description" ? "none" : "security-sensitive",
      costImpact: [
        "rotationEnabled",
        "rotationPeriodDays",
        "preventDestroy",
      ].includes(property)
        ? "cost-sensitive"
        : "none",
    })),
  },
  ports: [
    {
      id: "aws.kms.key.resource-policy",
      displayName: "Key policy",
      description:
        "One explicit user-owned key policy; no default principal or implicit grant.",
      direction: "input",
      capability: "aws.kms.key.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
    {
      id: "aws.kms.key.policy-resource",
      displayName: "Key scope",
      description:
        "Exact owning-key reference for reviewed key-policy statements.",
      direction: "input",
      capability: "aws.iam.policy.kms-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    kmsReadinessRuleId,
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Protect encryption keys with explicit policy review, rotation and retention.",
    guidedExplanation:
      "A key protects encrypted data. Add a key policy with an explicit administrator before export; ordinary key users do not receive administration. Retaining a key avoids accidental loss of access to ciphertext, but retains its costs.",
    professionalExplanation:
      "This variant fixes SYMMETRIC_DEFAULT, ENCRYPT_DECRYPT, AWS_KMS and single-Region semantics. One canonical user-owned resource policy renders inline on the key. Its exact self-scope becomes the KMS owner-local Resource asterisk; wildcard configuration remains forbidden. The deployment caller must retain PutKeyPolicy authority and provider lockout checks remain enabled.",
    considerations: [
      "Connections: Use an explicit key policy and exact policy scope. Reviewed Secrets Manager metadata, EC2 inline root and standalone EBS encryption require their explicit typed associations; no workload access is inferred.",
      "Cost: Keys, cryptographic operations and retained key material can incur charges; this export does not create resources or estimate live cost.",
      "Operations: Terraform prevent_destroy is a configuration guard, while CloudFormation Retain survives stack removal. Immutable key-kind changes replace Terraform resources and fail CloudFormation updates.",
      "Security: Review administrator and key-user statements separately; no principal, account or access intent is inferred.",
    ],
    documentation: kmsDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.kms.key.unsupported.other-key-types",
      title: "Other key types and stores",
      explanation:
        "Asymmetric, HMAC, imported material, custom/external stores and multi-Region keys or replicas require separate variants.",
    },
    {
      id: "aws.kms.key.unsupported.integrations",
      title: "Aliases, grants and other service encryption",
      explanation:
        "Only reviewed explicit Secrets Manager metadata, EC2 inline root and standalone EBS encryption associations are supported. Aliases, grants, cross-account access, service principals and other integrations require separate contracts; export cannot establish live caller authority or effective permissions.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.kms.key.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_kms_key",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.kms-key-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: Object.entries(targetNames).map(
        ([configurationKey, names]) => ({
          configurationKey,
          targetName: names[0],
        }),
      ),
      semanticConfigurationKeys: ["origin", "preventDestroy"],
      portBindings: [
        { portId: "aws.kms.key.resource-policy", targetAttribute: "policy" },
        { portId: "aws.kms.key.policy-resource", targetAttribute: "arn" },
      ],
    },
    {
      mappingId: "aws.kms.key.cloudformation",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::KMS::Key",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.kms-key-cloudformation",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        ...Object.entries(targetNames).map(([configurationKey, names]) => ({
          configurationKey,
          targetName: names[1],
        })),
        { configurationKey: "origin", targetName: "Origin" },
      ],
      semanticConfigurationKeys: ["preventDestroy"],
      portBindings: [
        { portId: "aws.kms.key.resource-policy", targetAttribute: "KeyPolicy" },
        { portId: "aws.kms.key.policy-resource", targetAttribute: "Arn" },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed version-bound regional KMS inventory is installed; export does not prove regional availability.",
  },
});

/** Add KMS semantics only in the successor; immutable historical definitions remain fixed. */
export function extendServiceForKms(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  if (
    service.id !== "aws.iam.policy-document" &&
    service.id !== "aws.iam.policy-statement"
  )
    return service;
  const document = service.id === "aws.iam.policy-document";
  return defineProviderServiceV1({
    ...service,
    definitionVersion: document ? "1.4.0" : "2.3.0",
    placement: document
      ? {
          ...service.placement,
          allowedParentTypes: [
            ...service.placement.allowedParentTypes,
            {
              serviceId: "aws.kms.key",
              relationshipType: "aws.kms.key-owns-resource-policy",
            },
          ],
        }
      : service.placement,
    ports: [
      ...service.ports,
      {
        id: document
          ? "aws.iam.policy-document.kms-key-resource-policy"
          : "aws.iam.policy-statement.kms-resource",
        displayName: document ? "KMS key policy" : "KMS key scope",
        description:
          "Explicit policy ownership or exact graph scope for the reviewed regional KMS key.",
        direction: "output",
        capability: document
          ? "aws.kms.key.resource-policy"
          : "aws.iam.policy.kms-resource",
        category: "network-and-security",
        cardinality: "one",
        required: false,
      },
    ],
    validationRuleIds: [...service.validationRuleIds, kmsReadinessRuleId],
  });
}
