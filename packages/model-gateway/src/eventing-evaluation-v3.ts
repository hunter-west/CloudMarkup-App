import { digestCanonicalValue, type Sha256Digest } from "@cloudmarkup/schemas";

export const eventingEvaluationFindingCodesV3 = Object.freeze({
  fifoMismatch: "TARGET_SQS_DLQ_FIFO_MISMATCH",
  missingPermission: "TARGET_GENERATED_POLICY_COVERAGE_MISSING",
  recursiveNotification: "TARGET_EVENT_FLOW_CYCLE",
  unboundedRetry: "TARGET_EVENT_RETRY_UNBOUNDED",
  unsupportedFilter: "TARGET_EVENT_FILTER_UNSUPPORTED",
  wrongSqsDirection: "TARGET_EVENT_SQS_DIRECTION_INVALID",
} as const);

type EventingEvaluationFindingCodeV3 =
  (typeof eventingEvaluationFindingCodesV3)[keyof typeof eventingEvaluationFindingCodesV3];

interface EventingEvaluationDesignV3 {
  readonly pattern:
    | "image-upload-processing"
    | "scheduled-workflow"
    | "sns-fan-out-notification"
    | "queue-consumer-with-dlq";
  readonly recursiveS3Notification?: boolean;
  readonly sqsDirection?: "queue-to-lambda" | "lambda-to-queue";
  readonly generatedPermissionPresent?: boolean;
  readonly queueType?: "STANDARD" | "FIFO";
  readonly deadLetterQueueType?: "STANDARD" | "FIFO";
  readonly filterMode?: "NONE" | "REVIEWED" | "UNSUPPORTED";
  readonly maximumRetryAttempts?: number;
}

export interface EventingEvaluationCaseV3 {
  readonly caseId: string;
  readonly promptTemplate: string;
  readonly design: EventingEvaluationDesignV3;
  readonly expected: {
    readonly accepted: boolean;
    readonly findingCode?: EventingEvaluationFindingCodeV3;
  };
}

