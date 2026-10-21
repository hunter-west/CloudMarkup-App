import {
  asyncJobHandlerOutcomeV1Schema,
  asyncJobOutputV1Schema,
  type AsyncJobFamilyV1,
  type AsyncJobHandlerOutcomeV1,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import type { AsyncJobHandlerResumePolicyV1 } from "@cloudmarkup/domain";

import { JobExecutionError } from "./framework-contracts.js";
import type { JobHandlerV1 } from "./framework-ports.js";

const FAKE_DIGEST = `sha256:${"a".repeat(64)}`;

function objectReference(
  record: AsyncJobRecordV1,
  purpose: string,
  sizeBytes: number,
) {
  return {
    contractVersion: 1,
    digest: FAKE_DIGEST,
    mediaType: "application/vnd.cloudmarkup.fake+json",
    objectId: `object_${record.jobId}_${purpose}`,
    purpose,
    sizeBytes,
  };
}

function artifact(
  record: AsyncJobRecordV1,
  purpose: string,
  sizeBytes: number,
) {
  return {
    artifactId: `artifact_${record.jobId}_${purpose}`,
    availability: { state: "available" },
    object: objectReference(record, purpose, sizeBytes),
  };
}

function evidence(record: AsyncJobRecordV1) {
  if (record.input.subject.kind !== "solution-revision") {
    return [];
  }
  const environment =
    "environment" in record.input
      ? record.input.environment
      : { environmentType: "unknown" as const };
  return [
    {
      environment,
      evidenceId: `evidence_${record.jobId}`,
      record: objectReference(record, "evidence", 128),
      solutionRevisionId: record.input.subject.solutionRevisionId,
    },
  ];
}

function referencedBytes(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (total, child) => total + referencedBytes(child),
      0,
    );
  }
  if (value === null || typeof value !== "object") {
    return 0;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["objectId"] === "string" &&
    typeof candidate["sizeBytes"] === "number"
  ) {
    return candidate["sizeBytes"];
  }
  return Object.values(candidate).reduce<number>(
    (total, child) => total + referencedBytes(child),
    0,
  );
}

function fakeOutput(record: AsyncJobRecordV1, sizeBytes: number) {
  const common = { contractVersion: 1, evidenceRecords: evidence(record) };
  switch (record.family) {
    case "intent-extraction":
    case "architecture-proposal":
    case "workload-contract-proposal":
    case "graph-workload-operation-proposal":
      return asyncJobOutputV1Schema.parse({
        ...common,
        evidenceRecords: [],
        family: record.family,
        proposal: objectReference(record, "proposal", sizeBytes),
      });
    case "iac-compilation":
      return asyncJobOutputV1Schema.parse({
        ...common,
        compiledInfrastructure: artifact(record, "build-output", sizeBytes),
        family: record.family,
      });
    case "application-source-generation":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        generatedSource: artifact(record, "generated-source", sizeBytes),
      });
    case "application-build-test-package":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        package: artifact(record, "build-output", sizeBytes),
      });
    case "static-validation":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        report: artifact(record, "validation-report", sizeBytes),
      });
    case "diagram-rendering":
      return asyncJobOutputV1Schema.parse({
        ...common,
        diagram: artifact(record, "diagram", sizeBytes),
        evidenceRecords: [],
        family: record.family,
      });
    case "combined-export-packaging":
      return asyncJobOutputV1Schema.parse({
        ...common,
        evidenceRecords: [],
        family: record.family,
        package: artifact(record, "export-package", sizeBytes),
      });
    case "solution-export-orchestration":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        verifiedPackage: artifact(record, "export-package", sizeBytes),
      });
    case "github-repository-export":
      return asyncJobOutputV1Schema.parse({
        ...common,
        commitSha: "a".repeat(40),
        family: record.family,
        receipt: artifact(record, "repository-export-receipt", sizeBytes),
      });
    case "customer-owned-plan-evidence":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        result: artifact(record, "plan-result", sizeBytes),
      });
    case "deployment-evidence":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        result: artifact(record, "deployment-result", sizeBytes),
      });
    case "smoke-integration-evidence":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        result: artifact(record, "smoke-integration-result", sizeBytes),
      });
    case "drift-evidence":
      return asyncJobOutputV1Schema.parse({
        ...common,
        family: record.family,
        result: artifact(record, "drift-result", sizeBytes),
      });
    case "billing-usage-reconciliation":
      return asyncJobOutputV1Schema.parse({
        ...common,
        evidenceRecords: [],
        family: record.family,
        reconciliation: artifact(
          record,
          "billing-reconciliation-result",
          sizeBytes,
        ),
      });
  }
}

export class DeterministicFakeJobHandler implements JobHandlerV1 {
  public readonly family: AsyncJobFamilyV1;
  public readonly handlerId = "job.deterministic-fake";
  public readonly handlerVersion = "1.0.0";
  public readonly resumePolicy = "restart-from-input";
  readonly #outputSizeBytes: number;

  public constructor(family: AsyncJobFamilyV1, outputSizeBytes = 128) {
    this.family = family;
    this.#outputSizeBytes = outputSizeBytes;
  }

  public execute(record: AsyncJobRecordV1): Promise<AsyncJobHandlerOutcomeV1> {
    const output = fakeOutput(record, this.#outputSizeBytes);
    return Promise.resolve(
      asyncJobHandlerOutcomeV1Schema.parse({
        outcome: "succeeded",
        output,
        outputSizeBytes: referencedBytes(output),
      }),
    );
  }
}

export type ScriptedFakeStepV1 =
  | AsyncJobHandlerOutcomeV1
  | { readonly error: unknown; readonly kind: "unsafe-error" };

export class ScriptedFakeJobHandler implements JobHandlerV1 {
  public readonly family: AsyncJobFamilyV1;
  public readonly handlerId = "job.scripted-fake";
  public readonly handlerVersion = "1.0.0";
  public readonly resumePolicy: AsyncJobHandlerResumePolicyV1;
  readonly #steps: ScriptedFakeStepV1[];
  public calls = 0;

  public constructor(
    family: AsyncJobFamilyV1,
    steps: readonly ScriptedFakeStepV1[],
    resumePolicy: AsyncJobHandlerResumePolicyV1 = "restart-from-input",
  ) {
    this.family = family;
    this.#steps = [...steps];
    this.resumePolicy = resumePolicy;
  }

  public execute(): Promise<AsyncJobHandlerOutcomeV1> {
    const step = this.#steps[this.calls];
    this.calls += 1;
    if (step === undefined) {
      return Promise.reject(
        new JobExecutionError({
          classification: "permanent",
          code: "job.fake-script-exhausted" as never,
          publicMessage: "job-internal-error",
        }),
      );
    }
    return Promise.resolve().then(() => {
      if ("kind" in step) {
        throw step.error;
      }
      return step;
    });
  }
}
