import { createHash } from "node:crypto";

export const APPLICATION_GENERATOR_ID =
  "cloudmarkup.application-generator" as const;
export const APPLICATION_GENERATOR_VERSION = "1.0.0" as const;
export const EVENT_APPLICATION_GENERATOR_ID =
  "cloudmarkup.event-application-generator" as const;
export const EVENT_APPLICATION_GENERATOR_VERSION = "1.0.0" as const;

export const APPLICATION_GENERATION_CONTRACT_VERSION = 1 as const;

export const NOTES_TEMPLATE_ID =
  "cloudmarkup.template.aws-lambda-notes-typescript" as const;
export const NOTES_TEMPLATE_VERSION = "1.0.0" as const;
export const NOTES_PATTERN_ID =
  "cloudmarkup.pattern.aws-lambda-authenticated-notes" as const;
export const NOTES_PATTERN_VERSION = "1.0.0" as const;
export const EVENT_APPLICATION_TEMPLATE_ID =
  "cloudmarkup.template.aws-lambda-curated-events-typescript" as const;
export const EVENT_APPLICATION_TEMPLATE_VERSION = "1.0.0" as const;
export const EVENT_APPLICATION_PATTERN_ID =
  "cloudmarkup.pattern.aws-lambda-curated-event-driven" as const;
export const EVENT_APPLICATION_PATTERN_VERSION = "1.0.0" as const;
export const EVENT_TRIGGER_DISPATCHER_ID =
  "cloudmarkup.event-trigger-dispatcher" as const;
export const EVENT_TRIGGER_DISPATCHER_VERSION = "1.0.0" as const;

export const APPLICATION_RUNTIME_ID =
  "cloudmarkup.runtime.aws-lambda-nodejs24-typescript" as const;
export const APPLICATION_RUNTIME_VERSION = "1.0.0" as const;

export const NODE_RUNTIME_FAMILY =
  "aws.lambda.runtime-family.nodejs24" as const;
export const TYPESCRIPT_LANGUAGE_FAMILY =
  "cloudmarkup.language.typescript" as const;
export const LAMBDA_RUNTIME = "nodejs24.x" as const;
export const LAMBDA_HANDLER = "index.handler" as const;
export const APPLICATION_RUNTIME_DESCRIPTOR = Object.freeze({
  contractVersion: 1,
  id: APPLICATION_RUNTIME_ID,
  version: APPLICATION_RUNTIME_VERSION,
  runtimeFamily: NODE_RUNTIME_FAMILY,
  languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
  runtime: LAMBDA_RUNTIME,
  handler: LAMBDA_HANDLER,
  moduleFormat: "esm",
});

export const APPLICATION_RUNTIME_DIGEST = sha256Digest(
  canonicalJson(APPLICATION_RUNTIME_DESCRIPTOR),
);

export const SUPPORTED_RELATIONSHIPS = Object.freeze({
  apiInvokesLambda: "aws.apigateway.integrates-lambda",
  lambdaReadsDynamoDb: "aws.lambda.reads-dynamodb-table",
  lambdaWritesDynamoDb: "aws.lambda.writes-dynamodb-table",
  lambdaWritesLogs: "aws.lambda.writes-log-group",
});

export const SUPPORTED_EVENT_RELATIONSHIPS = Object.freeze({
  s3NotifiesLambda: "aws.s3.notifies-lambda",
  sqsTriggersLambda: "aws.sqs.triggers-lambda",
  snsInvokesLambda: "aws.sns.subscription-invokes-lambda",
  snsSubscriptionSendsToSqs: "aws.sns.subscription-sends-to-sqs",
  eventBridgeInvokesLambda: "aws.eventbridge.target-invokes-lambda",
  stepFunctionsInvokesLambda: "aws.stepfunctions.state-machine-invokes-lambda",
  lambdaWritesDynamoDb: "aws.lambda.writes-dynamodb-table",
  lambdaWritesLogs: "aws.lambda.writes-log-group",
  sqsUsesDeadLetterQueue: "aws.sqs.uses-dead-letter-queue",
  eventBridgeUsesDeadLetterQueue:
    "aws.eventbridge.target-uses-dead-letter-queue",
});

export const SUPPORTED_EVENT_PATTERN_KINDS = Object.freeze([
  "s3-image-metadata",
  "sqs-consumer-dlq",
  "sns-fanout-consumer",
  "eventbridge-scheduled",
  "eventbridge-target",
  "step-functions-task",
] as const);

