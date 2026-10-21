import { digestCanonicalValue, type Sha256Digest } from "@cloudmarkup/schemas";

export const eventingApplicationEvaluationFindingCodesV4 = Object.freeze({
  fifoMismatch: "TARGET_SQS_DLQ_FIFO_MISMATCH",
  missingPermission: "TARGET_GENERATED_POLICY_COVERAGE_MISSING",
  recursiveNotification: "TARGET_EVENT_FLOW_CYCLE",
  unboundedRetry: "TARGET_EVENT_RETRY_UNBOUNDED",
  unsupportedFilter: "TARGET_EVENT_FILTER_UNSUPPORTED",
  wrongSqsDirection: "TARGET_EVENT_SQS_DIRECTION_INVALID",
} as const);

type EventingApplicationEvaluationFindingCodeV4 =
  (typeof eventingApplicationEvaluationFindingCodesV4)[keyof typeof eventingApplicationEvaluationFindingCodesV4];

type EventingApplicationPatternV4 =
  | "s3-upload-metadata"
  | "sqs-consumer-dlq"
  | "sns-fan-out-consumer"
  | "eventbridge-schedule"
  | "eventbridge-event-target"
  | "step-functions-lambda-task";

interface EventingApplicationEvaluationDesignV4 {
  readonly pattern: EventingApplicationPatternV4;
  readonly contractAuthority: "workload-and-event-contracts";
  readonly dispatch: "explicit";
  readonly recursiveS3Notification?: boolean;
  readonly sqsDirection?: "queue-to-lambda" | "lambda-to-queue";
  readonly generatedPermissionPresent?: boolean;
  readonly queueType?: "STANDARD" | "FIFO";
  readonly deadLetterQueueType?: "STANDARD" | "FIFO";
  readonly filterMode?: "NONE" | "REVIEWED" | "UNSUPPORTED";
  readonly maximumRetryAttempts?: number;
  readonly partialBatchFailure?: boolean;
  readonly idempotencyHook?: boolean;
}

export interface EventingApplicationEvaluationCaseV4 {
  readonly caseId: string;
  readonly promptTemplate: string;
  readonly design: EventingApplicationEvaluationDesignV4;
  readonly expected: {
    readonly accepted: boolean;
    readonly findingCode?: EventingApplicationEvaluationFindingCodeV4;
  };
}

const authority = {
  contractAuthority: "workload-and-event-contracts",
  dispatch: "explicit",
} as const;

