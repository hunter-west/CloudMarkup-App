import { describe, expect, it } from "vitest";

import {
  cloudMarkupRepositoryLockV1Schema,
  cloudMarkupRepositoryManifestV1Schema,
  repositoryPackageLayoutV1Schema,
  repositoryPackagePathSchema,
  repositoryPathOwnershipV1Schema,
  repositoryRelativePathSchema,
} from "./repository-ownership-v1.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const layout = {
  contractVersion: 1,
  roots: {
    cloudmarkup: "cloudmarkup",
    application: "application",
    infrastructure: "infrastructure",
    diagram: "diagram",
    evidence: "evidence",
    workflows: ".github/workflows",
  },
  requiredFiles: [
    "cloudmarkup/solution.json",
    "cloudmarkup/architecture.json",
    "cloudmarkup/workloads.json",
    "cloudmarkup/external-resources.json",
    "cloudmarkup/cloudmarkup.lock.json",
    "cloudmarkup/cloudmarkup.manifest.json",
  ],
  requiredDirectories: [
    "cloudmarkup/repository-snapshots",
    "cloudmarkup/contracts",
  ],
} as const;

const ownership = {
  declarationId: "ownership_application",
  path: "application",
  pathKind: "subtree",
  ownership: "generated",
  ownerId: "cloudmarkup.application-generator",
  regeneration: "replace-when-baseline-matches",
  conflictBehavior: "require-reviewed-resolution",
  semanticDiff: {
    strategy: "structured-language",
    normalizerId: "cloudmarkup.typescript-normalizer",
    normalizerVersion: "1.0.0",
  },
  baselineDigest: digest("1"),
} as const;

const manifestFile = {
  path: "application/src/handler.ts",
  checksum: digest("7"),
  semanticDigest: digest("8"),
  sizeBytes: 1_024,
  ownershipDeclarationId: ownership.declarationId,
  producerId: "cloudmarkup.application-generator",
  producerVersion: "1.0.0",
  baselineDigest: digest("1"),
} as const;

function validManifest() {
  return {
    schemaVersion: 1,
    manifestId: "manifest_1",
    packageContractVersion: 1,
    solutionRevisionId: "solution_revision_1",
    solutionRevisionDigest: digest("5"),
    lockDigest: digest("6"),
    layout,
    ownership: [ownership],
    files: [manifestFile],
    verification: {
      strategy: "manifest-and-semantic-diff",
      overwritePolicy: "never-silent",
      conflictPolicy: "fail-closed",
    },
  } as const;
}

