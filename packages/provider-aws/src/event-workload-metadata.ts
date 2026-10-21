export interface AwsEventWorkloadEndpointMetadataV1 {
  readonly endpoint: "source" | "target";
  readonly role: "producer" | "consumer" | "invoker" | "task" | "transport";
  readonly direction: "inbound" | "outbound";
  readonly transportKind: "event" | "message";
  readonly operationBinding: "required" | "not-applicable";
  readonly eventContractBinding: "required";
}

export interface AwsEventWorkloadConnectionMetadataV1 {
  readonly contractVersion: 1;
  readonly relationshipType: string;
  readonly delivery: "at-least-once";
  readonly ordering:
    "unordered" | "queue-dependent" | "transport-dependent" | "contract-key";
  readonly duplicates: "possible";
  readonly endpointBindings: readonly AwsEventWorkloadEndpointMetadataV1[];
  readonly generatedCodeReadiness: {
    readonly status: "pending";
    readonly reason: string;
  };
}

export interface AwsEventWorkloadConnectionMetadataV2 {
  readonly contractVersion: 2;
  readonly relationshipType: string;
  readonly delivery: "at-least-once";
  readonly ordering:
    "unordered" | "queue-dependent" | "transport-dependent" | "contract-key";
  readonly duplicates: "possible";
  readonly endpointBindings: readonly AwsEventWorkloadEndpointMetadataV1[];
  readonly generatedCodeReadiness: {
    readonly status: "supported" | "pending";
    readonly reason: string;
  };
}

function metadata(
  relationshipType: string,
  ordering: AwsEventWorkloadConnectionMetadataV1["ordering"],
  endpointBindings: readonly AwsEventWorkloadEndpointMetadataV1[],
): AwsEventWorkloadConnectionMetadataV1 {
  return Object.freeze({
    contractVersion: 1,
    relationshipType,
    delivery: "at-least-once",
    ordering,
    duplicates: "possible",
    endpointBindings: Object.freeze([...endpointBindings]),
    generatedCodeReadiness: Object.freeze({
      status: "pending",
      reason:
        "Prompt 45 binds the reviewed Workload Behavior v2 operation and event-message contract to deterministic infrastructure; complete application handler generation remains pending until Prompt 45A.",
    }),
  });
}

const eventTransport = (
  endpoint: "source" | "target",
  direction: "inbound" | "outbound",
  transportKind: "event" | "message",
): AwsEventWorkloadEndpointMetadataV1 => ({
  endpoint,
  role: "transport",
  direction,
  transportKind,
  operationBinding: "not-applicable",
  eventContractBinding: "required",
});

const workload = (
  endpoint: "source" | "target",
  role: "producer" | "consumer" | "invoker" | "task",
  direction: "inbound" | "outbound",
  transportKind: "event" | "message",
): AwsEventWorkloadEndpointMetadataV1 => ({
  endpoint,
  role,
  direction,
  transportKind,
  operationBinding: "required",
  eventContractBinding: "required",
});

export const AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V1 = Object.freeze([
  metadata("aws.s3.notifies-lambda", "unordered", [
    eventTransport("source", "outbound", "event"),
    workload("target", "consumer", "inbound", "event"),
  ]),
  metadata("aws.lambda.sends-message-to-sqs", "queue-dependent", [
    workload("source", "producer", "outbound", "message"),
    eventTransport("target", "inbound", "message"),
  ]),
  metadata("aws.sqs.triggers-lambda", "queue-dependent", [
    eventTransport("source", "outbound", "message"),
    workload("target", "consumer", "inbound", "message"),
  ]),
  metadata("aws.lambda.publishes-to-sns", "transport-dependent", [
    workload("source", "producer", "outbound", "event"),
    eventTransport("target", "inbound", "event"),
  ]),
  metadata("aws.sns.subscription-invokes-lambda", "unordered", [
    eventTransport("source", "outbound", "event"),
    workload("target", "consumer", "inbound", "event"),
  ]),
  metadata("aws.lambda.puts-events-on-eventbridge", "unordered", [
    workload("source", "producer", "outbound", "event"),
    eventTransport("target", "inbound", "event"),
  ]),
  metadata("aws.eventbridge.target-invokes-lambda", "unordered", [
    eventTransport("source", "outbound", "event"),
    workload("target", "consumer", "inbound", "event"),
  ]),
  metadata("aws.lambda.starts-step-functions-state-machine", "contract-key", [
    workload("source", "invoker", "outbound", "event"),
    eventTransport("target", "inbound", "event"),
  ]),
  metadata("aws.stepfunctions.state-machine-invokes-lambda", "contract-key", [
    eventTransport("source", "outbound", "event"),
    workload("target", "task", "inbound", "event"),
  ]),
]);

const GENERATED_EVENT_TRIGGER_RELATIONSHIPS_V2 = new Set([
  "aws.s3.notifies-lambda",
  "aws.sqs.triggers-lambda",
  "aws.sns.subscription-invokes-lambda",
  "aws.eventbridge.target-invokes-lambda",
  "aws.stepfunctions.state-machine-invokes-lambda",
]);

export const AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V2 = Object.freeze(
  AWS_EVENT_WORKLOAD_CONNECTION_METADATA_V1.map(
    (entry): AwsEventWorkloadConnectionMetadataV2 => {
      const generatedTriggerSupported =
        GENERATED_EVENT_TRIGGER_RELATIONSHIPS_V2.has(entry.relationshipType);
      return Object.freeze({
        contractVersion: 2,
        relationshipType: entry.relationshipType,
        delivery: entry.delivery,
        ordering: entry.ordering,
        duplicates: entry.duplicates,
        endpointBindings: entry.endpointBindings,
        generatedCodeReadiness: Object.freeze({
          status: generatedTriggerSupported ? "supported" : "pending",
          reason: generatedTriggerSupported
            ? "AWS catalog 0.13 binds this trigger relationship to the exact reviewed curated-event generator, Workload operation, event contract, deterministic build, and target-neutral Lambda artifact contract."
            : "AWS catalog 0.13 retains this outbound Lambda producer relationship as typed infrastructure metadata; deterministic application operation generation is not part of the Prompt 45A curated slice.",
        }),
      });
    },
  ),
);
