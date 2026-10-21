import { describe, expect, it } from "vitest";
import { modelSafetyRefusalBatchV1Schema } from "./model-gateway-v1.js";
const refusal = {
  contractVersion: 1,
  kind: "safety-refusal",
  reasonCodes: ["reject-resource-limit"],
  explanation: "The requested work exceeds the reviewed request bounds.",
};
describe("closed non-mutating model refusal compatibility", () => {
  it.each([
    "reject-prompt-injection",
    "secret-redaction",
    "no-credential-authority",
    "no-deployment-authority",
    "reject-unsupported-service",
    "reject-unsupported-field",
    "reject-resource-limit",
  ])("accepts the reviewed %s reason without command authority", (reason) => {
    expect(
      modelSafetyRefusalBatchV1Schema.parse({
        ...refusal,
        reasonCodes: [reason],
      }),
    ).toEqual({ ...refusal, reasonCodes: [reason] });
  });
  it.each([
    { ...refusal, reasonCodes: [] },
    {
      ...refusal,
      reasonCodes: ["reject-resource-limit", "reject-resource-limit"],
    },
    { ...refusal, reasonCodes: ["skip-tenant-authorization"] },
    {
      ...refusal,
      reasonCodes: [
        "reject-resource-limit",
        "reject-unsupported-service",
        "reject-unsupported-field",
        "secret-redaction",
        "no-deployment-authority",
      ],
    },
    { ...refusal, commands: [] },
    { ...refusal, accepted: true },
    { ...refusal, explanation: "" },
  ])("rejects malformed or authority-bearing refusal %#", (value) => {
    expect(modelSafetyRefusalBatchV1Schema.safeParse(value).success).toBe(
      false,
    );
  });
});
