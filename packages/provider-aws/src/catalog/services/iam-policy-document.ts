import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/**
 * A graph-backed owned configuration. It is never offered as an independent
 * AWS service card and renders only through its exact owning resource slot.
 */
export const iamPolicyDocument0_8_0 = defineProviderServiceV1({
  id: "aws.iam.policy-document",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "IAM policy document",
  description:
    "A typed, service-owned IAM policy containing one or more canonical statements.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.iam.policy-document",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.iam.role",
        relationshipType: "aws.iam.role-owns-trust-policy",
      },
      {
        serviceId: "aws.iam.role",
        relationshipType: "aws.iam.role-owns-inline-policy",
      },
      {
        serviceId: "aws.iam.role",
        relationshipType: "aws.iam.role-owns-generated-permission",
      },
      {
        serviceId: "aws.lambda.function",
        relationshipType: "aws.lambda.owns-invocation-permission",
      },
    ],
    maximumDepth: 2,
    regionConstraint: "not-applicable",
  },
  configuration: {
    schemaId: "aws.iam.policy-document.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.iam.policy-document.configuration:1.0.0",
      type: "object",
      title: "IAM policy document configuration",
      description:
        "The stable name and precise policy kind for a graph-backed policy attachment.",
      additionalProperties: false,
      properties: {
        policyName: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9+=,.@_-]+$",
        },
        policyKind: {
          type: "string",
          enum: [
            "identity-inline",
            "trust",
            "resource",
            "generated-permission",
            "service-grant",
          ],
        },
      },
      required: ["policyName", "policyKind"],
    },
    uiHints: [
      {
        property: "policyName",
        control: "text",
        label: "Policy name",
        helpText:
          "Use a stable purpose-based name; account identifiers and secrets do not belong here.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "policyKind",
        control: "select",
        label: "Policy kind",
        helpText:
          "The owner slot constrains which policy kinds are valid; this is not an IAM statement effect.",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.iam.policy-document.role-trust-policy",
      displayName: "Role trust policy",
      description: "Owns the role's one trust policy.",
      direction: "output",
      capability: "aws.iam.policy.trust",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.role-inline-policy",
      displayName: "Role inline policy",
      description: "Owns one custom inline identity policy on a role.",
      direction: "output",
      capability: "aws.iam.policy.identity-inline",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.role-generated-permission",
      displayName: "Generated role permission",
      description: "Owns one connection-generated identity policy on a role.",
      direction: "output",
      capability: "aws.iam.policy.generated-permission",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.lambda-service-grant",
      displayName: "Lambda service grant",
      description: "Owns one typed Lambda invocation permission.",
      direction: "output",
      capability: "aws.lambda.invocation.permission",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.statement",
      displayName: "Policy statement",
      description: "Accepts one or more canonical policy statements.",
      direction: "input",
      capability: "aws.iam.policy.statement-member",
      category: "network-and-security",
      cardinality: "many",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.iam-policy-safety",
  ],
  education: {
    summary:
      "Groups related trust or permission statements under one typed owner slot.",
    guidedExplanation:
      "A policy document gives related statements one purpose and owner. Trust, user-authored permissions, generated permissions, and Lambda service grants remain separate so connection cleanup cannot silently remove policy you own.",
    professionalExplanation:
      "This nondeployable graph concept owns canonical statements and one exact role or Lambda slot. Policy kind, ownership, and lifecycle provenance constrain valid principals and cleanup; Terraform renders the document only through its owning resource.",
    considerations: [
      "Connections: Attach the document to one exact owner slot and add statements only through typed membership relationships.",
      "Security: Keep one purpose per document and resolve wildcard, principal, action, resource, and condition findings before export.",
      "Cost: The catalog does not price policies or the downstream provider operations their permissions may authorize.",
      "Operations: Generated and user-owned documents have different cleanup authority; adoption is required before generated customization.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.policy-elements",
        title: "IAM JSON policy elements reference",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.iam.policy-document.unsupported.cloudformation-rendering",
      title: "CloudFormation policy rendering pending",
      explanation:
        "CloudFormation rendering remains outside this milestone and is planned for Prompt 46.",
    },
  ],
  mappings: [],
  regionAvailability: {
    state: "unknown",
    reason:
      "IAM policy documents have global semantics and no reviewed regional availability dataset is required for this modeling concept.",
  },
});