describe("Repository ownership v1 schemas", () => {
  it("accepts only safe portable repository-relative paths", () => {
    expect(repositoryRelativePathSchema.parse("src/handler.ts")).toBe(
      "src/handler.ts",
    );
    expect(
      repositoryPackagePathSchema.parse(".github/workflows/verify.yml"),
    ).toBe(".github/workflows/verify.yml");

    for (const path of [
      "../secret",
      "cloudmarkup/../secret",
      "/absolute/path",
      "C:/absolute/path",
      "application\\handler.ts",
      "application//handler.ts",
      "application/./handler.ts",
      "https://user:token@example.com/file",
    ]) {
      expect(repositoryRelativePathSchema.safeParse(path).success).toBe(false);
    }
    expect(
      repositoryPackagePathSchema.safeParse("unowned/file.txt").success,
    ).toBe(false);
  });

  it("pins the exact package roots and required CloudMarkup files", () => {
    expect(repositoryPackageLayoutV1Schema.parse(layout)).toEqual(layout);

    const legacyProductLayout = JSON.parse(
      JSON.stringify(layout).replaceAll("cloudmarkup", "cloudcanvas"),
    ) as unknown;
    expect(
      repositoryPackageLayoutV1Schema.safeParse(legacyProductLayout).success,
    ).toBe(false);
    expect(
      repositoryPackageLayoutV1Schema.safeParse({
        ...layout,
        roots: { ...layout.roots, workflows: "workflows" },
      }).success,
    ).toBe(false);
    expect(
      repositoryPackageLayoutV1Schema.safeParse({
        ...layout,
        requiredFiles: layout.requiredFiles.slice(1),
      }).success,
    ).toBe(false);
  });

  it("requires digest-guarded regeneration and protects user ownership", () => {
    expect(repositoryPathOwnershipV1Schema.parse(ownership)).toEqual(ownership);
    expect(
      repositoryPathOwnershipV1Schema.safeParse({
        ...ownership,
        baselineDigest: undefined,
      }).success,
    ).toBe(false);
    expect(
      repositoryPathOwnershipV1Schema.safeParse({
        ...ownership,
        ownership: "user-owned",
      }).success,
    ).toBe(false);
    expect(
      repositoryPathOwnershipV1Schema.safeParse({
        ...ownership,
        ownership: "approved-extension",
      }).success,
    ).toBe(false);
  });

  it("binds a deterministic lock to exact versioned inputs", () => {
    const lock = {
      schemaVersion: 1,
      lockId: "lock_1",
      packageContractVersion: 1,
      solutionRevisionId: "solution_revision_1",
      solutionRevisionDigest: digest("2"),
      ownershipContractDigest: digest("3"),
      inputs: [
        {
          kind: "architecture",
          id: "architecture_revision_1",
          version: "3.0.0",
          digest: digest("4"),
        },
      ],
    } as const;

    expect(cloudMarkupRepositoryLockV1Schema.parse(lock)).toEqual(lock);
    expect(
      cloudMarkupRepositoryLockV1Schema.safeParse({
        ...lock,
        schemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      cloudMarkupRepositoryLockV1Schema.safeParse({
        ...lock,
        credentials: "forbidden",
      }).success,
    ).toBe(false);
  });

  it("records checksummed files and an explicit no-silent-overwrite policy", () => {
    const manifest = validManifest();

    expect(cloudMarkupRepositoryManifestV1Schema.parse(manifest)).toEqual(
      manifest,
    );
    expect(
      cloudMarkupRepositoryManifestV1Schema.safeParse({
        ...manifest,
        verification: {
          ...manifest.verification,
          overwritePolicy: "overwrite",
        },
      }).success,
    ).toBe(false);
    expect(
      cloudMarkupRepositoryManifestV1Schema.safeParse({
        ...manifest,
        token: "forbidden",
      }).success,
    ).toBe(false);
  });
  it("accepts disjoint file, directory, and subtree ownership declarations", () => {
    const manifest = validManifest();
    const infrastructureOwnership = {
      ...ownership,
      declarationId: "ownership_infrastructure_file",
      path: "infrastructure/main.tf",
      pathKind: "file",
      ownerId: "cloudmarkup.infrastructure-compiler",
    } as const;
    const evidenceDirectoryOwnership = {
      ...ownership,
      declarationId: "ownership_evidence_directory",
      path: "evidence/build",
      pathKind: "directory",
      ownerId: "cloudmarkup.evidence-writer",
    } as const;
    const infrastructureFile = {
      ...manifestFile,
      path: "infrastructure/main.tf",
      ownershipDeclarationId: infrastructureOwnership.declarationId,
      producerId: "cloudmarkup.infrastructure-compiler",
    } as const;
    const candidate = {
      ...manifest,
      ownership: [
        ownership,
        infrastructureOwnership,
        evidenceDirectoryOwnership,
      ],
      files: [manifestFile, infrastructureFile],
    } as const;

    expect(cloudMarkupRepositoryManifestV1Schema.parse(candidate)).toEqual(
      candidate,
    );
  });

  it("rejects duplicate or unresolved manifest ownership identities and file paths", () => {
    const manifest = validManifest();
    const duplicateIdentity = {
      ...ownership,
      path: "infrastructure",
    } as const;
    expect(() =>
      cloudMarkupRepositoryManifestV1Schema.parse({
        ...manifest,
        ownership: [ownership, duplicateIdentity],
      }),
    ).toThrow(/declaration identities must be unique/u);

    expect(() =>
      cloudMarkupRepositoryManifestV1Schema.parse({
        ...manifest,
        files: [manifestFile, { ...manifestFile, checksum: digest("9") }],
      }),
    ).toThrow(/file paths must be unique/u);

    expect(() =>
      cloudMarkupRepositoryManifestV1Schema.parse({
        ...manifest,
        files: [
          {
            ...manifestFile,
            ownershipDeclarationId: "ownership_missing",
          },
        ],
      }),
    ).toThrow(/existing ownership declaration/u);

    expect(() =>
      cloudMarkupRepositoryManifestV1Schema.parse({
        ...manifest,
        files: [
          {
            ...manifestFile,
            path: "infrastructure/main.tf",
          },
        ],
      }),
    ).toThrow(/outside referenced subtree ownership declaration/u);

    const directoryOwnership = {
      ...ownership,
      declarationId: "ownership_evidence_directory",
      path: "evidence/build",
      pathKind: "directory",
    } as const;
    expect(() =>
      cloudMarkupRepositoryManifestV1Schema.parse({
        ...manifest,
        ownership: [ownership, directoryOwnership],
        files: [
          manifestFile,
          {
            ...manifestFile,
            path: "evidence/build/result.json",
            ownershipDeclarationId: directoryOwnership.declarationId,
          },
        ],
      }),
    ).toThrow(/outside referenced directory ownership declaration/u);
  });

  it("rejects exact and ancestor ownership overlaps for every path kind", () => {
    const manifest = validManifest();
    const fileOwnership = {
      ...ownership,
      declarationId: "ownership_manifest_file",
      path: "infrastructure/main.tf",
      pathKind: "file",
    } as const;
    const file = {
      ...manifestFile,
      path: "infrastructure/main.tf",
      ownershipDeclarationId: fileOwnership.declarationId,
    } as const;
    const cases = [
      {
        label: "exact file and directory",
        first: {
          ...ownership,
          declarationId: "ownership_first",
          path: "application/src",
          pathKind: "file",
        },
        second: {
          ...ownership,
          declarationId: "ownership_second",
          path: "application/src",
          pathKind: "directory",
        },
      },
      {
        label: "subtree ancestor",
        first: {
          ...ownership,
          declarationId: "ownership_first",
          path: "application",
          pathKind: "subtree",
        },
        second: {
          ...ownership,
          declarationId: "ownership_second",
          path: "application/src/handler.ts",
          pathKind: "file",
        },
      },
      {
        label: "directory ancestor",
        first: {
          ...ownership,
          declarationId: "ownership_first",
          path: "application/src",
          pathKind: "directory",
        },
        second: {
          ...ownership,
          declarationId: "ownership_second",
          path: "application/src/handler.ts",
          pathKind: "file",
        },
      },
      {
        label: "file ancestor",
        first: {
          ...ownership,
          declarationId: "ownership_first",
          path: "application/src",
          pathKind: "file",
        },
        second: {
          ...ownership,
          declarationId: "ownership_second",
          path: "application/src/handler.ts",
          pathKind: "file",
        },
      },
    ] as const;

    for (const overlapCase of cases) {
      for (const declarations of [
        [overlapCase.first, overlapCase.second],
        [overlapCase.second, overlapCase.first],
      ] as const) {
        const result = cloudMarkupRepositoryManifestV1Schema.safeParse({
          ...manifest,
          ownership: [fileOwnership, ...declarations],
          files: [file],
        });
        expect(result.success, overlapCase.label).toBe(false);
        if (!result.success) {
          expect(
            result.error.issues.some(
              (issue) =>
                issue.message.includes("claim the same path") ||
                issue.message.includes("overlaps ancestor"),
            ),
            overlapCase.label,
          ).toBe(true);
        }
      }
    }
  });
});
