import { z } from "zod";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
} from "./architecture-document-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const repositoryRelativePathPattern = /^[A-Za-z0-9._/-]{1,512}$/;

const opaqueRepositoryIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const repositoryPackageManifestIdSchema =
  opaqueRepositoryIdSchema.brand<"RepositoryPackageManifestId">();
export const repositoryLockIdSchema =
  opaqueRepositoryIdSchema.brand<"RepositoryLockId">();
export const repositoryOwnershipDeclarationIdSchema =
  opaqueRepositoryIdSchema.brand<"RepositoryOwnershipDeclarationId">();

/**
 * Portable repository paths are POSIX-style, repository-relative, and closed
 * against traversal. The schema deliberately excludes URLs, drive letters,
 * backslashes, glob syntax, and platform-specific separators.
 */
export const repositoryRelativePathSchema = z
  .string()
  .regex(
    repositoryRelativePathPattern,
    "Must be a bounded POSIX repository-relative path.",
  )
  .refine((path) => !path.startsWith("/"), "Must not be absolute.")
  .refine((path) => !path.endsWith("/"), "Must not end with a separator.")
  .refine((path) => !path.includes("//"), "Must not contain empty segments.")
  .refine(
    (path) =>
      path.split("/").every((segment) => segment !== "." && segment !== ".."),
    "Must not contain dot or traversal segments.",
  )
  .brand<"RepositoryRelativePath">();

export const repositoryPackageRootV1Schema = z.enum([
  "cloudmarkup",
  "application",
  "infrastructure",
  "diagram",
  "evidence",
  ".github/workflows",
]);

export const repositoryPackagePathSchema = repositoryRelativePathSchema.refine(
  (path) =>
    repositoryPackageRootV1Schema.options.some(
      (root) => path === root || path.startsWith(`${root}/`),
    ),
  "Must be inside a fixed CloudMarkup repository package root.",
);

export const cloudMarkupRequiredFileV1Schema = z.enum([
  "cloudmarkup/solution.json",
  "cloudmarkup/architecture.json",
  "cloudmarkup/workloads.json",
  "cloudmarkup/external-resources.json",
  "cloudmarkup/cloudmarkup.lock.json",
  "cloudmarkup/cloudmarkup.manifest.json",
]);

export const cloudMarkupRequiredDirectoryV1Schema = z.enum([
  "cloudmarkup/repository-snapshots",
  "cloudmarkup/contracts",
]);

export const repositoryPackageLayoutV1Schema = z
  .object({
    contractVersion: z.literal(1),
    roots: z
      .object({
        cloudmarkup: z.literal("cloudmarkup"),
        application: z.literal("application"),
        infrastructure: z.literal("infrastructure"),
        diagram: z.literal("diagram"),
        evidence: z.literal("evidence"),
        workflows: z.literal(".github/workflows"),
      })
      .strict(),
    requiredFiles: z.tuple([
      z.literal("cloudmarkup/solution.json"),
      z.literal("cloudmarkup/architecture.json"),
      z.literal("cloudmarkup/workloads.json"),
      z.literal("cloudmarkup/external-resources.json"),
      z.literal("cloudmarkup/cloudmarkup.lock.json"),
      z.literal("cloudmarkup/cloudmarkup.manifest.json"),
    ]),
    requiredDirectories: z.tuple([
      z.literal("cloudmarkup/repository-snapshots"),
      z.literal("cloudmarkup/contracts"),
    ]),
  })
  .strict();

export const repositoryPathOwnershipKindV1Schema = z.enum([
  "source",
  "generated",
  "ai-authored",
  "user-owned",
  "imported-observation",
  "approved-extension",
]);

export const repositoryRegenerationPolicyV1Schema = z.enum([
  "never",
  "replace-when-baseline-matches",
  "refresh-observation",
  "require-reviewed-operation",
]);

export const repositoryConflictBehaviorV1Schema = z.enum([
  "fail-closed",
  "preserve-user-content",
  "require-reviewed-resolution",
]);

export const repositorySemanticDiffStrategyV1Schema = z.enum([
  "canonical-json",
  "byte-exact",
  "structured-language",
]);

