import { reviewedHostBoundedRepairPromptV4 } from "./prompts/host-bounded-repair.js";
import { reviewedHostSeedRepairPromptV2 } from "./prompts/host-seed-repair.js";
import {
  resolveReviewedHostSeedRepairPromptV3,
  resolveReviewedHostPatchRepairPromptV3,
} from "./prompts/host-seed-patch-repair.js";
import {
  parseModelHostSeedPatchResponseToolContentV2,
  parseModelResponseToolContentV1,
} from "./tools.js";
import { createHash } from "node:crypto";

import {
  getActiveIssueRecordHash,
  getApplicationContractRecordContentHash,
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentHashes,
  parseIntentDocument,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import {
  normalizeWorkloadBehaviorV2,
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  type ModelHostRepairSuccessorRequestV3,
  type ModelLiveRepairSuccessorInvocationDescriptorV4,
  modelLiveSeedInvocationDescriptorV3Schema,
  type ModelHostSeedRepairRequestV2,
  type ModelLiveSeedInvocationDescriptorV3,
  serializeCanonicalJson,
  sha256DigestSchema,
  type ModelHostSeedPatchResponseV2,
  type ModelCandidateBundleV1,
  type ModelGatewayRequestV1,
  type ModelGatewayResponseV1,
  type ModelGenerationContextV1,
  type ModelInvocationDescriptorV1,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import type { ModelInputRedactionSummaryV1 } from "./ports.js";

export class ModelGatewayValidationError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ModelGatewayValidationError";
    this.code = code;
  }
}

const secretPatterns = [
  {
    category: "credential-candidate" as const,
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED:CREDENTIAL]",
  },
  {
    category: "credential-candidate" as const,
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED:PRIVATE-KEY]",
  },
  {
    category: "credential-candidate" as const,
    pattern:
      /(["']?\bAuthorization\b["']?\s*:\s*)(["']?)Basic\s+[A-Za-z0-9+/]{4,}={0,2}\2/gi,
    replacement: "$1$2Basic [REDACTED:CREDENTIAL]$2",
  },
  {
    category: "secret-candidate" as const,
    pattern:
      /(["']?\baws_secret_access_key\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
    replacement: "$1[REDACTED:SECRET]",
  },
  {
    category: "secret-candidate" as const,
    pattern:
      /(["']?\baws[-_]?session[-_]?token\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
    replacement: "$1[REDACTED:SECRET]",
  },
  {
    category: "secret-candidate" as const,
    pattern:
      /(["']?(?:password|passwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key|credential)["']?\s*:\s*)(["'])([^"'\r\n]+)\2/gi,
    replacement: "$1$2[REDACTED:SECRET]$2",
  },
  {
    category: "secret-candidate" as const,
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: "Bearer [REDACTED:TOKEN]",
  },
  {
    category: "credential-candidate" as const,
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replacement: "[REDACTED:JWT]",
  },
  {
    category: "credential-candidate" as const,
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g,
    replacement: "[REDACTED:GITHUB-TOKEN]",
  },
  {
    category: "secret-candidate" as const,
    pattern:
      /\b(password|passwd|secret|token|client[-_]?secret|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|credential)\s*[:=]\s*([^\s,;]+)/gi,
    replacement: "$1=[REDACTED:SECRET]",
  },
  {
    category: "credential-candidate" as const,
    pattern: /https:\/\/[^\s/@:]+:[^\s/@]+@/gi,
    replacement: "https://[REDACTED:CREDENTIALS]@",
  },
] as const;

const sensitiveObjectKeyPattern =
  /^(?:password|passwd|secret|token|authorization|aws[-_]?secret[-_]?access[-_]?key|aws[-_]?session[-_]?token|client[-_]?secret|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|credential)$/i;

export function sha256Text(value: string): Sha256Digest {
  return sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}

export function digestStructuredValue(value: unknown): Sha256Digest {
  return sha256Text(serializeCanonicalJson(value));
}

export function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(serializeCanonicalJson(value)).byteLength;
}

function redactString(value: string): {
  readonly categories: readonly ("credential-candidate" | "secret-candidate")[];
  readonly redacted: string;
  readonly redactedValueCount: number;
} {
  let redacted = value;
  let redactedValueCount = 0;
  const categories = new Set<"credential-candidate" | "secret-candidate">();
  for (const candidate of secretPatterns) {
    const matches = redacted.match(candidate.pattern);
    if (matches !== null) {
      redactedValueCount += matches.length;
      categories.add(candidate.category);
      redacted = redacted.replace(candidate.pattern, candidate.replacement);
    }
  }
  return { categories: [...categories], redacted, redactedValueCount };
}

function redactTaggedConfigurationValue(
  value: Readonly<Record<string, unknown>>,
  sensitiveField: boolean,
): {
  readonly categories: readonly ("credential-candidate" | "secret-candidate")[];
  readonly redactedValueCount: number;
  readonly value: unknown;
} | null {
  const kind = value["kind"];
  if (kind === "string" && typeof value["value"] === "string") {
    const result = redactValue(value["value"], sensitiveField);
    return {
      categories: result.categories,
      redactedValueCount: result.redactedValueCount,
      value: { ...value, value: result.value },
    };
  }
  if (
    kind === "string-list" &&
    Array.isArray(value["value"]) &&
    value["value"].every((item) => typeof item === "string")
  ) {
    const result = redactValue(value["value"], sensitiveField);
    return {
      categories: result.categories,
      redactedValueCount: result.redactedValueCount,
      value: { ...value, value: result.value },
    };
  }
  const referenceFields =
    kind === "secret-reference"
      ? ["reference"]
      : kind === "variable-reference"
        ? ["variableId"]
        : kind === "node-reference"
          ? ["nodeId", "attribute"]
          : null;
  if (referenceFields === null) return null;
  for (const field of referenceFields) {
    const reference = value[field];
    if (
      typeof reference === "string" &&
      redactString(reference).redactedValueCount > 0
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.redaction-unsupported",
        "A typed configuration reference contains credential-shaped content and cannot be safely rewritten without breaking its tagged schema.",
      );
    }
  }
  return { categories: [], redactedValueCount: 0, value };
}

function redactValue(
  value: unknown,
  sensitiveField = false,
): {
  readonly categories: readonly ("credential-candidate" | "secret-candidate")[];
  readonly redactedValueCount: number;
  readonly value: unknown;
} {
  if (typeof value === "string") {
    const result = redactString(value);
    if (sensitiveField && result.redactedValueCount === 0) {
      return {
        categories: ["secret-candidate"],
        redactedValueCount: 1,
        value: "[REDACTED:SECRET]",
      };
    }
    return {
      categories: result.categories,
      redactedValueCount: result.redactedValueCount,
      value: result.redacted,
    };
  }
  if (Array.isArray(value)) {
    const categories = new Set<"credential-candidate" | "secret-candidate">();
    let redactedValueCount = 0;
    const children = value.map((child) => {
      const result = redactValue(child, sensitiveField);
      result.categories.forEach((category) => categories.add(category));
      redactedValueCount += result.redactedValueCount;
      return result.value;
    });
    return {
      categories: [...categories],
      redactedValueCount,
      value: children,
    };
  }
  if (value !== null && typeof value === "object") {
    const tagged = redactTaggedConfigurationValue(
      value as Readonly<Record<string, unknown>>,
      sensitiveField,
    );
    if (tagged !== null) return tagged;
    const categories = new Set<"credential-candidate" | "secret-candidate">();
    let redactedValueCount = 0;
    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const result = redactValue(child, sensitiveObjectKeyPattern.test(key));
      result.categories.forEach((category) => categories.add(category));
      redactedValueCount += result.redactedValueCount;
      record[key] = result.value;
    }
    return { categories: [...categories], redactedValueCount, value: record };
  }
  return { categories: [], redactedValueCount: 0, value };
}

type RevisionBoundModelRequest = Extract<
  ModelGatewayRequestV1,
  {
    operation:
      | "application-source.generate"
      | "iac-extension.generate"
      | "workload.propose";
  }
>;

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type SanitizedRepositoryExcerpt = Extract<
  ModelGatewayRequestV1,
  { operation: "repository.interpret" }
>["evidence"][number];

function rebindSanitizedRepositoryExcerpts(
  originalExcerpts: readonly SanitizedRepositoryExcerpt[],
  redactedExcerpts: readonly SanitizedRepositoryExcerpt[],
): SanitizedRepositoryExcerpt[] {
  const originalById = new Map(
    originalExcerpts.map((excerpt) => [excerpt.evidenceId, excerpt]),
  );
  return redactedExcerpts.map((excerpt) => {
    const originalExcerpt = originalById.get(excerpt.evidenceId);
    if (
      originalExcerpt === undefined ||
      originalExcerpt.content === excerpt.content
    ) {
      return excerpt;
    }
    const detected = redactString(originalExcerpt.content);
    return {
      ...excerpt,
      redaction: {
        ...excerpt.redaction,
        categories: [
          ...new Set([...excerpt.redaction.categories, ...detected.categories]),
        ].sort(compareUtf16),
        status: "applied" as const,
      },
    };
  });
}

function getApplicationContractRecordHashes(
  architecture: RevisionBoundModelRequest["architecture"],
): Sha256Digest[] {
  return architecture.applicationContracts.contracts
    .map(getApplicationContractRecordContentHash)
    .sort(compareUtf16);
}

function rebindSanitizedSolutionRevision(
  architecture: RevisionBoundModelRequest["architecture"],
  revision: NonNullable<RevisionBoundModelRequest["solutionRevision"]>,
): NonNullable<RevisionBoundModelRequest["solutionRevision"]> {
  const architectureHashes = getArchitectureDocumentHashes(architecture);
  return {
    ...revision,
    architecture: {
      ...revision.architecture,
      contentHash: architectureHashes.contentHash,
      documentHash: getArchitectureDocumentCanonicalHash(architecture),
      revisionId: architecture.revision.revisionId,
      visualHash: architectureHashes.visualHash,
    },
    contracts: {
      ...revision.contracts,
      contentHash: getApplicationContractsContentHash(
        architecture.applicationContracts,
      ),
      recordHashes: getApplicationContractRecordHashes(architecture),
    },
    externalResources: {
      ...revision.externalResources,
      contentHash: getExternalResourceReferenceContentHash(
        architecture.externalResources,
      ),
    },
    versions: {
      ...revision.versions,
      catalog: architecture.catalog,
    },
    workload: {
      ...revision.workload,
      contentHash: getWorkloadBehaviorContentHash(
        architecture.workloadBehavior,
      ),
    },
  };
}

function rebindSanitizedGenerationContext(
  original: ModelGenerationContextV1,
  redacted: ModelGenerationContextV1,
): ModelGenerationContextV1 {
  const originalByPath = new Map(
    original.existingFiles.map((file) => [file.path, file]),
  );
  return {
    ...redacted,
    existingFiles: redacted.existingFiles.map((file) => {
      const originalFile = originalByPath.get(file.path);
      return {
        ...file,
        contentDigest: sha256Text(file.content),
        redactionStatus:
          originalFile !== undefined && originalFile.content !== file.content
            ? ("applied" as const)
            : file.redactionStatus,
        sizeBytes: new TextEncoder().encode(file.content).byteLength,
      };
    }),
  };
}

function rebindSanitizedPriorCandidateContext(
  context: NonNullable<
    Extract<
      ModelGatewayRequestV1,
      { operation: "candidate.repair" }
    >["priorCandidateContext"]
  >,
) {
  const content = {
    assumptions: context.assumptions,
    expectedTests: context.expectedTests,
    unresolvedItems: context.unresolvedItems,
  };
  return { ...content, contextDigest: digestStructuredValue(content) };
}

function rebindSanitizedRequestAuthority(
  original: ModelGatewayRequestV1,
  redacted: unknown,
): unknown {
  const request = redacted as ModelGatewayRequestV1;
  switch (request.operation) {
    case "intent.extract":
      return {
        ...request,
        source: {
          ...request.source,
          digest: sha256Text(request.source.content),
        },
      };
    case "summary.plain-language":
    case "summary.technical":
      return {
        ...request,
        source: {
          ...request.source,
          contentDigest: sha256Text(request.source.content),
        },
      };
    case "issue.explain":
    case "deterministic-fix.explain":
    case "fix.propose":
      return {
        ...request,
        issue: {
          ...request.issue,
          currentRecordDigest: getActiveIssueRecordHash(request.issue),
        },
      };
    case "application-source.generate":
    case "iac-extension.generate": {
      const generationContext =
        request.generationContext === undefined ||
        (original.operation !== "application-source.generate" &&
          original.operation !== "iac-extension.generate") ||
        original.generationContext === undefined
          ? undefined
          : rebindSanitizedGenerationContext(
              original.generationContext,
              request.generationContext,
            );
      return {
        ...request,
        ...(generationContext === undefined
          ? {}
          : {
              generationContext,
              generationContextDigest: digestStructuredValue(generationContext),
            }),
        solutionRevision: rebindSanitizedSolutionRevision(
          request.architecture,
          request.solutionRevision,
        ),
      };
    }
    case "workload.propose":
      return request.solutionRevision === undefined
        ? request
        : {
            ...request,
            solutionRevision: rebindSanitizedSolutionRevision(
              request.architecture,
              request.solutionRevision,
            ),
          };
    case "repository.interpret":
      return {
        ...request,
        evidence: rebindSanitizedRepositoryExcerpts(
          original.operation === "repository.interpret"
            ? original.evidence
            : [],
          request.evidence,
        ),
      };
    case "external-resource.propose":
      return {
        ...request,
        repositoryExcerpts: rebindSanitizedRepositoryExcerpts(
          original.operation === "external-resource.propose"
            ? original.repositoryExcerpts
            : [],
          request.repositoryExcerpts,
        ),
      };
    case "candidate.repair": {
      const originalById = new Map(
        original.operation === "candidate.repair"
          ? original.failedCandidates.map((candidate) => [
              candidate.candidateId,
              candidate,
            ])
          : [],
      );
      const failedCandidates = request.failedCandidates.map((candidate) => {
        if (candidate.kind === "file") {
          return {
            ...candidate,
            contentDigest: sha256Text(candidate.content),
          };
        }
        const originalCandidate = originalById.get(candidate.candidateId);
        if (
          originalCandidate?.kind !== "patch" ||
          originalCandidate.unifiedDiff !== candidate.unifiedDiff
        ) {
          throw new ModelGatewayValidationError(
            "model-gateway.redaction-unsupported",
            "A failed patch containing sensitive content cannot be safely rebound without its exact proposed result.",
          );
        }
        return candidate;
      });
      const generationContext =
        request.generationContext === undefined ||
        original.operation !== "candidate.repair" ||
        original.generationContext === undefined
          ? undefined
          : rebindSanitizedGenerationContext(
              original.generationContext,
              request.generationContext,
            );
      const priorCandidateContext =
        request.priorCandidateContext === undefined
          ? undefined
          : rebindSanitizedPriorCandidateContext(request.priorCandidateContext);
      const originalDiagnosticById = new Map(
        original.operation === "candidate.repair"
          ? original.diagnostics.map((diagnostic) => [
              diagnostic.diagnosticId,
              diagnostic,
            ])
          : [],
      );
      return {
        ...request,
        ...(generationContext === undefined
          ? {}
          : {
              generationContext,
              generationContextDigest: digestStructuredValue(generationContext),
            }),
        ...(priorCandidateContext === undefined
          ? {}
          : { priorCandidateContext }),
        diagnostics: request.diagnostics.map((diagnostic) => {
          const originalDiagnostic = originalDiagnosticById.get(
            diagnostic.diagnosticId,
          );
          return originalDiagnostic !== undefined &&
            originalDiagnostic.message !== diagnostic.message
            ? { ...diagnostic, redactionStatus: "applied" as const }
            : diagnostic;
        }),
        failedCandidates,
        failedOutputDigest: digestStructuredValue(failedCandidates),
      };
    }
    default:
      return request;
  }
}

export function redactModelRequest(input: ModelGatewayRequestV1): {
  readonly request: unknown;
  readonly summary: ModelInputRedactionSummaryV1;
} {
  const result = redactValue(input);
  return {
    request: rebindSanitizedRequestAuthority(input, result.value),
    summary: {
      categories: result.categories,
      redactedValueCount: result.redactedValueCount,
    },
  };
}

export function inspectModelValueForSecretCandidatesV1(value: unknown): {
  readonly categories: readonly ("credential-candidate" | "secret-candidate")[];
  readonly detectedValueCount: number;
} {
  const result = redactValue(value);
  return {
    categories: result.categories,
    detectedValueCount: result.redactedValueCount,
  };
}

type ResponseDescriptor =
  | ModelInvocationDescriptorV1
  | ModelLiveSeedInvocationDescriptorV3
  | ModelLiveRepairSuccessorInvocationDescriptorV4;
type RepairAuthorityRequest =
  | Extract<ModelGatewayRequestV1, { operation: "candidate.repair" }>
  | ModelHostSeedRepairRequestV2
  | ModelHostRepairSuccessorRequestV3;

function assertProvenance(
  provenance: ModelGatewayResponseV1["provenance"],
  descriptor: ResponseDescriptor,
): void {
  const mismatched =
    provenance.gatewayId !== "cloudmarkup.model-gateway" ||
    provenance.invocationId !== descriptor.invocationId ||
    provenance.inputDigest !== descriptor.inputDigest ||
    provenance.providerId !== descriptor.providerId ||
    provenance.modelId !== descriptor.modelId ||
    provenance.modelVersion !== descriptor.modelVersion ||
    provenance.inferenceProfileId !== descriptor.inferenceProfileId ||
    provenance.promptTemplateId !== descriptor.promptTemplateId ||
    provenance.promptVersion !== descriptor.promptVersion ||
    provenance.promptDigest !== descriptor.promptDigest;
  if (mismatched) {
    throw new ModelGatewayValidationError(
      "model-gateway.provenance-mismatch",
      "Model output provenance does not match the exact invocation.",
    );
  }
}

function sameBoundary(
  left: ModelCandidateBundleV1["boundary"],
  right: ModelCandidateBundleV1["boundary"],
): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

type EvidenceReferenceV1 =
  ModelGatewayResponseV1["proposalContext"]["confidence"]["evidenceReferences"][number];
type ArchitectureEvidenceSource = Extract<
  ModelGatewayRequestV1,
  { operation: "workload.propose" }
>["architecture"];

function addArchitectureEvidenceReferences(
  allowed: Map<string, EvidenceReferenceV1>,
  architecture: ArchitectureEvidenceSource,
): void {
  const add = (reference: EvidenceReferenceV1): void => {
    allowed.set(serializeCanonicalJson(reference), reference);
  };
  architecture.nodes.forEach((node) => {
    add({ kind: "architecture-node", referenceId: node.id });
  });
  architecture.edges.forEach((edge) => {
    add({ kind: "architecture-edge", referenceId: edge.id });
  });
  architecture.workloadBehavior.workloads.forEach((workload) => {
    add({ kind: "workload", referenceId: workload.id });
  });
  architecture.externalResources.resources.forEach((resource) => {
    add({ kind: "external-resource", referenceId: resource.id });
  });
  architecture.applicationContracts.contracts.forEach((contract) => {
    add({ kind: "solution-contract", referenceId: contract.contractId });
  });
}

function allowedEvidenceReferences(
  request:
    | ModelGatewayRequestV1
    | ModelHostSeedRepairRequestV2
    | ModelHostRepairSuccessorRequestV3,
): ReadonlySet<string> {
  const allowed = new Map<string, EvidenceReferenceV1>();
  const add = (reference: EvidenceReferenceV1): void => {
    allowed.set(serializeCanonicalJson(reference), reference);
  };
  const addRepositoryEvidence = (
    evidence: Extract<
      ModelGatewayRequestV1,
      { operation: "repository.interpret" }
    >["evidence"][number],
  ): void => {
    add({
      digest: evidence.fileChecksum,
      kind: "repository-evidence",
      location: evidence.location,
      path: evidence.path,
      referenceId: evidence.evidenceId,
    });
  };

  switch (request.operation) {
    case "intent.extract":
      add({
        digest: request.source.digest,
        kind: "requirements-source",
        referenceId: request.source.sourceId,
      });
      break;
    case "architecture.propose":
      if (request.currentArchitecture !== undefined) {
        addArchitectureEvidenceReferences(allowed, request.currentArchitecture);
      }
      break;
    case "workload.propose":
      addArchitectureEvidenceReferences(allowed, request.architecture);
      if (request.solutionRevision !== undefined) {
        const solutionRevision = request.solutionRevision;
        solutionRevision.evidenceIdsAtFreeze.forEach((referenceId) => {
          add({ kind: "evidence-record", referenceId });
        });
        solutionRevision.issueIdsAtFreeze.forEach((referenceId) => {
          add({ kind: "active-issue", referenceId });
        });
        request.architecture.externalResources.resources.forEach((resource) => {
          add({
            digest: solutionRevision.externalResources.contentHash,
            kind: "external-resource",
            referenceId: resource.id,
          });
        });
      }
      break;
    case "external-resource.propose":
      addArchitectureEvidenceReferences(allowed, request.architecture);
      request.repositoryExcerpts.forEach(addRepositoryEvidence);
      break;
    case "operations.propose":
      addArchitectureEvidenceReferences(allowed, request.architecture);
      request.planningContext?.approvedRepositoryEvidence?.evidence.forEach(
        addRepositoryEvidence,
      );
      break;
    case "repository.interpret":
      request.evidence.forEach(addRepositoryEvidence);
      break;
    case "issue.explain":
    case "deterministic-fix.explain":
    case "fix.propose":
      add({
        digest: request.issue.currentRecordDigest,
        kind: "active-issue",
        referenceId: request.issue.id,
      });
      break;
    case "application-source.generate":
    case "iac-extension.generate":
      request.sourceReferences.forEach(add);
      break;
    case "candidate.repair":
      request.failedCandidates.forEach((candidate) => {
        add({
          digest: request.failedOutputDigest,
          kind: "candidate-artifact",
          referenceId: candidate.candidateId,
        });
      });
      break;
    case "summary.plain-language":
    case "summary.technical":
      request.source.evidenceReferences.forEach(add);
      break;
    case "requirements.blocking-questions":
      break;
  }
  return new Set(allowed.keys());
}

type CandidateAuthorityBundle =
  ModelCandidateBundleV1 | ModelHostSeedPatchResponseV2["candidateBundle"];
type HostRepairResponse =
  | Extract<ModelGatewayResponseV1, { operation: "candidate.repair" }>
  | ModelHostSeedPatchResponseV2;

function assertResponseEvidenceGrounding(
  request:
    | ModelGatewayRequestV1
    | ModelHostSeedRepairRequestV2
    | ModelHostRepairSuccessorRequestV3,
  response: ModelGatewayResponseV1 | ModelHostSeedPatchResponseV2,
): void {
  const arrays: readonly EvidenceReferenceV1[][] = [
    response.proposalContext.confidence.evidenceReferences,
    ...response.proposalContext.assumptions.map(
      (assumption) => assumption.confidence.evidenceReferences,
    ),
    ...response.proposalContext.unknowns.map(
      (unknown) => unknown.confidence.evidenceReferences,
    ),
    ...(response.operation === "requirements.blocking-questions"
      ? response.questions.map((question) => question.evidenceReferences)
      : []),
    ...(response.operation === "architecture.propose"
      ? response.services.map((service) => service.evidenceReferences)
      : []),
    ...(response.operation === "workload.propose"
      ? response.workloads.map((workload) => workload.sourceReferences)
      : []),
    ...(response.operation === "external-resource.propose"
      ? response.resources.map((resource) => resource.evidenceReferences)
      : []),
    ...(response.operation === "repository.interpret"
      ? response.claims.flatMap((claim) => [
          claim.confidence.evidenceReferences,
          claim.evidenceReferences,
        ])
      : []),
    ...(response.operation === "operations.propose" &&
    response.solutionProposal !== undefined
      ? [
          ...response.solutionProposal.rejectedAlternatives.map(
            (alternative) => alternative.evidenceReferences,
          ),
          ...response.solutionProposal.reconciliationSuggestions.flatMap(
            (suggestion) => [
              suggestion.confidence.evidenceReferences,
              suggestion.evidenceReferences,
            ],
          ),
          ...response.solutionProposal.testScenarios.map(
            (scenario) => scenario.evidenceReferences,
          ),
        ]
      : []),
  ];
  const allowed = allowedEvidenceReferences(request);
  for (const references of arrays) {
    const seen = new Set<string>();
    for (const reference of references) {
      const canonical = serializeCanonicalJson(reference);
      if (seen.has(canonical) || !allowed.has(canonical)) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-evidence-reference",
          "A model evidence reference is duplicate or is not an exact source authorized by the request.",
        );
      }
      seen.add(canonical);
    }
  }
}

