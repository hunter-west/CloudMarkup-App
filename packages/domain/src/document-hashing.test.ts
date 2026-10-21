import { readFile } from "node:fs/promises";

import {
  parseArchitectureDocumentV1Json,
  parseArchitectureDocumentV2Json,
  parseArchitectureDocumentV3Json,
  parseIntentDocumentV1,
  parseIntentDocumentV1Json,
  serializeArchitectureDocumentV1,
  serializeIntentDocumentV1,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import {
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentHashes,
  getArchitectureSemanticProjection,
  getIntentDocumentContentHash,
  hashCanonicalValue,
  parseArchitectureDocument,
} from "./index.js";
import { sha256Hex } from "./sha256.js";

async function readFixture(path: string): Promise<string> {
  return readFile(
    new URL(`../../test-fixtures/fixtures/${path}`, import.meta.url),
    "utf8",
  );
}

describe("document canonical serialization and hashes", () => {
  it("matches standard SHA-256 vectors, including UTF-8 input", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("CloudMarkup ☁️")).toBe(
      "beacb4d6cb281c03c4b091c231fef8cdcbaa78099c7bb16852625cdb90231eef",
    );
  });

  it("exposes one canonical full-snapshot digest for persistence adapters", () => {
    expect(hashCanonicalValue({ beta: 2, alpha: 1 })).toBe(
      hashCanonicalValue({ alpha: 1, beta: 2 }),
    );
    expect(hashCanonicalValue({ alpha: 1 })).not.toBe(
      hashCanonicalValue({ alpha: 1, auditTimestamp: "2030-01-01T00:00:00Z" }),
    );
  });

  it("makes Architecture Document collection ordering incidental", async () => {
    const document = parseArchitectureDocumentV1Json(
      await readFixture("architecture-document/v1/valid/representative.json"),
    );
    const reordered = {
      ...document,
      nodes: [...document.nodes].reverse(),
      edges: [...document.edges].reverse(),
      variables: [...document.variables].reverse(),
      outputs: [...document.outputs].reverse(),
      assumptions: [...document.assumptions].reverse(),
      unresolvedRequirements: [...document.unresolvedRequirements].reverse(),
    };

    expect(serializeArchitectureDocumentV1(reordered)).toBe(
      serializeArchitectureDocumentV1(document),
    );
    expect(getArchitectureDocumentHashes(reordered)).toEqual(
      getArchitectureDocumentHashes(document),
    );
  });

  it("pins legacy v2 content hashes to the immutable v2 revision", async () => {
    const document = parseArchitectureDocumentV2Json(
      await readFixture("architecture-document/v2/valid/representative.json"),
    );
    const legacyHash = getArchitectureDocumentContentHash(document);
    const migrated = parseArchitectureDocument(document);

    expect(legacyHash).toBe(
      "sha256:e6a127448bc559e502b665d92ad9a4f0f2e2fe3224beb9fdb48474161a9dbc43",
    );
    expect(migrated.schemaVersion).toBe(3);
    expect(getArchitectureDocumentContentHash(migrated)).not.toBe(legacyHash);
  });
  it("separates Architecture Document compilation content from visual layout", async () => {
    const document = parseArchitectureDocumentV1Json(
      await readFixture("architecture-document/v1/valid/representative.json"),
    );
    const changedPresentation = {
      ...document,
      nodes: document.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              presentation: {
                label: `${node.presentation.label} relabeled`,
                position: {
                  x: node.presentation.position.x + 20,
                  y: node.presentation.position.y - 10,
                },
              },
            }
          : node,
      ),
    };
    const originalHashes = getArchitectureDocumentHashes(document);
    const changedHashes = getArchitectureDocumentHashes(changedPresentation);

    expect(changedHashes.contentHash).toBe(originalHashes.contentHash);
    expect(changedHashes.visualHash).not.toBe(originalHashes.visualHash);
  });

  it("keeps compilation content stable when a boundary parent moves", async () => {
    const document = parseArchitectureDocumentV1Json(
      await readFixture("architecture-document/v1/valid/representative.json"),
    );
    const changedPresentation = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === "node_network"
          ? {
              ...node,
              presentation: {
                ...node.presentation,
                position: {
                  x: node.presentation.position.x + 20,
                  y: node.presentation.position.y - 10,
                },
              },
            }
          : node,
      ),
    };
    const originalHashes = getArchitectureDocumentHashes(document);
    const changedHashes = getArchitectureDocumentHashes(changedPresentation);

    expect(changedHashes.contentHash).toBe(originalHashes.contentHash);
    expect(changedHashes.visualHash).not.toBe(originalHashes.visualHash);
  });

  it("includes semantic reparenting in the content hash without changing the visual hash", async () => {
    const document = parseArchitectureDocumentV1Json(
      await readFixture("architecture-document/v1/valid/representative.json"),
    );
    const application = document.nodes.find(
      (node) => node.id === "node_application",
    );
    if (application === undefined) {
      throw new Error("Representative fixture must contain the application.");
    }
    const applicationAtRoot = {
      ...application,
      semantic: { ...application.semantic },
    };
    delete applicationAtRoot.semantic.parent;
    const reparented = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === application.id ? applicationAtRoot : node,
      ),
    };
    const originalHashes = getArchitectureDocumentHashes(document);
    const reparentedHashes = getArchitectureDocumentHashes(reparented);

    expect(reparentedHashes.contentHash).not.toBe(originalHashes.contentHash);
    expect(reparentedHashes.visualHash).toBe(originalHashes.visualHash);
  });

  it("excludes audit timestamps but includes catalog and compiler compatibility", async () => {
    const document = parseArchitectureDocumentV1Json(
      await readFixture("architecture-document/v1/valid/representative.json"),
    );
    const changedTimestamp = {
      ...document,
      revision: {
        ...document.revision,
        createdAt: "2030-01-01T00:00:00Z",
      },
    };
    const changedCatalog = {
      ...document,
      catalog: {
        ...document.catalog,
        version: "1.1.0",
      },
    };
    const changedCompiler = {
      ...document,
      compilerCompatibility: {
        ...document.compilerCompatibility,
        minimumCompilerVersion: "1.1.0",
      },
    };
    const generatedIndex = document.nodes.findIndex(
      (node) => node.semantic.lifecycle.ownership === "generated",
    );
    const generatedNode = document.nodes[generatedIndex];
    if (generatedNode?.semantic.lifecycle.ownership !== "generated") {
      throw new Error("Representative fixture must contain a generated node.");
    }
    const generatedLifecycle = generatedNode.semantic.lifecycle;
    const adopted = {
      ...document,
      nodes: document.nodes.map((node, index) =>
        index === generatedIndex
          ? {
              ...generatedNode,
              semantic: {
                ...generatedNode.semantic,
                lifecycle: {
                  ownership: "adopted",
                  origin: generatedLifecycle.origin,
                  provenance: generatedLifecycle.provenance,
                  adoptedBy: document.revision.createdBy,
                  adoptedAt: "2026-01-01T01:00:00Z",
                },
              },
            }
          : node,
      ),
    };
    const retimestampedAdoption = {
      ...adopted,
      nodes: adopted.nodes.map((node, index) =>
        index === generatedIndex &&
        node.semantic.lifecycle.ownership === "adopted"
          ? {
              ...node,
              semantic: {
                ...node.semantic,
                lifecycle: {
                  ...node.semantic.lifecycle,
                  adoptedAt: "2030-01-01T01:00:00Z",
                },
              },
            }
          : node,
      ),
    };
    const baseline = getArchitectureDocumentHashes(document);

    expect(getArchitectureDocumentHashes(changedTimestamp).contentHash).toBe(
      baseline.contentHash,
    );
    expect(getArchitectureDocumentHashes(changedCatalog).contentHash).not.toBe(
      baseline.contentHash,
    );
    expect(getArchitectureDocumentHashes(changedCompiler).contentHash).not.toBe(
      baseline.contentHash,
    );
    expect(
      getArchitectureDocumentHashes(retimestampedAdoption).contentHash,
    ).toBe(getArchitectureDocumentHashes(adopted).contentHash);
  });

  it("normalizes nested workload collections for semantic and content hashing", async () => {
    const document = parseArchitectureDocumentV2Json(
      await readFixture("architecture-document/v2/valid/representative.json"),
    );
    const [workload] = document.workloadBehavior.workloads;
    if (workload === undefined) {
      throw new Error("Representative v2 fixture must contain a workload.");
    }
    const reordered = {
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            operations: [...workload.operations].reverse(),
            triggers: [...workload.triggers].reverse(),
            downstreamActions: [...workload.downstreamActions].reverse(),
            environment: [...workload.environment].reverse(),
            unresolvedRequirementIds: [
              ...workload.unresolvedRequirementIds,
            ].reverse(),
          },
        ],
      },
    };

    expect(getArchitectureSemanticProjection(reordered)).toEqual(
      getArchitectureSemanticProjection(document),
    );
    expect(getArchitectureDocumentHashes(reordered)).toEqual(
      getArchitectureDocumentHashes(document),
    );
  });

  it("includes workload behavior in content hashes but not visual hashes", async () => {
    const document = parseArchitectureDocumentV2Json(
      await readFixture("architecture-document/v2/valid/representative.json"),
    );
    const [workload] = document.workloadBehavior.workloads;
    if (workload?.executionAssumptions.timeout.kind !== "duration") {
      throw new Error(
        "Representative v2 fixture must contain a duration assumption.",
      );
    }
    const changed = {
      ...document,
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            executionAssumptions: {
              ...workload.executionAssumptions,
              timeout: {
                ...workload.executionAssumptions.timeout,
                milliseconds:
                  workload.executionAssumptions.timeout.milliseconds + 1,
              },
            },
          },
        ],
      },
    };
    const originalHashes = getArchitectureDocumentHashes(document);
    const changedHashes = getArchitectureDocumentHashes(changed);

    expect(getArchitectureSemanticProjection(changed)).not.toEqual(
      getArchitectureSemanticProjection(document),
    );
    expect(changedHashes.contentHash).not.toBe(originalHashes.contentHash);
    expect(changedHashes.visualHash).toBe(originalHashes.visualHash);
  });

  it("keeps workload and binding identities stable across labels and layout", async () => {
    const document = parseArchitectureDocumentV2Json(
      await readFixture("architecture-document/v2/valid/representative.json"),
    );
    const changedPresentation = {
      ...document,
      nodes: document.nodes.map((node, index) => ({
        ...node,
        presentation: {
          label: `Relabeled node ${String(index)}`,
          position: {
            x: node.presentation.position.x + 500,
            y: node.presentation.position.y - 500,
          },
        },
      })),
    };
    const identities = (input: typeof document) =>
      input.workloadBehavior.workloads.map((workload) => ({
        workloadId: workload.id,
        triggerIds: workload.triggers.map((binding) => binding.id),
        triggerEdgeIds: workload.triggers.map((binding) => binding.edgeId),
        actionIds: workload.downstreamActions.map((binding) => binding.id),
        actionEdgeIds: workload.downstreamActions.map(
          (binding) => binding.edgeId,
        ),
      }));
    const originalHashes = getArchitectureDocumentHashes(document);
    const changedHashes = getArchitectureDocumentHashes(changedPresentation);

    expect(identities(changedPresentation)).toEqual(identities(document));
    expect(changedHashes.contentHash).toBe(originalHashes.contentHash);
    expect(changedHashes.visualHash).not.toBe(originalHashes.visualHash);
  });

  it("excludes nested v3 audit timestamps from compilation content only", async () => {
    const document = parseArchitectureDocumentV3Json(
      await readFixture("architecture-document/v3/valid/representative.json"),
    );
    const workload = document.workloadBehavior.workloads[0];
    if (
      workload === undefined ||
      workload.implementation.mode === "infrastructure-only"
    ) {
      throw new Error("Representative v3 fixture must expose a handler.");
    }
    const auditDigest = "sha256:" + "1".repeat(64);
    const extension = {
      digest: auditDigest,
      extensionContractVersion: 1,
      extensionId: "extension_hash_audit",
      ownership: "ai-authored",
      validationEvidenceIds: ["evidence_extension_static"],
    } as const;
    const timestamped = parseArchitectureDocument({
      ...document,
      applicationContracts: {
        ...document.applicationContracts,
        contracts: [
          {
            authenticationMethod: "none",
            claims: [],
            contractId: "contract.auth.hash-audit",
            contractKind: "auth",
            contractVersion: "1.0.0",
            displayName: "Hash audit authorization",
            provenance: {
              recordedAt: "2026-08-14T12:00:00Z",
              recordedBy: document.revision.createdBy,
              source: "designed",
              sourceReferenceIds: [],
            },
            roles: [],
          },
        ],
      },
      externalResources: {
        ...document.externalResources,
        resources: [
          {
            addresses: [],
            architectureNodeIds: [],
            availability: { assumption: "unknown" },
            capability: "external.hash.audit",
            dataClassifications: [],
            displayName: "Hash audit dependency",
            evidence: [
              {
                digest: auditDigest,
                evidenceId: "evidence_external_hash_audit",
                observedAt: "2026-08-14T12:00:00Z",
                source: "repository",
              },
            ],
            extractedCandidates: [],
            id: "external_hash_audit",
            interfaces: [],
            lifecycle: {
              behavior: {
                create: "forbidden",
                dataSource: "unresolved",
                import: "unresolved",
                reference: "unresolved",
              },
              iacTargets: [],
              lifecycleAuthority: "unresolved",
              ownershipState: "unknown-unresolved",
            },
            provider: {
              reason: "The provider is intentionally unresolved.",
              state: "unknown",
            },
            scope: {},
            trustBoundary: "unknown",
            unresolvedInformation: [],
          },
        ],
      },
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            compatibility: {
              ...workload.compatibility,
              modelGateways: [
                {
                  modelFamily: "model.general",
                  modelGatewayContractVersion: "1.0.0",
                  promptDigest: auditDigest,
                  promptTemplateId: "prompt.hash-audit",
                  promptVersion: "1.0.0",
                  requiredValidation: ["parse"],
                  supportedMode: "ai-assisted-custom",
                },
              ],
            },
            extensions: [extension],
            implementation: {
              extension,
              handler: workload.implementation.handler,
              mode: "ai-assisted-custom",
              runtimeFamily: workload.implementation.runtimeFamily,
              sourceOwnership: "ai-authored",
            },
            provenance: {
              acceptedAt: "2026-08-14T12:00:00Z",
              acceptedBy: document.revision.createdBy,
              modelGatewayId: "cloudmarkup.model-gateway",
              modelId: "model-v1",
              modelProviderId: "model.provider",
              outputDigest: auditDigest,
              promptDigest: auditDigest,
              promptTemplateId: "prompt.hash-audit",
              promptVersion: "1.0.0",
              source: "ai-assisted",
            },
          },
        ],
      },
    });
    const retimestamped = {
      ...timestamped,
      applicationContracts: {
        ...timestamped.applicationContracts,
        contracts: timestamped.applicationContracts.contracts.map(
          (contract) => ({
            ...contract,
            provenance: {
              ...contract.provenance,
              recordedAt: "2030-01-01T00:00:00Z",
            },
          }),
        ),
      },
      externalResources: {
        ...timestamped.externalResources,
        resources: timestamped.externalResources.resources.map((resource) => ({
          ...resource,
          evidence: resource.evidence.map((evidence) => ({
            ...evidence,
            observedAt: "2030-01-01T00:00:00Z",
          })),
        })),
      },
      workloadBehavior: {
        ...timestamped.workloadBehavior,
        workloads: timestamped.workloadBehavior.workloads.map((item) =>
          item.provenance.source === "ai-assisted"
            ? {
                ...item,
                provenance: {
                  ...item.provenance,
                  acceptedAt: "2030-01-01T00:00:00Z",
                },
              }
            : item,
        ),
      },
    };

    expect(getArchitectureDocumentContentHash(retimestamped)).toBe(
      getArchitectureDocumentContentHash(timestamped),
    );
    expect(getArchitectureDocumentCanonicalHash(retimestamped)).not.toBe(
      getArchitectureDocumentCanonicalHash(timestamped),
    );
  });
  it("normalizes Intent Document collections and excludes audit timestamps", async () => {
    const document = parseIntentDocumentV1Json(
      await readFixture("intent-document/v1/valid/representative.json"),
    );
    const prompt = document.metadata.provenance.prompt;
    if (prompt.kind !== "prompt-reference") {
      throw new Error(
        "Representative intent fixture must use prompt provenance.",
      );
    }

    const reorderedAndRetimestamped = {
      ...document,
      revision: {
        ...document.revision,
        createdAt: "2030-01-01T00:00:00Z",
      },
      assumptions: [...document.assumptions].reverse(),
      unresolvedQuestions: [...document.unresolvedQuestions].reverse(),
      decisions: [...document.decisions].reverse().map((decision) => ({
        ...decision,
        decidedAt: "2030-01-01T00:00:01Z",
        rationale: {
          ...decision.rationale,
          considerations: [...decision.rationale.considerations].reverse(),
        },
      })),
      alternatives: [...document.alternatives].reverse().map((alternative) => ({
        ...alternative,
        rationale: {
          ...alternative.rationale,
          considerations: [...alternative.rationale.considerations].reverse(),
        },
      })),
      metadata: {
        ...document.metadata,
        provenance: {
          ...document.metadata.provenance,
          prompt: {
            ...prompt,
            capturedAt: "2030-01-01T00:00:02Z",
          },
        },
      },
    };
    const parsedChange = parseIntentDocumentV1(reorderedAndRetimestamped);

    expect(serializeIntentDocumentV1(parsedChange)).not.toBe(
      serializeIntentDocumentV1(document),
    );
    expect(getIntentDocumentContentHash(parsedChange)).toBe(
      getIntentDocumentContentHash(document),
    );
  });

  it("changes the content hash for substantive intent and repeats byte-identically", async () => {
    const document = parseIntentDocumentV1Json(
      await readFixture("intent-document/v1/valid/representative.json"),
    );
    const changed = {
      ...document,
      application: {
        ...document.application,
        summary: `${document.application.summary} Additional requirement.`,
      },
    };
    const repeated = Array.from({ length: 8 }, () =>
      getIntentDocumentContentHash(document),
    );

    expect(new Set(repeated).size).toBe(1);
    expect(repeated[0]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(getIntentDocumentContentHash(changed)).not.toBe(repeated[0]);
  });
});