export const iamPolicyDocument0_10_0 = defineProviderServiceV1({
  ...iamPolicyDocument0_8_0,
  definitionVersion: "1.1.0",
  placement: {
    ...iamPolicyDocument0_8_0.placement,
    allowedParentTypes: [
      ...iamPolicyDocument0_8_0.placement.allowedParentTypes,
      {
        serviceId: "aws.ec2.gateway-vpc-endpoint",
        relationshipType: "aws.ec2.gateway-endpoint-owns-policy",
      },
    ],
  },
  ports: [
    ...iamPolicyDocument0_8_0.ports,
    {
      id: "aws.iam.policy-document.gateway-endpoint-resource-policy",
      displayName: "Gateway endpoint policy",
      description:
        "Owns one reviewed resource policy for an S3 or DynamoDB gateway VPC endpoint.",
      direction: "output",
      capability: "aws.ec2.gateway-endpoint.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [
    ...iamPolicyDocument0_8_0.validationRuleIds,
    "aws.cloudmarkup.validation.network-routing",
  ],
  education: {
    summary:
      "Groups related trust, permission, service-grant, or endpoint-policy statements under one typed owner slot.",
    guidedExplanation:
      "A policy document gives related statements one purpose and owner. Trust, user-authored permissions, generated permissions, Lambda service grants, and gateway endpoint policies stay separate so cleanup cannot silently remove policy you own.",
    professionalExplanation:
      "This nondeployable graph concept owns canonical statements and one exact IAM role, Lambda, or gateway-endpoint slot. Policy kind, ownership, lifecycle provenance, principals, and resource scope remain canonical graph facts; endpoint-policy rendering is pending.",
    considerations: [
      "Connections: Attach the document to one exact owner slot and add statements only through typed membership relationships.",
      "Security: Keep one purpose per document and resolve wildcard, principal, action, resource, and condition findings before export.",
      "Cost: The catalog does not price policies or the downstream provider operations their permissions may authorize.",
      "Operations: Generated and user-owned documents have different cleanup authority; adoption is required before generated customization.",
    ],
    documentation: [
      ...iamPolicyDocument0_8_0.education.documentation,
      {
        kind: "official",
        id: "aws.vpc.documentation.gateway-endpoint-policy",
        title: "Endpoint policies for gateway endpoints",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html",
      },
    ],
  },
  unsupportedCapabilities: [
    ...iamPolicyDocument0_8_0.unsupportedCapabilities,
    {
      id: "aws.iam.policy-document.unsupported.endpoint-policy-rendering",
      title: "Gateway endpoint policy rendering pending",
      explanation:
        "The canonical policy can be reviewed and validated, but neither Terraform nor CloudFormation currently renders it for a gateway endpoint.",
    },
  ],
});

export const iamPolicyDocument = defineProviderServiceV1({
  ...iamPolicyDocument0_10_0,
  definitionVersion: "1.2.0",
  placement: {
    ...iamPolicyDocument0_10_0.placement,
    allowedParentTypes: [
      ...iamPolicyDocument0_10_0.placement.allowedParentTypes,
      {
        serviceId: "aws.s3.bucket",
        relationshipType: "aws.s3.bucket-owns-resource-policy",
      },
      {
        serviceId: "aws.sqs.queue",
        relationshipType: "aws.sqs.queue-owns-resource-policy",
      },
      {
        serviceId: "aws.sns.topic",
        relationshipType: "aws.sns.topic-owns-resource-policy",
      },
      {
        serviceId: "aws.eventbridge.event-bus",
        relationshipType: "aws.eventbridge.event-bus-owns-resource-policy",
      },
    ],
  },
  ports: [
    ...iamPolicyDocument0_10_0.ports,
    {
      id: "aws.iam.policy-document.s3-bucket-resource-policy",
      displayName: "S3 bucket policy",
      description: "Owns one reviewed resource policy for an S3 bucket.",
      direction: "output",
      capability: "aws.s3.bucket.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.sqs-queue-resource-policy",
      displayName: "SQS queue policy",
      description: "Owns one reviewed resource policy for an SQS queue.",
      direction: "output",
      capability: "aws.sqs.queue.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.sns-topic-resource-policy",
      displayName: "SNS topic policy",
      description: "Owns one reviewed resource policy for an SNS topic.",
      direction: "output",
      capability: "aws.sns.topic.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.iam.policy-document.event-bus-resource-policy",
      displayName: "EventBridge bus policy",
      description:
        "Owns one reviewed resource policy for an EventBridge event bus.",
      direction: "output",
      capability: "aws.eventbridge.event-bus.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
  ],
  validationRuleIds: [
    ...iamPolicyDocument0_10_0.validationRuleIds,
    "aws.cloudmarkup.validation.event-delivery",
  ],
  education: {
    ...iamPolicyDocument0_10_0.education,
    summary:
      "Groups related trust, permission, service-grant, endpoint, or event-resource statements under one typed owner slot.",
    guidedExplanation:
      "A policy document gives related statements one purpose and exact owner. Event bucket, queue, topic, and bus resource policies stay separate from execution-role permissions and Lambda invocation grants so review and cleanup remain understandable.",
    professionalExplanation:
      "This nondeployable canonical graph concept owns typed statements through one exact IAM role, Lambda, gateway endpoint, S3, SQS, SNS, EventBridge, or KMS slot. Terraform and CloudFormation render the reviewed owner-specific policy forms. Principals, scopes, conditions, ownership, and lifecycle provenance remain explicit and must satisfy each owner's bounded contract.",
    considerations: [
      "Connections: Attach the document to one exact owner slot and add statements and conditions through typed relationships.",
      "Security: Resource policies require exact principals, actions, resources, and SourceArn/SourceAccount conditions where applicable; wildcard findings fail closed.",
      "Cost: Policies have no direct charge but can authorize billable publish, delivery, storage, and invocation operations.",
      "Operations: Generated and user-owned documents have separate cleanup authority; adopt before customizing generated policy.",
    ],
  },
  unsupportedCapabilities: [
    ...iamPolicyDocument0_10_0.unsupportedCapabilities.filter(
      (entry) =>
        ![
          "aws.iam.policy-document.unsupported.cloudformation-rendering",
          "aws.iam.policy-document.unsupported.endpoint-policy-rendering",
        ].includes(entry.id),
    ),
    {
      id: "aws.iam.policy-document.unsupported.raw-policy-language",
      title: "Raw IAM policy language",
      explanation:
        "Policy documents use typed statements and conditions. Arbitrary policy JSON, NotAction, NotResource, and NotPrincipal are not exposed by the structured editor.",
    },
  ],
});

/** Absolute graph depth includes Region, VPC and endpoint owner ancestry.
 * Historical service objects above remain byte-reproducible. */
export const iamPolicyDocument0_16_0 = defineProviderServiceV1({
  ...iamPolicyDocument,
  definitionVersion: "1.3.0",
  placement: { ...iamPolicyDocument.placement, maximumDepth: 4 },
});
