import {
  aiExtensionDependencyRequestV1Schema,
  aiExtensionOwnedPathV1Schema,
  modelCandidateBundleV1Schema,
  modelValidationExpectationV1Schema,
  namespacedIdentifierSchema,
  safeRelativePathSchema,
  sha256DigestSchema,
  solutionStableIdSchema,
  type ModelCandidateBundleV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  candidateDiagnosticV1Schema,
  type CandidateDiagnosticV1,
} from "./contracts.js";
import { applyExactUnifiedPatch } from "./patch.js";
import {
  candidateContentSafetyDiagnostics,
  digestCanonicalValue,
  portablePathKey,
  sameStringSet,
  sha256Text,
  utf8ByteLength,
  validatePortableCandidatePath,
  type CandidateContentKind,
} from "./security.js";

const candidateMaterializationExistingFileV1Schema = z
  .object({
    content: z.string().max(4 * 1024 * 1024),
    digest: sha256DigestSchema,
    noSecretValues: z.literal(true),
    ownership: z.enum(["user-owned", "previous-ai-candidate"]),
    path: safeRelativePathSchema,
  })
  .strict();
const candidateMaterializationRepairBaseV1Schema = z
  .object({
    content: z
      .string()
      .max(4 * 1024 * 1024)
      .optional(),
    digest: sha256DigestSchema,
    path: safeRelativePathSchema,
  })
  .strict();

const approvedCandidateDependencyV1Schema = z
  .object({
    approvalPathId: namespacedIdentifierSchema,
    ecosystem: namespacedIdentifierSchema,
    kind: z.enum(["package", "module", "provider"]),
    name: z.string().min(1).max(214),
    version: z.string().min(1).max(128),
  })
  .strict();

export const candidateMaterializationPolicyV1Schema = z
  .object({
    approvalPathIds: z.array(namespacedIdentifierSchema).min(1).max(32),
    approvedDependencies: z.array(approvedCandidateDependencyV1Schema).max(256),
    boundaryId: solutionStableIdSchema,
    contentKind: z.enum(["application", "terraform", "cloudformation"]),
    existingFiles: z
      .array(candidateMaterializationExistingFileV1Schema)
      .max(1_000),
    repairBases: z
      .array(candidateMaterializationRepairBaseV1Schema)
      .max(1_000)
      .default([]),
    limits: z
      .object({
        maximumFileBytes: z
          .number()
          .int()
          .positive()
          .max(4 * 1024 * 1024),
        maximumDependencies: z.number().int().nonnegative().max(256),
        maximumFiles: z.number().int().positive().max(1_000),
        maximumPatchHunks: z.number().int().positive().max(1_000),
        maximumTotalBytes: z
          .number()
          .int()
          .positive()
          .max(64 * 1024 * 1024),
      })
      .strict(),
    ownedPaths: z.array(aiExtensionOwnedPathV1Schema).min(1).max(1_000),
    protectedPaths: z.array(safeRelativePathSchema).max(4_096),
    sourceReferenceIds: z.array(solutionStableIdSchema).min(1).max(512),
    validationExpectations: z
      .array(modelValidationExpectationV1Schema)
      .min(1)
      .max(128),
  })
  .strict()
  .superRefine((value, context) => {
    const pathOwners = new Map<string, string>();
    for (const [index, entry] of value.ownedPaths.entries()) {
      const key = portablePathKey(entry.path);
      if (pathOwners.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Owned candidate paths must be portably unique.",
          path: ["ownedPaths", index, "path"],
        });
      }
      pathOwners.set(key, "owned");
    }
    for (const [index, path] of value.protectedPaths.entries()) {
      const key = portablePathKey(path);
      if (pathOwners.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Protected deterministic paths cannot be candidate-owned.",
          path: ["protectedPaths", index],
        });
      }
      pathOwners.set(key, "protected");
    }
    const existing = new Set<string>();
    value.existingFiles.forEach((file, index) => {
      const key = portablePathKey(file.path);
      if (existing.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Sanitized existing-file paths must be portably unique.",
          path: ["existingFiles", index, "path"],
        });
      }
      existing.add(key);
      if (sha256Text(file.content) !== file.digest) {
        context.addIssue({
          code: "custom",
          message:
            "Sanitized existing files must bind their exact content digest.",
          path: ["existingFiles", index, "digest"],
        });
      }
    });
    const repairPaths = new Set<string>();
    value.repairBases.forEach((base, index) => {
      const key = portablePathKey(base.path);
      if (repairPaths.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Repair lineage paths must be portably unique.",
          path: ["repairBases", index, "path"],
        });
      }
      repairPaths.add(key);
      if (
        base.content !== undefined &&
        sha256Text(base.content) !== base.digest
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Repair lineage content must bind its exact failed-candidate digest.",
          path: ["repairBases", index, "digest"],
        });
      }
    });
  });