type GenerationRequest = Extract<
  ModelGatewayRequestV1,
  {
    operation: "application-source.generate" | "iac-extension.generate";
  }
>;

function assertSolutionRevisionArchitectureBinding(
  architecture: GenerationRequest["architecture"],
  revision: GenerationRequest["solutionRevision"],
  fail: (message: string) => never,
): void {
  let expectedArchitectureContentHash: Sha256Digest;
  let expectedArchitectureDocumentHash: Sha256Digest;
  let expectedArchitectureVisualHash: Sha256Digest;
  let expectedWorkloadHash: Sha256Digest;
  let expectedContractsHash: Sha256Digest;
  let expectedContractRecordHashes: readonly Sha256Digest[];
  let expectedExternalResourcesHash: Sha256Digest;
  try {
    const architectureHashes = getArchitectureDocumentHashes(architecture);
    expectedArchitectureContentHash = architectureHashes.contentHash;
    expectedArchitectureVisualHash = architectureHashes.visualHash;
    expectedArchitectureDocumentHash =
      getArchitectureDocumentCanonicalHash(architecture);
    expectedWorkloadHash = getWorkloadBehaviorContentHash(
      architecture.workloadBehavior,
    );
    expectedContractsHash = getApplicationContractsContentHash(
      architecture.applicationContracts,
    );
    expectedContractRecordHashes =
      getApplicationContractRecordHashes(architecture);
    expectedExternalResourcesHash = getExternalResourceReferenceContentHash(
      architecture.externalResources,
    );
  } catch {
    fail(
      "The supplied Architecture cannot be canonicalized by the authoritative deterministic domain hash contracts.",
    );
  }

  if (
    revision.architecture.revisionId !== architecture.revision.revisionId ||
    revision.architecture.contentHash !== expectedArchitectureContentHash ||
    revision.architecture.documentHash !== expectedArchitectureDocumentHash ||
    revision.architecture.visualHash !== expectedArchitectureVisualHash ||
    revision.versions.catalog.id !== architecture.catalog.id ||
    revision.versions.catalog.version !== architecture.catalog.version ||
    revision.versions.catalog.digest !== architecture.catalog.digest ||
    revision.workload.contentHash !== expectedWorkloadHash ||
    revision.contracts.contentHash !== expectedContractsHash ||
    serializeCanonicalJson(revision.contracts.recordHashes) !==
      serializeCanonicalJson(expectedContractRecordHashes) ||
    revision.externalResources.contentHash !== expectedExternalResourcesHash
  ) {
    fail(
      "The Solution Revision does not bind the exact canonical Architecture document, semantic content, visual content, catalog, Workload Behavior, application contract set and records, and external resources.",
    );
  }
}

