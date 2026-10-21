import { describe, expect, it } from "vitest";

import {
  applicationTestExpectationV1Schema,
  applicationTestPreconditionV1Schema,
  contractFieldTypeV1Schema,
} from "./application-contracts-v1.js";

const digest =
  "sha256:4444444444444444444444444444444444444444444444444444444444444444";

describe("Application Contracts v1 bounded invariants", () => {
  it("rejects inverted collection and event-count bounds", () => {
    expect(() =>
      contractFieldTypeV1Schema.parse({
        kind: "scalar-list",
        itemType: "string",
        minimumItems: 10,
        maximumItems: 2,
      }),
    ).toThrow();

    expect(() =>
      applicationTestExpectationV1Schema.parse({
        expectationId: "expectation_event",
        kind: "event-emitted",
        event: {
          contractKind: "event-message",
          contractId: "contracts.notes.created-event",
          contractVersion: "1.0.0",
          digest,
        },
        minimumCount: 2,
        maximumCount: 1,
      }),
    ).toThrow();
  });

  it("admits only typed declarative test preconditions", () => {
    expect(
      applicationTestPreconditionV1Schema.parse({
        kind: "fixture-available",
        fixtureId: "fixture_note",
        digest,
      }).kind,
    ).toBe("fixture-available");

    expect(() =>
      applicationTestPreconditionV1Schema.parse("npm test"),
    ).toThrow();
    expect(() =>
      applicationTestPreconditionV1Schema.parse({
        kind: "shell-command",
        command: "npm test",
      }),
    ).toThrow();
  });
});
