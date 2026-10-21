import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

import {
  eventDrivenRegionAvailability,
  eventDrivenValidationRuleIds,
  eventMetadataMappings,
  internalEventConfiguration,
} from "./event-driven-helpers.js";

const officialDocumentation = [
  {
    kind: "official" as const,
    id: "aws.s3.documentation.event-notifications",
    title: "Amazon S3 event notifications",
    publisher: "Amazon Web Services",
    url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html",
  },
];

export const s3Bucket = defineProviderServiceV1({
  id: "aws.s3.bucket",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "S3 bucket",
  description:
    "A private versioned object bucket with bounded event notifications and explicit owned configuration.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.s3.bucket",
    deployable: true,
  },
  iconId: "aws.cloudmarkup.icons.s3",
  placement: {
    rootPlacement: "allowed",
    allowedParentTypes: [],
    regionConstraint: "same-region",
  },
  configuration: {
    schemaId: "aws.s3.bucket.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.s3.bucket.configuration:1.0.0",
      type: "object",
      title: "S3 bucket configuration",
      description:
        "Private object storage defaults without ACLs, public access, raw policies, or customer-managed keys.",
      additionalProperties: false,
      properties: {
        bucketName: {
          type: "string",
          default: "application-events",
          minLength: 3,
          maxLength: 63,
          pattern: "^[a-z0-9][a-z0-9.-]*[a-z0-9]$",
        },
        versioningEnabled: { type: "boolean", const: true, default: true },
        blockPublicAccess: { type: "boolean", const: true, default: true },
        objectOwnership: {
          type: "string",
          enum: ["BUCKET_OWNER_ENFORCED"],
          default: "BUCKET_OWNER_ENFORCED",
        },
        encryption: {
          type: "string",
          enum: ["SSE-S3"],
          default: "SSE-S3",
        },
        deletionProtectionEnabled: {
          type: "boolean",
          const: true,
          default: true,
        },
      },
      required: [
        "bucketName",
        "versioningEnabled",
        "blockPublicAccess",
        "objectOwnership",
        "encryption",
        "deletionProtectionEnabled",
      ],
    },
    uiHints: [
      {
        property: "bucketName",
        control: "text",
        label: "Bucket name",
        helpText:
          "Use a globally unique, non-sensitive name. The catalog default never contains tenant or customer data.",
        order: 0,
        advanced: false,
        valueSource: "literal",
        securityImpact: "none",
        costImpact: "none",
      },
      {
        property: "versioningEnabled",
        control: "checkbox",
        label: "Keep object versions",
        order: 1,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
      {
        property: "blockPublicAccess",
        control: "checkbox",
        label: "Block all public access",
        order: 2,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "objectOwnership",
        control: "select",
        label: "Object ownership",
        helpText: "ACLs are disabled; the bucket owner owns uploaded objects.",
        order: 3,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "encryption",
        control: "select",
        label: "Encryption",
        helpText:
          "This slice uses S3-managed encryption. Customer-managed KMS keys require separate key-policy support.",
        order: 4,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "deletionProtectionEnabled",
        control: "checkbox",
        label: "Protect from accidental deletion",
        order: 5,
        advanced: false,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "cost-sensitive",
      },
    ],
  },
  ports: [
    {
      id: "aws.s3.bucket.notifications",
      displayName: "Object notifications",
      description: "Emits reviewed object-created or object-removed events.",
      direction: "output",
      capability: "aws.s3.event.notification",
      category: "receives-events-from",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.s3.bucket.eventbridge",
      displayName: "EventBridge delivery",
      description:
        "Enables this bucket's service events on one same-Region EventBridge bus.",
      direction: "output",
      capability: "aws.s3.eventbridge.delivery",
      category: "sends-messages-or-events",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.s3.bucket.object-api",
      displayName: "Object API",
      description: "Accepts reviewed object read or write access.",
      direction: "input",
      capability: "aws.s3.object.read-write",
      category: "reads-or-writes-data",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.s3.bucket.policy-resource",
      displayName: "Policy resource",
      description: "Provides this bucket ARN to typed IAM policy statements.",
      direction: "input",
      capability: "aws.iam.policy.s3-resource",
      category: "network-and-security",
      cardinality: "many",
      required: false,
    },
    {
      id: "aws.s3.bucket.resource-policy",
      displayName: "Bucket policy",
      description: "Accepts one reviewed resource-policy document.",
      direction: "input",
      capability: "aws.s3.bucket.resource-policy",
      category: "network-and-security",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.s3.bucket.lifecycle-configuration",
      displayName: "Lifecycle configuration",
      description: "Accepts one bounded object lifecycle configuration.",
      direction: "input",
      capability: "aws.s3.bucket.lifecycle-configuration",
      category: "uses-secrets-or-configuration",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.s3.bucket.cors-configuration",
      displayName: "CORS configuration",
      description: "Accepts one bounded browser-origin policy.",
      direction: "input",
      capability: "aws.s3.bucket.cors-configuration",
      category: "uses-secrets-or-configuration",
      cardinality: "one",
      required: false,
    },
    {
      id: "aws.s3.bucket.notification-configuration",
      displayName: "Notification configuration",
      description: "Accepts reviewed owned notification settings.",
      direction: "input",
      capability: "aws.s3.bucket.notification-configuration",
      category: "uses-secrets-or-configuration",
      cardinality: "many",
      required: false,
    },
  ],
  validationRuleIds: [...eventDrivenValidationRuleIds],
  education: {
    summary:
      "Stores private versioned objects and emits bounded at-least-once object events.",
    guidedExplanation:
      "Use a bucket for objects, not messages. Public access stays blocked, encryption and versions stay on, and every notification names its event and optional key prefix or suffix. A function that writes back to its own trigger path can loop, so separate input and output prefixes or buckets.",
    professionalExplanation:
      "Models an ACL-disabled, BucketOwnerEnforced, SSE-S3, versioned bucket with prevent-destroy intent and graph-owned policy/lifecycle/CORS/notification slots. Direct S3 notifications are at-least-once and unordered; EventBridge delivery is a separate exact relationship.",
    considerations: [
      "Connections: Use exact event types and non-overlapping key filters; EventBridge is preferable when independent consumers should own separate rules.",
      "Security: Public access and ACLs remain disabled; bucket policies and workload access must scope exact actions and resources.",
      "Cost: Stored versions, requests, retrieval, transitions, replication, and event delivery can add charges; lifecycle choices need review.",
      "Operations: Consumers must tolerate duplicate or out-of-order notifications and avoid writing into their own unfiltered trigger path.",
    ],
    documentation: officialDocumentation,
  },
  unsupportedCapabilities: [
    {
      id: "aws.s3.unsupported.public-acl-website",
      title: "Public buckets, ACLs, and website hosting",
      explanation:
        "Public access, ACL ownership modes, static website hosting, access points, Object Lambda, requester pays, and transfer acceleration are rejected in this slice.",
    },
    {
      id: "aws.s3.unsupported.replication-object-lock-cmk",
      title: "Replication, Object Lock, and customer-managed keys",
      explanation:
        "Replication, Object Lock, inventory, analytics, Storage Lens, and customer-managed KMS keys require separate role, retention, and key-policy contracts.",
    },
    {
      id: "aws.s3.unsupported.fifo-notification",
      title: "Direct FIFO notification destinations",
      explanation:
        "Direct S3 notifications to FIFO SQS queues or FIFO SNS topics are not supported; use the curated EventBridge path when FIFO routing is required later.",
    },
  ],
  mappings: eventMetadataMappings({
    mappingIdPrefix: "aws.s3.bucket",
    terraformResourceType: "aws_s3_bucket",
    cloudFormationTypeName: "AWS::S3::Bucket",
    terraformConfigurationBindings: [
      { configurationKey: "bucketName", targetName: "bucket" },
      {
        configurationKey: "versioningEnabled",
        targetName: "versioning.status",
      },
      {
        configurationKey: "blockPublicAccess",
        targetName: "public_access_block.all",
      },
      {
        configurationKey: "objectOwnership",
        targetName: "ownership_controls.object_ownership",
      },
      {
        configurationKey: "encryption",
        targetName: "server_side_encryption.sse_algorithm",
      },
    ],
    cloudFormationConfigurationBindings: [
      { configurationKey: "bucketName", targetName: "BucketName" },
      {
        configurationKey: "versioningEnabled",
        targetName: "VersioningConfiguration.Status",
      },
      {
        configurationKey: "blockPublicAccess",
        targetName: "PublicAccessBlockConfiguration.BlockAll",
      },
      {
        configurationKey: "objectOwnership",
        targetName: "OwnershipControls.Rules.ObjectOwnership",
      },
      {
        configurationKey: "encryption",
        targetName: "BucketEncryption.ServerSideEncryptionConfiguration",
      },
    ],
    semanticConfigurationKeys: ["deletionProtectionEnabled"],
    terraformPortBindings: [
      { portId: "aws.s3.bucket.notifications", targetAttribute: "arn" },
      { portId: "aws.s3.bucket.eventbridge", targetAttribute: "arn" },
      { portId: "aws.s3.bucket.object-api", targetAttribute: "arn" },
      { portId: "aws.s3.bucket.policy-resource", targetAttribute: "arn" },
      { portId: "aws.s3.bucket.resource-policy", targetAttribute: "id" },
      {
        portId: "aws.s3.bucket.lifecycle-configuration",
        targetAttribute: "id",
      },
      { portId: "aws.s3.bucket.cors-configuration", targetAttribute: "id" },
      {
        portId: "aws.s3.bucket.notification-configuration",
        targetAttribute: "id",
      },
    ],
    cloudFormationPortBindings: [
      { portId: "aws.s3.bucket.notifications", targetAttribute: "Arn" },
      { portId: "aws.s3.bucket.eventbridge", targetAttribute: "Arn" },
      { portId: "aws.s3.bucket.object-api", targetAttribute: "Arn" },
      { portId: "aws.s3.bucket.policy-resource", targetAttribute: "Arn" },
      { portId: "aws.s3.bucket.resource-policy", targetAttribute: "Ref" },
      {
        portId: "aws.s3.bucket.lifecycle-configuration",
        targetAttribute: "Ref",
      },
      { portId: "aws.s3.bucket.cors-configuration", targetAttribute: "Ref" },
      {
        portId: "aws.s3.bucket.notification-configuration",
        targetAttribute: "Ref",
      },
    ],
    terraformProjection: {
      kind: "owned-resource",
      rendererContractId: "aws.s3.bucket.projection",
      rendererContractVersion: "1.0.0",
      generatedResourceTypes: [
        "aws_s3_bucket_ownership_controls",
        "aws_s3_bucket_public_access_block",
        "aws_s3_bucket_server_side_encryption_configuration",
        "aws_s3_bucket_versioning",
      ],
    },
  }),
  regionAvailability: eventDrivenRegionAvailability,
});