function assertGenerationContextGrounding(
  request: GenerationRequest,
  context: ModelGenerationContextV1,
  fail: (message: string) => never,
): void {
  if (
    request.generationContextDigest !== digestStructuredValue(context) ||
    serializeCanonicalJson(context.ownedPaths) !==
      serializeCanonicalJson(request.boundary.ownedPaths) ||
    serializeCanonicalJson(context.sourceReferences) !==
      serializeCanonicalJson(request.sourceReferences) ||
    serializeCanonicalJson(context.validationExpectations) !==
      serializeCanonicalJson(request.validationExpectations) ||
    serializeCanonicalJson(context.requestedBehavior.acceptanceCriteria) !==
      serializeCanonicalJson(request.acceptanceCriteria)
  ) {
    fail(
      "Generation context does not bind its exact digest, boundary, source references, validation expectations, and acceptance criteria.",
    );
  }

  const catalogSlice = context.catalogSlice;
  if (
    catalogSlice.sliceDigest !== sha256Text(catalogSlice.content) ||
    catalogSlice.catalog.id !== request.architecture.catalog.id ||
    catalogSlice.catalog.version !== request.architecture.catalog.version ||
    catalogSlice.catalog.digest !== request.architecture.catalog.digest
  ) {
    fail(
      "Generation catalog grounding must bind the exact canonical catalog slice and Solution Revision catalog pin.",
    );
  }
  const catalogNodes = new Map(
    catalogSlice.entries.map((node) => [node.serviceType, node]),
  );
  for (const node of request.architecture.nodes) {
    const grounded = catalogNodes.get(node.semantic.serviceType);
    if (grounded?.resourceType !== node.semantic.resourceType) {
      fail(
        "Generation catalog grounding omits a service/resource type used by the supplied Architecture.",
      );
    }
  }

  for (const schema of context.officialSchemas) {
    if (schema.schemaDigest !== sha256Text(schema.document)) {
      fail(
        "An official generation schema does not match its exact canonical digest.",
      );
    }
  }

  const boundaryApprovalPaths = new Set(request.boundary.approvalPathIds);
  if (
    context.allowedDependencies.some(
      (dependency) => !boundaryApprovalPaths.has(dependency.approvalPathId),
    )
  ) {
    fail(
      "A generation dependency allowlist entry is outside the exact candidate approval boundary.",
    );
  }

  const revisionOwnership = new Map<
    string,
    (typeof request.solutionRevision.sourceOwnership)[number]
  >(
    request.solutionRevision.sourceOwnership.map((entry) => [
      entry.path,
      entry,
    ]),
  );
  for (const path of context.protectedPaths) {
    if (revisionOwnership.get(path) === undefined) {
      fail(
        "A protected generation path is not grounded in the exact Solution Revision ownership manifest.",
      );
    }
  }
  const authorityOwnership = new Map<
    string,
    (typeof request.sourceOwnershipAuthority.sourceOwnership)[number]
  >(
    request.sourceOwnershipAuthority.sourceOwnership.map((entry) => [
      entry.path,
      entry,
    ]),
  );
  const existingByPath = new Map<
    string,
    (typeof context.existingFiles)[number]
  >(context.existingFiles.map((file) => [file.path, file]));
  const expectedOwnedPathOwnership =
    context.kind === "application" ? "ai-authored" : "approved-extension";

  for (const path of context.ownedPaths) {
    const ownership = authorityOwnership.get(path);
    const existing = existingByPath.get(path);
    const exactExtensionOwnedPath =
      ownership?.ownership === expectedOwnedPathOwnership &&
      ownership.ownerId === context.extensionId;
    const exactUserOwnedApplicationPath =
      context.kind === "application" &&
      ownership?.ownership === "user-owned" &&
      existing?.ownership === "user-owned" &&
      ownership.contentHash !== undefined &&
      ownership.contentHash === existing.contentDigest;
    if (!exactExtensionOwnedPath && !exactUserOwnedApplicationPath) {
      fail(
        "Prompt 36A owned paths must be exact extension-owned entries or digest-bound sanitized user-owned application files.",
      );
    }
  }

  let existingBytes = 0;
  for (const file of context.existingFiles) {
    const sizeBytes = new TextEncoder().encode(file.content).byteLength;
    existingBytes += sizeBytes;
    if (
      !context.ownedPaths.includes(file.path) ||
      context.protectedPaths.includes(file.path) ||
      file.contentDigest !== sha256Text(file.content) ||
      file.sizeBytes !== sizeBytes ||
      sizeBytes > context.limits.maximumCandidateFileBytes ||
      inspectModelValueForSecretCandidatesV1(file.content).detectedValueCount >
        0
    ) {
      fail(
        "A sanitized existing extension file has an invalid digest, size, safety assertion, or file limit.",
      );
    }
    if (context.ownedPaths.includes(file.path)) {
      const ownership = authorityOwnership.get(file.path);
      if (
        ownership?.ownership !== file.ownership ||
        ownership.contentHash !== file.contentDigest
      ) {
        fail(
          "An editable existing extension file does not bind the exact owned source digest.",
        );
      }
    }
  }
  if (
    context.ownedPaths.length > context.limits.maximumCandidateFiles ||
    existingBytes > context.limits.maximumCandidateTotalBytes ||
    context.allowedDependencies.length >
      context.limits.maximumDependencyRequests ||
    context.allowedResources.length > context.limits.maximumResourceCount
  ) {
    fail("Generation context exceeds its exact deterministic limits.");
  }

  if (request.operation === "application-source.generate") {
    if (
      context.kind !== "application" ||
      context.workloadId !== request.workloadId
    ) {
      fail(
        "Application generation context must bind the exact requested workload.",
      );
    }
    const workload = request.architecture.workloadBehavior.workloads.find(
      (entry) => entry.id === request.workloadId,
    );
    if (
      workload?.implementation.mode !== "ai-assisted-custom" ||
      String(workload.implementation.extension.extensionId) !==
        String(context.extensionId) ||
      workload.implementation.runtimeFamily !== context.runtimeFamily ||
      (workload.languageFamily !== undefined &&
        workload.languageFamily !== context.language)
    ) {
      fail(
        "Application generation context must bind an explicit ai-assisted-custom implementation, extension, runtime, and language.",
      );
    }
    const extensionPoint = workload.extensionPoints.find(
      (entry) => entry.extensionPointId === context.extensionPointId,
    );
    if (
      extensionPoint === undefined ||
      !context.ownedPaths.includes(extensionPoint.path)
    ) {
      fail(
        "Application generation context must bind an exact Workload extension point and owned path.",
      );
    }
    for (const path of context.ownedPaths) {
      const point = workload.extensionPoints.find(
        (entry) => entry.path === path,
      );
      const workloadOwnership = workload.sourceOwnership.find(
        (entry) => entry.path === path,
      );
      const authority = authorityOwnership.get(path);
      const existing = existingByPath.get(path);
      const exactAiOwnedPath =
        authority?.ownership === "ai-authored" &&
        authority.ownerId === context.extensionId &&
        workloadOwnership?.ownership === "ai-authored" &&
        String(workloadOwnership.ownerId) === String(context.extensionId) &&
        point?.permittedOwnership.includes("ai-authored") === true;
      const exactUserOwnedPatchPath =
        authority?.ownership === "user-owned" &&
        existing?.ownership === "user-owned" &&
        authority.contentHash !== undefined &&
        authority.contentHash === existing.contentDigest &&
        workloadOwnership?.ownership === "user-owned" &&
        workloadOwnership.ownerId === authority.ownerId &&
        workloadOwnership.pathKind === "file" &&
        workloadOwnership.regeneration === "never" &&
        workloadOwnership.conflictBehavior === "preserve-user-content" &&
        point?.permittedOwnership.includes("user-owned") === true;
      if (!exactAiOwnedPath && !exactUserOwnedPatchPath) {
        fail(
          "Every application path must rejoin exact AI-owned authority or an exact digest-bound user-owned Workload file eligible only for patching.",
        );
      }
    }
    const extension = workload.extensions.find(
      (entry) => String(entry.extensionId) === String(context.extensionId),
    );
    if (
      extension === undefined ||
      serializeCanonicalJson(extension) !==
        serializeCanonicalJson(workload.implementation.extension)
    ) {
      fail(
        "Application generation context must rejoin the exact Workload extension reference.",
      );
    }
    return;
  }

  if (
    context.kind !== "iac-extension" ||
    context.targetFormat !== request.targetFormat
  ) {
    fail(
      "IaC generation context must bind the exact requested target format and extension slot.",
    );
  }
}

function assertGenerationRequestGrounding(request: GenerationRequest): void {
  const fail = (message: string): never => {
    throw new ModelGatewayValidationError(
      "model-gateway.ungrounded-generation-input",
      message,
    );
  };
  const architecture = request.architecture;
  const revision = request.solutionRevision;
  assertSolutionRevisionArchitectureBinding(architecture, revision, fail);
  if (request.generationContext !== undefined) {
    assertGenerationContextGrounding(request, request.generationContext, fail);
  }
  if (
    request.operation === "application-source.generate" &&
    !architecture.workloadBehavior.workloads.some(
      (workload) => workload.id === request.workloadId,
    )
  ) {
    fail("Application generation references an unknown workload.");
  }

  const authority = request.sourceOwnershipAuthority;
  const requiredRoot =
    request.operation === "application-source.generate"
      ? "application"
      : "infrastructure";
  const boundaryPaths = new Set<string>(request.boundary.ownedPaths);
  const authorityPaths = new Set<string>(authority.ownedPaths);
  const revisionOwnership = new Map<string, string>(
    revision.sourceOwnership.map((entry) => [
      entry.path,
      serializeCanonicalJson(entry),
    ]),
  );
  if (
    authority.solutionRevisionId !== revision.solutionRevisionId ||
    authority.candidateRoots.length !== 1 ||
    authority.candidateRoots[0] !== requiredRoot ||
    authorityPaths.size !== boundaryPaths.size ||
    [...boundaryPaths].some((path) => !authorityPaths.has(path))
  ) {
    fail(
      "Source-ownership authority does not bind the exact Solution Revision, operation root, and candidate boundary.",
    );
  }
  for (const entry of authority.sourceOwnership) {
    const exactUserOwnedApplicationEntry =
      request.operation === "application-source.generate" &&
      request.generationContext?.kind === "application" &&
      entry.ownership === "user-owned" &&
      entry.contentHash !== undefined &&
      request.generationContext.existingFiles.some(
        (file) =>
          file.path === entry.path &&
          file.ownership === "user-owned" &&
          file.contentDigest === entry.contentHash,
      );
    if (
      revisionOwnership.get(entry.path) !== serializeCanonicalJson(entry) ||
      !boundaryPaths.has(entry.path) ||
      (!["generated", "ai-authored", "approved-extension"].includes(
        entry.ownership,
      ) &&
        !exactUserOwnedApplicationEntry)
    ) {
      fail(
        "Source-ownership authority contains an unowned, altered, or non-generative Solution Revision entry.",
      );
    }
  }

  const nodeIds = new Set<string>(architecture.nodes.map((node) => node.id));
  const edgeIds = new Set<string>(architecture.edges.map((edge) => edge.id));
  const workloadIds = new Set<string>(
    architecture.workloadBehavior.workloads.map((workload) => workload.id),
  );
  const externalIds = new Set<string>(
    architecture.externalResources.resources.map((resource) => resource.id),
  );
  const contractDigests = new Map<string, Sha256Digest>(
    architecture.applicationContracts.contracts.map((contract) => [
      contract.contractId,
      getApplicationContractRecordContentHash(contract),
    ]),
  );
  const evidenceIds = new Set<string>(revision.evidenceIdsAtFreeze);
  const issueIds = new Set<string>(revision.issueIdsAtFreeze);
  const seenReferences = new Set<string>();
  for (const reference of request.sourceReferences) {
    const canonical = serializeCanonicalJson(reference);
    const simpleReference =
      reference.digest === undefined &&
      reference.path === undefined &&
      reference.location === undefined;
    const groundedContractReference =
      reference.kind === "solution-contract" &&
      reference.digest !== undefined &&
      reference.path === undefined &&
      reference.location === undefined &&
      reference.digest === contractDigests.get(reference.referenceId);
    const grounded =
      groundedContractReference ||
      (simpleReference &&
        ((reference.kind === "architecture-node" &&
          nodeIds.has(reference.referenceId)) ||
          (reference.kind === "architecture-edge" &&
            edgeIds.has(reference.referenceId)) ||
          (reference.kind === "workload" &&
            workloadIds.has(reference.referenceId)) ||
          (reference.kind === "external-resource" &&
            externalIds.has(reference.referenceId)) ||
          (reference.kind === "evidence-record" &&
            evidenceIds.has(reference.referenceId)) ||
          (reference.kind === "active-issue" &&
            issueIds.has(reference.referenceId))));
    if (seenReferences.has(canonical) || !grounded) {
      fail(
        "A generation source reference is duplicate or is not an exact supplied Architecture/Solution Revision identity.",
      );
    }
    seenReferences.add(canonical);
  }
}

function assertUnifiedDiffCandidatePath(
  candidate: Extract<
    CandidateAuthorityBundle["candidates"][number],
    { kind: "patch" }
  >,
): void {
  const lines = candidate.unifiedDiff.split("\n");
  const expectedOldHeader = `--- a/${candidate.path}`;
  const expectedNewHeader = `+++ b/${candidate.path}`;
  if (
    candidate.unifiedDiff.includes("\r") ||
    lines[0] !== expectedOldHeader ||
    lines[1] !== expectedNewHeader ||
    !lines
      .slice(2)
      .some((line) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u.test(line))
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.patch-path-mismatch",
      "A patch candidate must contain one canonical unified diff for its exact owned path.",
    );
  }
  if (
    lines
      .slice(2)
      .some(
        (line) =>
          line.startsWith("--- ") ||
          line.startsWith("+++ ") ||
          line.startsWith("diff --git "),
      )
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.patch-multiple-files",
      "A patch candidate cannot contain headers for another or multiple files.",
    );
  }
}

