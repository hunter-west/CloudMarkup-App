import {
  defineProviderServiceV1,
  type ProviderServiceDefinitionV1,
  type ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

export const secretReadinessRuleId =
  "aws.cloudmarkup.validation.secret-readiness";
export const secretDocumentation = [
  {
    kind: "official" as const,
    id: "aws.secretsmanager.documentation.secret",
    title: "Secrets Manager metadata, encryption and lifecycle",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html",
  },
  {
    kind: "official" as const,
    id: "aws.secretsmanager.documentation.encryption",
    title: "Secrets Manager encryption permissions",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html",
  },
];
const properties: ProviderServiceDefinitionV1Input["configuration"]["jsonSchema"]["properties"] =
  {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      pattern: "^[A-Za-z0-9/_+=.@-]+$",
    },
    description: {
      type: "string",
      maxLength: 2048,
      default: "Externally populated application secret",
    },
    encryptionMode: {
      type: "string",
      enum: ["aws-managed", "customer-managed"],
      default: "aws-managed",
    },
    valueMode: {
      type: "string",
      enum: ["external-population"],
      default: "external-population",
    },
    recoveryWindowDays: {
      type: "integer",
      minimum: 7,
      maximum: 30,
      default: 30,
    },
    preventDestroy: { type: "boolean", const: true, default: true },
  };
const fields = [
  [
    "name",
    "Secret name",
    "Use a non-secret name. Changing it replaces the resource. Names ending in a hyphen and six characters are rejected to avoid partial-ARN ambiguity.",
    "text",
  ],
  [
    "description",
    "Purpose",
    "Describe its purpose without including credentials or secret contents.",
    "text",
  ],
  [
    "encryptionMode",
    "Encryption key",
    "AWS-managed uses aws/secretsmanager. Customer-managed requires one explicit enabled regional KMS key connection and separately reviewed key-user permissions.",
    "select",
  ],
  [
    "valueMode",
    "Value source",
    "Export creates an empty secret. Populate it externally through an approved secret-management process before an application retrieves it. This editor never accepts secret values.",
    "select",
  ],
  [
    "recoveryWindowDays",
    "Recovery window (days)",
    "7-30 days if deletion is separately authorized in Terraform. CloudFormation retains the secret; this setting does not schedule deletion.",
    "number",
  ],
  [
    "preventDestroy",
    "Retain secret",
    "Terraform prevents destruction while this resource remains in configuration. CloudFormation retains it on removal and replacement; retained resources may incur charges.",
    "checkbox",
  ],
] as const;
export const secretsManagerSecret = defineProviderServiceV1({
  id: "aws.secretsmanager.secret",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "Secrets Manager secret",
  description:
    "Regional retained secret metadata with external value population and explicit encryption/access intent.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.secretsmanager.secret",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.secretsmanager-secret",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.secretsmanager.secret.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.secretsmanager.secret.configuration:1.0.0",
      type: "object",
      title: "Regional secret metadata",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
    uiHints: fields.map(([property, label, helpText, control], order) => ({
      property,
      label,
      helpText,
      control,
      order,
      advanced: property === "recoveryWindowDays",
      valueSource: "literal",
      securityImpact: [
        "encryptionMode",
        "valueMode",
        "preventDestroy",
        "recoveryWindowDays",
      ].includes(property)
        ? "security-sensitive"
        : "none",
      costImpact: ["encryptionMode", "preventDestroy"].includes(property)
        ? "cost-sensitive"
        : "none",
    })),
  },
  ports: [
    {
      id: "aws.secretsmanager.secret.encryption-key",
      displayName: "Encryption key",
      description:
        "One explicit enabled regional symmetric key for customer-managed mode.",
      direction: "input",
      capability: "aws.secretsmanager.secret.encryption-key",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.secretsmanager.secret.policy-resource",
      displayName: "Secret scope",
      description: "Exact ARN scope for explicit role identity-policy access.",
      direction: "input",
      capability: "aws.iam.policy.secret-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [
    secretReadinessRuleId,
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.region-availability",
  ],
  education: {
    summary:
      "Keep secret contents outside architecture while modeling explicit encryption and access.",
    guidedExplanation:
      "This resource creates the secret's name and encryption settings. It starts empty and must be populated externally before use. Choose an explicit key when needed, then scope read-value or read-metadata permissions in the role's policy.",
    professionalExplanation:
      "A retained regional metadata-only secret maps to aws_secretsmanager_secret and AWS::SecretsManager::Secret. No version/value/password, rotation, replication, dynamic reference or database attachment is emitted. Scoped IAM uses the target-generated full ARN including the AWS suffix. A KMS association does not grant key usage.",
    considerations: [
      "Security: GetSecretValue and DescribeSecret are distinct permissions. Customer-key users require separately reviewed key-policy authority; no principal or grant is inferred.",
      "Operations: Populate and rotate values externally. An empty secret is not working database credentials or a generated application retrieval integration.",
      "Connections: Key encryption and exact secret policy scope are explicit. Name changes replace the resource; retained old resources require deliberate external cleanup.",
      "Cost: Secret storage, API calls, retained resources and customer-managed keys may incur charges. Export never contacts AWS or proves name availability.",
    ],
    documentation: secretDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.secretsmanager.secret.unsupported.values",
      title: "Secret values and generated passwords",
      explanation:
        "Plaintext/binary values, versions and password generation are not stored or generated here; populate this empty secret externally. The reviewed Linux Fargate whole-secret environment binding uses an explicit AWS-managed-key secret reference and exact execution-role GetSecretValue permission. JSON-key/version selection, customer-key injection and other application retrieval require separate contracts.",
    },
    {
      id: "aws.secretsmanager.secret.unsupported.advanced",
      title: "Rotation, replicas and cross-account access",
      explanation:
        "Rotation schedules, resource policies, replicas, imported secrets, cross-account access and database target attachments are outside this variant.",
    },
  ],
  mappings: [
    {
      mappingId: "aws.secretsmanager.secret.terraform",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "terraform",
      kind: "resource",
      providerSource: "hashicorp/aws",
      resourceType: "aws_secretsmanager_secret",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.secret-terraform",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "name", targetName: "name" },
        { configurationKey: "description", targetName: "description" },
        {
          configurationKey: "recoveryWindowDays",
          targetName: "recovery_window_in_days",
        },
      ],
      semanticConfigurationKeys: [
        "encryptionMode",
        "valueMode",
        "preventDestroy",
      ],
      portBindings: [
        {
          portId: "aws.secretsmanager.secret.encryption-key",
          targetAttribute: "kms_key_id",
        },
        {
          portId: "aws.secretsmanager.secret.policy-resource",
          targetAttribute: "arn",
        },
      ],
    },
    {
      mappingId: "aws.secretsmanager.secret.cloudformation",
      declarationVersion: 1,
      implementationStatus: "implemented",
      target: "cloudformation",
      kind: "resource",
      typeName: "AWS::SecretsManager::Secret",
      projection: {
        kind: "relationship-resource",
        rendererContractId: "cloudmarkup.iac.secret-cloudformation",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      configurationBindings: [
        { configurationKey: "name", targetName: "Name" },
        { configurationKey: "description", targetName: "Description" },
      ],
      semanticConfigurationKeys: [
        "encryptionMode",
        "valueMode",
        "recoveryWindowDays",
        "preventDestroy",
      ],
      portBindings: [
        {
          portId: "aws.secretsmanager.secret.encryption-key",
          targetAttribute: "KmsKeyId",
        },
        {
          portId: "aws.secretsmanager.secret.policy-resource",
          targetAttribute: "Id",
        },
      ],
    },
  ],
  regionAvailability: {
    state: "unknown",
    reason:
      "No reviewed version-bound regional Secrets Manager inventory is installed; offline export does not prove regional availability.",
  },
});

