import { describe, expect, it } from "vitest";
import {
  type ArchitectureDocumentV3,
  serviceConfigurationRecordSchema,
} from "@cloudmarkup/schemas";
import { inspectModelLiveEventCoverage } from "./model-live-event-coverage.js";
import { createSyntheticEventGraph } from "./model-live-event-test-helpers.js";

const score = (doc: unknown, criterion: string) =>
  inspectModelLiveEventCoverage(doc).criteria.find(
    (c) => c.criterion === criterion,
  )?.satisfied;
function setting(
  doc: ArchitectureDocumentV3,
  id: string,
  key: string,
  raw: unknown,
) {
  const n = doc.nodes.find((n) => n.id === id);
  if (!n) throw Error("Missing synthetic node");
  n.semantic.configuration.values =
    serviceConfigurationRecordSchema.shape.values.parse({
      ...n.semantic.configuration.values,
      [key]: raw,
    });
}

describe("event coverage from actual graph relationships and settings", () => {
  it("measures all nine topology requirements without claiming full rule safety", () => {
    const { doc } = createSyntheticEventGraph();
    expect(inspectModelLiveEventCoverage(doc)).toMatchObject({
      numerator: 9,
      denominator: 9,
    });
  });
  it.each([
    ["aws.s3.notifies-lambda", "object-created-asynchronous-invocation"],
    ["aws.iam.role-assumed-by-lambda", "explicit-execution-role"],
    ["aws.iam.role-owns-inline-policy", "scoped-input-object-read"],
    ["aws.iam.authorizes-s3-bucket", "separate-output-bucket"],
    [
      "aws.lambda.owns-invocation-permission",
      "scoped-s3-invocation-permission",
    ],
    ["aws.iam.statement-owns-condition", "scoped-s3-invocation-permission"],
    ["aws.lambda.uses-sqs-dead-letter-queue", "bounded-failure-destination"],
    ["aws.lambda.writes-log-group", "explicit-log-destination"],
  ])("requires the actual %s relationship", (relation, criterion) => {
    const { doc } = createSyntheticEventGraph();
    doc.edges = doc.edges.filter(
      (e) => e.semantic.relationshipType !== relation,
    );
    expect(score(doc, criterion)).toBe(false);
  });
  it.each([
    [
      "ReadInput",
      "actions",
      { kind: "string-list", value: ["s3:*"] },
      "scoped-input-object-read",
    ],
    [
      "WriteOutput",
      "effect",
      { kind: "string", value: "deny" },
      "separate-output-bucket",
    ],
    [
      "source",
      "values",
      { kind: "string-list", value: ["arn:aws:s3:::*"] },
      "scoped-s3-invocation-permission",
    ],
    [
      "InvokeLambda",
      "principals",
      { kind: "string-list", value: ["sns.amazonaws.com"] },
      "scoped-s3-invocation-permission",
    ],
    [
      "output",
      "bucketName",
      { kind: "string", value: "synthetic-image-input" },
      "separate-output-bucket",
    ],
    [
      "output",
      "blockPublicAccess",
      { kind: "boolean", value: false },
      "private-encrypted-buckets",
    ],
    [
      "lambda",
      "timeoutSeconds",
      { kind: "integer", value: 999 },
      "bounded-failure-destination",
    ],
    [
      "dlq",
      "messageRetentionSeconds",
      { kind: "integer", value: 1 },
      "bounded-failure-destination",
    ],
    [
      "dlq",
      "queueType",
      { kind: "string", value: "FIFO" },
      "bounded-failure-destination",
    ],
  ] as const)(
    "does not infer valid coverage from %s.%s",
    (id, key, raw, criterion) => {
      const { doc } = createSyntheticEventGraph();
      setting(doc, id, key, raw);
      expect(score(doc, criterion)).toBe(false);
    },
  );
  it("rejects recursion and decorative or incorrectly directed edges", () => {
    const f = createSyntheticEventGraph();
    f.link("output", "lambda", "aws.s3.notifies-lambda");
    expect(score(f.doc, "object-created-asynchronous-invocation")).toBe(false);
    const { doc } = createSyntheticEventGraph();
    const edge = doc.edges.find(
      (e) => e.semantic.relationshipType === "aws.s3.notifies-lambda",
    );
    if (!edge) throw Error("Missing event");
    edge.semantic.target.port = "example.decorative" as never;
    expect(score(doc, "object-created-asynchronous-invocation")).toBe(false);
  });
  it("preserves input and ignores presentation", () => {
    const { doc } = createSyntheticEventGraph();
    const original = structuredClone(doc),
      first = inspectModelLiveEventCoverage(doc);
    expect(doc).toEqual(original);
    doc.nodes.forEach((n) => {
      n.presentation.label = "Prettier";
      n.presentation.position = { x: 100, y: 200 };
    });
    expect(inspectModelLiveEventCoverage(doc)).toEqual(first);
  });
  it.each([
    ["ReadInput", "input", "aws.s3.bucket.id", "scoped-input-object-read"],
    ["WriteOutput", "output", "aws.s3.bucket.id", "separate-output-bucket"],
    ["SendFailure", "dlq", "aws.sqs.queue.url", "bounded-failure-destination"],
    [
      "InvokeLambda",
      "lambda",
      "aws.lambda.function.name",
      "scoped-s3-invocation-permission",
    ],
  ])(
    "requires the exact ARN attribute for %s",
    (id, nodeId, attribute, criterion) => {
      const { doc } = createSyntheticEventGraph();
      setting(doc, id, "resourceNode", {
        kind: "node-reference",
        nodeId,
        attribute,
      });
      expect(score(doc, criterion)).toBe(false);
    },
  );
  it.each([
    [
      "aws.lambda.uses-sqs-dead-letter-queue",
      "deliverySemantics",
      "AT_LEAST_ONCE_UNORDERED",
      "bounded-failure-destination",
    ],
    [
      "aws.s3.notifies-lambda",
      "eventType",
      "OBJECT_REMOVED",
      "object-created-asynchronous-invocation",
    ],
    [
      "aws.s3.notifies-lambda",
      "filterPrefix",
      "x".repeat(1025),
      "object-created-asynchronous-invocation",
    ],
  ])("requires supported %s.%s values", (relation, key, value, criterion) => {
    const { doc } = createSyntheticEventGraph();
    const edge = doc.edges.find(
      (e) => e.semantic.relationshipType === relation,
    );
    if (!edge) throw Error("Missing synthetic relationship");
    edge.semantic.configuration.values =
      serviceConfigurationRecordSchema.shape.values.parse({
        ...edge.semantic.configuration.values,
        [key]: { kind: "string", value },
      });
    expect(score(doc, criterion)).toBe(false);
  });
  it("rejects stale catalog metadata", () => {
    const { doc } = createSyntheticEventGraph();
    doc.catalog.version = "0.1.0" as never;
    expect(() => inspectModelLiveEventCoverage(doc)).toThrow(
      "current event evaluation catalog",
    );
  });
});