function assertCandidateBundle(
  bundle: CandidateAuthorityBundle,
  request:
    | Extract<
        ModelGatewayRequestV1,
        {
          readonly operation:
            | "application-source.generate"
            | "candidate.repair"
            | "fix.propose"
            | "iac-extension.generate";
        }
      >
    | ModelHostSeedRepairRequestV2
    | ModelHostRepairSuccessorRequestV3,
  descriptor: ResponseDescriptor,
  allowedApprovalPathIds: ReadonlySet<string>,
): void {
  assertProvenance(bundle.provenance, descriptor);
  if (!sameBoundary(bundle.boundary, request.boundary)) {
    throw new ModelGatewayValidationError(
      "model-gateway.candidate-boundary-mismatch",
      "Candidate output changed the exact artifact boundary.",
    );
  }
  const generationContext =
    "generationContext" in request ? request.generationContext : undefined;
  if (
    generationContext !== undefined &&
    bundle.candidates.length > generationContext.limits.maximumCandidateFiles
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.candidate-limit-exceeded",
      "Candidate output exceeds the exact generation-context file limit.",
    );
  }
  const ownedPaths = new Set<string>(request.boundary.ownedPaths);
  const existingByCandidatePath = new Map<
    string,
    NonNullable<typeof generationContext>["existingFiles"][number]
  >(generationContext?.existingFiles.map((file) => [file.path, file]) ?? []);
  const candidatePaths = new Set<string>();
  const candidateIds = new Set<string>();
  const candidatesByPath = new Map<
    string,
    CandidateAuthorityBundle["candidates"][number]
  >();
  let candidateBytes = 0;
  for (const candidate of bundle.candidates) {
    const candidateContent =
      candidate.kind === "file" ? candidate.content : candidate.unifiedDiff;
    const candidateSize = new TextEncoder().encode(candidateContent).byteLength;
    candidateBytes += candidateSize;
    if (
      generationContext !== undefined &&
      candidateSize > generationContext.limits.maximumCandidateFileBytes
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.candidate-limit-exceeded",
        "A candidate file exceeds the exact generation-context byte limit.",
      );
    }
    if (
      inspectModelValueForSecretCandidatesV1(candidateContent)
        .detectedValueCount > 0
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.candidate-secret-detected",
        "A generated candidate contains credential or secret-shaped content.",
      );
    }
    if (!ownedPaths.has(candidate.path)) {
      throw new ModelGatewayValidationError(
        "model-gateway.path-not-owned",
        "A generated candidate targeted a path outside its owned boundary.",
      );
    }
    const existing = existingByCandidatePath.get(candidate.path);
    if (
      existing?.ownership === "user-owned" &&
      (candidate.kind !== "patch" ||
        candidate.baseDigest !== existing.contentDigest)
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.user-owned-candidate-must-be-exact-patch",
        "Sanitized user-owned content may be changed only by an exact base-digest-bound patch candidate.",
      );
    }
    if (candidatePaths.has(candidate.path)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-candidate-path",
        "Generated candidates cannot rejoin the same target path ambiguously.",
      );
    }
    if (candidateIds.has(candidate.candidateId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-candidate-id",
        "Generated candidate IDs must be unique within a candidate bundle.",
      );
    }
    candidatePaths.add(candidate.path);
    candidateIds.add(candidate.candidateId);
    candidatesByPath.set(candidate.path, candidate);
    if (candidate.kind === "patch") {
      assertUnifiedDiffCandidatePath(candidate);
    }
    if (
      candidate.kind === "file" &&
      sha256Text(candidate.content) !== candidate.contentDigest
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.candidate-digest-mismatch",
        "A generated file digest does not match its exact content.",
      );
    }
  }
  if (
    generationContext !== undefined &&
    candidateBytes > generationContext.limits.maximumCandidateTotalBytes
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.candidate-limit-exceeded",
      "Candidate output exceeds the exact generation-context aggregate byte limit.",
    );
  }
  const plannedPaths = new Set<string>();
  const planStepIds = new Set<string>();
  for (const step of bundle.generationPlan.steps) {
    const candidate = candidatesByPath.get(step.targetPath);
    if (!ownedPaths.has(step.targetPath)) {
      throw new ModelGatewayValidationError(
        "model-gateway.plan-path-not-owned",
        "A generation plan targeted a path outside its owned boundary.",
      );
    }
    if (!candidatePaths.has(step.targetPath)) {
      throw new ModelGatewayValidationError(
        "model-gateway.plan-candidate-path-mismatch",
        "A generation-plan target does not rejoin an exact candidate path.",
      );
    }
    if (
      candidate === undefined ||
      (step.action === "propose-patch" && candidate.kind !== "patch") ||
      (step.action === "create-file" &&
        (candidate.kind !== "file" || candidate.priorDigest !== undefined)) ||
      (step.action === "replace-owned-file" &&
        (candidate.kind !== "file" || candidate.priorDigest === undefined))
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.generation-step-candidate-mismatch",
        "A generation-plan action does not match its exact candidate kind and prior state.",
      );
    }
    if (plannedPaths.has(step.targetPath) || planStepIds.has(step.stepId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-generation-step",
        "Generation-plan step IDs and target paths must be unique.",
      );
    }
    plannedPaths.add(step.targetPath);
    planStepIds.add(step.stepId);
    const stepReferences = new Set<string>();
    for (const reference of step.sourceReferences) {
      const canonical = serializeCanonicalJson(reference);
      if (stepReferences.has(canonical)) {
        throw new ModelGatewayValidationError(
          "model-gateway.ambiguous-generation-source",
          "Generation-plan source references must be unique per step.",
        );
      }
      stepReferences.add(canonical);
    }
  }
  if ([...candidatePaths].some((path) => !plannedPaths.has(path))) {
    throw new ModelGatewayValidationError(
      "model-gateway.plan-candidate-path-mismatch",
      "Every generated candidate path must rejoin an exact generation-plan target.",
    );
  }

  const allowedSourceReferences = new Set<string>();
  if (
    request.operation === "application-source.generate" ||
    request.operation === "iac-extension.generate"
  ) {
    const ownershipByPath = new Map<
      string,
      (typeof request.sourceOwnershipAuthority.sourceOwnership)[number]
    >(
      request.sourceOwnershipAuthority.sourceOwnership.map((entry) => [
        entry.path,
        entry,
      ]),
    );
    for (const candidate of bundle.candidates) {
      const ownedSource = ownershipByPath.get(candidate.path);
      const expectedPriorDigest = ownedSource?.contentHash;
      const actualPriorDigest =
        candidate.kind === "file"
          ? candidate.priorDigest
          : candidate.baseDigest;
      if (
        ownedSource === undefined ||
        actualPriorDigest !== expectedPriorDigest ||
        (candidate.kind === "patch" && expectedPriorDigest === undefined)
      ) {
        throw new ModelGatewayValidationError(
          "model-gateway.generation-prior-digest-mismatch",
          "A generation candidate does not bind the exact owned source content state.",
        );
      }
    }
    request.sourceReferences.forEach((reference) =>
      allowedSourceReferences.add(serializeCanonicalJson(reference)),
    );
  } else if (request.operation === "fix.propose") {
    allowedSourceReferences.add(
      serializeCanonicalJson({
        digest: request.issue.currentRecordDigest,
        kind: "active-issue",
        referenceId: request.issue.id,
      }),
    );
  } else {
    for (const candidate of request.failedCandidates) {
      allowedSourceReferences.add(
        serializeCanonicalJson({
          digest: request.failedOutputDigest,
          kind: "candidate-artifact",
          referenceId: candidate.candidateId,
        }),
      );
    }
    generationContext?.sourceReferences.forEach((reference) =>
      allowedSourceReferences.add(serializeCanonicalJson(reference)),
    );
  }
  for (const step of bundle.generationPlan.steps) {
    for (const reference of step.sourceReferences) {
      if (!allowedSourceReferences.has(serializeCanonicalJson(reference))) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-generation-source",
          "A generation-plan source reference is not an exact source supplied by the request.",
        );
      }
    }
  }

  const metadataIds = new Set<string>();
  const assertMetadataReferences = (
    id: string,
    references: readonly unknown[],
  ): void => {
    if (metadataIds.has(id)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-candidate-context-identity",
        "Candidate assumptions, unresolved items, and expected tests must use unique identities.",
      );
    }
    metadataIds.add(id);
    const seen = new Set<string>();
    for (const reference of references) {
      const canonical = serializeCanonicalJson(reference);
      if (seen.has(canonical) || !allowedSourceReferences.has(canonical)) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-candidate-context",
          "Candidate context metadata contains a duplicate or ungrounded source reference.",
        );
      }
      seen.add(canonical);
    }
  };
  for (const assumption of bundle.assumptions ?? []) {
    assertMetadataReferences(
      assumption.assumptionId,
      assumption.sourceReferences,
    );
  }
  for (const unresolved of bundle.unresolvedItems ?? []) {
    assertMetadataReferences(
      unresolved.unresolvedItemId,
      unresolved.sourceReferences,
    );
  }
  const requestedExpectationsById = new Map(
    request.validationExpectations.map((expectation) => [
      expectation.checkId,
      expectation,
    ]),
  );
  for (const expectedTest of bundle.expectedTests ?? []) {
    assertMetadataReferences(
      expectedTest.expectedTestId,
      expectedTest.sourceReferences,
    );
    const expectation = requestedExpectationsById.get(
      expectedTest.validationCheckId,
    );
    if (
      expectation?.kind !== expectedTest.kind ||
      expectedTest.targetPaths.some((path) => !candidatePaths.has(path)) ||
      new Set(expectedTest.targetPaths).size !== expectedTest.targetPaths.length
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-expected-test",
        "An expected test must bind one exact requested test validation and unique candidate paths.",
      );
    }
  }
  if (
    generationContext !== undefined &&
    (bundle.expectedTests ?? []).length >
      generationContext.limits.maximumExpectedTests
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.candidate-limit-exceeded",
      "Candidate output exceeds the exact generation-context expected-test limit.",
    );
  }

  const requestApprovalPaths = new Set(request.boundary.approvalPathIds);
  const allowedDependencyKeys =
    generationContext === undefined
      ? undefined
      : new Set(
          generationContext.allowedDependencies.map((dependency) =>
            serializeCanonicalJson(dependency),
          ),
        );
  const dependencyKeys = new Set<string>();
  for (const dependency of bundle.dependencies) {
    const dependencyKey = serializeCanonicalJson({
      ecosystem: dependency.ecosystem,
      kind: dependency.kind,
      name: dependency.name,
      requestedVersion: dependency.requestedVersion,
    });
    const allowedDependencyKey = serializeCanonicalJson({
      approvalPathId: dependency.approvalPathId,
      ecosystem: dependency.ecosystem,
      kind: dependency.kind,
      name: dependency.name,
      requestedVersion: dependency.requestedVersion,
    });
    if (
      dependencyKeys.has(dependencyKey) ||
      !requestApprovalPaths.has(dependency.approvalPathId) ||
      !allowedApprovalPathIds.has(dependency.approvalPathId) ||
      (allowedDependencyKeys !== undefined &&
        !allowedDependencyKeys.has(allowedDependencyKey))
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.dependency-approval-path-denied",
        "A dependency request did not use an allow-listed approval path.",
      );
    }
    dependencyKeys.add(dependencyKey);
  }
  if (
    generationContext !== undefined &&
    bundle.dependencies.length >
      generationContext.limits.maximumDependencyRequests
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.candidate-limit-exceeded",
      "Candidate output exceeds the exact generation-context dependency limit.",
    );
  }
  const actualExpectations = new Map<string, string>();
  for (const expectation of bundle.validationExpectations) {
    if (actualExpectations.has(expectation.checkId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-validation-expectation",
        "Candidate validation expectation IDs must be unique.",
      );
    }
    actualExpectations.set(
      expectation.checkId,
      serializeCanonicalJson(expectation),
    );
  }
  const requestedExpectations = new Map<string, string>(
    request.validationExpectations.map((expectation) => [
      expectation.checkId,
      serializeCanonicalJson(expectation),
    ]),
  );
  for (const [checkId, expectation] of actualExpectations) {
    if (requestedExpectations.get(checkId) !== expectation) {
      throw new ModelGatewayValidationError(
        "model-gateway.validation-expectation-not-authorized",
        "Candidate output added or changed a validation expectation outside the request.",
      );
    }
  }
  for (const expected of request.validationExpectations) {
    if (
      expected.required &&
      actualExpectations.get(expected.checkId) !==
        serializeCanonicalJson(expected)
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.validation-expectation-missing",
        "Candidate output omitted or changed a required validation expectation.",
      );
    }
  }
}

type WorkloadProposalRequest = Extract<
  ModelGatewayRequestV1,
  { operation: "workload.propose" }
>;

function assertWorkloadRequestGrounding(
  request: WorkloadProposalRequest,
): void {
  if (request.solutionRevision !== undefined) {
    assertSolutionRevisionArchitectureBinding(
      request.architecture,
      request.solutionRevision,
      (message): never => {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-workload-revision",
          message,
        );
      },
    );
  }
}

function assertWorkloadProposalGrounding(
  request: WorkloadProposalRequest,
  response: Extract<ModelGatewayResponseV1, { operation: "workload.propose" }>,
): void {
  assertWorkloadRequestGrounding(request);
  const nodeIds = new Set<string>(
    request.architecture.nodes.map((node) => node.id),
  );
  const edgeIds = new Set<string>(
    request.architecture.edges.map((edge) => edge.id),
  );
  const workloadIds = new Set<string>(
    request.architecture.workloadBehavior.workloads.map(
      (workload) => workload.id,
    ),
  );
  const contractIds = new Set<string>(
    request.architecture.applicationContracts.contracts.map(
      (contract) => contract.contractId,
    ),
  );
  const externalResourceIds = new Set<string>(
    request.architecture.externalResources.resources.map(
      (resource) => resource.id,
    ),
  );
  const evidenceIds = new Set<string>(
    request.solutionRevision?.evidenceIdsAtFreeze ?? [],
  );
  const issueIds = new Set<string>(
    request.solutionRevision?.issueIdsAtFreeze ?? [],
  );
  const candidateIds = new Set<string>();

  const referenceIsGrounded = (
    reference: (typeof response.workloads)[number]["sourceReferences"][number],
  ): boolean => {
    if (reference.path !== undefined || reference.location !== undefined) {
      return false;
    }
    switch (reference.kind) {
      case "architecture-node":
        return (
          reference.digest === undefined && nodeIds.has(reference.referenceId)
        );
      case "architecture-edge":
        return (
          reference.digest === undefined && edgeIds.has(reference.referenceId)
        );
      case "workload":
        return (
          reference.digest === undefined &&
          workloadIds.has(reference.referenceId)
        );
      case "solution-contract":
        return (
          reference.digest === undefined &&
          contractIds.has(reference.referenceId)
        );
      case "external-resource": {
        return (
          externalResourceIds.has(reference.referenceId) &&
          (reference.digest === undefined ||
            reference.digest ===
              request.solutionRevision?.externalResources.contentHash)
        );
      }
      case "evidence-record":
        return (
          reference.digest === undefined &&
          evidenceIds.has(reference.referenceId)
        );
      case "active-issue":
        return (
          reference.digest === undefined && issueIds.has(reference.referenceId)
        );
      default:
        return false;
    }
  };

  for (const workload of response.workloads) {
    if (candidateIds.has(workload.candidateId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-workload-candidate",
        "Workload proposal candidate identities must be unique across the response.",
      );
    }
    candidateIds.add(workload.candidateId);
    if (!nodeIds.has(workload.owningNodeId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-workload-owner",
        "A workload proposal references an owning node outside the supplied architecture.",
      );
    }
    if (workload.sourceReferences.length === 0) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-workload-source",
        "A workload proposal must cite at least one grounded source reference.",
      );
    }
    const references = new Set<string>();
    for (const reference of workload.sourceReferences) {
      const canonical = serializeCanonicalJson(reference);
      if (references.has(canonical) || !referenceIsGrounded(reference)) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-workload-source",
          "A workload proposal source reference is duplicate or not grounded in the supplied architecture and Solution Revision.",
        );
      }
      references.add(canonical);
    }
  }
}