const cases = [
  {
    caseId: "eventing_valid_image_upload_v3",
    promptTemplate:
      "Create image upload processing with S3, asynchronous Lambda invocation, and explicit metadata storage. Keep handler generation pending Prompt 45A.",
    design: {
      pattern: "image-upload-processing",
      generatedPermissionPresent: true,
      filterMode: "REVIEWED",
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_valid_schedule_v3",
    promptTemplate:
      "Start a workflow every five minutes with a bounded EventBridge target retry policy and explicit role.",
    design: {
      pattern: "scheduled-workflow",
      generatedPermissionPresent: true,
      maximumRetryAttempts: 3,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_valid_sns_fanout_v3",
    promptTemplate:
      "Fan one SNS notification out to two explicit Standard SQS subscriptions with independently durable delivery.",
    design: {
      pattern: "sns-fan-out-notification",
      generatedPermissionPresent: true,
      queueType: "STANDARD",
      deadLetterQueueType: "STANDARD",
      filterMode: "NONE",
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_valid_queue_consumer_v3",
    promptTemplate:
      "Connect one Standard SQS queue to Lambda with partial batch response and a compatible Standard DLQ.",
    design: {
      pattern: "queue-consumer-with-dlq",
      sqsDirection: "queue-to-lambda",
      generatedPermissionPresent: true,
      queueType: "STANDARD",
      deadLetterQueueType: "STANDARD",
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_invalid_recursive_s3_v3",
    promptTemplate:
      "Use the same S3 bucket as both the notification input and the processor output without a reviewed boundary.",
    design: {
      pattern: "image-upload-processing",
      recursiveS3Notification: true,
      generatedPermissionPresent: true,
    },
    expected: {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.recursiveNotification,
    },
  },
  {
    caseId: "eventing_invalid_sqs_direction_v3",
    promptTemplate:
      "Draw a Lambda-triggering SQS event source from Lambda to the queue.",
    design: {
      pattern: "queue-consumer-with-dlq",
      sqsDirection: "lambda-to-queue",
      generatedPermissionPresent: true,
    },
    expected: {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.wrongSqsDirection,
    },
  },
  {
    caseId: "eventing_invalid_missing_permission_v3",
    promptTemplate:
      "Create an EventBridge target that invokes Lambda but omit the exact generated invocation permission.",
    design: {
      pattern: "scheduled-workflow",
      generatedPermissionPresent: false,
      maximumRetryAttempts: 3,
    },
    expected: {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.missingPermission,
    },
  },
  {
    caseId: "eventing_invalid_fifo_mismatch_v3",
    promptTemplate:
      "Attach a Standard dead-letter queue to a FIFO source queue.",
    design: {
      pattern: "queue-consumer-with-dlq",
      sqsDirection: "queue-to-lambda",
      generatedPermissionPresent: true,
      queueType: "FIFO",
      deadLetterQueueType: "STANDARD",
    },
    expected: {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.fifoMismatch,
    },
  },
  {
    caseId: "eventing_invalid_filter_v3",
    promptTemplate:
      "Add an arbitrary SNS or EventBridge JSON filter that is outside the reviewed typed filter subset.",
    design: {
      pattern: "sns-fan-out-notification",
      generatedPermissionPresent: true,
      filterMode: "UNSUPPORTED",
    },
    expected: {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.unsupportedFilter,
    },
  },
  {
    caseId: "eventing_invalid_unbounded_retry_v3",
    promptTemplate:
      "Retry EventBridge target delivery indefinitely without a bounded event age or DLQ.",
    design: {
      pattern: "scheduled-workflow",
      generatedPermissionPresent: true,
      maximumRetryAttempts: 999,
    },
    expected: {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.unboundedRetry,
    },
  },
] as const satisfies readonly EventingEvaluationCaseV3[];

export const frozenEventingEvaluationDatasetV3 = Object.freeze({
  datasetId: "cloudmarkup.model-evaluation.eventing",
  datasetVersion: "3.0.0",
  cases: Object.freeze(cases),
  datasetDigest: digestCanonicalValue({
    datasetId: "cloudmarkup.model-evaluation.eventing",
    datasetVersion: "3.0.0",
    cases,
  }),
});

export interface EventingEvaluationCaseResultV3 {
  readonly caseId: string;
  readonly accepted: boolean;
  readonly findingCode?: EventingEvaluationFindingCodeV3;
  readonly passed: boolean;
}

export interface EventingEvaluationReportV3 {
  readonly datasetDigest: Sha256Digest;
  readonly executionMode: "deterministic";
  readonly results: readonly EventingEvaluationCaseResultV3[];
  readonly deterministicPassed: boolean;
}

export function evaluateEventingDesignV3(
  design: EventingEvaluationDesignV3,
): Omit<EventingEvaluationCaseResultV3, "caseId" | "passed"> {
  if (design.recursiveS3Notification === true) {
    return {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.recursiveNotification,
    };
  }
  if (design.sqsDirection === "lambda-to-queue") {
    return {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.wrongSqsDirection,
    };
  }
  if (design.generatedPermissionPresent === false) {
    return {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.missingPermission,
    };
  }
  if (
    design.queueType !== undefined &&
    design.deadLetterQueueType !== undefined &&
    design.queueType !== design.deadLetterQueueType
  ) {
    return {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.fifoMismatch,
    };
  }
  if (design.filterMode === "UNSUPPORTED") {
    return {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.unsupportedFilter,
    };
  }
  if (
    design.maximumRetryAttempts !== undefined &&
    (design.maximumRetryAttempts < 0 || design.maximumRetryAttempts > 185)
  ) {
    return {
      accepted: false,
      findingCode: eventingEvaluationFindingCodesV3.unboundedRetry,
    };
  }
  return { accepted: true };
}

export function runFrozenEventingEvaluationV3(): EventingEvaluationReportV3 {
  const results = frozenEventingEvaluationDatasetV3.cases.map(
    (evaluationCase): EventingEvaluationCaseResultV3 => {
      const actual = evaluateEventingDesignV3(evaluationCase.design);
      const passed =
        actual.accepted === evaluationCase.expected.accepted &&
        actual.findingCode ===
          ("findingCode" in evaluationCase.expected
            ? evaluationCase.expected.findingCode
            : undefined);
      return { caseId: evaluationCase.caseId, ...actual, passed };
    },
  );
  return {
    datasetDigest: frozenEventingEvaluationDatasetV3.datasetDigest,
    executionMode: "deterministic",
    results,
    deterministicPassed: results.every(({ passed }) => passed),
  };
}
