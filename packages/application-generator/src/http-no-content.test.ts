import {
  architectureDocumentV3Schema,
  existingApplicationFileV1Schema,
} from "@cloudmarkup/schemas";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENT_APPLICATION_CATALOG, sha256Digest } from "./constants.js";
import { generateApplication } from "./generate.js";
import { rebindHttpNoContentFixture } from "./http-no-content-test-fixture.js";
import { createHttpNoContentFixture } from "./test-fixtures.js";

function handler(result: ReturnType<typeof generateApplication>) {
  const file = result.artifact.sourceFiles.find((file) =>
    file.path.endsWith("/index.ts"),
  );
  if (file === undefined) throw Error("Expected generated handler.");
  return file;
}
describe("explicit authenticated no-content source", () => {
  it.each([CURRENT_APPLICATION_CATALOG])(
    "emits reproducible stateless source and retains the native build boundary for $version",
    (catalog) => {
      const request = createHttpNoContentFixture(catalog);
      const result = generateApplication(request);
      expect(result.artifact.diagnostics).toEqual([]);
      expect(result).toEqual(generateApplication(request));
      expect(handler(result).provenance.edgeIds).toEqual(
        expect.arrayContaining(["edge_auth_pool_api", "edge_auth_client_api"]),
      );
      expect(JSON.stringify(result.artifact.sourceFiles)).not.toContain(
        "client-dynamodb",
      );
      expect(result.artifact.coverage.state).toBe("starter-application");
      expect(result.artifact.coverage.missingRequirements).toEqual(
        expect.arrayContaining([
          "application-build-and-tests",
          "application-security-checks",
        ]),
      );
      expect(result.artifact.buildContracts).toHaveLength(1);
      expect(
        result.artifact.buildContracts[0]?.contract.dependencies.every(
          (dependency) => dependency.kind === "development",
        ),
      ).toBe(true);
    },
  );
  it.each([
    "issuer",
    "audience",
    "jwt-disabled",
    "cors",
    "data-action",
    "unreviewed-behavior",
    "missing-tests",
  ])("withholds source for %s", (mutation) => {
    const request = createHttpNoContentFixture();
    const document = request.architectureDocument;
    const workload = document.workloadBehavior.workloads[0];
    if (workload === undefined) throw Error("Expected workload.");
    const changed = architectureDocumentV3Schema.parse({
      ...document,
      edges: document.edges.filter(
        (edge) =>
          !(
            mutation === "issuer" &&
            edge.semantic.relationshipType === "aws.cognito.provides-jwt-issuer"
          ) &&
          !(
            mutation === "audience" &&
            edge.semantic.relationshipType ===
              "aws.cognito.provides-jwt-audience"
          ),
      ),
      nodes: document.nodes.map((node) =>
        node.semantic.resourceType === "aws.apigateway.http-api" &&
        (mutation === "jwt-disabled" || mutation === "cors")
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                configuration: {
                  ...node.semantic.configuration,
                  values: {
                    ...node.semantic.configuration.values,
                    [mutation === "cors"
                      ? "corsEnabled"
                      : "jwtAuthorizationRequired"]: {
                      kind: "boolean",
                      value: mutation === "cors",
                    },
                  },
                },
              },
            }
          : node,
      ),
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            ...(mutation === "data-action"
              ? {
                  downstreamActions: [
                    {
                      id: "action_undeclared",
                      edgeId: document.edges.find(
                        (edge) =>
                          edge.semantic.source.nodeId === workload.owningNodeId,
                      )?.id,
                      sourceOperationId: workload.operations[0]?.id,
                    },
                  ],
                }
              : {}),
            ...(mutation === "unreviewed-behavior"
              ? {
                  operations: workload.operations.map((operation) => ({
                    ...operation,
                    capability: "application.http.invented-business-logic",
                  })),
                }
              : {}),
            ...(mutation === "missing-tests" ? { tests: [] } : {}),
          },
        ],
      },
    });
    const result = generateApplication(
      rebindHttpNoContentFixture(request, changed),
    );
    expect(
      result.artifact.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toBe(true);
    expect(result.artifact.sourceFiles).toEqual([]);
    expect(result.artifact.buildContracts).toEqual([]);
  });
  it("rejects mismatched release pins", () => {
    const request = createHttpNoContentFixture();
    const result = generateApplication({
      ...request,
      generator: {
        ...request.generator,
        digest: sha256Digest("wrong release"),
      },
      solutionRevision: {
        ...request.solutionRevision,
        versions: {
          ...request.solutionRevision.versions,
          applicationGenerator: {
            state: "pinned",
            tool: {
              ...request.generator,
              digest: sha256Digest("wrong release"),
            },
          },
        },
      },
    });
    expect(result.artifact.sourceFiles).toEqual([]);
    expect(result.artifact.buildContracts).toEqual([]);
  });
  it("preserves a modified generated handler and withholds its build contract", () => {
    const request = createHttpNoContentFixture();
    const original = handler(generateApplication(request));
    const changed = sha256Digest("synthetic user edits");
    const existing = existingApplicationFileV1Schema.parse({
      path: original.path,
      mediaType: original.mediaType,
      ownership: "generated",
      currentChecksum: changed,
      baselineChecksum: original.checksum,
      semanticChecksum: changed,
      sizeBytes: 20,
    });
    const result = generateApplication({
      ...request,
      existingFiles: [existing],
    });
    expect(
      result.artifact.sourceFiles.some((file) => file.path === original.path),
    ).toBe(false);
    expect(result.artifact.diff.files).toContainEqual(
      expect.objectContaining({
        path: original.path,
        change: "conflict",
        beforeChecksum: changed,
      }),
    );
    expect(result.artifact.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "APPLICATION_SOURCE_CONFLICT",
        severity: "error",
      }),
    );
    expect(result.artifact.buildContracts).toEqual([]);
  });
});

// The checked-in graph is synthetic, built by the catalog resolver and domain commands.
it("preserves native parent relationships and rejects rebinding", () => {
  const graph = architectureDocumentV3Schema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../services/iac-compiler/testdata/http-no-content-v1/architecture.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const request = rebindHttpNoContentFixture(
    createHttpNoContentFixture(),
    graph,
  );
  expect(generateApplication(request).artifact.diagnostics).toEqual([]);
  const parent = request.normalizedSolution.resources.find(
    (resource) => resource.parent !== undefined,
  );
  if (!parent?.parent) throw Error("Expected a typed parent.");
  parent.parent.relationshipType = "aws.unreviewed.relationship";
  const rejected = generateApplication(request);
  expect(
    rejected.artifact.diagnostics.map((diagnostic) => diagnostic.code),
  ).toContain("APPLICATION_NORMALIZED_RESOURCE_MISMATCH");
  expect(rejected.artifact.sourceFiles).toEqual([]);
});