function assertRepairRequestGrounding(request: RepairAuthorityRequest): {
  readonly diagnosticPathById: ReadonlyMap<string, string>;
  readonly failedByPath: ReadonlyMap<
    string,
    { readonly candidateId: string; readonly resultDigest: Sha256Digest }
  >;
} {
  const context =
    "generationContext" in request ? request.generationContext : undefined;
  if (context !== undefined) {
    if (
      !("generationContextDigest" in request) ||
      request.generationContextDigest !== digestStructuredValue(context) ||
      serializeCanonicalJson(context.ownedPaths) !==
        serializeCanonicalJson(request.boundary.ownedPaths) ||
      serializeCanonicalJson(context.validationExpectations) !==
        serializeCanonicalJson(request.validationExpectations) ||
      request.maximumRepairAttempts > context.limits.maximumRepairAttempts ||
      context.catalogSlice.sliceDigest !==
        sha256Text(context.catalogSlice.content)
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-generation-context",
        "Repair must preserve the exact generation context, boundary, validation expectations, catalog slice, and repair limit.",
      );
    }
    const boundaryApprovalPaths = new Set(request.boundary.approvalPathIds);
    if (
      context.allowedDependencies.some(
        (dependency) => !boundaryApprovalPaths.has(dependency.approvalPathId),
      )
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-generation-context",
        "Repair generation context contains dependency authority outside its exact boundary.",
      );
    }
    for (const schema of context.officialSchemas) {
      if (schema.schemaDigest !== sha256Text(schema.document)) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-repair-generation-context",
          "Repair generation context contains an official schema with an invalid canonical digest.",
        );
      }
    }
    let existingBytes = 0;
    for (const file of context.existingFiles) {
      const sizeBytes = new TextEncoder().encode(file.content).byteLength;
      existingBytes += sizeBytes;
      if (
        !context.ownedPaths.includes(file.path) ||
        context.protectedPaths.includes(file.path) ||
        file.contentDigest !== sha256Text(file.content) ||
        file.sizeBytes !== sizeBytes ||
        sizeBytes > context.limits.maximumCandidateFileBytes ||
        inspectModelValueForSecretCandidatesV1(file.content)
          .detectedValueCount > 0
      ) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-repair-generation-context",
          "Repair generation context contains an invalid sanitized existing file.",
        );
      }
    }
    if (
      existingBytes > context.limits.maximumCandidateTotalBytes ||
      context.allowedDependencies.length >
        context.limits.maximumDependencyRequests ||
      context.allowedResources.length > context.limits.maximumResourceCount
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-generation-context",
        "Repair generation context exceeds its exact deterministic limits.",
      );
    }
  }
  if (
    "priorCandidateContext" in request &&
    request.priorCandidateContext !== undefined
  ) {
    const { contextDigest, ...priorContent } = request.priorCandidateContext;
    if (contextDigest !== digestStructuredValue(priorContent)) {
      throw new ModelGatewayValidationError(
        "model-gateway.repair-candidate-context-digest-mismatch",
        "Repair prior candidate metadata does not match its exact canonical digest.",
      );
    }
  }
  if (
    request.failedOutputDigest !==
    digestStructuredValue(request.failedCandidates)
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.repair-input-digest-mismatch",
      "The failed output digest does not match the exact canonical failed-candidate array.",
    );
  }
  const ownedPaths = new Set<string>(request.boundary.ownedPaths);
  const failedPaths = new Set<string>();
  const failedCandidateIds = new Set<string>();
  const failedByPath = new Map<
    string,
    { readonly candidateId: string; readonly resultDigest: Sha256Digest }
  >();
  for (const candidate of request.failedCandidates) {
    if (
      failedPaths.has(candidate.path) ||
      failedCandidateIds.has(candidate.candidateId) ||
      !ownedPaths.has(candidate.path)
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-input",
        "A failed candidate has an ambiguous path or falls outside the repair boundary.",
      );
    }
    if (
      candidate.kind === "file" &&
      sha256Text(candidate.content) !== candidate.contentDigest
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-input",
        "A failed candidate content digest does not match its exact content.",
      );
    }
    if (candidate.kind === "patch") {
      assertUnifiedDiffCandidatePath(candidate);
    }
    failedPaths.add(candidate.path);
    failedCandidateIds.add(candidate.candidateId);
    failedByPath.set(candidate.path, {
      candidateId: candidate.candidateId,
      resultDigest:
        candidate.kind === "file"
          ? candidate.contentDigest
          : candidate.proposedResultDigest,
    });
  }

  const diagnosticIds = new Set<string>();
  const diagnosticPathById = new Map<string, string>();
  for (const diagnostic of request.diagnostics) {
    if (
      diagnosticIds.has(diagnostic.diagnosticId) ||
      !failedPaths.has(diagnostic.path) ||
      failedByPath.get(diagnostic.path)?.candidateId !== diagnostic.candidateId
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-diagnostic",
        "A repair diagnostic is duplicate or does not target an exact failed candidate path.",
      );
    }
    diagnosticIds.add(diagnostic.diagnosticId);
    diagnosticPathById.set(diagnostic.diagnosticId, diagnostic.path);
  }

  return { diagnosticPathById, failedByPath };
}

function assertRepairGrounding(
  request: RepairAuthorityRequest,
  response: HostRepairResponse,
): void {
  const { diagnosticPathById, failedByPath } =
    assertRepairRequestGrounding(request);

  const repairedPaths = new Set(
    response.candidateBundle.candidates.map((candidate) => candidate.path),
  );
  const diagnosedPaths = new Set(diagnosticPathById.values());
  if ([...repairedPaths].some((path) => !diagnosedPaths.has(path))) {
    throw new ModelGatewayValidationError(
      "model-gateway.ungrounded-repair-input",
      "A repaired candidate path was not an exact diagnosed failed-candidate path.",
    );
  }
  for (const candidate of response.candidateBundle.candidates) {
    const failed = failedByPath.get(candidate.path);
    const priorDigest =
      candidate.kind === "file" ? candidate.priorDigest : candidate.baseDigest;
    if (failed === undefined || priorDigest !== failed.resultDigest) {
      throw new ModelGatewayValidationError(
        "model-gateway.repair-prior-digest-mismatch",
        "Every repair output must bind the exact prior/base digest of its failed candidate path.",
      );
    }
  }
  const priorCandidateContext =
    "priorCandidateContext" in request
      ? request.priorCandidateContext
      : undefined;
  if (priorCandidateContext !== undefined) {
    const currentContext = {
      assumptions: response.candidateBundle.assumptions ?? [],
      expectedTests: response.candidateBundle.expectedTests ?? [],
      unresolvedItems: response.candidateBundle.unresolvedItems ?? [],
    };
    if (
      serializeCanonicalJson(currentContext) !==
      serializeCanonicalJson({
        assumptions: priorCandidateContext.assumptions,
        expectedTests: priorCandidateContext.expectedTests,
        unresolvedItems: priorCandidateContext.unresolvedItems,
      })
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.repair-candidate-context-changed",
        "Repair cannot omit or change prior assumptions, expected tests, or unresolved items; blocking questions must remain visible.",
      );
    }
  }
  const resolvedIds = new Set<string>();
  for (const diagnosticId of response.resolvedDiagnosticIds) {
    const diagnosticPath = diagnosticPathById.get(diagnosticId);
    if (
      resolvedIds.has(diagnosticId) ||
      diagnosticPath === undefined ||
      !repairedPaths.has(diagnosticPath)
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-repair-diagnostic",
        "A resolved diagnostic is duplicate or was not supplied as repair input.",
      );
    }
    resolvedIds.add(diagnosticId);
  }
}

function assertArchitectureAllowlist(
  request: Extract<
    ModelGatewayRequestV1,
    { operation: "architecture.propose" }
  >,
  response: Extract<
    ModelGatewayResponseV1,
    { operation: "architecture.propose" }
  >,
): void {
  const serviceIds = new Set(request.catalog.allowedServiceIds);
  const relationshipTypes = new Set(request.catalog.allowedRelationshipTypes);
  const candidateIds = new Set<string>();
  const serviceCandidateIds = new Set<string>();
  for (const service of response.services) {
    if (candidateIds.has(service.candidateId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-architecture-candidate",
        "Architecture proposal candidate identities must be unique across the response.",
      );
    }
    candidateIds.add(service.candidateId);
    serviceCandidateIds.add(service.candidateId);
    if (!serviceIds.has(service.catalogServiceId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.unknown-service",
        "Architecture output referenced a service outside the exact catalog allowlist.",
      );
    }
  }
  for (const relationship of response.relationships) {
    if (candidateIds.has(relationship.candidateId)) {
      throw new ModelGatewayValidationError(
        "model-gateway.ambiguous-architecture-candidate",
        "Architecture proposal candidate identities must be unique across the response.",
      );
    }
    if (
      !relationshipTypes.has(relationship.relationshipType) ||
      !serviceCandidateIds.has(relationship.sourceCandidateId) ||
      !serviceCandidateIds.has(relationship.targetCandidateId)
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.unknown-relationship",
        "Architecture output referenced an unknown relationship or endpoint.",
      );
    }
    candidateIds.add(relationship.candidateId);
  }
}

function assertRepositoryGrounding(
  request: Extract<
    ModelGatewayRequestV1,
    { operation: "repository.interpret" }
  >,
  response: Extract<
    ModelGatewayResponseV1,
    { operation: "repository.interpret" }
  >,
): void {
  const evidence = new Map(
    request.evidence.map((item) => [item.evidenceId, item]),
  );
  for (const claim of response.claims) {
    for (const reference of claim.evidenceReferences) {
      const source = evidence.get(reference.referenceId);
      if (
        reference.kind !== "repository-evidence" ||
        source === undefined ||
        reference.path !== source.path ||
        reference.digest !== source.fileChecksum ||
        serializeCanonicalJson(reference.location) !==
          serializeCanonicalJson(source.location)
      ) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-repository-claim",
          "A repository claim is not grounded in an exact supplied evidence excerpt.",
        );
      }
    }
  }
}

type OperationProposalRequest = Extract<
  ModelGatewayRequestV1,
  { operation: "operations.propose" }
>;
type OperationProposalResponse = Extract<
  ModelGatewayResponseV1,
  { operation: "operations.propose" }
>;
function approvedRepositoryEvidenceReference(
  evidence: NonNullable<
    NonNullable<
      OperationProposalRequest["planningContext"]
    >["approvedRepositoryEvidence"]
  >["evidence"][number],
): EvidenceReferenceV1 {
  return {
    digest: evidence.fileChecksum,
    kind: "repository-evidence",
    location: evidence.location,
    path: evidence.path,
    referenceId: evidence.evidenceId,
  };
}

function assertPlanningRepositoryEvidenceAuthority(
  request: OperationProposalRequest,
): void {
  if (request.reconciliation === undefined) {
    return;
  }
  const approved = request.planningContext?.approvedRepositoryEvidence;
  if (
    approved?.repositorySnapshotId !==
      request.reconciliation.repositorySnapshotId ||
    approved.repositorySnapshotDigest !==
      request.reconciliation.repositorySnapshotDigest
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.reconciliation-evidence-lineage-mismatch",
      "Planning reconciliation must bind the exact approved repository snapshot identity and digest.",
    );
  }
}

function assertReconciliationSuggestionEvidence(
  request: OperationProposalRequest,
  response: OperationProposalResponse,
  reconciliationOperations: ReadonlyMap<string, string>,
): void {
  const suggestions = response.solutionProposal?.reconciliationSuggestions;
  if (suggestions === undefined || suggestions.length === 0) return;
  const approved = request.planningContext?.approvedRepositoryEvidence;
  const allowed = new Set(
    approved?.evidence.map((evidence) =>
      serializeCanonicalJson(approvedRepositoryEvidenceReference(evidence)),
    ) ?? [],
  );
  for (const suggestion of suggestions) {
    const direct = suggestion.evidenceReferences.map(serializeCanonicalJson);
    const confidence = suggestion.confidence.evidenceReferences.map(
      serializeCanonicalJson,
    );
    if (
      !reconciliationOperations.has(suggestion.operationId) ||
      direct.length === 0 ||
      confidence.length === 0 ||
      direct.length !== confidence.length ||
      direct.some(
        (reference, index) =>
          !allowed.has(reference) || reference !== confidence[index],
      )
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-reconciliation-evidence",
        "Every reconciliation suggestion and confidence must cite the same nonempty exact approved repository evidence.",
      );
    }
  }
}

