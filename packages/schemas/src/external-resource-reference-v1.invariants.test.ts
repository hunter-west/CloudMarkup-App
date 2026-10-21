import { describe, expect, it } from "vitest";

import {
  externalResourceAddressV1Schema,
  externalResourceCandidateFieldV1Schema,
  externalResourceV1Schema,
  generateExternalResourceReferenceDocumentV1JsonSchema,
} from "./external-resource-reference-v1.js";

const digest =
  "sha256:6666666666666666666666666666666666666666666666666666666666666666";

function importedResource(importAddressId: string) {
  return {
    id: "external_imported_table",
    displayName: "Imported table",
    capability: "external.data.table",
    architectureNodeIds: [],
    provider: { state: "unknown", reason: "Provider selection is unresolved." },
    scope: {},
    addresses: [
      {
        addressId: "address_imported_table",
        kind: "provider-resource-id",
        value: "tables/imported-table",
      },
    ],
    lifecycle: {
      ownershipState: "imported-current-iac-lifecycle",
      lifecycleAuthority: "current-customer-iac",
      behavior: {
        create: "forbidden",
        reference: "required",
        import: "reviewed-required",
        dataSource: "optional",
        importAddressId,
      },
      iacTargets: [{ target: "terraform", readiness: "import-ready" }],
    },
    interfaces: [],
    dataClassifications: [],
    trustBoundary: "unknown",
    availability: { assumption: "unknown" },
    evidence: [],
    extractedCandidates: [],
    unresolvedInformation: [],
  } as const;
}

describe("External Resource Reference v1 safety invariants", () => {
  it("restricts URL references to query-free HTTPS in Zod and generated schema", () => {
    expect(
      externalResourceAddressV1Schema.parse({
        addressId: "address_https",
        kind: "url",
        value: "https://api.example.test/v1",
      }).kind,
    ).toBe("url");

    for (const value of [
      "http://api.example.test/v1",
      "javascript:alert(1)",
      "data:text/plain,secret",
      "file:///etc/passwd",
      "https://user:password@api.example.test/v1",
      "https://api.example.test/v1?token=secret",
    ]) {
      expect(() =>
        externalResourceAddressV1Schema.parse({
          addressId: "address_unsafe",
          kind: "url",
          value,
        }),
      ).toThrow();
    }

    expect(
      JSON.stringify(generateExternalResourceReferenceDocumentV1JsonSchema()),
    ).toContain("^https:");
  });

  it("requires imported lifecycle references to name a declared address", () => {
    expect(
      externalResourceV1Schema.parse(importedResource("address_imported_table"))
        .lifecycle.ownershipState,
    ).toBe("imported-current-iac-lifecycle");

    expect(() =>
      externalResourceV1Schema.parse(importedResource("address_missing")),
    ).toThrow();
  });

  it("rejects inverted source locations and raw opaque candidate values", () => {
    const candidate = {
      candidateId: "candidate_provider",
      fieldPath: "$.provider.serviceFamily",
      candidateValue: {
        kind: "namespaced-identifier",
        value: "provider.example.service",
      },
      confidenceBasisPoints: 8_000,
      provenance: {
        source: "deterministic-parser",
        importerId: "cloudmarkup.repository-importer",
        importerVersion: "1.0.0",
        repositorySnapshotId: "snapshot_repository",
        sourceFileDigest: digest,
        sourceLocation: { startLine: 20, endLine: 10 },
      },
    } as const;

    expect(() =>
      externalResourceCandidateFieldV1Schema.parse(candidate),
    ).toThrow();
    expect(() =>
      externalResourceCandidateFieldV1Schema.parse({
        ...candidate,
        provenance: {
          ...candidate.provenance,
          sourceLocation: { startLine: 10, endLine: 20 },
        },
        candidateValue: {
          kind: "opaque-reference",
          value: "token-secret-value",
        },
      }),
    ).toThrow();
  });
});
