import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  getApplicationContractRecordContentHash,
  migrateArchitectureDocumentV2ToV3,
  parseArchitectureDocument,
} from "./index.js";

async function representativeV3() {
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../test-fixtures/fixtures/architecture-document/v2/valid/representative.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;
  return migrateArchitectureDocumentV2ToV3(source);
}

describe("Architecture v3 cross-document reference integrity", () => {
  it("rejects workload behavior references to undeclared operations", async () => {
    const document = await representativeV3();
    const workload = document.workloadBehavior.workloads[0];
    if (workload === undefined) {
      throw new Error("Representative workload must expose a handler.");
    }
    const implementation = workload.implementation;
    if (implementation.mode === "infrastructure-only") {
      throw new Error("Representative workload must expose a handler.");
    }

    expect(() =>
      parseArchitectureDocument({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              entrypoints: [
                {
                  entrypointId: "entrypoint_missing_operation",
                  handler: implementation.handler,
                  kind: "request-handler",
                  operationId: "operation_missing",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/broken_workload_v2_operation_reference/u);
  });

  it("requires exact application contract version and digest references", async () => {
    const document = await representativeV3();
    const workload = document.workloadBehavior.workloads[0];
    const operation = workload?.operations[0];
    if (workload === undefined || operation === undefined) {
      throw new Error("Representative workload must expose an operation.");
    }

    const contract = {
      authenticationMethod: "none",
      claims: [
        {
          name: "tenant",
          required: true,
          sensitive: false,
          source: "identity-token",
          valueType: "string",
        },
        {
          name: "subject",
          required: true,
          sensitive: false,
          source: "identity-token",
          valueType: "string",
        },
      ],
      contractId: "contract.auth.primary",
      contractKind: "auth",
      contractVersion: "1.0.0",
      displayName: "Primary authorization",
      provenance: {
        recordedAt: document.revision.createdAt,
        recordedBy: document.revision.createdBy,
        source: "designed",
        sourceReferenceIds: ["source-b", "source-a"],
      },
      roles: [
        {
          claimRequirements: [
            { claimName: "tenant", match: "present" },
            { claimName: "subject", match: "present" },
          ],
          displayName: "Administrator",
          roleId: "role_admin",
        },
        {
          claimRequirements: [{ claimName: "subject", match: "present" }],
          displayName: "Reader",
          roleId: "role_reader",
        },
      ],
    } as const;
    const reorderedContract = {
      ...contract,
      claims: [...contract.claims].reverse(),
      provenance: {
        ...contract.provenance,
        sourceReferenceIds: [
          ...contract.provenance.sourceReferenceIds,
        ].reverse(),
      },
      roles: [...contract.roles].reverse().map((role) => ({
        ...role,
        claimRequirements: [...role.claimRequirements].reverse(),
      })),
    };
    expect(getApplicationContractRecordContentHash(reorderedContract)).toBe(
      getApplicationContractRecordContentHash(contract),
    );
    const exactReference = {
      contractId: contract.contractId,
      contractKind: contract.contractKind,
      contractVersion: contract.contractVersion,
      digest: getApplicationContractRecordContentHash(reorderedContract),
    };
    const candidate = {
      ...document,
      applicationContracts: {
        ...document.applicationContracts,
        contracts: [contract],
      },
      workloadBehavior: {
        ...document.workloadBehavior,
        workloads: [
          {
            ...workload,
            authorization: [
              {
                authContract: exactReference,
                bindingId: "authorization_primary",
                deniedBehavior: "reject",
                operationIds: [operation.id],
                permittedRoleIds: [],
              },
            ],
          },
        ],
      },
    };

    expect(parseArchitectureDocument(candidate)).toBeDefined();
    expect(() =>
      parseArchitectureDocument({
        ...candidate,
        workloadBehavior: {
          ...candidate.workloadBehavior,
          workloads: [
            {
              ...candidate.workloadBehavior.workloads[0],
              authorization: [
                {
                  ...candidate.workloadBehavior.workloads[0]?.authorization[0],
                  authContract: {
                    ...exactReference,
                    digest: `sha256:${"f".repeat(64)}`,
                  },
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/application_contract_digest_mismatch/u);
  });

  it("keeps AI-authored source proposals behind explicit provenance and ModelGateway compatibility", async () => {
    const document = await representativeV3();
    const workload = document.workloadBehavior.workloads[0];
    if (workload === undefined) {
      throw new Error("Representative workload must expose a handler.");
    }
    const implementation = workload.implementation;
    if (implementation.mode === "infrastructure-only") {
      throw new Error("Representative workload must expose a handler.");
    }
    const extension = {
      digest: `sha256:${"e".repeat(64)}`,
      extensionContractVersion: 1,
      extensionId: "extension_custom_handler",
      ownership: "ai-authored",
      validationEvidenceIds: ["evidence_static_1"],
    } as const;

    expect(() =>
      parseArchitectureDocument({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...workload,
              extensions: [extension],
              implementation: {
                extension,
                handler: implementation.handler,
                mode: "ai-assisted-custom",
                runtimeFamily: implementation.runtimeFamily,
                sourceOwnership: "ai-authored",
              },
              provenance: {
                recordedAt: document.revision.createdAt,
                recordedBy: document.revision.createdBy,
                source: "manual",
              },
            },
          ],
        },
      }),
    ).toThrow(/invalid_workload_model_compatibility/u);
  });

  it("requires one exact complete reviewed AI extension reference", async () => {
    const document = await representativeV3();
    const workload = document.workloadBehavior.workloads[0];
    if (workload === undefined) {
      throw new Error("Representative workload must expose a handler.");
    }
    const implementation = workload.implementation;
    if (implementation.mode === "infrastructure-only") {
      throw new Error("Representative workload must expose a handler.");
    }
    const extension = {
      digest: `sha256:${"e".repeat(64)}`,
      extensionContractVersion: 1,
      extensionId: "extension_custom_handler",
      ownership: "ai-authored",
      validationEvidenceIds: ["evidence_static_1"],
    } as const;
    const common = {
      ...workload,
      implementation: {
        extension: {
          ...extension,
          validationEvidenceIds: ["evidence_different"],
        },
        handler: implementation.handler,
        mode: "ai-assisted-custom",
        runtimeFamily: implementation.runtimeFamily,
        sourceOwnership: "ai-authored",
      },
      provenance: {
        recordedAt: document.revision.createdAt,
        recordedBy: document.revision.createdBy,
        source: "manual",
      },
    } as const;

    expect(() =>
      parseArchitectureDocument({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [{ ...common, extensions: [extension] }],
        },
      }),
    ).toThrow(/broken_workload_extension_reference/u);

    expect(() =>
      parseArchitectureDocument({
        ...document,
        workloadBehavior: {
          ...document.workloadBehavior,
          workloads: [
            {
              ...common,
              extensions: [extension, extension],
              implementation: {
                ...common.implementation,
                extension,
              },
            },
          ],
        },
      }),
    ).toThrow(/duplicate_workload_extension_id/u);
  });
});
