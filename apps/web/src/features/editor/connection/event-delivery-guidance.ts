export interface EventDeliveryGuidance {
  readonly delivery: string;
  readonly ordering: string;
  readonly retry: string;
}

const eventDescriptorMarkers = [
  "aws.s3.",
  "aws.sqs.",
  "aws.sns.",
  "aws.eventbridge.",
  "aws.stepfunctions.",
  "aws.lambda.sends-message-to-sqs",
  "aws.lambda.publishes-to-sns",
  "aws.lambda.puts-events-on-eventbridge",
  "aws.lambda.starts-step-functions-state-machine",
  "aws.lambda.uses-sqs-dead-letter-queue",
] as const;

export function eventDeliveryGuidance(
  descriptorId: string,
): EventDeliveryGuidance | null {
  if (
    !eventDescriptorMarkers.some((marker) => descriptorId.startsWith(marker))
  ) {
    return null;
  }

  if (descriptorId.includes("dead-letter")) {
    return {
      delivery:
        "Failed records move to the explicit DLQ after the configured bounded attempt threshold; replay remains a deliberate operation.",
      ordering:
        "Standard and FIFO resources cannot be mixed; FIFO replay keeps message-group ordering only within each group.",
      retry:
        "A DLQ limits repeated delivery but does not replace monitoring, investigation, or idempotent processing.",
    };
  }
  if (descriptorId === "aws.sqs.queue-triggers-lambda") {
    return {
      delivery:
        "Lambda polls bounded batches with at-least-once delivery, so a record can be presented more than once.",
      ordering:
        "Standard queues do not guarantee order; FIFO queues preserve order only within a message group.",
      retry:
        "Partial batch response retries only failed records, while concurrency and batching choices affect both recovery and cost.",
    };
  }
  if (descriptorId === "aws.s3.bucket-notifies-lambda") {
    return {
      delivery:
        "S3 invokes the function asynchronously and can deliver duplicate object notifications.",
      ordering:
        "Object notifications can arrive out of order; use object version or sequencer data when order matters.",
      retry:
        "The handler must be idempotent and its asynchronous failure path must remain bounded and observable.",
    };
  }
  if (descriptorId.includes("sns") || descriptorId.includes("subscription")) {
    return {
      delivery:
        "SNS fan-out is at least once, and each explicit subscription retries independently and may receive duplicates.",
      ordering:
        "Standard topics do not guarantee order; FIFO ordering requires a compatible FIFO destination and stable message group.",
      retry:
        "Durable queue branches isolate retry; filter, raw-delivery, and retry choices remain explicit rather than inferred.",
    };
  }
  if (descriptorId.includes("eventbridge")) {
    return {
      delivery:
        "EventBridge target delivery is at least once and can duplicate matched events.",
      ordering:
        "Cross-target order is not guaranteed; consumers must use event identity and time fields instead of arrival order.",
      retry:
        "Retry count and event age are bounded per target, with an explicit DLQ for exhausted delivery when configured.",
    };
  }
  if (
    descriptorId.includes("stepfunctions") ||
    descriptorId.includes("state-machine")
  ) {
    return {
      delivery:
        "Workflow starts and task invocations use explicit input contracts and may be repeated after a retry.",
      ordering:
        "State-machine task order comes from the deterministic workflow definition, not canvas position.",
      retry:
        "Task timeout, retry count, and backoff are bounded; retried operations must be idempotent.",
    };
  }
  return {
    delivery:
      "This event connection is at least once unless its exact destination contract states otherwise, so consumers handle duplicates.",
    ordering:
      "Arrival order is not assumed; FIFO behavior applies only when every typed endpoint and setting is compatible.",
    retry:
      "Retries remain bounded and visible, and any failure destination is an explicit typed edge.",
  };
}
