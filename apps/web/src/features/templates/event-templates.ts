import { awsEditorCatalog } from "../../provider-catalog/aws-editor-catalog.js";

export const EVENT_TEMPLATE_CATALOG_VERSION = awsEditorCatalog.identity.version;

export type EventApplicationHandlerPatternId =
  | "s3-image-metadata"
  | "sqs-consumer-dlq"
  | "sns-fanout-consumer"
  | "eventbridge-scheduled"
  | "eventbridge-target"
  | "step-functions-task";

export interface EventApplicationHandlerPattern {
  readonly id: EventApplicationHandlerPatternId;
  readonly label: string;
}

export const eventApplicationHandlerPatterns = Object.freeze([
  {
    id: "s3-image-metadata",
    label: "S3 object metadata event",
  },
  {
    id: "sqs-consumer-dlq",
    label: "SQS batch consumer with DLQ",
  },
  {
    id: "sns-fanout-consumer",
    label: "SNS envelope fan-out consumer",
  },
  {
    id: "eventbridge-scheduled",
    label: "EventBridge scheduled workload",
  },
  {
    id: "eventbridge-target",
    label: "EventBridge event target",
  },
  {
    id: "step-functions-task",
    label: "Step Functions Lambda task",
  },
] as const satisfies readonly EventApplicationHandlerPattern[]);

export interface EventTemplateDefinition {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly eventFlow: readonly string[];
  readonly delivery: string;
  readonly handlerPatterns: readonly EventApplicationHandlerPatternId[];
  readonly readiness: string;
  readonly artifactReadiness: string;
  readonly idempotencyBoundary: string;
}

const artifactReadiness =
  "The bound Workload is source-eligible, while generated source coverage remains starter-application until the deterministic build sandbox provides passing unit and contract tests, security checks, package manifest, and checksum evidence. Only then is the final Lambda ZIP evidence-confirmed complete; Terraform never references a provisional artifact.";
const idempotencyBoundary =
  "The generated Workloads do not claim a durable replay store: duplicate S3 events can repeat a same-key overwrite, but older events can arrive later; the other handlers are side-effect-free or log-only. Adding stateful effects or newer-wins behavior requires revising the Workload and implementing a durable strategy or sequencing check through the preserved user-owned hook.";

export const eventTemplateDefinitions = Object.freeze([
  {
    id: "image-upload-processing",
    title: "Image upload with asynchronous processing",
    summary:
      "S3 object-created notifications invoke a Lambda workload that records image metadata in DynamoDB.",
    eventFlow: ["Amazon S3", "AWS Lambda", "Amazon DynamoDB"],
    delivery:
      "At-least-once delivery may repeat the same metadata overwrite, and object-event ordering is not guaranteed. Customers must add reviewed sequencing when newer metadata must win, and any added side effect must be idempotent.",
    handlerPatterns: ["s3-image-metadata"],
    readiness:
      "The template binds one complete-supported S3 metadata Workload. Image transforms are not invented and remain a reviewed user extension.",
    artifactReadiness,
    idempotencyBoundary,
  },
  {
    id: "scheduled-workflow",
    title: "Scheduled workflow",
    summary:
      "A bounded EventBridge schedule starts a Step Functions state machine whose exact task contract invokes Lambda.",
    eventFlow: ["Amazon EventBridge", "AWS Step Functions", "AWS Lambda"],
    delivery:
      "EventBridge retries are bounded and may deliver more than once; workflow starts need an idempotency strategy.",
    handlerPatterns: ["step-functions-task"],
    readiness:
      "The template binds one complete-supported Step Functions Lambda task Workload. EventBridge starts the state machine as infrastructure; it does not imply a second schedule-handler Workload.",
    artifactReadiness,
    idempotencyBoundary,
  },
  {
    id: "sns-fan-out-notification",
    title: "SNS fan-out notification",
    summary:
      "One SNS topic owns explicit SQS subscriptions and separately generated consumers for durable, independently retryable delivery.",
    eventFlow: ["Amazon SNS", "Amazon SQS fan-out", "AWS Lambda consumers"],
    delivery:
      "Each subscription is at least once; branch order is not guaranteed and each consumer handles duplicates independently.",
    handlerPatterns: ["sqs-consumer-dlq"],
    readiness:
      "The template binds two independent complete-supported SQS batch Workloads, each with its own DLQ. It does not guess a direct SNS-envelope handler.",
    artifactReadiness,
    idempotencyBoundary,
  },
  {
    id: "queue-consumer-with-dlq",
    title: "Queue consumer with DLQ",
    summary:
      "An SQS queue triggers Lambda in bounded batches and redrives repeatedly failed messages to a compatible DLQ.",
    eventFlow: ["Amazon SQS", "AWS Lambda", "Amazon SQS DLQ"],
    delivery:
      "Consumption is at least once; partial batch failure reduces replay, while FIFO ordering is preserved only for FIFO-compatible queues.",
    handlerPatterns: ["sqs-consumer-dlq"],
    readiness:
      "The template binds one complete-supported SQS batch Workload with partial-failure and idempotency hooks; message-specific business work remains an extension.",
    artifactReadiness,
    idempotencyBoundary,
  },
] as const satisfies readonly EventTemplateDefinition[]);

export function findEventApplicationHandlerPattern(
  patternId: EventApplicationHandlerPatternId,
): EventApplicationHandlerPattern {
  const pattern = eventApplicationHandlerPatterns.find(
    (candidate) => candidate.id === patternId,
  );
  if (pattern === undefined)
    throw new TypeError(`Unsupported event handler pattern ${patternId}.`);
  return pattern;
}

export function findEventTemplate(
  templateId: string,
): EventTemplateDefinition | undefined {
  return eventTemplateDefinitions.find(
    (template) => template.id === templateId,
  );
}