const cases = [
  {
    caseId: "eventing_app_valid_s3_metadata_v4",
    promptTemplate:
      "Propose the reviewed S3 object-created workload and event contracts for asynchronous metadata processing, with explicit dispatch and idempotency; do not author a business transform.",
    design: {
      ...authority,
      pattern: "s3-upload-metadata",
      generatedPermissionPresent: true,
      filterMode: "REVIEWED",
      idempotencyHook: true,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_app_valid_sqs_consumer_v4",
    promptTemplate:
      "Propose an SQS-to-Lambda workload contract with explicit batch dispatch, partial batch failure, duplicate-safe idempotency, bounded retries, and a compatible DLQ.",
    design: {
      ...authority,
      pattern: "sqs-consumer-dlq",
      sqsDirection: "queue-to-lambda",
      generatedPermissionPresent: true,
      queueType: "STANDARD",
      deadLetterQueueType: "STANDARD",
      maximumRetryAttempts: 5,
      partialBatchFailure: true,
      idempotencyHook: true,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_app_valid_sns_fanout_v4",
    promptTemplate:
      "Propose exact SNS fan-out consumer contracts with explicit envelope parsing, independent duplicate handling, and no implied branch ordering.",
    design: {
      ...authority,
      pattern: "sns-fan-out-consumer",
      generatedPermissionPresent: true,
      filterMode: "NONE",
      idempotencyHook: true,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_app_valid_schedule_v4",
    promptTemplate:
      "Propose an EventBridge schedule workload contract with an exact schedule entrypoint, bounded retry posture, correlation fields, and an explicit smoke specification.",
    design: {
      ...authority,
      pattern: "eventbridge-schedule",
      generatedPermissionPresent: true,
      maximumRetryAttempts: 3,
      idempotencyHook: true,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_app_valid_event_target_v4",
    promptTemplate:
      "Propose an EventBridge event-target workload and typed detail contract with reviewed filtering and explicit dispatch; do not guess the event shape.",
    design: {
      ...authority,
      pattern: "eventbridge-event-target",
      generatedPermissionPresent: true,
      filterMode: "REVIEWED",
      maximumRetryAttempts: 3,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_app_valid_step_functions_task_v4",
    promptTemplate:
      "Propose a Step Functions Lambda task operation with exact input/output contracts, explicit dispatch, structured correlation, and no fabricated business transform.",
    design: {
      ...authority,
      pattern: "step-functions-lambda-task",
      generatedPermissionPresent: true,
      idempotencyHook: true,
    },
    expected: { accepted: true },
  },
  {
    caseId: "eventing_app_invalid_recursive_s3_v4",
    promptTemplate:
      "Use one S3 bucket as both unfiltered notification input and processor output, recursively invoking the same handler.",
    design: {
      ...authority,
      pattern: "s3-upload-metadata",
      recursiveS3Notification: true,
      generatedPermissionPresent: true,
    },
    expected: {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.recursiveNotification,
    },
  },
  {
    caseId: "eventing_app_invalid_sqs_direction_v4",
    promptTemplate:
      "Treat Lambda-to-SQS as an inbound SQS Lambda event-source mapping.",
    design: {
      ...authority,
      pattern: "sqs-consumer-dlq",
      sqsDirection: "lambda-to-queue",
      generatedPermissionPresent: true,
    },
    expected: {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.wrongSqsDirection,
    },
  },
  {
    caseId: "eventing_app_invalid_missing_permission_v4",
    promptTemplate:
      "Connect an EventBridge target to Lambda while omitting the graph-derived invocation permission.",
    design: {
      ...authority,
      pattern: "eventbridge-event-target",
      generatedPermissionPresent: false,
      maximumRetryAttempts: 3,
    },
    expected: {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.missingPermission,
    },
  },
  {
    caseId: "eventing_app_invalid_fifo_mismatch_v4",
    promptTemplate:
      "Attach a Standard dead-letter queue to a FIFO source queue and claim FIFO delivery remains valid.",
    design: {
      ...authority,
      pattern: "sqs-consumer-dlq",
      sqsDirection: "queue-to-lambda",
      generatedPermissionPresent: true,
      queueType: "FIFO",
      deadLetterQueueType: "STANDARD",
      partialBatchFailure: true,
    },
    expected: {
      accepted: false,
      findingCode: eventingApplicationEvaluationFindingCodesV4.fifoMismatch,
    },
  },
  {
    caseId: "eventing_app_invalid_filter_v4",
    promptTemplate:
      "Insert an arbitrary unreviewed SNS or EventBridge JSON filter into the generated application contract.",
    design: {
      ...authority,
      pattern: "sns-fan-out-consumer",
      generatedPermissionPresent: true,
      filterMode: "UNSUPPORTED",
    },
    expected: {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.unsupportedFilter,
    },
  },
  {
    caseId: "eventing_app_invalid_unbounded_retry_v4",
    promptTemplate:
      "Retry event target delivery without a finite attempt or event-age bound and without a DLQ.",
    design: {
      ...authority,
      pattern: "eventbridge-schedule",
      generatedPermissionPresent: true,
      maximumRetryAttempts: 999,
    },
    expected: {
      accepted: false,
      findingCode: eventingApplicationEvaluationFindingCodesV4.unboundedRetry,
    },
  },
] as const satisfies readonly EventingApplicationEvaluationCaseV4[];

export const frozenEventingApplicationEvaluationDatasetV4 = Object.freeze({
  datasetId: "cloudmarkup.model-evaluation.eventing-application",
  datasetVersion: "4.0.0",
  cases: Object.freeze(cases),
  datasetDigest: digestCanonicalValue({
    datasetId: "cloudmarkup.model-evaluation.eventing-application",
    datasetVersion: "4.0.0",
    cases,
  }),
});

export interface EventingApplicationEvaluationCaseResultV4 {
  readonly caseId: string;
  readonly accepted: boolean;
  readonly findingCode?: EventingApplicationEvaluationFindingCodeV4;
  readonly passed: boolean;
}

export interface EventingApplicationEvaluationReportV4 {
  readonly datasetDigest: Sha256Digest;
  readonly executionMode: "deterministic";
  readonly results: readonly EventingApplicationEvaluationCaseResultV4[];
  readonly deterministicPassed: boolean;
}

export function evaluateEventingApplicationDesignV4(
  design: EventingApplicationEvaluationDesignV4,
): Omit<EventingApplicationEvaluationCaseResultV4, "caseId" | "passed"> {
  if (design.recursiveS3Notification === true) {
    return {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.recursiveNotification,
    };
  }
  if (design.sqsDirection === "lambda-to-queue") {
    return {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.wrongSqsDirection,
    };
  }
  if (design.generatedPermissionPresent === false) {
    return {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.missingPermission,
    };
  }
  if (
    design.queueType !== undefined &&
    design.deadLetterQueueType !== undefined &&
    design.queueType !== design.deadLetterQueueType
  ) {
    return {
      accepted: false,
      findingCode: eventingApplicationEvaluationFindingCodesV4.fifoMismatch,
    };
  }
  if (design.filterMode === "UNSUPPORTED") {
    return {
      accepted: false,
      findingCode:
        eventingApplicationEvaluationFindingCodesV4.unsupportedFilter,
    };
  }
  if (
    design.maximumRetryAttempts !== undefined &&
    (design.maximumRetryAttempts < 0 || design.maximumRetryAttempts > 185)
  ) {
    return {
      accepted: false,
      findingCode: eventingApplicationEvaluationFindingCodesV4.unboundedRetry,
    };
  }
  return { accepted: true };
}

export function runFrozenEventingApplicationEvaluationV4(): EventingApplicationEvaluationReportV4 {
  const results = frozenEventingApplicationEvaluationDatasetV4.cases.map(
    (evaluationCase): EventingApplicationEvaluationCaseResultV4 => {
      const actual = evaluateEventingApplicationDesignV4(evaluationCase.design);
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
    datasetDigest: frozenEventingApplicationEvaluationDatasetV4.datasetDigest,
    executionMode: "deterministic",
    results,
    deterministicPassed: results.every(({ passed }) => passed),
  };
}