export const EVENT_S3_METADATA_PAYLOAD_CONTRACT = Object.freeze({
  fields: [
    {
      classification: "internal",
      name: "bucket",
      nullable: false,
      required: true,
      scalarType: "string",
    },
    {
      classification: "internal",
      name: "eTag",
      nullable: false,
      required: true,
      scalarType: "string",
    },
    {
      classification: "internal",
      name: "key",
      nullable: false,
      required: true,
      scalarType: "string",
    },
    {
      classification: "internal",
      name: "sequencer",
      nullable: false,
      required: true,
      scalarType: "string",
    },
    {
      classification: "internal",
      name: "size",
      nullable: false,
      required: true,
      scalarType: "integer",
    },
    {
      classification: "internal",
      name: "versionId",
      nullable: false,
      required: true,
      scalarType: "string",
    },
  ],
  partitionKey: "key",
  storageIntent: "persistent",
  supportedOperations: ["consume", "create"],
} as const);

export const EVENT_SCHEDULED_PAYLOAD_CONTRACT = Object.freeze({
  fields: [
    {
      classification: "internal",
      name: "correlationId",
      nullable: false,
      required: false,
      scalarType: "string",
    },
    {
      classification: "internal",
      name: "eventId",
      nullable: false,
      required: true,
      scalarType: "string",
    },
  ],
  partitionKey: "eventId",
  storageIntent: "transient",
  supportedOperations: ["consume"],
} as const);

export const EVENT_SCHEDULED_PAYLOAD_AUTHORITY = Object.freeze({
  envelopeKind: "aws.events.scheduled-event",
  payloadContract: EVENT_SCHEDULED_PAYLOAD_CONTRACT,
  fieldBindings: [{ payloadField: "eventId", sourcePath: "$.id" }],
  nonAuthoritativePaths: ["$.detail"],
} as const);

export const EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE = Object.freeze({
  queueBodyAuthority: "bound-event-payload",
  relationshipType: SUPPORTED_EVENT_RELATIONSHIPS.snsSubscriptionSendsToSqs,
  sourceResourceType: "aws.sns.subscription",
  sourceServiceType: "aws.sns.subscription",
  requiredConfiguration: {
    rawMessageDelivery: true,
  },
} as const);

export const SUPPORTED_OPERATION_KINDS = Object.freeze([
  "create",
  "read",
  "update",
  "delete",
] as const);

