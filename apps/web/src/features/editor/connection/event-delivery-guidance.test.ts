import { describe, expect, it } from "vitest";

import { eventDeliveryGuidance } from "./event-delivery-guidance.js";

describe("event delivery guidance", () => {
  it("explains the queue consumer duplicate, ordering, retry, and cost interaction", () => {
    const guidance = eventDeliveryGuidance("aws.sqs.queue-triggers-lambda");

    expect(guidance?.delivery).toContain("at-least-once");
    expect(guidance?.ordering).toContain("FIFO");
    expect(guidance?.retry).toContain("cost");
  });

  it("explains bounded EventBridge retry and explicit DLQ posture", () => {
    const guidance = eventDeliveryGuidance(
      "aws.eventbridge.target-starts-state-machine",
    );

    expect(guidance?.delivery).toContain("duplicate");
    expect(guidance?.retry).toContain("bounded");
    expect(guidance?.retry).toContain("DLQ");
  });

  it("does not add event semantics to unrelated relationships", () => {
    expect(
      eventDeliveryGuidance("aws.lambda.writes-dynamodb-table"),
    ).toBeNull();
  });
});
