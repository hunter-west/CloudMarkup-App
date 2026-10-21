import { readFileSync } from "node:fs";

import {
  existingApplicationFileV1Schema,
  type ApplicationGenerationResultV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  CURRENT_APPLICATION_CATALOG,
  EVENT_APPLICATION_GENERATOR_DIGEST,
  EVENT_APPLICATION_GENERATOR_ID,
  EVENT_APPLICATION_PATTERN_DIGEST,
  EVENT_APPLICATION_TEMPLATE_DESCRIPTOR,
  EVENT_APPLICATION_TEMPLATE_DIGEST,
  EVENT_S3_METADATA_PAYLOAD_CONTRACT,
  EVENT_SCHEDULED_PAYLOAD_AUTHORITY,
  EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE,
  EVENT_TRIGGER_DISPATCHER_DESCRIPTOR,
  EVENT_TRIGGER_DISPATCHER_DIGEST,
  sha256Digest,
} from "./constants.js";
import { generateApplication } from "./generate.js";
import {
  createEventGenerationRequest,
  createMultiWorkloadEventGenerationRequest,
  type EventFixturePattern,
} from "./test-fixtures.js";

const patterns = [
  "s3-image-metadata",
  "sqs-consumer-dlq",
  "sns-fanout-consumer",
  "eventbridge-scheduled",
  "eventbridge-target",
  "step-functions-task",
] as const satisfies readonly EventFixturePattern[];

function generate(pattern: EventFixturePattern, options = {}) {
  return generateApplication(
    createEventGenerationRequest({ pattern, ...options }),
  );
}

function sourceContent(
  result: ApplicationGenerationResultV1,
  suffix: string,
): string {
  const file = result.artifact.sourceFiles.find((candidate) =>
    candidate.path.endsWith(suffix),
  );
  if (file === undefined || !("content" in file)) {
    throw new Error(`Missing generated source ending in ${suffix}.`);
  }
  return file.content;
}

function sourceFile(result: ApplicationGenerationResultV1, suffix: string) {
  const file = result.artifact.sourceFiles.find((candidate) =>
    candidate.path.endsWith(suffix),
  );
  if (file === undefined) throw new Error(`Missing source ${suffix}.`);
  return file;
}

