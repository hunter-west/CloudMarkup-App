import { describe, expect, it } from "vitest";

import {
  generateWorkloadBehaviorV2JsonSchema,
  workloadBehaviorV2Schema,
  workloadImplementationV2Schema,
} from "./workload-behavior-v2.js";
import { normalizeWorkloadBehaviorV2 } from "./solution-normalization.js";

const digest =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222";

const contractReference = (
  contractKind:
    | "http-api"
    | "event-message"
    | "data-entity"
    | "auth"
    | "behavior-operation"
    | "test-case",
  contractId: string,
) => ({ contractKind, contractId, contractVersion: "1.0.0", digest });

function representativeWorkloadBehavior() {
  const operationId = "operation_create_note";
  const testCase = contractReference(
    "test-case",
    "contracts.notes.create-contract-test",
  );

  return {
    contractVersion: 2,
    workloads: [
      {
        id: "workload_notes_api",
        owningNodeId: "node_notes_function",
        implementation: {
          mode: "complete-supported-pattern",
          runtimeFamily: "runtime.nodejs.lambda",
          handler: "src/handler.main",
          sourceOwnership: "cloudmarkup",
          supportedPattern: {
            patternId: "application.pattern.authenticated-notes",
            patternVersion: "1.0.0",
            digest,
          },
        },
        operations: [
          {
            id: operationId,
            capability: "application.notes.create",
            inputContract: {
              kind: "contract-reference",
              reference: {
                contractId: "contracts.notes.entity",
                contractVersion: "1.0.0",
                digest,
              },
            },
            outputContract: {
              kind: "contract-reference",
              reference: {
                contractId: "contracts.notes.entity",
                contractVersion: "1.0.0",
                digest,
              },
            },
          },
        ],
        behaviorContracts: [
          contractReference(
            "behavior-operation",
            "contracts.notes.create-operation",
          ),
        ],
        triggers: [
          {
            id: "trigger_http_create",
            edgeId: "edge_http_function",
            targetOperationId: operationId,
          },
        ],
        downstreamActions: [
          {
            id: "action_store_note",
            edgeId: "edge_function_table",
            sourceOperationId: operationId,
          },
        ],
        environment: [
          {
            id: "environment_api_key",
            name: "EXTERNAL_API_KEY",
            value: {
              kind: "secret-reference",
              reference: "secret_external_api_key",
            },
          },
        ],
        errorBehavior: {
          mode: "return-error",
          errorContract: {
            contractId: "contracts.notes.error",
            contractVersion: "1.0.0",
            digest,
          },
        },
        executionAssumptions: {
          timeout: { kind: "duration", milliseconds: 5_000 },
          retry: { kind: "bounded", maximumAttempts: 3 },
        },
        triggerDispatch: { mode: "single" },
        unresolvedRequirementIds: [],
        languageFamily: "language.typescript",
        entrypoints: [
          {
            entrypointId: "entrypoint_http",
            kind: "request-handler",
            operationId,
            handler: "src/handler.main",
          },
        ],
        httpRoutes: [
          {
            routeId: "route_create_note",
            method: "POST",
            pathTemplate: "/notes",
            operationId,
            triggerEdgeId: "edge_http_function",
            contract: contractReference(
              "http-api",
              "contracts.notes.create-route",
            ),
          },
        ],
        eventBindings: [
          {
            bindingId: "event_note_created",
            direction: "outbound",
            transportKind: "event",
            operationId,
            edgeId: "edge_function_event_bus",
            contract: contractReference(
              "event-message",
              "contracts.notes.created-event",
            ),
          },
        ],
        schedules: [
          {
            bindingId: "schedule_cleanup",
            operationId,
            schedule: { kind: "weekly", days: ["sunday"], utcTime: "03:30" },
          },
        ],
        dataBindings: [
          {
            bindingId: "data_notes_table",
            operationId,
            entity: contractReference("data-entity", "contracts.notes.entity"),
            dataOperation: "create",
            edgeId: "edge_function_table",
          },
        ],
        authorization: [
          {
            bindingId: "authorization_member",
            authContract: contractReference("auth", "contracts.notes.auth"),
            operationIds: [operationId],
            permittedRoleIds: ["role_member"],
            deniedBehavior: "reject",
          },
        ],
        idempotency: [
          {
            policyId: "idempotency_create_note",
            mode: "required",
            operationIds: [operationId],
            keySource: {
              kind: "request-header",
              headerName: "Idempotency-Key",
            },
            retentionSeconds: 86_400,
            concurrentDuplicateBehavior: "return-recorded",
          },
        ],
        observability: {
          signals: ["logs", "metrics", "traces"],
          healthChecks: [
            {
              healthCheckId: "health_ready",
              kind: "readiness",
              operationId,
              timeoutMilliseconds: 1_000,
              failureState: "unhealthy",
            },
          ],
          smokeTests: [testCase],
        },
        tests: [
          {
            bindingId: "test_create_contract",
            level: "contract",
            testCase,
            requiredForCoverage: true,
          },
        ],
        sourceOwnership: [
          {
            declarationId: "ownership_handler",
            path: "application/src/handler.ts",
            pathKind: "file",
            ownership: "generated",
            ownerId: "cloudmarkup.application-generator",
            regeneration: "replace-when-baseline-matches",
            conflictBehavior: "fail-closed",
            semanticDiff: { strategy: "byte-exact" },
            baselineDigest: digest,
          },
        ],
        extensionPoints: [
          {
            extensionPointId: "application.notes.extensions",
            path: "application/src/extensions",
            kind: "module",
            permittedOwnership: ["user-owned", "approved-extension"],
            conflictBehavior: "require-reviewed-resolution",
          },
        ],
        extensions: [],
        implementationRequirements: [],
        compatibility: {
          applicationGenerators: [
            {
              generatorId: "cloudmarkup.application-generator",
              minimumVersion: "1.0.0",
              templateId: "application.template.authenticated-notes",
              templateVersion: "1.0.0",
              supportedModes: ["complete-supported-pattern"],
            },
          ],
          modelGateways: [],
        },
        provenance: {
          source: "deterministic-generator",
          generatorId: "cloudmarkup.application-generator",
          generatorVersion: "1.0.0",
          inputDigest: digest,
        },
      },
    ],
  } as const;
}