export const s3BucketLifecycleConfiguration = defineProviderServiceV1(
  internalEventConfiguration({
    serviceId: "aws.s3.bucket-lifecycle-configuration",
    resourceType: "aws.s3.bucket-lifecycle-configuration",
    displayName: "S3 lifecycle configuration",
    description:
      "One bounded lifecycle rule owned by an S3 bucket without raw rule JSON.",
    ownerServiceId: "aws.s3.bucket",
    ownerRelationshipType: "aws.s3.bucket-owns-lifecycle-configuration",
    configuration: {
      schemaId: "aws.s3.bucket-lifecycle-configuration.configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:aws.s3.bucket-lifecycle-configuration.configuration:1.0.0",
        type: "object",
        title: "S3 lifecycle rule",
        description:
          "A single whole-bucket expiration rule with an optional reviewed storage transition.",
        additionalProperties: false,
        properties: {
          ruleName: {
            type: "string",
            default: "retention",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          },
          expirationDays: {
            type: "integer",
            enum: [30, 90, 180, 365],
            default: 90,
          },
          transition: {
            type: "string",
            enum: ["NONE", "INTELLIGENT_TIERING_AFTER_30_DAYS"],
            default: "NONE",
          },
          expireNoncurrentVersions: {
            type: "boolean",
            default: true,
          },
        },
        required: [
          "ruleName",
          "expirationDays",
          "transition",
          "expireNoncurrentVersions",
        ],
      },
      uiHints: [
        {
          property: "ruleName",
          control: "text",
          label: "Rule name",
          order: 0,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
        {
          property: "expirationDays",
          control: "number",
          label: "Delete objects after",
          helpText: "Choose a reviewed retention period in days.",
          order: 1,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "transition",
          control: "select",
          label: "Storage transition",
          helpText:
            "Intelligent-Tiering can reduce storage cost for uncertain access patterns but has monitoring charges.",
          order: 2,
          advanced: false,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "cost-sensitive",
        },
        {
          property: "expireNoncurrentVersions",
          control: "checkbox",
          label: "Expire old versions",
          order: 3,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
      ],
    },
    ports: [
      {
        id: "aws.s3.bucket-lifecycle-configuration.bucket",
        displayName: "Owning bucket",
        description: "Provides this lifecycle rule to one S3 bucket.",
        direction: "output",
        capability: "aws.s3.bucket.lifecycle-configuration",
        category: "uses-secrets-or-configuration",
        cardinality: "one",
        required: true,
      },
    ],
    education: {
      summary: "Applies one understandable retention rule to a bucket.",
      guidedExplanation:
        "Choose how long objects and old versions should remain. Shorter retention lowers storage cost but can remove recovery history.",
      professionalExplanation:
        "Models one whole-bucket lifecycle rule with bounded expiration and optional Intelligent-Tiering transition. Prefix/tag filters, abort rules, Glacier classes, and multiple rule JSON remain unsupported.",
      considerations: [
        "Connections: This lifecycle configuration belongs to exactly one bucket and remains owned by it.",
        "Security: Retention is a data-governance choice; do not shorten it without reviewing recovery and policy requirements.",
        "Cost: Versions and retained objects add storage cost; Intelligent-Tiering adds monitoring charges.",
        "Operations: Test recovery before relying on lifecycle deletion and review noncurrent-version retention.",
      ],
      documentation: [
        {
          kind: "official",
          id: "aws.s3.documentation.lifecycle",
          title: "Managing the lifecycle of objects",
          publisher: "Amazon Web Services",
          url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html",
        },
      ],
    },
    unsupportedCapabilities: [
      {
        id: "aws.s3.lifecycle.unsupported.advanced-rules",
        title: "Advanced lifecycle rule language",
        explanation:
          "Tag/prefix combinations, object-size filters, multipart-upload cleanup, replication status, Glacier variants, and arbitrary lifecycle JSON are rejected.",
      },
    ],
    mappings: eventMetadataMappings({
      mappingIdPrefix: "aws.s3.bucket-lifecycle-configuration",
      terraformResourceType: "aws_s3_bucket_lifecycle_configuration",
      cloudFormationTypeName: "AWS::S3::Bucket",
      terraformConfigurationBindings: [
        { configurationKey: "ruleName", targetName: "rule.id" },
        {
          configurationKey: "expirationDays",
          targetName: "rule.expiration.days",
        },
        { configurationKey: "transition", targetName: "rule.transition" },
        {
          configurationKey: "expireNoncurrentVersions",
          targetName: "rule.noncurrent_version_expiration",
        },
      ],
      cloudFormationConfigurationBindings: [
        {
          configurationKey: "ruleName",
          targetName: "LifecycleConfiguration.Rules.Id",
        },
        {
          configurationKey: "expirationDays",
          targetName: "LifecycleConfiguration.Rules.ExpirationInDays",
        },
        {
          configurationKey: "transition",
          targetName: "LifecycleConfiguration.Rules.Transitions",
        },
        {
          configurationKey: "expireNoncurrentVersions",
          targetName:
            "LifecycleConfiguration.Rules.NoncurrentVersionExpiration",
        },
      ],
      terraformPortBindings: [
        {
          portId: "aws.s3.bucket-lifecycle-configuration.bucket",
          targetAttribute: "bucket",
        },
      ],
      cloudFormationPortBindings: [
        {
          portId: "aws.s3.bucket-lifecycle-configuration.bucket",
          targetAttribute: "BucketName",
        },
      ],
      terraformProjection: {
        kind: "owned-resource",
        rendererContractId: "aws.s3.bucket-lifecycle-configuration.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      cloudFormationProjection: {
        kind: "owner-nested-block",
        rendererContractId: "aws.s3.bucket.lifecycle-configuration.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    }),
  }),
);

export const s3BucketCorsConfiguration = defineProviderServiceV1(
  internalEventConfiguration({
    serviceId: "aws.s3.bucket-cors-configuration",
    resourceType: "aws.s3.bucket-cors-configuration",
    displayName: "S3 CORS configuration",
    description: "One bounded browser-origin policy owned by an S3 bucket.",
    ownerServiceId: "aws.s3.bucket",
    ownerRelationshipType: "aws.s3.bucket-owns-cors-configuration",
    configuration: {
      schemaId: "aws.s3.bucket-cors-configuration.configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:aws.s3.bucket-cors-configuration.configuration:1.0.0",
        type: "object",
        title: "S3 CORS rule",
        description:
          "One HTTPS-origin CORS rule with bounded methods and no credentials or wildcard origin default.",
        additionalProperties: false,
        properties: {
          allowedOrigins: {
            type: "array",
            items: { type: "string" },
            default: ["https://app.example.invalid"],
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
          },
          allowedMethods: {
            type: "array",
            items: { type: "string", enum: ["GET", "HEAD", "PUT", "POST"] },
            default: ["GET", "HEAD"],
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
          },
          allowedHeaders: {
            type: "array",
            items: {
              type: "string",
              enum: ["authorization", "content-type", "x-amz-date"],
            },
            default: ["content-type"],
            maxItems: 3,
            uniqueItems: true,
          },
          maxAgeSeconds: {
            type: "integer",
            enum: [0, 300, 3600],
            default: 300,
          },
        },
        required: [
          "allowedOrigins",
          "allowedMethods",
          "allowedHeaders",
          "maxAgeSeconds",
        ],
      },
      uiHints: [
        {
          property: "allowedOrigins",
          control: "multi-select",
          label: "Allowed HTTPS origins",
          helpText:
            "Enter exact application origins. Wildcard and insecure HTTP origins are rejected.",
          order: 0,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
        {
          property: "allowedMethods",
          control: "multi-select",
          label: "Allowed methods",
          order: 1,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
        {
          property: "allowedHeaders",
          control: "multi-select",
          label: "Allowed request headers",
          order: 2,
          advanced: true,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "none",
        },
        {
          property: "maxAgeSeconds",
          control: "number",
          label: "Browser preflight cache",
          order: 3,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
      ],
    },
    ports: [
      {
        id: "aws.s3.bucket-cors-configuration.bucket",
        displayName: "Owning bucket",
        description: "Provides this CORS policy to one S3 bucket.",
        direction: "output",
        capability: "aws.s3.bucket.cors-configuration",
        category: "uses-secrets-or-configuration",
        cardinality: "one",
        required: true,
      },
    ],
    education: {
      summary: "Allows specific browser origins to call selected S3 methods.",
      guidedExplanation:
        "CORS tells browsers which exact websites and methods may call the bucket. It does not grant S3 permission; IAM and bucket policy still decide access.",
      professionalExplanation:
        "Models one exact-origin CORS rule with a closed method/header set. Wildcard origins, HTTP origins, exposed headers, credentials, and arbitrary rule arrays are excluded.",
      considerations: [
        "Connections: This configuration belongs to one bucket and does not replace workload authentication or IAM.",
        "Security: Use exact HTTPS origins and only the methods and headers the browser workload needs.",
        "Cost: CORS has no direct charge, but permitted browser calls incur normal S3 request and transfer charges.",
        "Operations: Test browser preflight and actual requests from every approved origin.",
      ],
      documentation: [
        {
          kind: "official",
          id: "aws.s3.documentation.cors",
          title: "Using cross-origin resource sharing with Amazon S3",
          publisher: "Amazon Web Services",
          url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html",
        },
      ],
    },
    unsupportedCapabilities: [
      {
        id: "aws.s3.cors.unsupported.wildcard-advanced",
        title: "Wildcard and advanced CORS modes",
        explanation:
          "Wildcard or HTTP origins, DELETE, arbitrary headers, exposed headers, credential flags, and multiple unbounded CORS rules are rejected.",
      },
    ],
    mappings: eventMetadataMappings({
      mappingIdPrefix: "aws.s3.bucket-cors-configuration",
      terraformResourceType: "aws_s3_bucket_cors_configuration",
      cloudFormationTypeName: "AWS::S3::Bucket",
      terraformConfigurationBindings: [
        {
          configurationKey: "allowedOrigins",
          targetName: "cors_rule.allowed_origins",
        },
        {
          configurationKey: "allowedMethods",
          targetName: "cors_rule.allowed_methods",
        },
        {
          configurationKey: "allowedHeaders",
          targetName: "cors_rule.allowed_headers",
        },
        {
          configurationKey: "maxAgeSeconds",
          targetName: "cors_rule.max_age_seconds",
        },
      ],
      cloudFormationConfigurationBindings: [
        {
          configurationKey: "allowedOrigins",
          targetName: "CorsConfiguration.CorsRules.AllowedOrigins",
        },
        {
          configurationKey: "allowedMethods",
          targetName: "CorsConfiguration.CorsRules.AllowedMethods",
        },
        {
          configurationKey: "allowedHeaders",
          targetName: "CorsConfiguration.CorsRules.AllowedHeaders",
        },
        {
          configurationKey: "maxAgeSeconds",
          targetName: "CorsConfiguration.CorsRules.MaxAge",
        },
      ],
      terraformPortBindings: [
        {
          portId: "aws.s3.bucket-cors-configuration.bucket",
          targetAttribute: "bucket",
        },
      ],
      cloudFormationPortBindings: [
        {
          portId: "aws.s3.bucket-cors-configuration.bucket",
          targetAttribute: "BucketName",
        },
      ],
      terraformProjection: {
        kind: "owned-resource",
        rendererContractId: "aws.s3.bucket-cors-configuration.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
      cloudFormationProjection: {
        kind: "owner-nested-block",
        rendererContractId: "aws.s3.bucket.cors-configuration.projection",
        rendererContractVersion: "1.0.0",
        generatedResourceTypes: [],
      },
    }),
  }),
);

export const s3BucketNotificationConfiguration = defineProviderServiceV1(
  internalEventConfiguration({
    serviceId: "aws.s3.bucket-notification-configuration",
    resourceType: "aws.s3.bucket-notification-configuration",
    displayName: "S3 notification configuration",
    description:
      "One owned, filterable S3 event notification derived from a reviewed event connection.",
    ownerServiceId: "aws.s3.bucket",
    ownerRelationshipType: "aws.s3.bucket-owns-notification-configuration",
    configuration: {
      schemaId: "aws.s3.bucket-notification-configuration.configuration",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:aws.s3.bucket-notification-configuration.configuration:1.0.0",
        type: "object",
        title: "S3 event notification",
        description:
          "A reviewed object event, destination family, optional non-overlapping key filters, and honest delivery semantics.",
        additionalProperties: false,
        properties: {
          notificationName: {
            type: "string",
            default: "object-created",
            minLength: 1,
            maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          },
          eventType: {
            type: "string",
            enum: ["OBJECT_CREATED", "OBJECT_REMOVED"],
            default: "OBJECT_CREATED",
          },
          destinationKind: {
            type: "string",
            enum: ["LAMBDA", "EVENTBRIDGE"],
            default: "LAMBDA",
          },
          filterPrefix: { type: "string", default: "", maxLength: 1024 },
          filterSuffix: { type: "string", default: "", maxLength: 1024 },
          deliverySemantics: {
            type: "string",
            enum: ["AT_LEAST_ONCE_UNORDERED"],
            default: "AT_LEAST_ONCE_UNORDERED",
          },
        },
        required: [
          "notificationName",
          "eventType",
          "destinationKind",
          "filterPrefix",
          "filterSuffix",
          "deliverySemantics",
        ],
      },
      uiHints: [
        {
          property: "notificationName",
          control: "text",
          label: "Notification name",
          helpText:
            "Terraform preserves this identifier. CloudFormation LambdaConfiguration has no Id property, so named owned notifications cannot be exported to that target.",
          order: 0,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
        {
          property: "eventType",
          control: "select",
          label: "Object event",
          order: 1,
          advanced: false,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "cost-sensitive",
        },
        {
          property: "destinationKind",
          control: "select",
          label: "Destination family",
          order: 2,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "filterPrefix",
          control: "text",
          label: "Object-key prefix",
          helpText: "Leave blank for every key; use a prefix to avoid loops.",
          order: 3,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "filterSuffix",
          control: "text",
          label: "Object-key suffix",
          helpText: "For example, .json. Filters are literal key fragments.",
          order: 4,
          advanced: false,
          valueSource: "literal",
          securityImpact: "security-sensitive",
          costImpact: "cost-sensitive",
        },
        {
          property: "deliverySemantics",
          control: "select",
          label: "Delivery behavior",
          order: 5,
          advanced: true,
          valueSource: "literal",
          securityImpact: "none",
          costImpact: "none",
        },
      ],
    },
    ports: [
      {
        id: "aws.s3.bucket-notification-configuration.bucket",
        displayName: "Owning bucket",
        description: "Provides this notification to one S3 bucket.",
        direction: "output",
        capability: "aws.s3.bucket.notification-configuration",
        category: "uses-secrets-or-configuration",
        cardinality: "one",
        required: true,
      },
    ],
    education: {
      summary: "Defines one exact S3 event and key filter for one destination.",
      guidedExplanation:
        "Match these settings to exactly one bucket-to-Lambda notification with the same object event, prefix and suffix. Terraform preserves the notification name; CloudFormation cannot represent that owned name and refuses the child. Standalone, conflicting or duplicate entries cannot be exported. Per-object EventBridge child settings are unsupported; the separate bucket-to-EventBridge connection enables bucket events without these filters.",
      professionalExplanation:
        "Owned LAMBDA settings must match one unique explicit delivery edge, including event family, literal filters and at-least-once unordered delivery. Terraform projects notificationName into lambda_function.id. CloudFormation has no corresponding LambdaConfiguration Id and rejects the owned child; edge-only notifications remain supported. EVENTBRIDGE child settings cannot represent their per-object constraints through the bucket-wide EventBridge switch and are rejected without inferring a destination or overwriting edge values.",
      considerations: [
        "Connections: This generated or user-owned configuration belongs to one bucket and one reviewed direct event relationship.",
        "Security: Filters limit invocation volume but do not authorize the destination; exact resource policies or Lambda grants are still required.",
        "Cost: Broad notifications can multiply Lambda, EventBridge, and downstream request charges.",
        "Operations: Avoid overlapping filters and make every consumer idempotent for duplicate and reordered events.",
      ],
      documentation: officialDocumentation,
    },
    unsupportedCapabilities: [
      {
        id: "aws.s3.notification.unsupported.cloudformation-owned-name",
        title: "CloudFormation owned notification names",
        explanation:
          "CloudFormation LambdaConfiguration has no Id property. The required owned notificationName cannot be silently discarded; use Terraform for a named owned notification or explicitly remove the child when only the delivery edge is required.",
      },
      {
        id: "aws.s3.notification.unsupported.raw-overlap",
        title: "Raw and overlapping notification rules",
        explanation:
          "Arbitrary notification XML/JSON, SNS/SQS direct destinations, overlapping filters, replication events, and FIFO direct destinations are rejected in this slice.",
      },
    ],
    mappings: [
      {
        mappingId: "aws.s3.bucket-notification-configuration.terraform",
        declarationVersion: 1,
        implementationStatus: "metadata-only",
        target: "terraform",
        kind: "resource",
        providerSource: "hashicorp/aws",
        resourceType: "aws_s3_bucket_notification",
        configurationBindings: [
          {
            configurationKey: "notificationName",
            targetName: "lambda_function.id",
          },
          { configurationKey: "eventType", targetName: "destination.events" },
          {
            configurationKey: "destinationKind",
            targetName: "destination.kind",
          },
          {
            configurationKey: "filterPrefix",
            targetName: "destination.filter_prefix",
          },
          {
            configurationKey: "filterSuffix",
            targetName: "destination.filter_suffix",
          },
        ],
        semanticConfigurationKeys: ["deliverySemantics"],
        portBindings: [
          {
            portId: "aws.s3.bucket-notification-configuration.bucket",
            targetAttribute: "bucket",
          },
        ],
        projection: {
          kind: "owned-resource",
          rendererContractId:
            "aws.s3.bucket-notification-configuration.projection",
          rendererContractVersion: "1.0.0",
          generatedResourceTypes: [],
        },
      },
    ],
  }),
);
