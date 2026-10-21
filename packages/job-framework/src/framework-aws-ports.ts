import type {
  AsyncJobObjectReferenceV1,
  AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";

/**
 * Interface-only AWS integration seam. Implementations belong in provider
 * adapters and may translate these requests to SDK calls. This package imports
 * no AWS SDK and performs no provider operation.
 */
export interface AwsSqsJobQueueAdapterV1 {
  acknowledge(input: {
    readonly receiptHandleReference: string;
    readonly sourceQueueId: string;
  }): Promise<void>;
  publish(input: {
    readonly deduplicationId: string;
    readonly envelope: AsyncJobQueueEnvelopeV1;
    readonly messageGroupId: string;
    readonly targetQueueId: string;
  }): Promise<{ readonly messageId: string }>;
  receive(input: {
    readonly maximumMessages: number;
    readonly sourceQueueId: string;
    readonly visibilityTimeoutSeconds: number;
  }): Promise<
    readonly {
      readonly envelope: AsyncJobQueueEnvelopeV1;
      readonly messageId: string;
      readonly receiptHandleReference: string;
    }[]
  >;
}

export interface AwsStepFunctionsJobOrchestrationAdapterV1 {
  cancelExecution(input: {
    readonly executionReference: string;
    readonly safeReasonCode: string;
  }): Promise<void>;
  signalTaskFailure(input: {
    readonly safeFailureCode: string;
    readonly taskTokenReference: string;
  }): Promise<void>;
  signalTaskSuccess(input: {
    readonly output: AsyncJobObjectReferenceV1;
    readonly taskTokenReference: string;
  }): Promise<void>;
  startExecution(input: {
    readonly correlationId: string;
    readonly idempotencyName: string;
    readonly input: AsyncJobObjectReferenceV1;
    readonly stateMachineId: string;
  }): Promise<{ readonly executionReference: string }>;
}

export interface AwsLambdaJobInvocationAdapterV1 {
  invoke(input: {
    readonly correlationId: string;
    readonly functionId: string;
    readonly payload: AsyncJobObjectReferenceV1;
  }): Promise<{ readonly invocationReference: string }>;
}

export interface AwsCodeBuildJobAdapterV1 {
  cancelBuild(input: { readonly buildReference: string }): Promise<void>;
  getBuild(input: { readonly buildReference: string }): Promise<{
    readonly output: AsyncJobObjectReferenceV1 | null;
    readonly safeFailureCode: string | null;
    readonly state: "failed" | "running" | "succeeded";
  }>;
  startBuild(input: {
    readonly correlationId: string;
    readonly input: AsyncJobObjectReferenceV1;
    readonly projectId: string;
  }): Promise<{ readonly buildReference: string }>;
}

export interface AwsJobAdapterPortsV1 {
  readonly codeBuild: AwsCodeBuildJobAdapterV1;
  readonly lambda: AwsLambdaJobInvocationAdapterV1;
  readonly sqs: AwsSqsJobQueueAdapterV1;
  readonly stepFunctions: AwsStepFunctionsJobOrchestrationAdapterV1;
}