function diagnosticCodes(result: ApplicationGenerationResultV1): string[] {
  return result.artifact.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("curated event application generator", () => {
  it("publishes one immutable additive descriptor matrix", () => {
    expect(EVENT_APPLICATION_GENERATOR_ID).toBe(
      "cloudmarkup.event-application-generator",
    );
    expect(EVENT_APPLICATION_GENERATOR_DIGEST).toBe(
      "sha256:7cf9b85f31f427ac5f4dbe095bb227c10435fc86c84d8318ff41c88d5540e391",
    );
    expect(EVENT_APPLICATION_TEMPLATE_DIGEST).toBe(
      "sha256:a867606bd9806e1d56b948207ab544b5b50c61af642dfcc2382ca763da519111",
    );
    expect(EVENT_APPLICATION_PATTERN_DIGEST).toBe(
      "sha256:b74c6d0c918d5dd3eac3485cb5004aece78e7dc9a9936f3ecbd85aa012a53686",
    );
    expect(EVENT_TRIGGER_DISPATCHER_DIGEST).toBe(
      "sha256:02bb3cb413a02cc1751ab78b7e58cb7793eac117c4b7bf2271e8bf63517e6656",
    );
    expect(
      EVENT_TRIGGER_DISPATCHER_DESCRIPTOR.payloadAuthorities[
        "eventbridge-scheduled"
      ],
    ).toBe(EVENT_SCHEDULED_PAYLOAD_AUTHORITY);
    expect(
      EVENT_APPLICATION_TEMPLATE_DESCRIPTOR.completePatternContracts[
        "s3-image-metadata"
      ].payload,
    ).toBe(EVENT_S3_METADATA_PAYLOAD_CONTRACT);
    expect(
      EVENT_APPLICATION_TEMPLATE_DESCRIPTOR.completePatternContracts[
        "sqs-consumer-dlq"
      ].upstreamSnsToSqs,
    ).toBe(EVENT_SNS_SQS_RAW_DELIVERY_PREREQUISITE);
    expect(
      EVENT_APPLICATION_TEMPLATE_DESCRIPTOR.runtimeExtensionBoundary,
    ).toEqual({
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
    });
    expect(EVENT_SCHEDULED_PAYLOAD_AUTHORITY).toMatchObject({
      fieldBindings: [{ payloadField: "eventId", sourcePath: "$.id" }],
      nonAuthoritativePaths: ["$.detail"],
    });
    expect(CURRENT_APPLICATION_CATALOG).toEqual({
      id: "aws.cloudmarkup.notes-api-catalog",
      version: "0.30.0",
      digest:
        "sha256:8e9b1b23bbcdf723352044baddd8e79468d70ed5a719af914036992daf91fb94",
    });
  });

  it.each(patterns)(
    "emits complete deterministic source, tests, fixture, smoke seam, and build handoff for %s",
    (pattern) => {
      const request = createEventGenerationRequest({ pattern });
      const result = generateApplication(request);
      const workload = result.artifact.coverage.workloads[0];
      const handler = sourceContent(result, "/index.ts");
      const runtimeSeam = sourceFile(result, "/generated/runtime-extension.ts");
      const userExtension = sourceFile(result, "/extensions/custom.ts");
      const smoke = JSON.parse(sourceContent(result, ".smoke.json")) as Record<
        string,
        unknown
      >;
      const integration = JSON.parse(
        sourceContent(result, ".integration.json"),
      ) as Record<string, unknown>;

      expect(result.artifact.diagnostics).toEqual([]);
      expect(result.artifact.coverage.state).toBe("starter-application");
      expect(workload?.state).toBe("starter-application");
      expect(workload?.missingRequirements).toEqual([
        "application-build-and-tests",
        "application-security-checks",
      ]);
      expect(workload?.representedOperationIds).toHaveLength(1);
      expect(workload?.representedTestIds).toHaveLength(2);
      expect(result.artifact.buildContracts).toHaveLength(1);
      expect(handler).toContain("export const deliveryPolicy");
      expect(handler).toContain('"timeoutMilliseconds":30000');
      expect(handler).not.toMatch(/\n\s*payload,\n/u);
      expect(handler).toContain('from "./generated/runtime-extension.js"');
      expect(handler).not.toContain('from "./extensions/custom.js"');
      expect(runtimeSeam).toMatchObject({
        disposition: "create",
        ownership: "generated",
      });
      expect(
        sourceContent(result, "/generated/runtime-extension.ts"),
      ).toContain("Deterministic complete-pattern runtime seam");
      expect(userExtension).toMatchObject({
        disposition: "create",
        ownership: "user-owned",
      });
      expect(handler).toContain("console.log(JSON.stringify");
      expect(handler).not.toMatch(
        /(?:["']Records["']\s+in|semanticName|displayName|presentation\.label)/,
      );
      expect(
        result.artifact.sourceFiles.some((file) =>
          file.path.includes("/tests/fixtures/"),
        ),
      ).toBe(true);
      expect(Object.keys(smoke).sort()).toEqual([
        "assertions",
        "contractVersion",
        "eventContractId",
        "eventFixturePath",
        "executionBoundary",
        "extensionId",
        "handler",
        "kind",
        "state",
        "triggerPattern",
        "workloadId",
      ]);
      expect(smoke).toMatchObject({
        contractVersion: 1,
        kind: "cloudmarkup.smoke-test-extension-specification",
        state: "customer-implementation-required",
      });
      expect(integration).toMatchObject({
        contractVersion: 1,
        eventFixturePath: `application/tests/fixtures/event_${pattern.replaceAll("-", "_")}.json`,
        executionBoundary: "post-deploy-customer-workflow",
        kind: "cloudmarkup.integration-test-extension-specification",
        state: "customer-implementation-required",
        triggerPattern: pattern,
      });
      expect(typeof integration["eventContractId"]).toBe("string");
      if (pattern === "s3-image-metadata") {
        expect(handler).toContain("decodeURIComponent");
        expect(handler).toContain("PutItemCommand");
        const types = sourceContent(result, "/generated/types.ts");
        const contractTest = sourceContent(result, "/contracts.test.ts");
        expect(types).toContain("readonly eTag: string;");
        expect(types).toContain("readonly size: number;");
        expect(types).toContain("readonly versionId: string;");
        expect(types).toContain("readonly sequencer: string;");
        expect(types).not.toMatch(
          /readonly (?:eTag|size|versionId|sequencer)\?:/u,
        );
        expect(handler).toContain(
          'const eTag = requiredS3String(object.eTag, sourcePath + ".eTag");',
        );
        expect(handler).toContain(
          'const size = requiredS3Size(object.size, sourcePath + ".size");',
        );
        expect(handler).not.toMatch(
          /object\.(?:eTag|size|versionId|sequencer) \?\?/u,
        );
        expect(contractTest).toContain('"$.Records[0].s3.object." + field');
        expect(contractTest).toContain("$.Records[0].s3.bucket.name");
        expect(contractTest).toContain("expect(writer).not.toHaveBeenCalled()");
      } else if (pattern === "sqs-consumer-dlq") {
        expect(handler).toMatch(/messageId[\s\S]*batchItemFailures/);
        const idempotency = sourceContent(result, "/generated/idempotency.ts");
        const unit = sourceContent(result, "/unit.test.ts");
        expect(handler).toContain("batchItemFailures");
        expect(handler).toContain("duplicate-skipped");
        expect(handler).toContain("runIdempotent");
        expect(handler).toContain('"batchSize":10');
        expect(handler).toContain('"partialBatchFailure":true');
        expect(handler).toContain('"maximumAttempts":5');
        expect(handler).toContain('"deadLetterTargetKey"');
        expect(idempotency).toContain("IdempotencyHook");
        expect(idempotency).toContain("execute(");
        expect(idempotency).toContain("await operation()");
        expect(idempotency).not.toContain("claim(");
        expect(idempotency).toContain("invocationDeduplicator");
        expect(unit).toContain("message-invalid");
        expect(unit).toContain("message-valid-2");
        expect(unit).toContain("commits a durable identity only after success");
        expect(unit).toContain("RAW_SECRET_MARKER");
      } else if (pattern === "sns-fanout-consumer") {
        expect(handler).toContain("record.Sns.Message");
      } else if (pattern === "eventbridge-scheduled") {
        expect(handler).toContain("validatePayload({ eventId: event.id })");
        expect(handler).not.toContain("validatePayload(event.detail)");
        expect(sourceContent(result, "/contracts.test.ts")).toContain(
          "top-level AWS event identity",
        );
      } else if (pattern === "eventbridge-target") {
        expect(handler).toContain("validatePayload(event.detail)");
      } else {
        expect(handler).toContain("const identity = payload.eventId;");
        expect(handler).toContain("return payload");
        const edge = request.normalizedSolution.connections.find(
          ({ relationshipType }) =>
            relationshipType ===
            "aws.stepfunctions.state-machine-invokes-lambda",
        );
        expect(edge?.configuration).toMatchObject({
          schemaId: "aws.stepfunctions.lambda-task.connection",
          values: {
            maximumAttempts: { kind: "integer", value: 5 },
            retryMode: { kind: "string", value: "BOUNDED_EXPONENTIAL" },
            taskTimeoutSeconds: { kind: "integer", value: 30 },
          },
        });
        expect(Object.keys(edge?.configuration.values ?? {}).sort()).toEqual([
          "maximumAttempts",
          "retryMode",
          "taskTimeoutSeconds",
        ]);
        expect(handler).toContain('"maximumAttempts":5');
      }
    },
  );

  it("rejects a Step Functions task whose edge retry count conflicts with Workload authority", () => {
    const result = generate("step-functions-task", {
      mismatchedStepRetry: true,
    });

    expect(result.artifact.coverage.state).toBe("target-unsupported");
    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED",
    );
    expect(result.artifact.buildContracts).toEqual([]);
  });

  it("makes the supported Standard SQS source queue mode explicit", () => {
    const request = createEventGenerationRequest({
      pattern: "sqs-consumer-dlq",
    });
    const source = request.normalizedSolution.resources.find((resource) =>
      resource.id.startsWith("node_source_event_sqs_consumer_dlq"),
    );

    expect(source?.configuration.values["queueType"]).toEqual({
      kind: "string",
      value: "STANDARD",
    });
    expect(generateApplication(request).artifact.diagnostics).toEqual([]);
  });

  it("rejects a FIFO SQS source for the curated partial-batch consumer", () => {
    const result = generate("sqs-consumer-dlq", { fifoQueue: true });
    const diagnostic = result.artifact.diagnostics.find(
      (candidate) => candidate.code === "APPLICATION_EVENT_FIFO_UNSUPPORTED",
    );

    expect(result.artifact.coverage.state).toBe("target-unsupported");
    expect(result.artifact.buildContracts).toEqual([]);
    expect(diagnostic).toMatchObject({
      code: "APPLICATION_EVENT_FIFO_UNSUPPORTED",
      severity: "error",
      source: {
        document: "normalized-solution",
        path: "$.resources.configuration.values.queueType",
        workloadId: "workload_event_sqs_consumer_dlq",
        operationId: "operation_event_sqs_consumer_dlq",
        nodeId: "node_source_event_sqs_consumer_dlq",
        edgeId: "edge_trigger_event_sqs_consumer_dlq",
      },
    });
  });

  it("rejects an upstream SNS envelope that does not match the bound SQS payload", () => {
    const result = generate("sqs-consumer-dlq", {
      snsSqsUpstreamDelivery: "wrapped",
    });
    const diagnostic = result.artifact.diagnostics.find(
      (candidate) =>
        candidate.code === "APPLICATION_EVENT_SNS_SQS_ENVELOPE_UNSUPPORTED",
    );

    expect(result.artifact.coverage.state).toBe("target-unsupported");
    expect(result.artifact.buildContracts).toEqual([]);
    expect(diagnostic).toMatchObject({
      code: "APPLICATION_EVENT_SNS_SQS_ENVELOPE_UNSUPPORTED",
      severity: "error",
      source: {
        document: "normalized-solution",
        path: "$.resources.configuration.values.rawMessageDelivery",
        workloadId: "workload_event_sqs_consumer_dlq",
        operationId: "operation_event_sqs_consumer_dlq",
        nodeId: "node_sns_subscription_event_sqs_consumer_dlq",
        edgeId: "edge_sns_subscription_event_sqs_consumer_dlq",
      },
    });
  });

  it("accepts an upstream SNS subscription only with exact raw SQS delivery", () => {
    const result = generate("sqs-consumer-dlq", {
      snsSqsUpstreamDelivery: "raw",
    });

    expect(result.artifact.diagnostics).toEqual([]);
    expect(result.artifact.coverage.state).toBe("starter-application");
    expect(result.artifact.buildContracts).toHaveLength(1);
  });

  it.each([
    {
      options: { invalidS3MetadataShape: true },
      variant: "shape",
    },
    {
      options: { invalidS3MetadataKey: true },
      variant: "primary key",
    },
    {
      options: { invalidS3MetadataStorage: true },
      variant: "storage intent",
    },
    {
      options: { invalidS3MetadataOperations: true },
      variant: "operations",
    },
  ] as const)(
    "rejects unsupported S3 metadata contract $variant",
    ({ options }) => {
      const result = generate("s3-image-metadata", options);
      const diagnostic = result.artifact.diagnostics.find(
        (candidate) =>
          candidate.code ===
          "APPLICATION_EVENT_S3_METADATA_CONTRACT_UNSUPPORTED",
      );

      expect(result.artifact.coverage.state).toBe("target-unsupported");
      expect(result.artifact.buildContracts).toEqual([]);
      expect(diagnostic).toMatchObject({
        code: "APPLICATION_EVENT_S3_METADATA_CONTRACT_UNSUPPORTED",
        severity: "error",
        source: {
          document: "architecture",
          path: "$.applicationContracts.contracts",
          workloadId: "workload_event_s3_image_metadata",
          operationId: "operation_event_s3_image_metadata",
        },
      });
    },
  );

  it("rejects a scheduled payload that cannot be derived from top-level event authority", () => {
    const result = generate("eventbridge-scheduled", {
      invalidScheduledPayload: true,
    });
    const diagnostic = result.artifact.diagnostics.find(
      (candidate) =>
        candidate.code === "APPLICATION_EVENT_SCHEDULE_PAYLOAD_UNSUPPORTED",
    );

    expect(result.artifact.coverage.state).toBe("target-unsupported");
    expect(result.artifact.buildContracts).toEqual([]);
    expect(diagnostic).toMatchObject({
      code: "APPLICATION_EVENT_SCHEDULE_PAYLOAD_UNSUPPORTED",
      severity: "error",
      source: {
        document: "architecture",
        path: "$.applicationContracts.contracts",
        workloadId: "workload_event_eventbridge_scheduled",
        operationId: "operation_event_eventbridge_scheduled",
      },
    });
  });

  it.each([
    [
      { invalidDispatcher: true },
      "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED",
    ],
    [
      { unsupportedFilter: true },
      "APPLICATION_EVENT_CONFIGURATION_UNSUPPORTED",
    ],
    [{ wrongDirection: true }, "APPLICATION_EVENT_BINDING_UNSUPPORTED"],
    [{ missingDlq: true }, "APPLICATION_EVENT_DLQ_UNSUPPORTED"],
    [
      { mismatchedTimeout: true },
      "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED",
    ],
    [
      { excessiveTimeout: true },
      "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED",
    ],
    [{ unresolvedRetry: true }, "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED"],
    [{ invalidTimeout: true }, "APPLICATION_EVENT_WORKLOAD_SHAPE_UNSUPPORTED"],
  ] as const)(
    "rejects invalid explicit event authority %#",
    (options, code) => {
      const result = generate("sqs-consumer-dlq", options);
      expect(result.artifact.coverage.state).toBe("target-unsupported");
      expect(diagnosticCodes(result)).toContain(code);
      expect(result.artifact.buildContracts).toEqual([]);
    },
  );

  it("never embeds a secret reference and accesses environment at invocation time", () => {
    const result = generate("sqs-consumer-dlq", {
      includeSecretBinding: true,
    });
    const emitted = result.artifact.sourceFiles
      .flatMap((file) =>
        "content" in file && typeof file.content === "string"
          ? [file.content]
          : [],
      )
      .join("\n");

    expect(emitted).not.toContain("secret_reference_not_a_value");
    expect(sourceContent(result, "/generated/bindings.ts")).toContain(
      "process.env[name]",
    );
  });

  it("is byte deterministic and exposes a starter state without claiming completeness", () => {
    const first = generate("eventbridge-target");
    const second = generate("eventbridge-target");
    const starter = generateApplication(
      createEventGenerationRequest({
        pattern: "eventbridge-target",
        mode: "generated-starter",
      }),
    );

    expect(first).toEqual(second);
    expect(first.artifactDigest).toBe(second.artifactDigest);
    expect(starter.artifact.coverage.state).toBe("starter-application");
    expect(starter.artifact.coverage.missingRequirements).toContain(
      "application-build-and-tests",
    );
  });

  it("preserves user-owned extensions and fails closed on a user-owned generated-path conflict", () => {
    const baseline = generate("sns-fanout-consumer");
    const handler = sourceFile(baseline, "/index.ts");
    const extension = sourceFile(baseline, "/extensions/custom.ts");
    const existing = (file: typeof handler) =>
      existingApplicationFileV1Schema.parse({
        path: file.path,
        mediaType: file.mediaType,
        ownership: "user-owned",
        currentChecksum: sha256Digest(`user bytes:${file.path}`),
        semanticChecksum: sha256Digest(`user semantics:${file.path}`),
        sizeBytes: 31,
      });
    const preserved = generateApplication(
      createEventGenerationRequest({
        pattern: "sns-fanout-consumer",
        existingFiles: [existing(extension)],
      }),
    );
    const conflicted = generateApplication(
      createEventGenerationRequest({
        pattern: "sns-fanout-consumer",
        existingFiles: [existing(handler)],
      }),
    );

    expect(
      preserved.artifact.sourceFiles.find(
        (file) => file.path === extension.path,
      ),
    ).toMatchObject({ disposition: "preserve", ownership: "user-owned" });
    expect(preserved.artifact.coverage.state).toBe(
      "custom-implementation-required",
    );
    expect(preserved.artifact.buildContracts).toEqual([]);
    expect(diagnosticCodes(conflicted)).toContain(
      "APPLICATION_SOURCE_CONFLICT",
    );
    expect(conflicted.artifact.buildContracts).toEqual([]);
  });

  it("emits two independent handlers and build contracts for SNS fan-out", () => {
    const result = generateApplication(
      createMultiWorkloadEventGenerationRequest(),
    );
    expect(result.artifact.diagnostics).toEqual([]);
    expect(result.artifact.coverage.state).toBe("starter-application");
    expect(result.artifact.coverage.workloads).toHaveLength(2);
    expect(result.artifact.buildContracts).toHaveLength(2);
    expect(
      new Set(
        result.artifact.buildContracts.map(
          (envelope) => envelope.contract.entrypoint,
        ),
      ).size,
    ).toBe(2);
  });

  it("matches the checked event source checksum golden", () => {
    const golden = JSON.parse(
      readFileSync(
        new URL("../fixtures/event-source-golden.json", import.meta.url),
        "utf8",
      ),
    ) as Record<
      EventFixturePattern,
      {
        readonly artifactDigest: string;
        readonly buildContractDigest: string;
        readonly fixtureChecksum: string;
        readonly handlerChecksum: string;
      }
    >;
    const actual = Object.fromEntries(
      patterns.map((pattern) => {
        const result = generate(pattern);
        return [
          pattern,
          {
            artifactDigest: result.artifactDigest,
            buildContractDigest:
              result.artifact.buildContracts[0]?.contractDigest,
            fixtureChecksum: sourceFile(
              result,
              "/tests/fixtures/" + `event_${pattern.replace(/-/g, "_")}.json`,
            ).checksum,
            handlerChecksum: sourceFile(result, "/index.ts").checksum,
          },
        ];
      }),
    );
    expect(actual).toEqual(golden);
  });
});
