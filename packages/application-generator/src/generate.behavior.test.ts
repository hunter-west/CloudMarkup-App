import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Digest } from "./constants.js";
import { generateApplication } from "./generate.js";
import {
  createNotesGenerationRequest,
  type FixtureMode,
  type FixtureOperation,
} from "./test-fixtures.js";

function generate(
  options: Parameters<typeof createNotesGenerationRequest>[0] = {},
) {
  return generateApplication(createNotesGenerationRequest(options));
}

function diagnosticCodes(result: ReturnType<typeof generateApplication>) {
  return result.artifact.diagnostics.map(({ code }) => code);
}

function requiredContent(value: unknown, path: string): string {
  if (
    value === null ||
    typeof value !== "object" ||
    !("content" in value) ||
    typeof value.content !== "string"
  ) {
    throw new Error(`Missing generated source content for ${path}.`);
  }
  return value.content;
}

function sourceContent(
  result: ReturnType<typeof generateApplication>,
  path: string,
): string {
  const file = result.artifact.sourceFiles.find(
    (candidate) => candidate.path === path,
  );
  return requiredContent(file, path);
}

describe("deterministic application generation behavior", () => {
  it.each([
    [
      "infrastructure-only",
      "application-code-required",
      "APPLICATION_CODE_REQUIRED",
    ],
    [
      "user-provided",
      "user-source-required",
      "APPLICATION_USER_PACKAGE_REQUIRED",
    ],
    ["generated-starter", "starter-source-ready", undefined],
    [
      "external-artifact",
      "external-artifact-reference-ready",
      "APPLICATION_EXTERNAL_ARTIFACT_NOT_FETCHED",
    ],
  ] satisfies readonly [FixtureMode, string, string | undefined][])(
    "represents %s honestly",
    (mode, readiness, diagnosticCode) => {
      const result = generate({ mode });
      const workload = result.artifact.workloadContracts[0];

      expect(workload?.implementationMode).toBe(mode);
      expect(workload?.readiness).toBe(readiness);
      if (diagnosticCode !== undefined) {
        expect(diagnosticCodes(result)).toContain(diagnosticCode);
      }
      if (mode === "external-artifact") {
        expect(workload).toMatchObject({
          artifact: { resolution: "reference-only" },
          ownershipReadiness: "not-applicable",
        });
      }
    },
  );

  it("keeps punctuated workload IDs in provenance while deriving portable paths", () => {
    const workloadId = "workload:notes";
    const expectedSegment = `workload_notes-${sha256Digest(workloadId).slice(7)}`;
    const first = generate({ workloadId });
    const second = generate({ workloadId });

    expect(first).toEqual(second);
    expect(first.artifact.buildContracts).toHaveLength(1);
    expect(first.artifact.buildContracts[0]?.contract).toMatchObject({
      workloadId,
      expectedArtifact: {
        artifactId: `artifact_${expectedSegment}`,
        path: `application/artifacts/${expectedSegment}/function.zip`,
      },
    });
    expect(first.artifact.sourceFiles.map(({ path }) => path)).toContain(
      `application/build-contracts/${expectedSegment}.json`,
    );
    expect(
      first.artifact.sourceFiles.map(({ path }) => path).join("\n"),
    ).not.toContain(":");
  });

  it.each([
    ["read", "GetItemCommand", "GET /notes/{noteId}"],
    ["delete", "DeleteItemCommand", "DELETE /notes/{noteId}"],
  ] satisfies readonly [FixtureOperation, string, string][])(
    "emits the reviewed %s route and DynamoDB operation",
    (operation, commandName, routeKey) => {
      const result = generate({ operations: [operation] });
      const operationSource = sourceContent(
        result,
        `application/src/functions/notes_handler/generated/operations/operation_${operation}_note.ts`,
      );
      const handler = sourceContent(
        result,
        "application/src/functions/notes_handler/index.ts",
      );

      expect(operationSource).toContain(commandName);
      expect(handler).toContain(JSON.stringify(routeKey));
      expect(
        result.artifact.coverage.workloads[0]?.representedOperationIds,
      ).toEqual([`operation_${operation}_note`]);
      expect(result.artifact.diagnostics).toEqual([]);
    },
  );

  it("requires matching request-body and route-path identity for updates", () => {
    const result = generate({ operations: ["update"] });
    const handler = sourceContent(
      result,
      "application/src/functions/notes_handler/index.ts",
    );
    const operation = sourceContent(
      result,
      "application/src/functions/notes_handler/generated/operations/operation_update_note.ts",
    );

    expect(handler).toContain(
      'executeOperation0(client, parseBody(event.body), requiredPath(event, "noteId"))',
    );
    expect(operation).toContain("input: unknown, pathPartitionValue: string");
    expect(operation).toContain("bodyPartitionValue !== pathPartitionValue");
    expect(operation).toContain(
      "Path and request-body partition keys must match.",
    );
    expect(operation).toContain("UpdateItemCommand");
    expect(handler).toContain(JSON.stringify("PUT /notes/{noteId}"));
    expect(
      result.artifact.coverage.workloads[0]?.representedOperationIds,
    ).toEqual(["operation_update_note"]);
    expect(result.artifact.diagnostics).toEqual([]);
  });

  it("downgrades unsupported starter behavior without fabricating an operation", () => {
    const result = generate({
      mode: "generated-starter",
      operations: ["list"],
    });

    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_DATA_OPERATION_UNSUPPORTED",
    );
    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_DATA_OPERATION_UNSUPPORTED",
        severity: "warning",
      }),
    );
    expect(result.artifact.coverage.workloads[0]).toMatchObject({
      representedOperationIds: [],
      state: "starter-application",
    });
    expect(
      result.artifact.sourceFiles.some((file) =>
        file.path.includes("generated/operations/operation_list_note.ts"),
      ),
    ).toBe(false);
  });

  it("reports missing behavior contracts and unresolved behavior with source IDs", () => {
    const result = generate({
      mode: "generated-starter",
      missingBehaviorFor: "create",
      unresolvedBehavior: true,
    });

    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "APPLICATION_BEHAVIOR_CONTRACT_REQUIRED",
        "APPLICATION_STARTER_BEHAVIOR_REQUIRED",
        "APPLICATION_STARTER_NO_SUPPORTED_OPERATION",
      ]),
    );
    expect(
      result.artifact.coverage.workloads[0]?.unresolvedBehaviorIds,
    ).toEqual([
      "implementation_custom_behavior",
      "requirement_custom_behavior",
    ]);
    expect(
      result.artifact.coverage.workloads[0]?.representedOperationIds,
    ).toEqual([]);
  });

  it("blocks complete-pattern claims when behavior remains unresolved", () => {
    const result = generate({ unresolvedBehavior: true });

    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_COMPLETE_BEHAVIOR_UNRESOLVED",
    );
    expect(result.artifact.coverage).toMatchObject({
      state: "target-unsupported",
      workloads: [
        expect.objectContaining({
          state: "target-unsupported",
          representedOperationIds: [],
        }),
      ],
    });
    expect(result.artifact.workloadContracts[0]).toMatchObject({
      readiness: "generation-blocked",
      ownershipReadiness: "not-safe-to-materialize",
    });
  });

  it("supports deterministic multiple routes, tables, and environment bindings", () => {
    const options = {
      operations: ["create", "read"] as const,
      separateTables: true,
    };
    const left = generate(options);
    const right = generate({ ...options, reverseCollections: true });
    const bindings = sourceContent(
      left,
      "application/src/functions/notes_handler/generated/bindings.ts",
    );

    expect(left).toEqual(right);
    expect(diagnosticCodes(left)).not.toContain(
      "APPLICATION_MULTIPLE_TRIGGER_INCOMPATIBLE",
    );
    expect(
      left.artifact.coverage.workloads[0]?.representedOperationIds,
    ).toEqual(["operation_create_note", "operation_read_note"]);
    expect(bindings).toContain("NOTES_TABLE_NAME");
    expect(bindings).toContain("NOTES_ARCHIVE_TABLE_NAME");
  });

  it("fails closed for incompatible multiple-trigger input identities", () => {
    const result = generate({
      mode: "generated-starter",
      operations: ["create", "read"],
      incompatibleMultipleInputs: true,
    });

    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_MULTIPLE_TRIGGER_INCOMPATIBLE",
        severity: "error",
      }),
    );
    expect(result.artifact.workloadContracts[0]).toMatchObject({
      readiness: "generation-blocked",
      ownershipReadiness: "not-safe-to-materialize",
    });
  });

  it("requires exactly one reviewed generator compatibility declaration", () => {
    const result = generate({
      duplicateCompatibility: true,
      mode: "generated-starter",
    });

    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_TEMPLATE_COMPATIBILITY_AMBIGUOUS",
    );
    expect(result.artifact.coverage.workloads[0]?.state).toBe(
      "target-unsupported",
    );
  });

  it("is invariant to presentation labels and never emits labels or secret references", () => {
    const baseline = generate({ includeSecretBinding: true });
    const malicious = generate({
      includeSecretBinding: true,
      maliciousLabels: true,
    });
    const serialized = canonicalJson(malicious);

    expect(malicious).toEqual(baseline);
    expect(serialized).not.toContain("displayOnly");
    expect(serialized).not.toContain("SECRET_DO_NOT_READ");
    expect(serialized).not.toContain("secret_fixture_marker_never_embed");
    expect(serialized).toContain("SIGNING_SECRET");
  });

  it("binds external-resource truth without fetching or embedding addresses", () => {
    const result = generate({ includeExternalResource: true });
    const serialized = canonicalJson(result);

    expect(serialized).not.toContain("audit.invalid");
    expect(result.artifact.diagnostics).toEqual([]);
    expect(result.artifact.coverage.state).toBe("complete-supported-pattern");
  });

  it("emits only deterministic scaffolding and a user-owned boundary for AI custom mode", () => {
    const result = generate({ mode: "ai-assisted-custom" });
    const handler = sourceContent(
      result,
      "application/src/functions/notes_handler/index.ts",
    );
    const extension = result.artifact.sourceFiles.find((file) =>
      file.path.endsWith("/extensions/custom.ts"),
    );

    expect(extension).toMatchObject({
      ownership: "user-owned",
      disposition: "create",
    });
    expect(
      result.artifact.sourceFiles.some(
        (file) => file.ownership === "ai-authored",
      ),
    ).toBe(false);
    expect(handler).not.toContain("PutItemCommand");
    expect(handler).not.toContain("Infinity");
    expect(result.artifact.buildContracts).toEqual([]);
    expect(result.artifact.sourceManifest.buildContracts).toEqual([]);
    expect(
      result.artifact.diff.semantic.some(
        (entry) => entry.kind === "build-contract",
      ),
    ).toBe(false);

    expect(result.artifact.workloadContracts[0]).toMatchObject({
      implementationMode: "ai-assisted-custom",
      ownershipReadiness: "extension-boundary-ready",
      readiness: "custom-source-required",
      validationRequirements: [
        "parse",
        "static-analysis",
        "build",
        "unit-tests",
        "contract-tests",
        "security",
      ],
    });
    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_AI_CANDIDATE_REQUIRED",
    );
  });
  it.each([
    [
      { behaviorInputMismatchFor: "create" as const },
      "APPLICATION_BEHAVIOR_SEMANTICS_UNSUPPORTED",
    ],
    [
      { behaviorFailureMismatchFor: "create" as const },
      "APPLICATION_BEHAVIOR_SEMANTICS_UNSUPPORTED",
    ],
    [{ unsupportedAuthRule: true }, "APPLICATION_AUTH_ROLE_RULE_UNSUPPORTED"],
    [
      { invalidRouteShapeFor: "create" as const },
      "APPLICATION_ROUTE_SHAPE_UNSUPPORTED",
    ],
    [{ invalidWorkloadShape: true }, "APPLICATION_WORKLOAD_SHAPE_UNSUPPORTED"],
    [
      { invalidTestTargetFor: "create" as const },
      "APPLICATION_COMPLETE_TESTS_INCOMPLETE",
    ],
  ])(
    "fails closed for an unsupported complete semantic shape",
    (options, code) => {
      const result = generate(options);

      expect(diagnosticCodes(result)).toContain(code);
      expect(result.artifact.coverage.state).toBe("target-unsupported");
      expect(result.artifact.workloadContracts[0]?.readiness).toBe(
        "generation-blocked",
      );
    },
  );

  it("withholds unsupported starter operations with warning-only coverage", () => {
    const result = generate({
      mode: "generated-starter",
      behaviorFailureMismatchFor: "create",
    });

    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_BEHAVIOR_SEMANTICS_UNSUPPORTED",
        severity: "warning",
      }),
    );
    expect(
      result.artifact.coverage.workloads[0]?.representedOperationIds,
    ).toEqual([]);
  });

  it("requires all implementation requirements to be resolved for complete coverage", () => {
    const result = generate({ nonBlockingImplementationRequirement: true });

    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_COMPLETE_BEHAVIOR_UNRESOLVED",
    );
    expect(result.artifact.coverage.state).toBe("target-unsupported");
  });

  it.each([
    ["lifecycle", { normalizedLifecycleTamper: true }],
    ["target key", { normalizedTargetKeyTamper: true }],
  ])("rejects normalized %s tampering", (_name, options) => {
    const result = generate(options);

    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_NORMALIZED_RESOURCE_MISMATCH",
    );
    expect(result.artifact.coverage.state).toBe("target-unsupported");
  });

  it("withholds colliding operation paths in starter mode and blocks complete mode", () => {
    const starter = generate({
      mode: "generated-starter",
      operations: ["create", "read"],
      collidingOperationPathKeys: true,
    });
    const complete = generate({
      operations: ["create", "read"],
      collidingOperationPathKeys: true,
    });

    expect(starter.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_DISPATCH_KEY_COLLISION",
        severity: "warning",
      }),
    );
    expect(
      starter.artifact.coverage.workloads[0]?.representedOperationIds,
    ).toEqual([]);
    expect(complete.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_DISPATCH_KEY_COLLISION",
        severity: "error",
      }),
    );
    expect(complete.artifact.coverage.state).toBe("target-unsupported");
  });

  it("emits authorization, exact test pins, fail-invocation, and scalar-list bounds", () => {
    const result = generate();
    const handler = sourceContent(
      result,
      "application/src/functions/notes_handler/index.ts",
    );
    const types = sourceContent(
      result,
      "application/src/functions/notes_handler/generated/types.ts",
    );
    const contractTests = sourceContent(
      result,
      "application/tests/functions/notes_handler/contracts.test.ts",
    );

    expect(handler).toContain("authorize(event");
    expect(handler).toContain("application.internal");
    expect(handler).toContain("throw error");
    expect(types).toContain("application.authorization");
    expect(types).toContain('"minimumItems": 1');
    expect(types).toContain('"maximumItems": 3');
    expect(contractTests).toContain("behavior");
    expect(contractTests).toContain("testCase");
    expect(
      sourceContent(
        result,
        "application/src/functions/notes_handler/generated/operations/operation_create_note.ts",
      ),
    ).toContain("PutItemCommand");
    expect(handler).toContain(JSON.stringify("POST /notes"));
    expect(
      result.artifact.coverage.workloads[0]?.representedOperationIds,
    ).toEqual(["operation_create_note"]);
    expect(result.artifact.diagnostics).toEqual([]);
    expect(result.artifact.workloadContracts[0]).toMatchObject({
      implementationMode: "complete-supported-pattern",
      readiness: "complete-source-ready",
    });
  });
  it("requires at least one operation before claiming complete source", () => {
    const result = generate({ operations: [], allowEmptyOperations: true });

    expect(diagnosticCodes(result)).toContain(
      "APPLICATION_COMPLETE_OPERATION_REQUIRED",
    );
    expect(result.artifact.coverage.state).toBe("target-unsupported");
  });
});