export interface MaterializedCandidateFile {
  readonly content: string;
  readonly digest: Sha256Digest;
  readonly ownership: "ai-authored-candidate" | "user-owned-preserved";
  readonly path: string;
  readonly sizeBytes: number;
  readonly sourceKind: "file" | "patch";
}

export interface CandidateMaterializationResult {
  readonly bundleDigest: Sha256Digest;
  readonly dependencies: readonly z.output<
    typeof aiExtensionDependencyRequestV1Schema
  >[];
  readonly diagnostics: readonly CandidateDiagnosticV1[];
  readonly files: readonly MaterializedCandidateFile[];
  readonly succeeded: boolean;
}

function diagnostic(input: {
  readonly category: CandidateDiagnosticV1["category"];
  readonly code: string;
  readonly detail: string;
  readonly path?: string;
  readonly repairable: boolean;
  readonly severity?: CandidateDiagnosticV1["severity"];
  readonly summary: string;
}): CandidateDiagnosticV1 {
  return candidateDiagnosticV1Schema.parse({
    category: input.category,
    checkId: `cloudmarkup.ai-extension.${input.category}`,
    code: input.code,
    ...(input.path === undefined ? {} : { path: input.path }),
    repairable: input.repairable,
    severity: input.severity ?? "error",
    summary: input.summary,
    technicalDetail: input.detail,
  });
}

function dependencyKey(input: {
  readonly approvalPathId: string;
  readonly ecosystem: string;
  readonly kind: string;
  readonly name: string;
  readonly version: string;
}): string {
  return [
    input.approvalPathId,
    input.ecosystem,
    input.kind,
    input.name,
    input.version,
  ].join("\u0000");
}
function compareCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function materializeOne(input: {
  readonly candidate: ModelCandidateBundleV1["candidates"][number];
  readonly existingByPath: ReadonlyMap<
    string,
    z.output<typeof candidateMaterializationExistingFileV1Schema>
  >;
  readonly kind: CandidateContentKind;
  readonly repairByPath: ReadonlyMap<
    string,
    z.output<typeof candidateMaterializationRepairBaseV1Schema>
  >;
  readonly maximumFileBytes: number;
  readonly maximumPatchHunks: number;
  readonly ownedPath: z.output<typeof aiExtensionOwnedPathV1Schema>;
}): MaterializedCandidateFile {
  const candidate = input.candidate;
  const path = validatePortableCandidatePath(candidate.path);
  const existing = input.existingByPath.get(path);
  const repairBase = input.repairByPath.get(path);
  let content: string;
  if (candidate.kind === "file") {
    if (existing?.ownership === "user-owned") {
      throw new Error(
        "Existing user-owned content requires an exact bounded patch.",
      );
    }
    if (
      input.ownedPath.conflictPolicy === "propose-patch" &&
      existing !== undefined
    ) {
      throw new Error(
        "Existing propose-patch ownership requires a bounded patch.",
      );
    }
    if (repairBase !== undefined) {
      if (candidate.priorDigest !== repairBase.digest) {
        throw new Error(
          "A repaired file must bind the exact failed-candidate digest.",
        );
      }
    } else {
      if (existing === undefined && candidate.priorDigest !== undefined) {
        throw new Error("A new file cannot claim a prior content digest.");
      }
      if (
        existing !== undefined &&
        (candidate.priorDigest === undefined ||
          candidate.priorDigest !== existing.digest ||
          input.ownedPath.priorDigest !== existing.digest)
      ) {
        throw new Error(
          "Replacement requires the exact current owned-file digest.",
        );
      }
    }
    content = candidate.content;
    if (sha256Text(content) !== candidate.contentDigest) {
      throw new Error(
        "Candidate file content does not match its declared digest.",
      );
    }
  } else {
    if (input.ownedPath.conflictPolicy !== "propose-patch") {
      throw new Error(
        "A patch requires exact propose-patch ownership authority.",
      );
    }
    let baseContent: string | undefined;
    if (repairBase !== undefined) {
      if (
        candidate.baseDigest !== repairBase.digest ||
        repairBase.content === undefined
      ) {
        throw new Error(
          "A repaired patch requires the exact available failed-candidate content.",
        );
      }
      baseContent = repairBase.content;
    } else {
      if (
        candidate.baseDigest !== existing?.digest ||
        input.ownedPath.priorDigest !== existing.digest
      ) {
        throw new Error(
          "A patch requires the exact current owned-file base digest.",
        );
      }
      baseContent = existing.content;
    }
    content = applyExactUnifiedPatch({
      baseContent,
      limits: {
        maximumHunks: input.maximumPatchHunks,
        maximumOutputBytes: input.maximumFileBytes,
      },
      path,
      unifiedDiff: candidate.unifiedDiff,
    });
    if (sha256Text(content) !== candidate.proposedResultDigest) {
      throw new Error(
        "Patched content does not match the proposed result digest.",
      );
    }
  }
  const sizeBytes = utf8ByteLength(content);
  if (sizeBytes > input.maximumFileBytes) {
    throw new Error("Candidate file exceeds the approved byte limit.");
  }
  const safetyDiagnostics = candidateContentSafetyDiagnostics(
    content,
    input.kind,
  );
  if (safetyDiagnostics.length > 0) {
    throw new Error(safetyDiagnostics[0]);
  }
  return Object.freeze({
    content,
    digest: sha256Text(content),
    ownership:
      existing?.ownership === "user-owned"
        ? "user-owned-preserved"
        : "ai-authored-candidate",
    path,
    sizeBytes,
    sourceKind: candidate.kind,
  });
}