export const TEMPLATE_DESCRIPTOR = Object.freeze({
  contractVersion: 1,
  id: NOTES_TEMPLATE_ID,
  version: NOTES_TEMPLATE_VERSION,
  pattern: {
    id: NOTES_PATTERN_ID,
    version: NOTES_PATTERN_VERSION,
  },
  runtime: {
    id: APPLICATION_RUNTIME_ID,
    version: APPLICATION_RUNTIME_VERSION,
    digest: APPLICATION_RUNTIME_DIGEST,
  },
  supportedModes: ["generated-starter", "complete-supported-pattern"],
  supportedRelationships: Object.values(SUPPORTED_RELATIONSHIPS),
  supportedDataOperations: SUPPORTED_OPERATION_KINDS,
  triggerContract: "aws.apigateway.http-api.payload-v2",
});

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareUtf16(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function sha256Digest(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), undefined, 2)}\n`;
}

export function portableArtifactSegment(value: string): string {
  if (/^[a-z][a-z0-9_]{0,62}$/.test(value)) return value;
  const readable = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  const prefix = readable.length === 0 ? "id" : readable;
  return `${prefix}-${sha256Digest(value).slice(7)}`;
}
export const NOTES_TEMPLATE_DIGEST = sha256Digest(
  canonicalJson(TEMPLATE_DESCRIPTOR),
);

export const NOTES_PATTERN_DIGEST = sha256Digest(
  canonicalJson({
    contractVersion: 1,
    id: NOTES_PATTERN_ID,
    version: NOTES_PATTERN_VERSION,
    templateDigest: NOTES_TEMPLATE_DIGEST,
    supportedDataOperations: SUPPORTED_OPERATION_KINDS,
    supportedRelationships: Object.values(SUPPORTED_RELATIONSHIPS),
  }),
);

export const APPLICATION_GENERATOR_DESCRIPTOR = Object.freeze({
  contractVersion: APPLICATION_GENERATION_CONTRACT_VERSION,
  id: APPLICATION_GENERATOR_ID,
  version: APPLICATION_GENERATOR_VERSION,
  templates: [
    {
      id: NOTES_TEMPLATE_ID,
      version: NOTES_TEMPLATE_VERSION,
      digest: NOTES_TEMPLATE_DIGEST,
    },
  ],
});

export const APPLICATION_GENERATOR_DIGEST = sha256Digest(
  canonicalJson(APPLICATION_GENERATOR_DESCRIPTOR),
);

export const EVENT_TRIGGER_DISPATCHER_DESCRIPTOR = Object.freeze({
  contractVersion: 1,
  id: EVENT_TRIGGER_DISPATCHER_ID,
  version: EVENT_TRIGGER_DISPATCHER_VERSION,
  dispatchAuthority: "workload-event-binding-and-typed-edge",
  inference: "forbidden",
  payloadAuthorities: {
    "eventbridge-scheduled": EVENT_SCHEDULED_PAYLOAD_AUTHORITY,
  },
  supportedPatterns: SUPPORTED_EVENT_PATTERN_KINDS,
});

export const EVENT_TRIGGER_DISPATCHER_DIGEST = sha256Digest(
  canonicalJson(EVENT_TRIGGER_DISPATCHER_DESCRIPTOR),
);

export const EVENT_APPLICATION_TEMPLATE_DESCRIPTOR = Object.freeze({
  contractVersion: 1,
  id: EVENT_APPLICATION_TEMPLATE_ID,
  version: EVENT_APPLICATION_TEMPLATE_VERSION,
  pattern: {
    id: EVENT_APPLICATION_PATTERN_ID,
    version: EVENT_APPLICATION_PATTERN_VERSION,
  },
  runtime: {
    id: APPLICATION_RUNTIME_ID,
    version: APPLICATION_RUNTIME_VERSION,
    digest: APPLICATION_RUNTIME_DIGEST,
  },
  dispatcher: {
    id: EVENT_TRIGGER_DISPATCHER_ID,
    version: EVENT_TRIGGER_DISPATCHER_VERSION,
    digest: EVENT_TRIGGER_DISPATCHER_DIGEST,
  },
  completePatternContracts: {
    "s3-image-metadata": {
      payload: EVENT_S3_METADATA_PAYLOAD_CONTRACT,
    },
    "sqs-consumer-dlq": {
      upstreamSnsToSqs: EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE,
    },
  },
  runtimeExtensionBoundary: {
    generatedSeam: {
      path: "generated/runtime-extension.ts",
      ownership: "generated",
      behavior: "no-op",
      generatedProfilePackaging: "included",
    },
    userExtension: {
      path: "extensions/custom.ts",
      ownership: "user-owned",
      generatedProfilePackaging: "excluded",
      activation: "separately-reviewed-custom-source-profile",
      modificationStatus: "custom-implementation-required",
    },
  },
  supportedModes: ["generated-starter", "complete-supported-pattern"],
  supportedRelationships: Object.values(SUPPORTED_EVENT_RELATIONSHIPS),
  supportedPatterns: SUPPORTED_EVENT_PATTERN_KINDS,
  dispatchAuthority: "explicit-workload-contract",
  eventInference: "forbidden",
});

export const EVENT_APPLICATION_TEMPLATE_DIGEST = sha256Digest(
  canonicalJson(EVENT_APPLICATION_TEMPLATE_DESCRIPTOR),
);

export const EVENT_APPLICATION_PATTERN_DIGEST = sha256Digest(
  canonicalJson({
    contractVersion: 1,
    id: EVENT_APPLICATION_PATTERN_ID,
    version: EVENT_APPLICATION_PATTERN_VERSION,
    templateDigest: EVENT_APPLICATION_TEMPLATE_DIGEST,
    dispatcherDigest: EVENT_TRIGGER_DISPATCHER_DIGEST,
    supportedPatterns: SUPPORTED_EVENT_PATTERN_KINDS,
    supportedRelationships: Object.values(SUPPORTED_EVENT_RELATIONSHIPS),
  }),
);

export const EVENT_APPLICATION_GENERATOR_DESCRIPTOR = Object.freeze({
  contractVersion: APPLICATION_GENERATION_CONTRACT_VERSION,
  id: EVENT_APPLICATION_GENERATOR_ID,
  version: EVENT_APPLICATION_GENERATOR_VERSION,
  templates: [
    {
      id: EVENT_APPLICATION_TEMPLATE_ID,
      version: EVENT_APPLICATION_TEMPLATE_VERSION,
      digest: EVENT_APPLICATION_TEMPLATE_DIGEST,
    },
  ],
});

export const EVENT_APPLICATION_GENERATOR_DIGEST = sha256Digest(
  canonicalJson(EVENT_APPLICATION_GENERATOR_DESCRIPTOR),
);
/** Exact installed AWS catalog; generator/template/runtime identities are unchanged. */
export const CURRENT_APPLICATION_CATALOG = Object.freeze({
  id: "aws.cloudmarkup.notes-api-catalog",
  version: "0.30.0",
  digest:
    "sha256:7bc6db32a69c5dd33ef85e02e2ebd38bb47333670259696165149ce39bcca682",
});