type ProposedOperationBatch = OperationProposalResponse["batches"][number];
type ProposedGraphBatch = Extract<
  ProposedOperationBatch,
  { kind: "graph" }
>["batch"];

type CatalogNodeAuthority =
  OperationProposalRequest["catalogGrounding"]["nodes"][number];
type CatalogConfigurationValidation =
  CatalogNodeAuthority["configurationValidation"];
type CatalogConfigurationProperties =
  CatalogConfigurationValidation["jsonSchema"]["properties"];
type CatalogConfigurationProperty =
  CatalogConfigurationProperties[keyof CatalogConfigurationProperties];
type CatalogConfigurationValueSources =
  CatalogConfigurationValidation["valueSources"];
type CatalogConfigurationValueSource =
  CatalogConfigurationValueSources[keyof CatalogConfigurationValueSources];
type CatalogNodeReferenceAuthorities =
  CatalogConfigurationValidation["nodeReferenceAuthorities"];
type CatalogNodeReferenceAuthority =
  CatalogNodeReferenceAuthorities[keyof CatalogNodeReferenceAuthorities][number];
type GraphNode = OperationProposalRequest["architecture"]["nodes"][number];

function requireGrounded<T>(
  value: T | undefined,
  message: string,
  fail: (message: string) => never,
): T {
  if (value === undefined) fail(message);
  return value;
}

function nodeAuthoritySignature(node: {
  readonly configurationSchemaId: string;
  readonly configurationSchemaVersion: string;
  readonly resourceType: string;
  readonly serviceType: string;
}): string {
  return `${node.serviceType}\u0000${node.resourceType}\u0000${node.configurationSchemaId}\u0000${node.configurationSchemaVersion}`;
}

function connectionAuthoritySignature(rule: {
  readonly configurationSchemaId: string;
  readonly configurationSchemaVersion: string;
  readonly relationshipType: string;
  readonly source: { readonly port: string; readonly serviceType: string };
  readonly target: { readonly port: string; readonly serviceType: string };
}): string {
  return `${rule.source.serviceType}\u0000${rule.source.port}\u0000${rule.target.serviceType}\u0000${rule.target.port}\u0000${rule.relationshipType}\u0000${rule.configurationSchemaId}\u0000${rule.configurationSchemaVersion}`;
}

function configurationAuthorityDigest(
  schemaId: string,
  schemaVersion: string,
  authority: CatalogConfigurationValidation,
): Sha256Digest {
  return digestStructuredValue({
    canonicalization: authority.canonicalization,
    jsonSchema: authority.jsonSchema,
    nodeReferenceAuthorities: authority.nodeReferenceAuthorities,
    schemaId,
    schemaVersion,
    valueSources: authority.valueSources,
  });
}

function primitiveSatisfiesConfigurationProperty(
  property: CatalogConfigurationProperty,
  value: unknown,
): boolean {
  switch (property.type) {
    case "string":
      if (typeof value !== "string") return false;
      if (property.enum !== undefined && !property.enum.includes(value))
        return false;
      if (property.minLength !== undefined && value.length < property.minLength)
        return false;
      if (property.maxLength !== undefined && value.length > property.maxLength)
        return false;
      if (property.pattern !== undefined) {
        try {
          if (!new RegExp(property.pattern, "u").test(value)) return false;
        } catch {
          return false;
        }
      }
      return true;
    case "number":
    case "integer":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (property.type !== "integer" || Number.isInteger(value)) &&
        (property.enum === undefined || property.enum.includes(value)) &&
        (property.minimum === undefined || value >= property.minimum) &&
        (property.maximum === undefined || value <= property.maximum)
      );
    case "boolean":
      return (
        typeof value === "boolean" &&
        (property.const === undefined || value === property.const)
      );
    case "array":
      if (!Array.isArray(value)) return false;
      return (
        value.every((item) =>
          property.items.type === "string"
            ? typeof item === "string" &&
              (property.items.enum === undefined ||
                property.items.enum.includes(item))
            : typeof item === "number" &&
              Number.isFinite(item) &&
              (property.items.type !== "integer" || Number.isInteger(item)) &&
              (property.items.enum === undefined ||
                property.items.enum.includes(item)),
        ) &&
        (property.minItems === undefined ||
          value.length >= property.minItems) &&
        (property.maxItems === undefined ||
          value.length <= property.maxItems) &&
        (property.uniqueItems !== true || new Set(value).size === value.length)
      );
  }
  return false;
}

function assertConfigurationAuthority(
  schemaId: string,
  schemaVersion: string,
  authority: CatalogConfigurationValidation,
  fail: (message: string) => never,
): void {
  if (
    authority.schemaDigest !==
    configurationAuthorityDigest(schemaId, schemaVersion, authority)
  ) {
    fail(
      "Catalog configuration authority does not match its exact canonical schema digest.",
    );
  }
  for (const property of Object.values(authority.jsonSchema.properties)) {
    if (
      "default" in property &&
      property.default !== undefined &&
      !primitiveSatisfiesConfigurationProperty(property, property.default)
    ) {
      fail(
        "Catalog configuration authority contains an invalid default value.",
      );
    }
  }
}

function assertCatalogConfiguration(
  configuration: GraphNode["semantic"]["configuration"],
  schemaId: string,
  schemaVersion: string,
  authority: CatalogConfigurationValidation,
  nodes: ReadonlyMap<string, GraphNode>,
  variableIds: ReadonlySet<string>,
  fail: (message: string) => never,
): void {
  if (
    configuration.schemaId !== schemaId ||
    configuration.schemaVersion !== schemaVersion
  ) {
    fail("A proposed configuration changed its exact catalog schema binding.");
  }
  assertConfigurationAuthority(schemaId, schemaVersion, authority, fail);
  const properties = authority.jsonSchema.properties as Readonly<
    Record<string, CatalogConfigurationProperty>
  >;
  const valueSources = authority.valueSources as Readonly<
    Record<string, CatalogConfigurationValueSource>
  >;
  const nodeReferenceAuthorities =
    authority.nodeReferenceAuthorities as Readonly<
      Record<string, readonly CatalogNodeReferenceAuthority[]>
    >;
  for (const key of Object.keys(configuration.values)) {
    if (!Object.hasOwn(properties, key)) {
      fail("A proposed configuration contains a field outside its allowlist.");
    }
  }
  for (const key of authority.jsonSchema.required) {
    const property = properties[key];
    if (
      configuration.values[key] === undefined &&
      (property === undefined ||
        !("default" in property) ||
        property.default === undefined)
    ) {
      fail("A proposed configuration omitted a required catalog field.");
    }
  }
  for (const [key, value] of Object.entries(configuration.values)) {
    const property = properties[key];
    const source = valueSources[key];
    if (property === undefined || source === undefined) {
      fail("A proposed configuration field has no exact catalog authority.");
    }
    if (source === "node-reference") {
      const targetNode =
        value.kind === "node-reference" ? nodes.get(value.nodeId) : undefined;
      const authorities = nodeReferenceAuthorities[key];
      if (
        value.kind !== "node-reference" ||
        targetNode === undefined ||
        authorities?.some(
          (candidate) =>
            candidate.serviceType === targetNode.semantic.serviceType &&
            candidate.attribute === value.attribute,
        ) !== true
      ) {
        fail(
          "A proposed node-reference field is not grounded in its exact field, target service, and attribute authority.",
        );
      }
      continue;
    }
    if (source === "secret-reference") {
      if (value.kind !== "secret-reference") {
        fail(
          "A proposed secret field contains a value instead of a reference.",
        );
      }
      continue;
    }
    if (source === "sensitive-variable-reference") {
      if (
        value.kind !== "variable-reference" ||
        !variableIds.has(value.variableId)
      ) {
        fail(
          "A proposed sensitive field is not an exact known variable reference.",
        );
      }
      continue;
    }

    const literal = "value" in value ? value.value : undefined;
    const expectedKind =
      property.type === "array"
        ? property.items.type === "string"
          ? "string-list"
          : "number-list"
        : property.type;
    if (
      value.kind !== expectedKind ||
      !primitiveSatisfiesConfigurationProperty(property, literal)
    ) {
      fail(
        "A proposed literal configuration value violates its exact catalog schema.",
      );
    }
  }
}

function graphNodeDepth(
  nodes: ReadonlyMap<string, GraphNode>,
  nodeId: string,
): number | null {
  const seen = new Set<string>();
  let current: string | undefined = nodeId;
  let depth = 1;
  while (current !== undefined) {
    if (seen.has(current)) return null;
    seen.add(current);
    const node = nodes.get(current);
    if (node === undefined) return null;
    current = node.semantic.parent?.nodeId;
    if (current !== undefined) depth += 1;
  }
  return depth;
}

function assertCatalogPlacements(
  nodes: ReadonlyMap<string, GraphNode>,
  authoritiesByService: ReadonlyMap<string, CatalogNodeAuthority>,
  fail: (message: string) => never,
): void {
  for (const node of nodes.values()) {
    const authority = authoritiesByService.get(node.semantic.serviceType);
    if (authority === undefined) {
      fail("A graph node has no exact service placement authority.");
    }
    const parent = node.semantic.parent;
    if (parent === undefined) {
      if (authority.placement.rootPlacement === "forbidden") {
        fail("A proposed node cannot be placed at the architecture root.");
      }
    } else {
      const parentNode = nodes.get(parent.nodeId);
      if (
        parentNode === undefined ||
        authority.placement.rootPlacement === "required" ||
        !authority.placement.allowedParentTypes.some(
          (allowed) =>
            allowed.serviceType === parentNode.semantic.serviceType &&
            allowed.relationshipType === parent.relationshipType,
        )
      ) {
        fail(
          "A proposed parent is not an exact ordered child-service, parent-service, and relationship tuple.",
        );
      }
    }
    const depth = graphNodeDepth(nodes, node.id);
    if (
      depth === null ||
      (authority.placement.maximumDepth !== undefined &&
        depth > authority.placement.maximumDepth)
    ) {
      fail(
        "A proposed placement creates a cycle or exceeds its exact depth bound.",
      );
    }
  }
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return serializeCanonicalJson(left) === serializeCanonicalJson(right);
}

