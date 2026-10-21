import { createAsyncJobFailureV1 } from "@cloudmarkup/domain";
import type {
  JobHandlerContextV1,
  JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobHandlerOutcomeV1Schema,
  type AsyncJobHandlerOutcomeV1,
  type AsyncJobObjectReferenceV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";

import type { ModelCommercialOperationRequestV1 } from "./commercial-lifecycle.js";
import type {
  IntentModelRequestV1,
  ModelIntentCommercialExecutionV1,
} from "./intent-commercial-service.js";
import { ModelIntentCommercialServiceV1 } from "./intent-commercial-service.js";
import type { ModelGatewayInvocationContextV1 } from "./ports.js";

export interface ModelIntentJobResolvedInputV1 {
  readonly commercialRequest: ModelCommercialOperationRequestV1;
  readonly context: ModelGatewayInvocationContextV1;
  readonly modelRequest: IntentModelRequestV1;
}

export interface ModelIntentJobInputResolverV1 {
  /** Resolves the authorized immutable input reference; never trusts tenant IDs in payload. */
  resolve(record: AsyncJobRecordV1): Promise<ModelIntentJobResolvedInputV1>;
}

export interface ModelIntentJobResultPublisherV1 {
  /** Persists the safe proposal result idempotently and returns its durable reference. */
  publish(input: {
    readonly job: AsyncJobRecordV1;
    readonly result: ModelIntentCommercialExecutionV1;
  }): Promise<AsyncJobObjectReferenceV1>;
}

export class ModelIntentJobHandlerV1 implements JobHandlerV1 {
  public readonly family = "intent-extraction" as const;
  public readonly handlerId = "cloudmarkup.model-intent-commercial.v1";
  public readonly handlerVersion = "1.0.0";
  public readonly resumePolicy = "restart-from-input" as const;
  readonly #input: ModelIntentJobInputResolverV1;
  readonly #publisher: ModelIntentJobResultPublisherV1;
  readonly #service: ModelIntentCommercialServiceV1;

  public constructor(input: {
    readonly input: ModelIntentJobInputResolverV1;
    readonly publisher: ModelIntentJobResultPublisherV1;
    readonly service: ModelIntentCommercialServiceV1;
  }) {
    this.#input = input.input;
    this.#publisher = input.publisher;
    this.#service = input.service;
  }

  public async execute(
    record: AsyncJobRecordV1,
    context: JobHandlerContextV1,
  ): Promise<AsyncJobHandlerOutcomeV1> {
    if (record.family !== this.family)
      return asyncJobHandlerOutcomeV1Schema.parse({
        failure: createAsyncJobFailureV1("handler-permanent-failure"),
        outcome: "failed",
      });
    if (await context.isCancellationRequested())
      return asyncJobHandlerOutcomeV1Schema.parse({ outcome: "canceled" });
    let resolved: ModelIntentJobResolvedInputV1;
    try {
      resolved = await this.#input.resolve(record);
    } catch {
      return asyncJobHandlerOutcomeV1Schema.parse({
        failure: createAsyncJobFailureV1("handler-permanent-failure"),
        outcome: "failed",
      });
    }
    if (
      resolved.context.scope.jobId !== record.jobId ||
      resolved.context.scope.organizationId !==
        record.ownership.organizationId ||
      resolved.context.scope.projectId !== record.ownership.projectId ||
      resolved.commercialRequest.jobId !== record.jobId ||
      resolved.commercialRequest.organizationId !==
        record.ownership.organizationId ||
      resolved.commercialRequest.projectId !== record.ownership.projectId
    ) {
      return asyncJobHandlerOutcomeV1Schema.parse({
        failure: createAsyncJobFailureV1("handler-permanent-failure"),
        outcome: "failed",
      });
    }
    const controller = new AbortController();
    if (await context.isCancellationRequested()) controller.abort();
    let result: ModelIntentCommercialExecutionV1;
    try {
      result = await this.#service.execute(
        resolved.commercialRequest,
        resolved.modelRequest,
        resolved.context,
        controller.signal,
      );
    } catch {
      return asyncJobHandlerOutcomeV1Schema.parse({
        failure: createAsyncJobFailureV1("handler-transient-failure"),
        outcome: "failed",
      });
    }
    if (await context.isCancellationRequested())
      return asyncJobHandlerOutcomeV1Schema.parse({ outcome: "canceled" });
    if (
      result.modelResult === null ||
      !["completed", "compensated"].includes(result.commercial.state)
    ) {
      const transient =
        result.commercial.state === "settlement-pending" ||
        result.commercial.state === "reconciliation-required" ||
        result.issues.some(
          (issue) => issue.category === "provider-unavailable",
        );
      return asyncJobHandlerOutcomeV1Schema.parse({
        failure: createAsyncJobFailureV1(
          transient ? "handler-transient-failure" : "handler-permanent-failure",
        ),
        outcome: "failed",
      });
    }
    const proposal = await this.#publisher.publish({ job: record, result });
    return asyncJobHandlerOutcomeV1Schema.parse({
      outcome: "succeeded",
      output: {
        contractVersion: 1,
        evidenceRecords: [],
        family: "intent-extraction",
        proposal,
      },
      outputSizeBytes: proposal.sizeBytes,
    });
  }
}
