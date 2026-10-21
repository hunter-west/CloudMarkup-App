import { describe, expect, it } from "vitest";

import {
  externalResourceAuthenticationV1Schema,
  externalResourceLifecycleV1Schema,
  externalResourceReferenceDocumentV1Schema,
  generateExternalResourceReferenceDocumentV1JsonSchema,
} from "./external-resource-reference-v1.js";
import { normalizeExternalResourceReferenceDocumentV1 } from "./solution-normalization.js";

const digest =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333";
const timestamp = "2026-08-14T12:00:00Z";

function representativeExternalResourceDocument() {
  return {
    kind: "cloudmarkup.external-resource-reference-document",
    schemaVersion: 1,
    documentId: "document_external_resources",
    architectureId: "architecture_notes",
    revision: {
      revisionId: "revision_external_resources_1",
      revisionNumber: 1,
      createdAt: timestamp,
      createdBy: "actor_owner",
    },
    resources: [
      {
        id: "external_audit_api",
        displayName: "Audit API",
        capability: "external.audit.api",
        resourceType: "external.http.service",
        architectureNodeIds: ["node_notes_function"],
        provider: {
          state: "known",
          providerId: "provider.example",
          serviceFamily: "provider.example.http-api",
        },
        scope: {
          accountReference: "account_audit",
          region: "us-east-1",
        },
        addresses: [
          {
            addressId: "address_audit_api",
            kind: "url",
            value: "https://audit.example.test/v1",
          },
        ],
        lifecycle: {
          ownershipState: "third-party-service-api",
          lifecycleAuthority: "third-party-owner",
          behavior: {
            create: "forbidden",
            reference: "required",
            import: "unsupported",
            dataSource: "allowed",
          },
          iacTargets: [
            {
              target: "terraform",
              readiness: "reference-ready",
              mappingId: "mapping.example.audit-api",
              mappingVersion: "1.0.0",
            },
          ],
        },
        interfaces: [
          {
            interfaceId: "interface_audit_ingest",
            direction: "input",
            protocol: "protocol.https.json",
            contracts: [
              {
                contractKind: "event-message",
                contractId: "contracts.audit.event",
                contractVersion: "1.0.0",
                digest,
              },
            ],
            authentication: {
              method: "api-key-reference",
              secretReferences: ["secret_audit_api_key"],
            },
          },
        ],
        dataClassifications: ["confidential"],
        trustBoundary: "public-internet",
        availability: {
          assumption: "contracted",
          targetBasisPoints: 9_990,
          recoveryTimeSeconds: 3_600,
          recoveryPointSeconds: 0,
        },
        evidence: [
          {
            evidenceId: "evidence_repository_audit_api",
            source: "repository",
            digest,
            observedAt: timestamp,
          },
        ],
        description: "An externally operated API used for audit delivery.",
        extractedCandidates: [
          {
            candidateId: "candidate_service_family",
            fieldPath: "$.provider.serviceFamily",
            candidateValue: {
              kind: "namespaced-identifier",
              value: "provider.example.http-api",
            },
            confidenceBasisPoints: 9_250,
            provenance: {
              source: "deterministic-parser",
              importerId: "cloudmarkup.repository-importer",
              importerVersion: "1.0.0",
              repositorySnapshotId: "snapshot_repository_1",
              sourceFileDigest: digest,
              sourceLocation: { startLine: 12, endLine: 18 },
            },
          },
        ],
        unresolvedInformation: [
          {
            unresolvedInformationId: "unresolved_audit_rto",
            fieldPath: "$.availability.recoveryTimeSeconds",
            summary: "Confirm the vendor recovery-time objective.",
            blocking: false,
          },
        ],
      },
    ],
  } as const;
}

