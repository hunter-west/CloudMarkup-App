import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/**
 * A graph-backed IAM role configuration. This concept is edited through the
 * role configuration surface and is never offered as an independent service.
 */
export const iamManagedPolicyAttachment0_8_0 = defineProviderServiceV1({
  id: "aws.iam.managed-policy-attachment",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "IAM managed policy attachment",
  description:
    "A typed reference to a managed policy attached to an IAM identity or used as its permissions boundary.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.iam.managed-policy-attachment",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.iam.role",
        relationshipType: "aws.iam.role-owns-managed-policy-attachment",
      },
      {
        serviceId: "aws.iam.role",
        relationshipType: "aws.iam.role-owns-permissions-boundary",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "not-applicable",
  },
  configuration: {
    schemaId: "aws.iam.managed-policy-attachment.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.iam.managed-policy-attachment.configuration:1.0.0",
      type: "object",
      title: "Managed policy attachment configuration",
      description:
        "A stable display name, attachment kind, and deliberate managed-policy reference. Raw account identifiers and secrets are not accepted.",
      additionalProperties: false,
      properties: {
        displayName: {
          type: "string",
          minLength: 1,
          maxLength: 128,
        },
        attachmentKind: {
          type: "string",
          enum: ["managed-policy-attachment", "permissions-boundary"],
        },
        managedPolicyReference: {
          type: "string",
          minLength: 5,
          maxLength: 512,
          pattern: "^(aws-managed|approved-variable):[A-Za-z0-9_./${}-]+$",
        },
      },
      required: ["displayName", "attachmentKind", "managedPolicyReference"],
    },
    uiHints: [
      {
        property: "displayName",
        control: "text",
        label: "Display name",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "attachmentKind",
        control: "select",
        label: "Attachment kind",
        helpText:
          "A permissions boundary limits maximum permissions; a managed policy attachment grants the policy's permissions.",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "managedPolicyReference",
        control: "text",
        label: "Managed policy reference",
        helpText:
          "Choose a reviewed AWS-managed policy name or approved variable. Pasted account-specific ARNs are not accepted.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.iam.managed-policy-attachment.role-managed-policy",
      displayName: "Role managed policy",
      description: "Attaches this managed policy reference to one role.",
      direction: "output",
      capability: "aws.iam.policy.managed-attachment",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.managed-policy-attachment.role-permissions-boundary",
      displayName: "Role permissions boundary",
      description: "Limits one role with this managed policy reference.",
      direction: "output",
      capability: "aws.iam.policy.permissions-boundary",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.iam-policy-safety",
  ],
  education: {
    summary:
      "References a reviewed managed policy as a role attachment or permissions boundary.",
    guidedExplanation:
      "A managed-policy attachment grants every permission in the referenced policy. A permissions boundary uses a managed policy differently: it limits the maximum permissions the role may receive but grants nothing by itself.",
    professionalExplanation:
      "This nondeployable graph concept preserves a reviewed AWS-managed or approved-variable reference, attachment kind, role-slot cardinality, ownership, and lifecycle provenance without accepting pasted account-specific ARNs.",
    considerations: [
      "Connections: Attach the reference to exactly one role slot and keep managed-policy grants separate from the optional boundary.",
      "Security: Review the complete referenced policy and its future updates; a broad managed policy may exceed the workload's needs.",
      "Cost: Attached permissions may authorize billable provider operations; this catalog does not estimate those downstream charges.",
      "Operations: Use only reviewed references; Terraform supports this bounded shape while CloudFormation rendering remains pending.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.permissions-boundaries",
        title: "Permissions boundaries for IAM entities",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.iam.managed-policy-attachment.unsupported.customer-policy-creation",
      title: "Customer-managed policy creation pending",
      explanation:
        "This milestone models reviewed references only; it does not create or render a standalone customer-managed policy.",
    },
    {
      id: "aws.iam.managed-policy-attachment.unsupported.cloudformation-rendering",
      title: "CloudFormation rendering pending",
      explanation:
        "Terraform renders reviewed references; CloudFormation export remains outside this milestone.",
    },
  ],
  mappings: [],
  regionAvailability: {
    state: "unknown",
    reason:
      "IAM managed-policy attachments have global semantics and no reviewed regional availability behavior.",
  },
});

export const iamManagedPolicyAttachment = defineProviderServiceV1({
  ...iamManagedPolicyAttachment0_8_0,
  education: {
    ...iamManagedPolicyAttachment0_8_0.education,
    considerations: [
      ...iamManagedPolicyAttachment0_8_0.education.considerations.slice(0, 3),
      "Operations: Use only reviewed references; Terraform and CloudFormation render the supported role attachments and optional permissions boundary.",
    ],
  },
  unsupportedCapabilities:
    iamManagedPolicyAttachment0_8_0.unsupportedCapabilities.filter(
      (entry) =>
        entry.id !==
        "aws.iam.managed-policy-attachment.unsupported.cloudformation-rendering",
    ),
  definitionVersion: "1.1.0",
  validationRuleIds: [
    ...iamManagedPolicyAttachment0_8_0.validationRuleIds,
    "aws.cloudmarkup.validation.lambda-vpc-access",
  ],
});