/** Extend only the successor; historical KMS and policy definitions remain exact. */
export function extendServiceForSecrets(
  service: ProviderServiceDefinitionV1,
): ProviderServiceDefinitionV1 {
  const key = service.id === "aws.kms.key";
  if (!key && service.id !== "aws.iam.policy-statement") return service;
  return defineProviderServiceV1({
    ...service,
    definitionVersion: key ? "1.1.0" : "2.4.0",
    ports: [
      ...service.ports,
      {
        id: key
          ? "aws.kms.key.secret-encryption"
          : "aws.iam.policy-statement.secret-resource",
        displayName: key ? "Secret encryption" : "Secret scope",
        description:
          "Explicit regional encryption association or exact role identity-policy scope; no access intent is inferred.",
        direction: "output",
        capability: key
          ? "aws.secretsmanager.secret.encryption-key"
          : "aws.iam.policy.secret-resource",
        category: "network-and-security",
        cardinality: key ? "many" : "one",
        required: false,
      },
    ],
    validationRuleIds: [...service.validationRuleIds, secretReadinessRuleId],
    ...(key
      ? {
          unsupportedCapabilities: service.unsupportedCapabilities.map(
            (entry) =>
              entry.id === "aws.kms.key.unsupported.integrations"
                ? {
                    ...entry,
                    title: "Aliases, grants and other service encryption",
                    explanation:
                      "Only the explicit Secrets Manager metadata encryption association is supported. Aliases, grants, cross-account access, service principals and other service-encryption integrations remain outside this variant; export cannot establish live effective permissions.",
                  }
                : entry,
          ),
        }
      : {}),
  });
}