export const repositoryPathOwnershipV1Schema = z
  .object({
    declarationId: repositoryOwnershipDeclarationIdSchema,
    path: repositoryPackagePathSchema,
    pathKind: z.enum(["file", "directory", "subtree"]),
    ownership: repositoryPathOwnershipKindV1Schema,
    ownerId: namespacedIdentifierSchema,
    regeneration: repositoryRegenerationPolicyV1Schema,
    conflictBehavior: repositoryConflictBehaviorV1Schema,
    semanticDiff: z
      .object({
        strategy: repositorySemanticDiffStrategyV1Schema,
        normalizerId: namespacedIdentifierSchema.optional(),
        normalizerVersion: semanticVersionSchema.optional(),
      })
      .strict()
      .superRefine((value, context) => {
        const hasNormalizer = value.normalizerId !== undefined;
        const hasVersion = value.normalizerVersion !== undefined;
        if (hasNormalizer !== hasVersion) {
          context.addIssue({
            code: "custom",
            message:
              "Normalizer identity and version must be supplied together.",
          });
        }
      }),
    baselineDigest: sha256DigestSchema.optional(),
    extensionPointId: namespacedIdentifierSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.regeneration === "replace-when-baseline-matches" &&
      value.baselineDigest === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["baselineDigest"],
        message: "Safe replacement requires an exact baseline digest.",
      });
    }
    if (
      value.ownership === "approved-extension" &&
      value.extensionPointId === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["extensionPointId"],
        message: "Approved extensions require an extension-point identity.",
      });
    }
    if (value.ownership === "user-owned" && value.regeneration !== "never") {
      context.addIssue({
        code: "custom",
        path: ["regeneration"],
        message: "User-owned paths cannot be regenerated.",
      });
    }
  });

export const repositoryLockedInputKindV1Schema = z.enum([
  "solution-revision",
  "architecture",
  "workloads",
  "external-resources",
  "contracts",
  "repository-snapshot",
  "observed-layer",
  "catalog",
  "compiler",
  "application-generator",
  "diagram-generator",
  "importer",
  "policy",
  "model-prompt",
]);

export const repositoryLockedInputV1Schema = z
  .object({
    kind: repositoryLockedInputKindV1Schema,
    id: opaqueRepositoryIdSchema,
    version: semanticVersionSchema,
    digest: sha256DigestSchema,
  })
  .strict();

export const cloudMarkupRepositoryLockV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    lockId: repositoryLockIdSchema,
    packageContractVersion: z.literal(1),
    solutionRevisionId: opaqueRepositoryIdSchema,
    solutionRevisionDigest: sha256DigestSchema,
    ownershipContractDigest: sha256DigestSchema,
    inputs: z.array(repositoryLockedInputV1Schema).min(1).max(512),
  })
  .strict();

export const repositoryManifestEntryV1Schema = z
  .object({
    path: repositoryPackagePathSchema,
    checksum: sha256DigestSchema,
    semanticDigest: sha256DigestSchema,
    sizeBytes: z.number().int().nonnegative().max(1_073_741_824),
    ownershipDeclarationId: repositoryOwnershipDeclarationIdSchema,
    producerId: namespacedIdentifierSchema,
    producerVersion: semanticVersionSchema,
    baselineDigest: sha256DigestSchema.optional(),
  })
  .strict();

type RepositoryOwnershipScopeV1 = z.output<
  typeof repositoryPathOwnershipV1Schema
>;

function properAncestorPaths(path: string): string[] {
  const ancestors: string[] = [];
  let candidate = path;
  let separatorIndex = candidate.lastIndexOf("/");
  while (separatorIndex >= 0) {
    candidate = candidate.slice(0, separatorIndex);
    ancestors.push(candidate);
    separatorIndex = candidate.lastIndexOf("/");
  }
  return ancestors;
}

/**
 * Version 1 deliberately defines no "most specific path wins" behavior.
 * Exact and ancestor/descendant declarations are therefore ambiguous for every
 * file, directory, and subtree pairing and fail closed.
 */
function addAmbiguousOwnershipDeclarationIssues(
  declarations: readonly RepositoryOwnershipScopeV1[],
  context: z.RefinementCtx,
) {
  const firstDeclarationByPath = new Map<string, RepositoryOwnershipScopeV1>();
  const duplicateIndexes = new Set<number>();

  for (const [index, declaration] of declarations.entries()) {
    const existing = firstDeclarationByPath.get(declaration.path);
    if (existing !== undefined) {
      duplicateIndexes.add(index);
      context.addIssue({
        code: "custom",
        path: ["ownership", index, "path"],
        message:
          "Ownership declarations " +
          existing.declarationId +
          " and " +
          declaration.declarationId +
          " claim the same path with ambiguous " +
          existing.pathKind +
          "/" +
          declaration.pathKind +
          " kinds.",
      });
      continue;
    }
    firstDeclarationByPath.set(declaration.path, declaration);
  }

  for (const [index, declaration] of declarations.entries()) {
    if (duplicateIndexes.has(index)) {
      continue;
    }
    for (const ancestorPath of properAncestorPaths(declaration.path)) {
      const ancestor = firstDeclarationByPath.get(ancestorPath);
      if (ancestor === undefined) {
        continue;
      }
      context.addIssue({
        code: "custom",
        path: ["ownership", index, "path"],
        message:
          "Ownership declaration " +
          declaration.declarationId +
          " overlaps ancestor declaration " +
          ancestor.declarationId +
          "; version 1 defines no hierarchy precedence for " +
          ancestor.pathKind +
          "/" +
          declaration.pathKind +
          " kinds.",
      });
      break;
    }
  }
}

