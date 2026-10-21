import { describe, expect, it } from "vitest";

import {
  workloadImplementationV2Schema,
  workloadV2Schema,
} from "./workload-behavior-v2.js";

const digest =
  "sha256:5555555555555555555555555555555555555555555555555555555555555555";

const baseWorkload = {
  id: "workload_compatibility",
  owningNodeId: "node_workload",
  implementation: { mode: "infrastructure-only" },
  operations: [],
  behaviorContracts: [],
  triggers: [],
  downstreamActions: [],
  environment: [
    {
      id: "environment_secret",
      name: "API_SECRET",
      value: { kind: "secret-reference", reference: "secret_api" },
    },
  ],
  errorBehavior: { mode: "fail-invocation" },
  executionAssumptions: {
    timeout: { kind: "unresolved" },
    retry: { kind: "unresolved" },
  },
  triggerDispatch: { mode: "single" },
  unresolvedRequirementIds: [],
  entrypoints: [],
  httpRoutes: [],
  eventBindings: [],
  schedules: [],
  dataBindings: [],
  authorization: [],
  idempotency: [],
  observability: { signals: [], healthChecks: [], smokeTests: [] },
  tests: [],
  sourceOwnership: [],
  extensionPoints: [],
  extensions: [],
  implementationRequirements: [],
  compatibility: { applicationGenerators: [], modelGateways: [] },
  provenance: {
    source: "deterministic-migration",
    migrationId: "cloudmarkup.workload.v1-to-v2",
    migrationVersion: "1.0.0",
  },
} as const;

describe("Workload Behavior v2 compatibility invariants", () => {
  it("parses full workloads with every preserved v1 implementation mode", () => {
    const executable = {
      runtimeFamily: "runtime.nodejs.lambda",
      handler: "src/handler.main",
    } as const;
    const implementations = [
      { mode: "infrastructure-only" },
      { ...executable, mode: "user-provided", sourceOwnership: "user" },
      {
        ...executable,
        mode: "generated-starter",
        sourceOwnership: "cloudmarkup",
      },
      {
        ...executable,
        mode: "external-artifact",
        sourceOwnership: "external",
        artifact: { artifactId: "artifact_workload", digest },
      },
    ] as const;

    expect(
      implementations.map(
        (implementation) =>
          workloadV2Schema.parse({ ...baseWorkload, implementation })
            .implementation.mode,
      ),
    ).toEqual([
      "infrastructure-only",
      "user-provided",
      "generated-starter",
      "external-artifact",
    ]);
  });

  it("requires validation evidence for AI-assisted custom extensions", () => {
    expect(() =>
      workloadImplementationV2Schema.parse({
        mode: "ai-assisted-custom",
        runtimeFamily: "runtime.nodejs.lambda",
        handler: "src/handler.main",
        sourceOwnership: "ai-authored",
        extension: {
          extensionId: "extension_unvalidated",
          extensionContractVersion: 1,
          digest,
          ownership: "ai-authored",
          validationEvidenceIds: [],
        },
      }),
    ).toThrow();
  });
});