export function materializeCandidateBundle(input: {
  readonly bundle: unknown;
  readonly policy: unknown;
}): CandidateMaterializationResult {
  const bundle = modelCandidateBundleV1Schema.parse(input.bundle);
  const policy = candidateMaterializationPolicyV1Schema.parse(input.policy);
  const diagnostics: CandidateDiagnosticV1[] = [];
  const bundleDigest = digestCanonicalValue(bundle);

  if (
    bundle.boundary.boundaryId !== policy.boundaryId ||
    !sameStringSet(bundle.boundary.approvalPathIds, policy.approvalPathIds) ||
    !sameStringSet(
      bundle.boundary.ownedPaths,
      policy.ownedPaths.map(({ path }) => path),
    )
  ) {
    diagnostics.push(
      diagnostic({
        category: "ownership",
        code: "cloudmarkup.ai-extension.boundary-mismatch",
        detail:
          "The returned boundary does not equal the exact approved candidate authority.",
        repairable: false,
        summary: "Candidate ownership boundary was rejected.",
      }),
    );
  }
  if (
    digestCanonicalValue(bundle.validationExpectations) !==
    digestCanonicalValue(policy.validationExpectations)
  ) {
    diagnostics.push(
      diagnostic({
        category: "provenance",
        code: "cloudmarkup.ai-extension.validation-expectation-mismatch",
        detail:
          "Candidate validation expectations changed from the exact request.",
        repairable: false,
        summary: "Candidate validation authority was changed.",
      }),
    );
  }

  const protectedKeys = new Set(policy.protectedPaths.map(portablePathKey));
  const ownedByPath = new Map(
    policy.ownedPaths.map((entry) => [entry.path, entry]),
  );
  const existingByPath = new Map(
    policy.existingFiles.map((file) => [file.path, file]),
  );
  const repairByPath = new Map(
    policy.repairBases.map((base) => [base.path, base]),
  );
  const candidateKeys = new Set<string>();
  const files: MaterializedCandidateFile[] = [];
  if (bundle.candidates.length > policy.limits.maximumFiles) {
    diagnostics.push(
      diagnostic({
        category: "admission",
        code: "cloudmarkup.ai-extension.file-count-exceeded",
        detail: "Candidate file count exceeds the exact configured maximum.",
        repairable: true,
        summary: "Candidate contains too many files.",
      }),
    );
  }
  for (const candidate of bundle.candidates) {
    let portableKey: string;
    try {
      portableKey = portablePathKey(
        validatePortableCandidatePath(candidate.path),
      );
    } catch (error) {
      diagnostics.push(
        diagnostic({
          category: "ownership",
          code: "cloudmarkup.ai-extension.path-invalid",
          detail:
            error instanceof Error
              ? error.message
              : "Candidate path is invalid.",
          repairable: true,
          summary: "Candidate path is invalid or non-portable.",
        }),
      );
      continue;
    }
    if (candidateKeys.has(portableKey)) {
      diagnostics.push(
        diagnostic({
          category: "ownership",
          code: "cloudmarkup.ai-extension.path-collision",
          detail: "Candidate paths collide under portable normalization.",
          path: candidate.path,
          repairable: true,
          summary: "Candidate paths collide on supported hosts.",
        }),
      );
      continue;
    }
    candidateKeys.add(portableKey);
    const ownedPath = ownedByPath.get(candidate.path);
    if (ownedPath === undefined || protectedKeys.has(portableKey)) {
      diagnostics.push(
        diagnostic({
          category: "ownership",
          code: "cloudmarkup.ai-extension.path-not-owned",
          detail:
            "Candidate path is outside exact owned paths or shadows deterministic output.",
          path: candidate.path,
          repairable: false,
          summary: "Candidate attempted to write a protected path.",
        }),
      );
      continue;
    }
    try {
      files.push(
        materializeOne({
          candidate,
          existingByPath,
          repairByPath,
          kind: policy.contentKind,
          maximumFileBytes: policy.limits.maximumFileBytes,
          maximumPatchHunks: policy.limits.maximumPatchHunks,
          ownedPath,
        }),
      );
    } catch (error) {
      diagnostics.push(
        diagnostic({
          category:
            error instanceof Error &&
            /secret|credential|dynamic-code|process/iu.test(error.message)
              ? "security"
              : "admission",
          code: "cloudmarkup.ai-extension.candidate-content-invalid",
          detail:
            error instanceof Error
              ? error.message
              : "Candidate content could not be materialized safely.",
          path: candidate.path,
          repairable: candidate.kind === "file",
          summary: "Candidate content failed deterministic materialization.",
        }),
      );
    }
  }

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > policy.limits.maximumTotalBytes) {
    diagnostics.push(
      diagnostic({
        category: "admission",
        code: "cloudmarkup.ai-extension.total-bytes-exceeded",
        detail:
          "Materialized candidate bytes exceed the exact configured maximum.",
        repairable: true,
        summary: "Candidate output is too large.",
      }),
    );
  }

  if (bundle.dependencies.length > policy.limits.maximumDependencies) {
    diagnostics.push(
      diagnostic({
        category: "dependency",
        code: "cloudmarkup.ai-extension.dependency-count-exceeded",
        detail: "Requested dependencies exceed the exact configured maximum.",
        repairable: true,
        summary: "Candidate requested too many dependencies.",
      }),
    );
  }
  const requestedDependencyKeys = new Set<string>();
  const approvedDependencyKeys = new Set(
    policy.approvedDependencies.map((entry) =>
      dependencyKey({ ...entry, version: entry.version }),
    ),
  );
  const dependencies = bundle.dependencies.map((entry) => {
    const requestedKey = dependencyKey({
      ...entry,
      version: entry.requestedVersion,
    });
    if (requestedDependencyKeys.has(requestedKey)) {
      diagnostics.push(
        diagnostic({
          category: "dependency",
          code: "cloudmarkup.ai-extension.dependency-duplicate",
          detail: "Requested dependency tuples must be unique.",
          repairable: true,
          summary: "Candidate repeated a dependency request.",
        }),
      );
    }
    requestedDependencyKeys.add(requestedKey);
    const approved = approvedDependencyKeys.has(requestedKey);
    if (!approved) {
      diagnostics.push(
        diagnostic({
          category: "dependency",
          code: "cloudmarkup.ai-extension.dependency-not-approved",
          detail:
            "Requested dependency is not present in the exact reviewed allowlist.",
          repairable: true,
          summary: "Candidate requested an unapproved dependency.",
        }),
      );
    }
    return aiExtensionDependencyRequestV1Schema.parse({
      ecosystem: entry.ecosystem,
      name: entry.name,
      reason: entry.reason,
      requestedVersion: entry.requestedVersion,
      reviewState: approved ? "approved" : "rejected",
    });
  });

  const orderedFiles = [...files].sort((left, right) =>
    compareCanonicalText(
      portablePathKey(left.path),
      portablePathKey(right.path),
    ),
  );
  const orderedDiagnostics = [...diagnostics].sort((left, right) =>
    compareCanonicalText(
      [left.path ?? "", left.code, left.summary].join("\u0000"),
      [right.path ?? "", right.code, right.summary].join("\u0000"),
    ),
  );
  return Object.freeze({
    bundleDigest,
    dependencies: Object.freeze(dependencies),
    diagnostics: Object.freeze(orderedDiagnostics),
    files: Object.freeze(orderedFiles),
    succeeded:
      orderedFiles.length === bundle.candidates.length &&
      orderedDiagnostics.every(({ severity }) => severity !== "error"),
  });
}

export type CandidateMaterializationPolicyV1 = z.output<
  typeof candidateMaterializationPolicyV1Schema
>;