describe("External Resource Reference Document v1 schema", () => {
  it("accepts provider-neutral references, contracts, evidence, and provenance", () => {
    const parsed = externalResourceReferenceDocumentV1Schema.parse(
      representativeExternalResourceDocument(),
    );
    const resource = parsed.resources[0];

    expect(resource?.lifecycle.ownershipState).toBe("third-party-service-api");
    expect(resource?.interfaces[0]?.authentication.method).toBe(
      "api-key-reference",
    );
    expect(
      generateExternalResourceReferenceDocumentV1JsonSchema().$id,
    ).toContain("external-resource-reference-document/v1");
  });

  it("defines all seven ownership states with state-specific IaC behavior", () => {
    const lifecycles = [
      {
        ownershipState: "managed-by-generated-iac",
        lifecycleAuthority: "cloudmarkup-generated-iac",
        behavior: {
          create: "generated-iac-required",
          reference: "allowed",
          import: "not-applicable",
          dataSource: "optional",
        },
        iacTargets: [
          { target: "terraform", readiness: "managed-create-ready" },
        ],
      },
      {
        ownershipState: "existing-cloud-managed-elsewhere",
        lifecycleAuthority: "external-owner",
        behavior: {
          create: "forbidden",
          reference: "required",
          import: "review-optional",
          dataSource: "allowed",
        },
        iacTargets: [
          { target: "cloudformation", readiness: "import-candidate" },
        ],
      },
      {
        ownershipState: "imported-current-iac-lifecycle",
        lifecycleAuthority: "current-customer-iac",
        behavior: {
          create: "forbidden",
          reference: "required",
          import: "reviewed-required",
          dataSource: "optional",
          importAddressId: "address_import",
        },
        iacTargets: [{ target: "terraform", readiness: "import-ready" }],
      },
      {
        ownershipState: "third-party-service-api",
        lifecycleAuthority: "third-party-owner",
        behavior: {
          create: "forbidden",
          reference: "required",
          import: "unsupported",
          dataSource: "allowed",
        },
        iacTargets: [{ target: "terraform", readiness: "reference-ready" }],
      },
      {
        ownershipState: "on-premises-network-endpoint",
        lifecycleAuthority: "external-owner",
        behavior: {
          create: "forbidden",
          reference: "required",
          import: "unsupported",
          dataSource: "allowed",
        },
        iacTargets: [
          { target: "cloudformation", readiness: "data-source-ready" },
        ],
      },
      {
        ownershipState: "repository-defined-external-dependency",
        lifecycleAuthority: "repository-owner",
        behavior: {
          create: "forbidden",
          reference: "required",
          import: "unsupported",
          dataSource: "allowed",
        },
        iacTargets: [{ target: "terraform", readiness: "unsupported" }],
      },
      {
        ownershipState: "unknown-unresolved",
        lifecycleAuthority: "unresolved",
        behavior: {
          create: "forbidden",
          reference: "unresolved",
          import: "unresolved",
          dataSource: "unresolved",
        },
        iacTargets: [{ target: "terraform", readiness: "unresolved" }],
      },
    ] as const;

    expect(
      lifecycles.map(
        (lifecycle) =>
          externalResourceLifecycleV1Schema.parse(lifecycle).ownershipState,
      ),
    ).toHaveLength(7);
  });

  it("never permits externally managed resources to request creation", () => {
    expect(() =>
      externalResourceLifecycleV1Schema.parse({
        ownershipState: "existing-cloud-managed-elsewhere",
        lifecycleAuthority: "external-owner",
        behavior: {
          create: "generated-iac-required",
          reference: "required",
          import: "review-optional",
          dataSource: "allowed",
        },
        iacTargets: [],
      }),
    ).toThrow();

    expect(() =>
      externalResourceLifecycleV1Schema.parse({
        ownershipState: "unknown-unresolved",
        lifecycleAuthority: "unresolved",
        behavior: {
          create: "forbidden",
          reference: "unresolved",
          import: "unresolved",
          dataSource: "unresolved",
        },
        iacTargets: [
          { target: "terraform", readiness: "managed-create-ready" },
        ],
      }),
    ).toThrow();
  });

  it("rejects URL credentials, query secrets, and inline authentication values", () => {
    const document = representativeExternalResourceDocument();
    const [resource] = document.resources;

    for (const value of [
      "https://user:password@audit.example.test/v1",
      "https://audit.example.test/v1?token=secret",
    ]) {
      expect(() =>
        externalResourceReferenceDocumentV1Schema.parse({
          ...document,
          resources: [
            {
              ...resource,
              addresses: [
                { addressId: "address_audit_api", kind: "url", value },
              ],
            },
          ],
        }),
      ).toThrow();
    }

    expect(() =>
      externalResourceAuthenticationV1Schema.parse({
        method: "api-key-reference",
        secretReferences: ["secret_audit_api_key"],
        secretValue: "must-not-be-retained",
      }),
    ).toThrow();
  });

  it.each(["rawCode", "credentials"])(
    "rejects prohibited resource field %s",
    (field) => {
      const document = representativeExternalResourceDocument();
      const [resource] = document.resources;
      expect(resource).toBeDefined();

      expect(() =>
        externalResourceReferenceDocumentV1Schema.parse({
          ...document,
          resources: [{ ...resource, [field]: "must-not-be-retained" }],
        }),
      ).toThrow();
    },
  );
});

describe("External Resource Reference v1 canonical normalization", () => {
  it("sorts resources and nested references without mutating ownership semantics", () => {
    const parsed = externalResourceReferenceDocumentV1Schema.parse(
      representativeExternalResourceDocument(),
    );
    const base = parsed.resources[0];
    if (base === undefined) {
      throw new Error("Representative external-resource fixture is empty.");
    }
    const expanded = externalResourceReferenceDocumentV1Schema.parse({
      ...parsed,
      resources: [
        { ...base, id: "external_z" },
        { ...base, id: "external_a" },
      ],
    });
    const reordered = externalResourceReferenceDocumentV1Schema.parse({
      ...expanded,
      resources: [...expanded.resources].reverse().map((resource) => ({
        ...resource,
        architectureNodeIds: [...resource.architectureNodeIds].reverse(),
        addresses: [...resource.addresses].reverse(),
        lifecycle: {
          ...resource.lifecycle,
          iacTargets: [...resource.lifecycle.iacTargets].reverse(),
        },
        interfaces: [...resource.interfaces].reverse().map((item) => ({
          ...item,
          contracts: [...item.contracts].reverse(),
          authentication:
            "secretReferences" in item.authentication
              ? {
                  ...item.authentication,
                  secretReferences: [
                    ...item.authentication.secretReferences,
                  ].reverse(),
                }
              : item.authentication,
        })),
        dataClassifications: [...resource.dataClassifications].reverse(),
        evidence: [...resource.evidence].reverse(),
        extractedCandidates: [...resource.extractedCandidates].reverse(),
        unresolvedInformation: [...resource.unresolvedInformation].reverse(),
      })),
    });
    const before = JSON.stringify(reordered);
    const normalized = normalizeExternalResourceReferenceDocumentV1(reordered);

    expect(normalized).toEqual(
      normalizeExternalResourceReferenceDocumentV1(expanded),
    );
    expect(
      normalized.resources.every(
        (resource) => resource.lifecycle.behavior.create === "forbidden",
      ),
    ).toBe(true);
    expect(JSON.stringify(reordered)).toBe(before);
  });
});