describe("Workload Behavior v2 schema", () => {
  it("accepts a complete supported pattern with bounded behavior capabilities", () => {
    const parsed = workloadBehaviorV2Schema.parse(
      representativeWorkloadBehavior(),
    );
    const workload = parsed.workloads[0];

    expect(workload?.implementation.mode).toBe("complete-supported-pattern");
    expect(workload?.httpRoutes[0]?.method).toBe("POST");
    expect(workload?.idempotency[0]?.mode).toBe("required");
    expect(workload?.sourceOwnership[0]?.ownership).toBe("generated");
    expect(generateWorkloadBehaviorV2JsonSchema().$id).toContain(
      "workload-behavior/v2",
    );
  });

  it("preserves all four v1 implementation modes and adds exactly two modes", () => {
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
        artifact: { artifactId: "artifact_notes", digest },
      },
      {
        ...executable,
        mode: "complete-supported-pattern",
        sourceOwnership: "cloudmarkup",
        supportedPattern: {
          patternId: "application.pattern.authenticated-notes",
          patternVersion: "1.0.0",
          digest,
        },
      },
      {
        ...executable,
        mode: "ai-assisted-custom",
        sourceOwnership: "ai-authored",
        extension: {
          extensionId: "extension_notes",
          extensionContractVersion: 1,
          digest,
          ownership: "ai-authored",
          validationEvidenceIds: ["evidence_build"],
        },
      },
    ] as const;

    expect(
      implementations.map(
        (implementation) =>
          workloadImplementationV2Schema.parse(implementation).mode,
      ),
    ).toEqual([
      "infrastructure-only",
      "user-provided",
      "generated-starter",
      "external-artifact",
      "complete-supported-pattern",
      "ai-assisted-custom",
    ]);
  });

  it.each(["rawCode", "credentials", "packageScripts"])(
    "rejects prohibited workload field %s",
    (field) => {
      const document = representativeWorkloadBehavior();
      const [workload] = document.workloads;
      expect(workload).toBeDefined();

      expect(() =>
        workloadBehaviorV2Schema.parse({
          ...document,
          workloads: [{ ...workload, [field]: "must-not-be-retained" }],
        }),
      ).toThrow();
    },
  );

  it("keeps AI-assisted custom behavior reference-only", () => {
    const valid = {
      mode: "ai-assisted-custom",
      runtimeFamily: "runtime.nodejs.lambda",
      handler: "src/handler.main",
      sourceOwnership: "ai-authored",
      extension: {
        extensionId: "extension_notes",
        extensionContractVersion: 1,
        digest,
        ownership: "ai-authored",
        validationEvidenceIds: ["evidence_static", "evidence_tests"],
      },
    } as const;

    expect(workloadImplementationV2Schema.parse(valid).mode).toBe(
      "ai-assisted-custom",
    );
    expect(() =>
      workloadImplementationV2Schema.parse({
        ...valid,
        extension: {
          ...valid.extension,
          sourceCode: "export default process.env.SECRET",
        },
      }),
    ).toThrow();
  });

  it("rejects traversal in owned files and extension points", () => {
    const document = representativeWorkloadBehavior();
    const [workload] = document.workloads;

    expect(() =>
      workloadBehaviorV2Schema.parse({
        ...document,
        workloads: [
          {
            ...workload,
            extensionPoints: workload.extensionPoints.map((point) => ({
              ...point,
              path: "../outside/source.ts",
            })),
          },
        ],
      }),
    ).toThrow();
  });
});