function assertGraphCommandGrounding(
  request: OperationProposalRequest,
  batch: ProposedGraphBatch,
): void {
  const architecture = request.architecture;
  const expectedTarget = {
    architectureId: architecture.architectureId,
    documentId: architecture.documentId,
    revisionId: architecture.revision.revisionId,
  };
  const fail = (message: string): never => {
    throw new ModelGatewayValidationError(
      "model-gateway.ungrounded-graph-command",
      message,
    );
  };
  if (
    batch.origin !== "ai-accepted" ||
    !sameCanonicalValue(batch.target, expectedTarget)
  ) {
    fail(
      "A proposed Graph Command batch is not bound to the exact architecture target and AI proposal origin.",
    );
  }

  const originalNodeIds = new Set(architecture.nodes.map((node) => node.id));
  const originalEdgeIds = new Set(architecture.edges.map((edge) => edge.id));
  const nodes = new Map(architecture.nodes.map((node) => [node.id, node]));
  const edges = new Map(architecture.edges.map((edge) => [edge.id, edge]));
  const variableIds = new Set(
    architecture.variables.map((variable) => variable.id),
  );
  const nodeAuthoritiesBySignature = new Map(
    request.catalogGrounding.nodes.map((node) => [
      nodeAuthoritySignature(node),
      node,
    ]),
  );
  const nodeAuthoritiesByService = new Map(
    request.catalogGrounding.nodes.map((node) => [node.serviceType, node]),
  );
  const connectionAuthoritiesBySignature = new Map(
    request.catalogGrounding.connectionRules.map((rule) => [
      connectionAuthoritySignature(rule),
      rule,
    ]),
  );
  for (const authority of request.catalogGrounding.nodes) {
    assertConfigurationAuthority(
      authority.configurationSchemaId,
      authority.configurationSchemaVersion,
      authority.configurationValidation,
      fail,
    );
  }
  for (const authority of request.catalogGrounding.connectionRules) {
    assertConfigurationAuthority(
      authority.configurationSchemaId,
      authority.configurationSchemaVersion,
      authority.configurationValidation,
      fail,
    );
  }
  for (const node of architecture.nodes) {
    const authority = requireGrounded(
      nodeAuthoritiesBySignature.get(
        nodeAuthoritySignature({
          configurationSchemaId: node.semantic.configuration.schemaId,
          configurationSchemaVersion: node.semantic.configuration.schemaVersion,
          resourceType: node.semantic.resourceType,
          serviceType: node.semantic.serviceType,
        }),
      ),
      "An existing architecture node has no exact catalog authority.",
      fail,
    );
    assertCatalogConfiguration(
      node.semantic.configuration,
      authority.configurationSchemaId,
      authority.configurationSchemaVersion,
      authority.configurationValidation,
      nodes,
      variableIds,
      fail,
    );
  }
  for (const edge of architecture.edges) {
    const source = requireGrounded(
      nodes.get(edge.semantic.source.nodeId),
      "An existing architecture edge has an unknown source node.",
      fail,
    );
    const target = requireGrounded(
      nodes.get(edge.semantic.target.nodeId),
      "An existing architecture edge has an unknown target node.",
      fail,
    );
    const authority = requireGrounded(
      connectionAuthoritiesBySignature.get(
        connectionAuthoritySignature({
          configurationSchemaId: edge.semantic.configuration.schemaId,
          configurationSchemaVersion: edge.semantic.configuration.schemaVersion,
          relationshipType: edge.semantic.relationshipType,
          source: {
            port: edge.semantic.source.port,
            serviceType: source.semantic.serviceType,
          },
          target: {
            port: edge.semantic.target.port,
            serviceType: target.semantic.serviceType,
          },
        }),
      ),
      "An existing architecture edge has no exact ordered catalog authority.",
      fail,
    );
    assertCatalogConfiguration(
      edge.semantic.configuration,
      authority.configurationSchemaId,
      authority.configurationSchemaVersion,
      authority.configurationValidation,
      nodes,
      variableIds,
      fail,
    );
  }
  assertCatalogPlacements(nodes, nodeAuthoritiesByService, fail);
  const commandIds = new Set<string>();

  for (const command of batch.commands) {
    if (
      commandIds.has(command.commandId) ||
      command.origin !== "ai-accepted" ||
      !sameCanonicalValue(command.target, expectedTarget)
    ) {
      fail(
        "A proposed Graph Command has duplicate identity or ungrounded target/origin metadata.",
      );
    }
    commandIds.add(command.commandId);

    switch (command.kind) {
      case "add-node": {
        if (
          nodes.has(command.node.id) ||
          originalNodeIds.has(command.node.id)
        ) {
          fail(
            "A proposed add-node command uses an existing or original node ID.",
          );
        }
        if (
          command.node.semantic.lifecycle.ownership !== "user" ||
          command.node.semantic.lifecycle.origin !== "ai-accepted"
        ) {
          fail(
            "A model-proposed node must have user ownership and an AI-accepted lifecycle origin.",
          );
        }
        const authority = requireGrounded(
          nodeAuthoritiesBySignature.get(
            nodeAuthoritySignature({
              configurationSchemaId:
                command.node.semantic.configuration.schemaId,
              configurationSchemaVersion:
                command.node.semantic.configuration.schemaVersion,
              resourceType: command.node.semantic.resourceType,
              serviceType: command.node.semantic.serviceType,
            }),
          ),
          "A proposed add-node service/schema is outside the exact catalog allowlist.",
          fail,
        );
        assertCatalogConfiguration(
          command.node.semantic.configuration,
          authority.configurationSchemaId,
          authority.configurationSchemaVersion,
          authority.configurationValidation,
          nodes,
          variableIds,
          fail,
        );
        nodes.set(command.node.id, command.node);
        assertCatalogPlacements(nodes, nodeAuthoritiesByService, fail);
        break;
      }
      case "remove-node": {
        const current = requireGrounded(
          nodes.get(command.nodeId),
          "A proposed remove-node command references an unknown node.",
          fail,
        );
        if (!sameCanonicalValue(current, command.expectedNode))
          fail(
            "A proposed remove-node precondition does not match an exact supplied node.",
          );
        nodes.delete(command.nodeId);
        break;
      }
      case "update-node-configuration": {
        const current = requireGrounded(
          nodes.get(command.nodeId),
          "A proposed node-configuration command references an unknown node.",
          fail,
        );
        if (
          !sameCanonicalValue(
            current.semantic.configuration,
            command.expectedConfiguration,
          ) ||
          command.configuration.schemaId !==
            current.semantic.configuration.schemaId ||
          command.configuration.schemaVersion !==
            current.semantic.configuration.schemaVersion
        )
          fail(
            "A proposed node-configuration precondition is not grounded in the supplied architecture.",
          );
        const authority = requireGrounded(
          nodeAuthoritiesByService.get(current.semantic.serviceType),
          "The updated node has no exact service authority.",
          fail,
        );
        assertCatalogConfiguration(
          command.configuration,
          authority.configurationSchemaId,
          authority.configurationSchemaVersion,
          authority.configurationValidation,
          nodes,
          variableIds,
          fail,
        );
        nodes.set(command.nodeId, {
          ...current,
          semantic: {
            ...current.semantic,
            configuration: command.configuration,
          },
        });
        break;
      }
      case "move-node": {
        const current = requireGrounded(
          nodes.get(command.nodeId),
          "A proposed node-position command references an unknown node.",
          fail,
        );
        if (
          !sameCanonicalValue(
            current.presentation.position,
            command.expectedPosition,
          )
        )
          fail(
            "A proposed node-position precondition is not grounded in the supplied architecture.",
          );
        nodes.set(command.nodeId, {
          ...current,
          presentation: { ...current.presentation, position: command.position },
        });
        break;
      }
      case "reparent-node": {
        const current = requireGrounded(
          nodes.get(command.nodeId),
          "A proposed node-parent command references an unknown node.",
          fail,
        );
        if (
          !sameCanonicalValue(
            current.semantic.parent ?? null,
            command.expectedParent,
          )
        )
          fail(
            "A proposed node-parent change is not grounded in supplied node identities and preconditions.",
          );
        nodes.set(command.nodeId, {
          ...current,
          semantic: {
            ...current.semantic,
            parent: command.parent ?? undefined,
          },
        });
        assertCatalogPlacements(nodes, nodeAuthoritiesByService, fail);
        break;
      }
      case "add-edge": {
        if (
          edges.has(command.edge.id) ||
          originalEdgeIds.has(command.edge.id)
        ) {
          fail(
            "A proposed add-edge command uses an existing or original edge ID.",
          );
        }
        if (
          command.edge.semantic.lifecycle.ownership !== "user" ||
          command.edge.semantic.lifecycle.origin !== "ai-accepted"
        ) {
          fail(
            "A model-proposed edge must have user ownership and an AI-accepted lifecycle origin.",
          );
        }
        const source = requireGrounded(
          nodes.get(command.edge.semantic.source.nodeId),
          "A proposed add-edge command references an unknown source node.",
          fail,
        );
        const target = requireGrounded(
          nodes.get(command.edge.semantic.target.nodeId),
          "A proposed add-edge command references an unknown target node.",
          fail,
        );
        const authority = requireGrounded(
          connectionAuthoritiesBySignature.get(
            connectionAuthoritySignature({
              configurationSchemaId:
                command.edge.semantic.configuration.schemaId,
              configurationSchemaVersion:
                command.edge.semantic.configuration.schemaVersion,
              relationshipType: command.edge.semantic.relationshipType,
              source: {
                port: command.edge.semantic.source.port,
                serviceType: source.semantic.serviceType,
              },
              target: {
                port: command.edge.semantic.target.port,
                serviceType: target.semantic.serviceType,
              },
            }),
          ),
          "A proposed add-edge relationship/schema is outside the exact ordered catalog allowlist.",
          fail,
        );
        assertCatalogConfiguration(
          command.edge.semantic.configuration,
          authority.configurationSchemaId,
          authority.configurationSchemaVersion,
          authority.configurationValidation,
          nodes,
          variableIds,
          fail,
        );
        edges.set(command.edge.id, command.edge);
        break;
      }
      case "remove-edge": {
        const current = requireGrounded(
          edges.get(command.edgeId),
          "A proposed remove-edge command references an unknown edge.",
          fail,
        );
        if (!sameCanonicalValue(current, command.expectedEdge))
          fail(
            "A proposed remove-edge precondition does not match an exact supplied edge.",
          );
        edges.delete(command.edgeId);
        break;
      }
      case "update-edge-configuration": {
        const current = requireGrounded(
          edges.get(command.edgeId),
          "A proposed edge-configuration command references an unknown edge.",
          fail,
        );
        if (
          !sameCanonicalValue(
            current.semantic.configuration,
            command.expectedConfiguration,
          ) ||
          command.configuration.schemaId !==
            current.semantic.configuration.schemaId ||
          command.configuration.schemaVersion !==
            current.semantic.configuration.schemaVersion
        )
          fail(
            "A proposed edge-configuration precondition is not grounded in the supplied architecture.",
          );
        const source = requireGrounded(
          nodes.get(current.semantic.source.nodeId),
          "The updated edge has an unknown source node.",
          fail,
        );
        const target = requireGrounded(
          nodes.get(current.semantic.target.nodeId),
          "The updated edge has an unknown target node.",
          fail,
        );
        const authority = requireGrounded(
          connectionAuthoritiesBySignature.get(
            connectionAuthoritySignature({
              configurationSchemaId: command.configuration.schemaId,
              configurationSchemaVersion: command.configuration.schemaVersion,
              relationshipType: current.semantic.relationshipType,
              source: {
                port: current.semantic.source.port,
                serviceType: source.semantic.serviceType,
              },
              target: {
                port: current.semantic.target.port,
                serviceType: target.semantic.serviceType,
              },
            }),
          ),
          "The updated edge has no exact ordered connection authority.",
          fail,
        );
        assertCatalogConfiguration(
          command.configuration,
          authority.configurationSchemaId,
          authority.configurationSchemaVersion,
          authority.configurationValidation,
          nodes,
          variableIds,
          fail,
        );
        edges.set(command.edgeId, {
          ...current,
          semantic: {
            ...current.semantic,
            configuration: command.configuration,
          },
        });
        break;
      }
      case "replace-workload-and-application-contracts":
        if (
          !sameCanonicalValue(
            architecture.workloadBehavior,
            command.expectedWorkloadBehavior,
          ) ||
          !sameCanonicalValue(
            architecture.applicationContracts,
            command.expectedApplicationContracts,
          )
        )
          fail(
            "A proposed contract replacement does not bind the exact supplied workload and application contracts.",
          );
        break;
      case "adopt-generated-resource":
        return fail(
          "A model proposal cannot ground actor and acceptance authority for generated-resource adoption.",
        );
      case "release-generated-resource": {
        const resource =
          command.resource.kind === "node"
            ? nodes.get(command.resource.nodeId)
            : edges.get(command.resource.edgeId);
        if (
          resource === undefined ||
          !sameCanonicalValue(
            resource.semantic.lifecycle,
            command.expectedLifecycle,
          ) ||
          command.dependencies.some((dependency) =>
            dependency.kind === "node"
              ? !nodes.has(dependency.nodeId)
              : !edges.has(dependency.edgeId),
          )
        )
          fail(
            "A proposed generated-resource release is not grounded in exact lifecycle and dependency references.",
          );
        break;
      }
    }
  }
  assertCatalogPlacements(nodes, nodeAuthoritiesByService, fail);
}

function assertOperationProposalGrounding(
  request: OperationProposalRequest,
  response: OperationProposalResponse,
): void {
  const workloadIds = new Set(
    request.architecture.workloadBehavior.workloads.map(
      (workload) => workload.id,
    ),
  );
  const nodeIds = new Set(request.architecture.nodes.map((node) => node.id));
  const workloadHash = digestStructuredValue(
    normalizeWorkloadBehaviorV2(request.architecture.workloadBehavior),
  );
  const reconciliationOperations = new Map(
    request.reconciliation?.operations.map((operation) => [
      operation.operationId,
      serializeCanonicalJson(operation),
    ]) ?? [],
  );
  const proposedReconciliationIds = new Set<string>();
  const graphCommandIds = new Set<string>();
  const workloadOperationIds = new Set<string>();

  assertReconciliationSuggestionEvidence(
    request,
    response,
    reconciliationOperations,
  );

  for (const batch of response.batches) {
    if (batch.kind === "graph") {
      const commandIds = [
        batch.batch.commandId,
        batch.batch.inverseCommandId,
        ...batch.batch.commands.flatMap((command) => [
          command.commandId,
          command.inverseCommandId,
        ]),
      ];
      for (const commandId of commandIds) {
        if (graphCommandIds.has(commandId)) {
          throw new ModelGatewayValidationError(
            "model-gateway.ambiguous-graph-command-identity",
            "Graph command and inverse identities must be unique across all proposed batches.",
          );
        }
        graphCommandIds.add(commandId);
      }
      continue;
    }
    if (batch.kind === "workload") {
      for (const operation of batch.operations) {
        if (workloadOperationIds.has(operation.operationId)) {
          throw new ModelGatewayValidationError(
            "model-gateway.ambiguous-workload-operation-identity",
            "Workload operation identities must be unique across all proposed batches.",
          );
        }
        workloadOperationIds.add(operation.operationId);
      }
    }
  }

  for (const batch of response.batches) {
    if (batch.kind === "safety-refusal") continue;
    if (batch.kind === "graph") {
      assertGraphCommandGrounding(request, batch.batch);
      continue;
    }
    if (batch.kind === "workload") {
      for (const operation of batch.operations) {
        if (operation.expectedWorkloadContentHash !== workloadHash) {
          throw new ModelGatewayValidationError(
            "model-gateway.ungrounded-workload-operation",
            "A workload operation does not bind the exact supplied Workload Behavior hash.",
          );
        }
        if (operation.action === "add") {
          if (
            workloadIds.has(operation.proposal.workloadId) ||
            !nodeIds.has(operation.proposal.owningNodeId)
          ) {
            throw new ModelGatewayValidationError(
              "model-gateway.ungrounded-workload-operation",
              "A proposed workload add uses a duplicate workload or unknown owning node.",
            );
          }
          workloadIds.add(operation.proposal.workloadId);
        } else if (!workloadIds.has(operation.workloadId)) {
          throw new ModelGatewayValidationError(
            "model-gateway.ungrounded-workload-operation",
            "A proposed workload update or removal references an unknown workload.",
          );
        } else if (operation.action === "remove") {
          workloadIds.delete(operation.workloadId);
        }
      }
      continue;
    }

    if (batch.kind === "assistant") {
      for (const operation of batch.batch.operations) {
        if (operation.kind === "graph-command") {
          assertGraphCommandGrounding(request, {
            ...operation.command,
            commands: [operation.command],
            kind: "batch",
          });
          continue;
        }
        if (operation.kind === "review-repository-difference") {
          if (
            operation.observedContentHash !==
              request.reconciliation?.observedContentHash ||
            reconciliationOperations.get(
              operation.reconciliationOperation.operationId,
            ) !== serializeCanonicalJson(operation.reconciliationOperation)
          ) {
            throw new ModelGatewayValidationError(
              "model-gateway.ungrounded-reconciliation-operation",
              "An Assistant repository review is not bound to the exact supplied observation and deterministic operation.",
            );
          }
        }
      }
      continue;
    }

    if (
      batch.expectedObservedContentHash !==
      request.reconciliation?.observedContentHash
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.ungrounded-reconciliation-operation",
        "A reconciliation batch is not bound to the exact supplied observed-layer hash.",
      );
    }
    for (const operation of batch.operations) {
      if (
        proposedReconciliationIds.has(operation.operationId) ||
        reconciliationOperations.get(operation.operationId) !==
          serializeCanonicalJson(operation)
      ) {
        throw new ModelGatewayValidationError(
          "model-gateway.ungrounded-reconciliation-operation",
          "A reconciliation operation is not an exact operation from the supplied proposal.",
        );
      }
      proposedReconciliationIds.add(operation.operationId);
    }
  }
}

