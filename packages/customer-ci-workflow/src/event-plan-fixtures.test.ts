import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  analyzeSanitizedTerraformPlanV1,
  sanitizeTerraformPlanV1,
} from "./plan-integrity.js";
import { canonicalJson } from "./security.js";

const eventPlanPath = new URL(
  "./fixtures/event-queue-consumer-plan.fake.json",
  import.meta.url,
);

describe("sanitized fake Terraform event plan fixture", () => {
  it("retains event resource structure while removing addresses and policy data", () => {
    const input = JSON.parse(readFileSync(eventPlanPath, "utf8")) as unknown;
    const first = sanitizeTerraformPlanV1(input);
    const repeated = sanitizeTerraformPlanV1(input);
    const analysis = analyzeSanitizedTerraformPlanV1(first);

    expect(repeated).toEqual(first);
    expect(analysis.counts).toEqual({
      create: 4,
      delete: 0,
      noOp: 0,
      read: 0,
      replace: 0,
      update: 0,
    });
    expect(analysis.changes).toHaveLength(4);
    expect(analysis.changes.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "aws_iam_role_policy",
        "aws_lambda_event_source_mapping",
        "aws_sqs_queue",
        "aws_sqs_queue",
      ]),
    );

    const retained = canonicalJson({ analysis, sanitized: first });
    for (const forbidden of [
      "aws_sqs_queue.work",
      "aws_sqs_queue.work_dlq",
      "aws_iam_role_policy.consumer_queue",
      "aws_lambda_event_source_mapping.work",
      "queue-consumer-access",
      "fixture-redacted",
      "after_sensitive",
    ]) {
      expect(retained).not.toContain(forbidden);
    }
  });
});