describe("Workload Behavior v2 canonical normalization", () => {
  it("sorts workloads and every nested unordered binding without mutating input", () => {
    const parsed = workloadBehaviorV2Schema.parse(
      representativeWorkloadBehavior(),
    );
    const base = parsed.workloads[0];
    if (base === undefined) {
      throw new Error(
        "Representative workload fixture must contain a workload.",
      );
    }
    const expanded = workloadBehaviorV2Schema.parse({
      ...parsed,
      workloads: [
        { ...base, id: "workload_z" },
        { ...base, id: "workload_a" },
      ],
    });
    const reordered = workloadBehaviorV2Schema.parse({
      ...expanded,
      workloads: [...expanded.workloads].reverse().map((workload) => ({
        ...workload,
        operations: [...workload.operations].reverse(),
        behaviorContracts: [...workload.behaviorContracts].reverse(),
        triggers: [...workload.triggers].reverse(),
        downstreamActions: [...workload.downstreamActions].reverse(),
        environment: [...workload.environment].reverse(),
        unresolvedRequirementIds: [
          ...workload.unresolvedRequirementIds,
        ].reverse(),
        entrypoints: [...workload.entrypoints].reverse(),
        httpRoutes: [...workload.httpRoutes].reverse(),
        eventBindings: [...workload.eventBindings].reverse(),
        schedules: [...workload.schedules].reverse().map((binding) => ({
          ...binding,
          schedule:
            binding.schedule.kind === "weekly"
              ? {
                  ...binding.schedule,
                  days: [...binding.schedule.days].reverse(),
                }
              : binding.schedule,
        })),
        dataBindings: [...workload.dataBindings].reverse(),
        authorization: [...workload.authorization].reverse().map((binding) => ({
          ...binding,
          operationIds: [...binding.operationIds].reverse(),
          permittedRoleIds: [...binding.permittedRoleIds].reverse(),
        })),
        idempotency: [...workload.idempotency].reverse().map((policy) => ({
          ...policy,
          operationIds: [...policy.operationIds].reverse(),
        })),
        observability: {
          signals: [...workload.observability.signals].reverse(),
          healthChecks: [...workload.observability.healthChecks].reverse(),
          smokeTests: [...workload.observability.smokeTests].reverse(),
        },
        tests: [...workload.tests].reverse(),
        sourceOwnership: [...workload.sourceOwnership].reverse(),
        extensionPoints: [...workload.extensionPoints]
          .reverse()
          .map((extensionPoint) => ({
            ...extensionPoint,
            permittedOwnership: [
              ...extensionPoint.permittedOwnership,
            ].reverse(),
          })),
        extensions: [...workload.extensions].reverse().map((extension) => ({
          ...extension,
          validationEvidenceIds: [...extension.validationEvidenceIds].reverse(),
        })),
        implementationRequirements: [...workload.implementationRequirements]
          .reverse()
          .map((requirement) => ({
            ...requirement,
            affectedContractReferences: [
              ...requirement.affectedContractReferences,
            ].reverse(),
          })),
        compatibility: {
          applicationGenerators: [
            ...workload.compatibility.applicationGenerators,
          ]
            .reverse()
            .map((compatibility) => ({
              ...compatibility,
              supportedModes: [...compatibility.supportedModes].reverse(),
            })),
          modelGateways: [...workload.compatibility.modelGateways]
            .reverse()
            .map((compatibility) => ({
              ...compatibility,
              requiredValidation: [
                ...compatibility.requiredValidation,
              ].reverse(),
            })),
        },
      })),
    });
    const before = JSON.stringify(reordered);

    expect(normalizeWorkloadBehaviorV2(reordered)).toEqual(
      normalizeWorkloadBehaviorV2(expanded),
    );
    expect(JSON.stringify(reordered)).toBe(before);
  });
});