function assertUniqueStableIds(
  ids: readonly string[],
  code: string,
  message: string,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ModelGatewayValidationError(code, message);
    }
    seen.add(id);
  }
}

function assertRequestStableIdentities(request: ModelGatewayRequestV1): void {
  if (request.operation === "repository.interpret") {
    assertUniqueStableIds(
      request.evidence.map((evidence) => evidence.evidenceId),
      "model-gateway.ambiguous-request-evidence",
      "Repository evidence identities must be unique within the exact request.",
    );
  }
  if (request.operation === "external-resource.propose") {
    assertUniqueStableIds(
      request.repositoryExcerpts.map((evidence) => evidence.evidenceId),
      "model-gateway.ambiguous-request-evidence",
      "Repository evidence identities must be unique within the exact request.",
    );
  }
  if (
    request.operation === "operations.propose" &&
    request.planningContext?.approvedRepositoryEvidence !== undefined
  ) {
    assertUniqueStableIds(
      request.planningContext.approvedRepositoryEvidence.evidence.map(
        (evidence) => evidence.evidenceId,
      ),
      "model-gateway.ambiguous-request-evidence",
      "Planning repository-evidence identities must be unique within the exact request.",
    );
  }
}

function assertResponseStableIdentities(
  request:
    | ModelGatewayRequestV1
    | ModelHostSeedRepairRequestV2
    | ModelHostRepairSuccessorRequestV3,
  response: ModelGatewayResponseV1 | ModelHostSeedPatchResponseV2,
): void {
  assertUniqueStableIds(
    [
      ...response.proposalContext.assumptions.map(
        (assumption) => assumption.assumptionId,
      ),
      ...response.proposalContext.unknowns.map((unknown) => unknown.unknownId),
    ],
    "model-gateway.ambiguous-proposal-context-identity",
    "Assumption and unknown identities must be unique across the proposal context.",
  );
  if (
    request.operation === "requirements.blocking-questions" &&
    response.operation === "requirements.blocking-questions"
  ) {
    if (response.questions.length > request.maximumQuestions) {
      throw new ModelGatewayValidationError(
        "model-gateway.question-limit-exceeded",
        "Blocking-question output exceeds the exact caller-authorized maximum.",
      );
    }
    assertUniqueStableIds(
      response.questions.map((question) => question.questionId),
      "model-gateway.ambiguous-question-identity",
      "Blocking-question identities must be unique within the response.",
    );
  }
  if (response.operation === "repository.interpret") {
    assertUniqueStableIds(
      response.claims.map((claim) => claim.claimId),
      "model-gateway.ambiguous-repository-claim",
      "Repository claim identities must be unique within the response.",
    );
  }
  if (response.operation === "external-resource.propose") {
    assertUniqueStableIds(
      response.resources.map((resource) => resource.candidateId),
      "model-gateway.ambiguous-external-resource-candidate",
      "External-resource candidate identities must be unique within the response.",
    );
  }
}

export function validateModelRequestAuthority(
  request: ModelGatewayRequestV1,
): void {
  assertRequestStableIdentities(request);
  if (
    request.operation === "intent.extract" &&
    sha256Text(request.source.content) !== request.source.digest
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.source-digest-mismatch",
      "Intent extraction content does not match its exact source digest.",
    );
  }
  if (request.operation === "requirements.blocking-questions") {
    try {
      parseIntentDocument(request.intentDocument);
    } catch {
      throw new ModelGatewayValidationError(
        "model-gateway.intent-semantics-invalid",
        "Clarification input must satisfy deterministic Intent semantics.",
      );
    }
  }
  if (
    (request.operation === "summary.plain-language" ||
      request.operation === "summary.technical") &&
    sha256Text(request.source.content) !== request.source.contentDigest
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.source-digest-mismatch",
      "Summary source content does not match its exact content digest.",
    );
  }
  if (
    (request.operation === "issue.explain" ||
      request.operation === "deterministic-fix.explain" ||
      request.operation === "fix.propose") &&
    getActiveIssueRecordHash(request.issue) !==
      request.issue.currentRecordDigest
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.issue-record-digest-mismatch",
      "The Active Issue source does not match its exact current record digest.",
    );
  }
  if (
    request.operation === "application-source.generate" ||
    request.operation === "iac-extension.generate"
  ) {
    assertGenerationRequestGrounding(request);
  }
  if (request.operation === "workload.propose") {
    assertWorkloadRequestGrounding(request);
  }
  if (request.operation === "candidate.repair") {
    assertRepairRequestGrounding(request);
  }
  if (request.operation === "operations.propose") {
    assertPlanningRepositoryEvidenceAuthority(request);
  }
}

export function validateModelResponseAuthority(input: {
  readonly allowedApprovalPathIds: ReadonlySet<string>;
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly request: ModelGatewayRequestV1;
  readonly response: ModelGatewayResponseV1;
}): void {
  if (input.response.operation !== input.request.operation) {
    throw new ModelGatewayValidationError(
      "model-gateway.operation-mismatch",
      "Model output operation does not match the requested operation.",
    );
  }
  assertProvenance(input.response.provenance, input.descriptor);
  assertResponseStableIdentities(input.request, input.response);

  if (
    input.request.operation === "intent.extract" &&
    input.response.operation === "intent.extract"
  ) {
    try {
      parseIntentDocument(input.response.intentDocument);
    } catch {
      throw new ModelGatewayValidationError(
        "model-gateway.intent-semantics-invalid",
        "Intent output must satisfy deterministic domain semantics.",
      );
    }
  }
  if (
    input.request.operation === "application-source.generate" ||
    input.request.operation === "iac-extension.generate"
  ) {
    assertGenerationRequestGrounding(input.request);
  }

  if (
    input.request.operation === "architecture.propose" &&
    input.response.operation === "architecture.propose"
  ) {
    assertArchitectureAllowlist(input.request, input.response);
  }
  if (
    input.request.operation === "repository.interpret" &&
    input.response.operation === "repository.interpret"
  ) {
    assertRepositoryGrounding(input.request, input.response);
  }
  if (
    input.request.operation === "workload.propose" &&
    input.response.operation === "workload.propose"
  ) {
    assertWorkloadProposalGrounding(input.request, input.response);
  }
  if (
    input.request.operation === "operations.propose" &&
    input.response.operation === "operations.propose"
  ) {
    assertPlanningRepositoryEvidenceAuthority(input.request);
    assertOperationProposalGrounding(input.request, input.response);
  }
  if (
    input.request.operation === "candidate.repair" &&
    input.response.operation === "candidate.repair"
  ) {
    assertRepairGrounding(input.request, input.response);
    if (
      input.response.repairedFromDigest !== input.request.failedOutputDigest
    ) {
      throw new ModelGatewayValidationError(
        "model-gateway.repair-input-mismatch",
        "Repair output does not bind the exact failed candidate digest.",
      );
    }
  }
  if (
    input.request.operation === "fix.propose" &&
    input.response.operation === "fix.propose" &&
    input.response.issueId !== input.request.issue.id
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.issue-mismatch",
      "AI-proposed fix output must bind the exact requested issue identity.",
    );
  }
  if (
    "candidateBundle" in input.response &&
    (input.request.operation === "fix.propose" ||
      input.request.operation === "application-source.generate" ||
      input.request.operation === "iac-extension.generate" ||
      input.request.operation === "candidate.repair")
  ) {
    assertCandidateBundle(
      input.response.candidateBundle,
      input.request,
      input.descriptor,
      input.allowedApprovalPathIds,
    );
  }
  assertResponseEvidenceGrounding(input.request, input.response);
}

/** Strict first-seed response reader. Reuses deterministic proposal checks but
 * grants no current authority, merge, validator receipt or financial transition.
 * The existing V1 response describes an unaccepted AI patch; the original
 * fixed-host file retains its actual user ownership and V2 request identity. */
interface HostSeedResponseInput {
  readonly allowedApprovalPathIds: ReadonlySet<string>;
  readonly descriptor: ModelLiveSeedInvocationDescriptorV3;
  readonly request: ModelHostSeedRepairRequestV2;
  readonly content: unknown;
  readonly maximumOutputBytes: number;
}
export function parseModelHostSeedResponseV3(
  input: HostSeedResponseInput,
): Extract<ModelGatewayResponseV1, { operation: "candidate.repair" }> {
  return parseBoundHostSeedResponse(
    input,
    (content) => {
      const response = parseModelResponseToolContentV1({
        content,
        operation: "candidate.repair",
      });
      if (response.operation !== "candidate.repair")
        throw new ModelGatewayValidationError(
          "model-gateway.operation-mismatch",
          "The exact repair response is required.",
        );
      return response;
    },
    reviewedHostSeedRepairPromptV2.digest,
  );
}
export function parseModelHostSeedPatchResponseV2(
  input: HostSeedResponseInput,
): ModelHostSeedPatchResponseV2 {
  return parseBoundHostSeedResponse(
    input,
    parseModelHostSeedPatchResponseToolContentV2,
    resolveReviewedHostPatchRepairPromptV3(input.descriptor)?.digest ?? "",
  );
}
function parseBoundHostSeedResponse<T extends HostRepairResponse>(
  input: HostSeedResponseInput,
  decode: (content: unknown) => T,
  expectedPromptDigest: string,
): T {
  let descriptor: ModelLiveSeedInvocationDescriptorV3;
  let request: ModelHostSeedRepairRequestV2;
  try {
    descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse(
      input.descriptor,
    );
    request = modelHostSeedRepairRequestV2Schema.parse(input.request);
  } catch {
    throw new ModelGatewayValidationError(
      "model-gateway.host-seed-binding-invalid",
      "The response requires the exact static seed descriptor and fixed-host request.",
    );
  }
  const prompt = resolveReviewedHostSeedRepairPromptV3(descriptor);
  if (
    prompt?.digest !== expectedPromptDigest ||
    descriptor.inputDigest !==
      digestStructuredValue({ request, scope: descriptor.scope }) ||
    descriptor.requestedMode !== request.requestedMode ||
    descriptor.promptDigest !== prompt.digest ||
    descriptor.promptTemplateId !== prompt.templateId ||
    descriptor.promptVersion !== prompt.version
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.host-seed-binding-invalid",
      "The seed response does not bind the exact request, scope and reviewed prompt.",
    );
  }
  return validateBoundRepairResponse({ ...input, request, descriptor }, decode);
}
function validateBoundRepairResponse<T extends HostRepairResponse>(
  input: Omit<HostSeedResponseInput, "request" | "descriptor"> & {
    readonly request:
      ModelHostSeedRepairRequestV2 | ModelHostRepairSuccessorRequestV3;
    readonly descriptor:
      | ModelLiveSeedInvocationDescriptorV3
      | ModelLiveRepairSuccessorInvocationDescriptorV4;
  },
  decode: (content: unknown) => T,
): T {
  const { request, descriptor } = input;
  if (
    !Number.isSafeInteger(input.maximumOutputBytes) ||
    input.maximumOutputBytes <= 0
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.output-limit-invalid",
      "A positive safe-integer output byte limit is required.",
    );
  }
  let outputBytes: number;
  try {
    outputBytes = serializedByteLength(input.content);
  } catch {
    throw new ModelGatewayValidationError(
      "model-gateway.invalid-output",
      "The model provider returned non-serializable output.",
    );
  }
  if (outputBytes > input.maximumOutputBytes) {
    throw new ModelGatewayValidationError(
      "model-gateway.output-too-large",
      "The model provider output exceeds the bounded response limit.",
    );
  }
  const response = decode(input.content);
  assertProvenance(response.provenance, descriptor);
  assertResponseStableIdentities(request, response);
  assertRepairGrounding(request, response);
  if (response.repairedFromDigest !== request.failedOutputDigest) {
    throw new ModelGatewayValidationError(
      "model-gateway.repair-input-mismatch",
      "Repair output does not bind the exact failed candidate digest.",
    );
  }
  if (
    response.candidateBundle.candidates.some(
      (candidate) => candidate.kind !== "patch",
    )
  ) {
    throw new ModelGatewayValidationError(
      "model-gateway.user-owned-candidate-must-be-exact-patch",
      "Fixed-host user-owned content requires an exact base-bound patch candidate.",
    );
  }
  assertCandidateBundle(
    response.candidateBundle,
    request,
    descriptor,
    input.allowedApprovalPathIds,
  );
  assertResponseEvidenceGrounding(request, response);
  return response;
}

/** Strict final-repair response reader. Parsing proves bindings, never current
 * issuance, acceptance, native validation or accounting completion. */
export function parseModelHostRepairSuccessorPatchResponseV4(
  input: Omit<HostSeedResponseInput, "request" | "descriptor"> & {
    readonly request: ModelHostRepairSuccessorRequestV3;
    readonly descriptor: ModelLiveRepairSuccessorInvocationDescriptorV4;
  },
): ModelHostSeedPatchResponseV2 {
  let descriptor: ModelLiveRepairSuccessorInvocationDescriptorV4;
  let request: ModelHostRepairSuccessorRequestV3;
  try {
    descriptor = modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(
      input.descriptor,
    );
    request = modelHostRepairSuccessorRequestV3Schema.parse(input.request);
  } catch {
    throw new ModelGatewayValidationError(
      "model-gateway.repair-successor-binding-invalid",
      "The response requires the distinct final-repair descriptor and actual prior candidate.",
    );
  }
  const prompt = reviewedHostBoundedRepairPromptV4;
  if (
    descriptor.invocationId === request.predecessor.invocationId ||
    descriptor.inputDigest !==
      digestStructuredValue({ request, scope: descriptor.scope }) ||
    descriptor.requestedMode !== request.requestedMode ||
    descriptor.promptDigest !== prompt.digest ||
    descriptor.promptTemplateId !== prompt.templateId ||
    descriptor.promptVersion !== prompt.version
  )
    throw new ModelGatewayValidationError(
      "model-gateway.repair-successor-binding-invalid",
      "The final repair response must bind its exact request, scope and reviewed prompt.",
    );
  return validateBoundRepairResponse(
    { ...input, request, descriptor },
    parseModelHostSeedPatchResponseToolContentV2,
  );
}
