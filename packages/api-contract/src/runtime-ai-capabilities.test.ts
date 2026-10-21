import { expect, it } from "vitest";
import {
  runtimeAiCapabilitiesV1Schema,
  UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1,
} from "./runtime-ai-capabilities.js";

it("advertises exact reviewed versions without granting actor or edit authority", () => {
  expect(
    runtimeAiCapabilitiesV1Schema.parse(UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1),
  ).toEqual(UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1);
  expect(
    runtimeAiCapabilitiesV1Schema.parse({
      schemaVersion: 1,
      proposalVersions: [6],
      applicationSources: ["ai-source-draft-v3"],
    }),
  ).toHaveProperty("proposalVersions", [6]);
});
it.each([
  { proposalVersions: [5] },
  { proposalVersions: [6, 6] },
  { applicationSources: ["ai-source-draft-v2"] },
  { applicationSources: ["ai-source-draft-v3", "ai-source-draft-v3"] },
  { tenantId: "org_private" },
  { policyEdits: true },
  { schemaVersion: 2 },
])("refuses contradictory or expanded runtime support %#", (extra) => {
  expect(
    runtimeAiCapabilitiesV1Schema.safeParse({
      ...UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1,
      ...extra,
    }).success,
  ).toBe(false);
});
