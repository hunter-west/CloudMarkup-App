import { describe, expect, it } from "vitest";

import {
  modelRuntimeAuditEventV1Schema,
  modelRuntimeMetricV1Schema,
} from "@cloudmarkup/schemas";

import {
  ModelRuntimeControlError,
  parseModelRuntimeTelemetryOutboxEntryV1,
  type ModelRuntimeTelemetryOutboxEntryV1,
} from "./model-runtime-controls.js";
import { digestStructuredValue, sha256Text } from "./security.js";

function fixture(): ModelRuntimeTelemetryOutboxEntryV1 {
  const audit = modelRuntimeAuditEventV1Schema.parse({
    admissionDecisionDigest: sha256Text("synthetic admission"),
    contractVersion: 1,
    eventId: "event.synthetic-preview",
    eventKind: "safety-issue",
    idempotencyKeyDigest: sha256Text("synthetic request"),
    noRawPromptResponseRepositoryOrCandidateContent: true,
    occurredAt: "2026-09-06T12:00:00.000Z",
    organizationId: "organization.synthetic",
    projectId: "project.synthetic",
    recordKind: "model-runtime-audit-event",
    referenceDigests: [sha256Text("synthetic output metadata")],
    safeReasonCodes: ["cloudmarkup.preview.delivery-unconfirmed"],
    userId: "principal.synthetic",
  });
  const metric = modelRuntimeMetricV1Schema.parse({
    contractVersion: 1,
    eventKind: "safety-issue",
    metricId: "metric.synthetic-preview",
    noRawSensitiveDimensions: true,
    occurredAt: audit.occurredAt,
    organizationScopeDigest: sha256Text("synthetic organization scope"),
    recordKind: "model-runtime-metric",
    sourceAuthority: "runtime-control-v1",
    unit: "count",
    value: 1,
  });
  return { audit, metric, outboxId: digestStructuredValue({ audit, metric }) };
}

function rehash(audit: unknown, metric: unknown) {
  return { audit, metric, outboxId: digestStructuredValue({ audit, metric }) };
}

describe("metadata-only runtime outbox projection", () => {
  it("preserves canonical schema and digest parity while isolating nested input objects", () => {
    const input = fixture();
    const parsed = parseModelRuntimeTelemetryOutboxEntryV1(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.audit).not.toBe(input.audit);
    expect(parsed.metric).not.toBe(input.metric);
    expect(parsed.audit.referenceDigests).not.toBe(
      input.audit.referenceDigests,
    );
    expect(parsed.audit.safeReasonCodes).not.toBe(input.audit.safeReasonCodes);
    expect(parsed.audit).toEqual(
      modelRuntimeAuditEventV1Schema.parse(input.audit),
    );
    expect(parsed.metric).toEqual(
      modelRuntimeMetricV1Schema.parse(input.metric),
    );
    expect(parsed.outboxId).toBe(
      digestStructuredValue({ audit: parsed.audit, metric: parsed.metric }),
    );
    expect(
      parseModelRuntimeTelemetryOutboxEntryV1(
        JSON.parse(JSON.stringify(parsed)),
      ),
    ).toEqual(parsed);
  });

  it.each(["top-level", "audit", "metric"] as const)(
    "rejects unrecognized %s metadata even with a recomputed digest",
    (level) => {
      const input = fixture();
      const extra = {
        candidateText: "Synthetic unaccepted preview must not be retained.",
      };
      const candidate =
        level === "top-level"
          ? { ...input, ...extra }
          : level === "audit"
            ? rehash({ ...input.audit, ...extra }, input.metric)
            : rehash(input.audit, { ...input.metric, ...extra });
      expect(() => parseModelRuntimeTelemetryOutboxEntryV1(candidate)).toThrow(
        ModelRuntimeControlError,
      );
    },
  );

  it("rejects changed digests and changed metadata under the original identity", () => {
    const input = fixture();
    expect(() =>
      parseModelRuntimeTelemetryOutboxEntryV1({
        ...input,
        outboxId: sha256Text("unrelated outbox"),
      }),
    ).toThrow(ModelRuntimeControlError);
    expect(() =>
      parseModelRuntimeTelemetryOutboxEntryV1({
        ...input,
        metric: { ...input.metric, value: 2 },
      }),
    ).toThrow(ModelRuntimeControlError);
  });

  it.each([
    "api-key",
    "credential",
    "password",
    "private-key",
    "secret",
    "token",
  ])(
    "rejects credential-sensitive safe-reason segment %s independently of its valid digest",
    (segment) => {
      const input = fixture();
      const audit = modelRuntimeAuditEventV1Schema.parse({
        ...input.audit,
        safeReasonCodes: [`cloudmarkup.${segment}.synthetic`],
      });
      expect(() =>
        parseModelRuntimeTelemetryOutboxEntryV1(rehash(audit, input.metric)),
      ).toThrow(ModelRuntimeControlError);
    },
  );

  it.each([
    [
      "audit content declaration",
      (input: ModelRuntimeTelemetryOutboxEntryV1) =>
        rehash(
          {
            ...input.audit,
            noRawPromptResponseRepositoryOrCandidateContent: false,
          },
          input.metric,
        ),
    ],
    [
      "metric sensitive dimensions",
      (input: ModelRuntimeTelemetryOutboxEntryV1) =>
        rehash(input.audit, {
          ...input.metric,
          noRawSensitiveDimensions: false,
        }),
    ],
    [
      "negative metric",
      (input: ModelRuntimeTelemetryOutboxEntryV1) =>
        rehash(input.audit, { ...input.metric, value: -1 }),
    ],
    [
      "wrong credit authority",
      (input: ModelRuntimeTelemetryOutboxEntryV1) =>
        rehash(input.audit, { ...input.metric, unit: "credit-units" }),
    ],
    [
      "duplicate audit reasons",
      (input: ModelRuntimeTelemetryOutboxEntryV1) =>
        rehash(
          {
            ...input.audit,
            safeReasonCodes: [
              ...input.audit.safeReasonCodes,
              ...input.audit.safeReasonCodes,
            ],
          },
          input.metric,
        ),
    ],
  ] as const)("retains declared-schema rejection for %s", (_label, tamper) => {
    expect(() =>
      parseModelRuntimeTelemetryOutboxEntryV1(tamper(fixture())),
    ).toThrow(ModelRuntimeControlError);
  });

  it.each([null, [], { audit: {}, metric: {} }])(
    "rejects incomplete or non-record input %#",
    (input) => {
      expect(() => parseModelRuntimeTelemetryOutboxEntryV1(input)).toThrow(
        ModelRuntimeControlError,
      );
    },
  );
});