/**
 * A file declaration covers only its exact file, a subtree covers strict
 * descendants of its directory root, and a directory declaration covers no
 * manifest file entry.
 */
function ownershipDeclarationCoversManifestFile(
  declaration: RepositoryOwnershipScopeV1,
  filePath: string,
): boolean {
  if (declaration.pathKind === "file") {
    return declaration.path === filePath;
  }
  if (declaration.pathKind === "subtree") {
    return filePath.startsWith(declaration.path + "/");
  }
  return false;
}

export const cloudMarkupRepositoryManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    manifestId: repositoryPackageManifestIdSchema,
    packageContractVersion: z.literal(1),
    solutionRevisionId: opaqueRepositoryIdSchema,
    solutionRevisionDigest: sha256DigestSchema,
    lockDigest: sha256DigestSchema,
    layout: repositoryPackageLayoutV1Schema,
    ownership: z.array(repositoryPathOwnershipV1Schema).min(1).max(2_048),
    files: z.array(repositoryManifestEntryV1Schema).min(1).max(20_000),
    verification: z
      .object({
        strategy: z.literal("manifest-and-semantic-diff"),
        overwritePolicy: z.literal("never-silent"),
        conflictPolicy: z.literal("fail-closed"),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const declarationById = new Map<string, RepositoryOwnershipScopeV1>();
    for (const [index, declaration] of manifest.ownership.entries()) {
      if (declarationById.has(declaration.declarationId)) {
        context.addIssue({
          code: "custom",
          path: ["ownership", index, "declarationId"],
          message:
            "Ownership declaration identities must be unique; duplicate " +
            declaration.declarationId +
            ".",
        });
      } else {
        declarationById.set(declaration.declarationId, declaration);
      }
    }

    addAmbiguousOwnershipDeclarationIssues(manifest.ownership, context);

    const filePaths = new Set<string>();
    for (const [index, file] of manifest.files.entries()) {
      if (filePaths.has(file.path)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "path"],
          message:
            "Manifest file paths must be unique; duplicate " + file.path + ".",
        });
      }
      filePaths.add(file.path);

      const declaration = declarationById.get(file.ownershipDeclarationId);
      if (declaration === undefined) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "ownershipDeclarationId"],
          message:
            "Manifest files must reference an existing ownership declaration.",
        });
        continue;
      }
      if (!ownershipDeclarationCoversManifestFile(declaration, file.path)) {
        context.addIssue({
          code: "custom",
          path: ["files", index, "ownershipDeclarationId"],
          message:
            "Manifest file " +
            file.path +
            " is outside referenced " +
            declaration.pathKind +
            " ownership declaration " +
            declaration.declarationId +
            ".",
        });
      }
    }
  });

export type RepositoryRelativePath = z.output<
  typeof repositoryRelativePathSchema
>;
export type RepositoryPackageRootV1 = z.output<
  typeof repositoryPackageRootV1Schema
>;
export type RepositoryPackageLayoutV1 = z.output<
  typeof repositoryPackageLayoutV1Schema
>;
export type RepositoryPathOwnershipKindV1 = z.output<
  typeof repositoryPathOwnershipKindV1Schema
>;
export type RepositoryPathOwnershipV1 = z.output<
  typeof repositoryPathOwnershipV1Schema
>;
export type RepositoryLockedInputV1 = z.output<
  typeof repositoryLockedInputV1Schema
>;
export type CloudMarkupRepositoryLockV1 = z.output<
  typeof cloudMarkupRepositoryLockV1Schema
>;
export type RepositoryManifestEntryV1 = z.output<
  typeof repositoryManifestEntryV1Schema
>;
export type CloudMarkupRepositoryManifestV1 = z.output<
  typeof cloudMarkupRepositoryManifestV1Schema
>;
