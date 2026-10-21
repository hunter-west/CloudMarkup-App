import {
  activeIssueV1Schema,
  conformanceDifferenceV1Schema,
  conformanceEvaluationRequestV1Schema,
  conformanceReportV1Schema,
  utcTimestampSchema,
  type ActiveIssueV1,
  type ConformanceDifferenceV1,
  type ConformanceEvaluationRequestV1,
  type ConformanceFactV1,
  type ConformanceReportV1,
  type ConformanceViewLayerV1,
} from "@cloudmarkup/schemas";

import { hashCanonicalValue } from "./document-hashing.js";
import { getActiveIssueRecordHash } from "./solution-lifecycle.js";

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const CONFORMANCE_ISSUE_DIRECT_SOURCE_DIGEST_LIMIT = 254;

type DifferenceDraft = Omit<
  ConformanceDifferenceV1,
  "differenceDigest" | "differenceId"
>;

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareUtf16);
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}.${hashCanonicalValue(value).slice("sha256:".length, 31)}`;
}

function normalizedFact(fact: ConformanceFactV1): ConformanceFactV1 {
  return {
    ...fact,
    evidenceIds: uniqueSorted(fact.evidenceIds),
    iamPermissions: [...fact.iamPermissions].sort((left, right) =>
      compareUtf16(
        `${left.effect}:${left.actionDigest}:${left.resourceDigest}`,
        `${right.effect}:${right.actionDigest}:${right.resourceDigest}`,
      ),
    ),
    sourceIds: uniqueSorted(fact.sourceIds),
    sourceLocations: [...fact.sourceLocations].sort((left, right) =>
      compareUtf16(
        `${left.path}:${String(left.startLine ?? 0)}:${String(left.startColumn ?? 0)}`,
        `${right.path}:${String(right.startLine ?? 0)}:${String(right.startColumn ?? 0)}`,
      ),
    ),
  };
}

function difference(draft: DifferenceDraft): ConformanceDifferenceV1 {
  const matching = draft.kind.startsWith("matching-");
  const normalized: DifferenceDraft = {
    ...draft,
    evidenceIds: uniqueSorted(draft.evidenceIds),
    remediation: {
      automatic: false,
      disposition: matching ? "none" : "review-required",
    },
    sourceIds: uniqueSorted(draft.sourceIds),
  };
  const differenceDigest = hashCanonicalValue({
    contractKind: "cloudmarkup.conformance-difference",
    contractVersion: 1,
    ...normalized,
  });
  return conformanceDifferenceV1Schema.parse({
    ...normalized,
    differenceDigest,
    differenceId: stableId("difference", differenceDigest),
  });
}

export function getConformanceDifferenceDigestV1(input: unknown) {
  const parsed = conformanceDifferenceV1Schema.parse(input);
  const { differenceDigest, differenceId, ...basis } = parsed;
  void differenceDigest;
  void differenceId;
  return hashCanonicalValue({
    contractKind: "cloudmarkup.conformance-difference",
    contractVersion: 1,
    ...basis,
  });
}

function matchingKind(fact: ConformanceFactV1) {
  return fact.subject.kind === "resource"
    ? ("matching-resource" as const)
    : fact.subject.kind === "connection"
      ? ("matching-connection" as const)
      : fact.subject.kind === "configuration"
        ? ("matching-configuration" as const)
        : undefined;
}

function missingKind(layer: ConformanceViewLayerV1) {
  return layer === "imported"
    ? ("designed-missing-from-repository" as const)
    : layer === "planned"
      ? ("designed-missing-from-plan" as const)
      : layer === "deployed"
        ? ("designed-missing-from-deployment" as const)
        : layer === "generated"
          ? ("generated-drift-from-source" as const)
          : undefined;
}

function mismatchKind(layer: ConformanceViewLayerV1, fact: ConformanceFactV1) {
  if (
    fact.applicationBinding === "mismatch" ||
    fact.subject.kind === "application-contract"
  ) {
    return "application-contract-binding-mismatch" as const;
  }
  if (layer === "generated") return "generated-drift-from-source" as const;
  if (fact.subject.kind === "connection") return "connection-mismatch" as const;
  if (fact.subject.kind === "resource") return "resource-mismatch" as const;
  return "configuration-mismatch" as const;
}

function applicationBindingDiffers(
  before: ConformanceFactV1 | undefined,
  current: ConformanceFactV1,
): boolean {
  return (
    current.applicationBinding === "mismatch" ||
    (before?.applicationContractDigest !== undefined &&
      current.applicationContractDigest !== undefined &&
      before.applicationContractDigest !== current.applicationContractDigest) ||
    (before?.applicationBindingDigest !== undefined &&
      current.applicationBindingDigest !== undefined &&
      before.applicationBindingDigest !== current.applicationBindingDigest)
  );
}

function currentDriftKind(
  fact: ConformanceFactV1,
): ConformanceDifferenceV1["kind"] {
  switch (fact.driftClassification) {
    case "managed-drift":
      return "managed-drift";
    case "unmanaged-resource":
      return "unmanaged-resource-drift";
    case "permission-drift":
      return "permission-drift";
    case "network-drift":
      return "network-drift";
    case "application-binding-drift":
      return "application-binding-drift";
    case "external-resource":
      return "external-unmanaged-resource";
    case "unknown":
    case undefined:
      return "unknown-drift";
  }
}

function subjectSummary(fact: ConformanceFactV1): string {
  return `${fact.subject.kind} ${fact.subject.stableKey}`;
}
function semanticFactsAreComparable(
  baseline: ConformanceFactV1,
  current: ConformanceFactV1,
): boolean {
  return (
    baseline.semanticComparison.coverage === "complete" &&
    current.semanticComparison.coverage === "complete" &&
    baseline.semanticComparison.basis === current.semanticComparison.basis
  );
}

function sourceIds(
  request: ConformanceEvaluationRequestV1,
  layer: ConformanceViewLayerV1,
): string[] {
  return uniqueSorted(
    request.layers
      .find((candidate) => candidate.layer === layer)
      ?.sources.map((source) => source.sourceId) ?? [],
  );
}

function factDifference(
  request: ConformanceEvaluationRequestV1,
  layer: ConformanceViewLayerV1,
  draft: Omit<
    DifferenceDraft,
    | "environmentId"
    | "layer"
    | "remediation"
    | "solutionRevisionId"
    | "sourceIds"
  >,
): ConformanceDifferenceV1 {
  return difference({
    ...draft,
    environmentId: request.environment.environmentId,
    layer,
    remediation: { automatic: false, disposition: "review-required" },
    solutionRevisionId: request.evaluatedSolutionRevision.id,
    sourceIds: uniqueSorted([
      ...sourceIds(request, layer),
      ...(draft.comparedWithLayer === undefined
        ? []
        : sourceIds(request, draft.comparedWithLayer)),
    ]),
  });
}

function compareLayerFacts(
  request: ConformanceEvaluationRequestV1,
  layer: ConformanceViewLayerV1,
  baselineLayer: ConformanceViewLayerV1,
): ConformanceDifferenceV1[] {
  const current = request.layers.find((candidate) => candidate.layer === layer);
  const baseline = request.layers.find(
    (candidate) => candidate.layer === baselineLayer,
  );
  if (
    current === undefined ||
    baseline === undefined ||
    current.availability !== "available" ||
    baseline.availability !== "available"
  ) {
    return [];
  }
  if (
    layerQuality(request, current).freshness !== "current" ||
    layerQuality(request, baseline).freshness !== "current"
  ) {
    return [];
  }
  const output: ConformanceDifferenceV1[] = [];
  const baselineByKey = new Map<string, ConformanceFactV1>(
    baseline.facts.map(
      (fact) =>
        [`${fact.subject.kind}:\u0000${fact.subject.stableKey}`, fact] as const,
    ),
  );
  const currentByKey = new Map<string, ConformanceFactV1>(
    current.facts.map(
      (fact) =>
        [`${fact.subject.kind}:\u0000${fact.subject.stableKey}`, fact] as const,
    ),
  );
  const generatedLayer = request.layers.find(
    ({ layer }) => layer === "generated",
  );
  const generatedLayerIsComparable =
    generatedLayer?.availability === "available" &&
    layerQuality(request, generatedLayer).freshness === "current";
  const generatedByKey = new Map<string, ConformanceFactV1>(
    (generatedLayerIsComparable ? generatedLayer.facts : []).map(
      (fact) =>
        [`${fact.subject.kind}:\u0000${fact.subject.stableKey}`, fact] as const,
    ),
  );

  for (const currentFact of current.facts) {
    const factKey = `${currentFact.subject.kind}:\u0000${currentFact.subject.stableKey}`;
    const before = baselineByKey.get(factKey);
    const evidenceIds = uniqueSorted(currentFact.evidenceIds);

    if (
      layer === "imported" &&
      currentFact.subject.kind === "repository-file" &&
      currentFact.extensionPoint
    )
      continue;

    if (
      layer === "imported" &&
      currentFact.subject.kind === "repository-file" &&
      !currentFact.extensionPoint
    ) {
      if (!generatedLayerIsComparable) continue;
      const generatedFact = generatedByKey.get(factKey);
      if (generatedFact !== undefined) {
        if (generatedFact.semanticDigest !== currentFact.semanticDigest) {
          output.push(
            factDifference(request, layer, {
              comparedWithLayer: "generated",
              evidenceIds,
              kind: "generated-drift-from-source",
              severity: "error",
              subject: currentFact.subject,
              summary: `${subjectSummary(currentFact)} differs from the independently verified generated-manifest checksum.`,
            }),
          );
        }
        continue;
      }
    }

    if (
      layer === "imported" &&
      currentFact.repositoryFileState !== undefined &&
      !currentFact.extensionPoint
    ) {
      if (currentFact.repositoryFileState === "generated-file-drift") {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: "generated",
            evidenceIds,
            kind: "generated-drift-from-source",
            severity: "error",
            subject: currentFact.subject,
            summary: `${subjectSummary(currentFact)} differs from the reviewed generated-file checksum.`,
          }),
        );
        continue;
      }
    }

    if (
      layer === "current-drift" &&
      currentFact.driftClassification !== undefined
    ) {
      const kind = currentDriftKind(currentFact);
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind,
          severity:
            kind === "permission-drift"
              ? "security-error"
              : kind === "application-binding-drift"
                ? "error"
                : kind === "network-drift" &&
                    currentFact.publicExposure === "public"
                  ? "security-error"
                  : "warning",
          subject: currentFact.subject,
          summary: `${subjectSummary(currentFact)} is explicitly classified as ${currentFact.driftClassification}.`,
        }),
      );
      continue;
    }

    if (layer === "planned" && currentFact.operation !== "none") {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind: `plan-${currentFact.operation}` as
            "plan-create" | "plan-update" | "plan-delete" | "plan-replace",
          severity:
            currentFact.operation === "delete" ||
            currentFact.operation === "replace"
              ? "warning"
              : "information",
          subject: currentFact.subject,
          summary: `The sanitized plan classifies ${subjectSummary(currentFact)} as ${currentFact.operation}.`,
        }),
      );
    }
    const beforePermissionKeys = new Set(
      before?.iamPermissions.map(
        (permission) =>
          `${permission.effect}:${permission.actionDigest}:${permission.resourceDigest}`,
      ) ?? [],
    );
    const currentPermissionKeys = new Set(
      currentFact.iamPermissions.map(
        (permission) =>
          `${permission.effect}:${permission.actionDigest}:${permission.resourceDigest}`,
      ),
    );
    const permissionExpanded =
      before !== undefined &&
      [...currentPermissionKeys].some((key) => !beforePermissionKeys.has(key));
    const permissionReduced =
      before !== undefined &&
      [...beforePermissionKeys].some((key) => !currentPermissionKeys.has(key));
    if (permissionExpanded || currentFact.iamAccess === "expanded") {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind: "iam-expansion",
          severity: "security-error",
          subject: currentFact.subject,
          summary: `IAM access expands for ${subjectSummary(currentFact)}.`,
        }),
      );
    }
    if (permissionReduced || currentFact.iamAccess === "reduced") {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind: "iam-reduction",
          severity: "warning",
          subject: currentFact.subject,
          summary: `IAM access is reduced for ${subjectSummary(currentFact)}.`,
        }),
      );
    }
    if (
      currentFact.management === "external" ||
      currentFact.management === "unmanaged"
    ) {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind: "external-unmanaged-resource",
          severity: "warning",
          subject: currentFact.subject,
          summary: `${subjectSummary(currentFact)} is ${currentFact.management} evidence.`,
        }),
      );
    }
    if (applicationBindingDiffers(before, currentFact)) {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind:
            layer === "current-drift"
              ? "application-binding-drift"
              : "application-contract-binding-mismatch",
          severity: "error",
          subject: currentFact.subject,
          summary: `Application contract or artifact binding differs for ${subjectSummary(currentFact)}.`,
        }),
      );
    }

    if (before === undefined) {
      if (
        layer === "planned" &&
        currentFact.subject.kind === "network-exposure" &&
        currentFact.publicExposure !== "unknown"
      ) {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: baselineLayer,
            evidenceIds,
            kind: "network-public-exposure-change",
            severity:
              currentFact.publicExposure === "public"
                ? "security-error"
                : "warning",
            subject: currentFact.subject,
            summary: `Network exposure changes for ${subjectSummary(currentFact)}.`,
          }),
        );
      } else if (layer === "current-drift") {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: baselineLayer,
            evidenceIds,
            kind:
              currentFact.management === "unmanaged"
                ? "unmanaged-resource-drift"
                : "unknown-drift",
            severity: "warning",
            subject: currentFact.subject,
            summary: `${subjectSummary(currentFact)} is not safely mapped to the approved deployment baseline.`,
          }),
        );
      } else if (layer === "imported") {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: baselineLayer,
            evidenceIds,
            kind: "observed-but-not-designed",
            severity: "warning",
            subject: currentFact.subject,
            summary: `${subjectSummary(currentFact)} is observed but not present in the approved design.`,
          }),
        );
      } else if (
        layer === "generated" &&
        currentFact.subject.kind !== "repository-file" &&
        currentFact.subject.kind !== "iam-policy"
      ) {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: baselineLayer,
            evidenceIds,
            kind: "generated-drift-from-source",
            severity: "error",
            subject: currentFact.subject,
            summary: `${subjectSummary(currentFact)} is generated without an approved source fact.`,
          }),
        );
      }
      continue;
    }

    if (
      layer === "imported" &&
      !currentFact.extensionPoint &&
      before.ownership !== "unknown" &&
      currentFact.ownership !== "unknown" &&
      before.ownership !== currentFact.ownership
    ) {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind: "ownership-import-mismatch",
          severity: "error",
          subject: currentFact.subject,
          summary: `Ownership differs for ${subjectSummary(currentFact)}.`,
        }),
      );
    }

    if (
      before.publicExposure !== "unknown" &&
      currentFact.publicExposure !== "unknown" &&
      before.publicExposure !== currentFact.publicExposure
    ) {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind:
            layer === "current-drift"
              ? "network-drift"
              : "network-public-exposure-change",
          severity:
            currentFact.publicExposure === "public"
              ? "security-error"
              : "warning",
          subject: currentFact.subject,
          summary: `Network exposure changes for ${subjectSummary(currentFact)}.`,
        }),
      );
    }

    if (!semanticFactsAreComparable(before, currentFact)) {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds: uniqueSorted([
            ...before.evidenceIds,
            ...currentFact.evidenceIds,
          ]),
          kind: "unknown-evidence",
          severity: "warning",
          subject: currentFact.subject,
          summary: `${subjectSummary(currentFact)} does not provide a compatible complete semantic comparison basis for ${baselineLayer} evidence.`,
        }),
      );
      continue;
    }

    if (before.semanticDigest === currentFact.semanticDigest) {
      const kind = matchingKind(currentFact);
      if (kind !== undefined && layer !== "current-drift") {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: baselineLayer,
            evidenceIds,
            kind,
            severity: "information",
            subject: currentFact.subject,
            summary: `${subjectSummary(currentFact)} matches the ${baselineLayer} evidence.`,
          }),
        );
      }
      continue;
    }

    if (layer === "current-drift") {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind:
            currentFact.subject.kind === "iam-policy"
              ? "permission-drift"
              : currentFact.subject.kind === "network-exposure"
                ? "network-drift"
                : currentFact.subject.kind === "application-contract"
                  ? "application-binding-drift"
                  : currentFact.management === "managed"
                    ? "managed-drift"
                    : "unknown-drift",
          severity:
            currentFact.subject.kind === "iam-policy" ||
            currentFact.publicExposure === "public"
              ? "security-error"
              : "warning",
          subject: currentFact.subject,
          summary: `${subjectSummary(currentFact)} differs from the approved deployment baseline.`,
        }),
      );
    } else if (!currentFact.extensionPoint) {
      output.push(
        factDifference(request, layer, {
          comparedWithLayer: baselineLayer,
          evidenceIds,
          kind: mismatchKind(layer, currentFact),
          severity: "error",
          subject: currentFact.subject,
          summary: `${subjectSummary(currentFact)} differs from the ${baselineLayer} evidence.`,
        }),
      );
    }
  }

  if (
    current.completeness === "complete" &&
    baseline.completeness === "complete" &&
    layer !== "current-drift"
  ) {
    for (const before of baseline.facts) {
      if (
        currentByKey.has(
          `${before.subject.kind}:\u0000${before.subject.stableKey}`,
        )
      ) {
        continue;
      }
      const kind = missingKind(layer);
      if (kind !== undefined) {
        output.push(
          factDifference(request, layer, {
            comparedWithLayer: baselineLayer,
            evidenceIds: before.evidenceIds,
            kind,
            severity: layer === "generated" ? "error" : "warning",
            subject: before.subject,
            summary: `${subjectSummary(before)} is designed but missing from ${layer} evidence.`,
          }),
        );
      }
    }
  }
  return output;
}

function layerQuality(
  request: ConformanceEvaluationRequestV1,
  layer: ConformanceEvaluationRequestV1["layers"][number],
) {
  const lastVerifiedAt = layer.verifiedAt;
  const exactRule = request.stalenessPolicy.rules.find(
    (candidate) =>
      candidate.environmentType === request.environment.environmentType &&
      candidate.evidenceType === layer.evidenceType,
  );
  const rule =
    exactRule ??
    request.stalenessPolicy.rules.find(
      (candidate) =>
        candidate.environmentType === "any" &&
        candidate.evidenceType === layer.evidenceType,
    );
  const computedExpiry =
    rule?.expiration.kind === "max-age" && lastVerifiedAt !== undefined
      ? utcTimestampSchema.parse(
          new Date(
            Date.parse(lastVerifiedAt) + rule.expiration.maxAgeSeconds * 1_000,
          ).toISOString(),
        )
      : undefined;
  const expiresAt = layer.explicitExpiresAt ?? computedExpiry;
  const revisionChanged =
    request.currentSolutionRevision.id !==
      request.evaluatedSolutionRevision.id ||
    request.currentSolutionRevision.digest !==
      request.evaluatedSolutionRevision.digest;
  const freshnessReasons: ConformanceReportV1["layers"][number]["quality"]["freshnessReasons"][number][] =
    [];
  let invalid = false;
  let expired = false;
  let stale = false;

  if (layer.availability === "unavailable") {
    invalid = true;
    freshnessReasons.push("evidence-unavailable");
  } else {
    if (layer.integrity === "invalid") {
      invalid = true;
      freshnessReasons.push("source-integrity-invalid");
    } else if (layer.integrity === "unknown") {
      invalid = true;
      freshnessReasons.push("source-integrity-unknown");
    }
    if (
      layer.boundSolutionRevision?.id !==
        request.evaluatedSolutionRevision.id ||
      layer.boundSolutionRevision.digest !==
        request.evaluatedSolutionRevision.digest
    ) {
      invalid = true;
      freshnessReasons.push("solution-revision-mismatch");
    }
    if (revisionChanged && rule?.invalidatedByNewerRevision === true) {
      invalid = true;
      freshnessReasons.push("newer-solution-revision");
    }
    if (rule === undefined) {
      invalid = true;
      freshnessReasons.push("policy-rule-missing");
    } else if (
      rule.expiration.kind === "explicit-expiry-required" &&
      layer.explicitExpiresAt === undefined
    ) {
      invalid = true;
      freshnessReasons.push("explicit-expiry-required");
    }
    if (
      layer.explicitExpiresAt !== undefined &&
      Date.parse(layer.explicitExpiresAt) <= Date.parse(request.evaluatedAt)
    ) {
      expired = true;
      freshnessReasons.push("explicit-expiry-reached");
    } else if (
      rule?.expiration.kind === "max-age" &&
      computedExpiry !== undefined &&
      Date.parse(computedExpiry) <= Date.parse(request.evaluatedAt)
    ) {
      stale = true;
      freshnessReasons.push("policy-max-age-reached");
    }
    if (layer.declaredFreshness === "stale") {
      stale = true;
      freshnessReasons.push("source-declared-stale");
    }
  }

  const freshness = invalid
    ? ("invalid" as const)
    : expired
      ? ("expired" as const)
      : stale
        ? ("stale" as const)
        : ("current" as const);
  return {
    completeness: layer.completeness,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    freshness,
    freshnessReasons: uniqueSorted(freshnessReasons),
    ...(lastVerifiedAt === undefined ? {} : { lastVerifiedAt }),
  };
}

function qualityDifferences(
  request: ConformanceEvaluationRequestV1,
  layers: ConformanceReportV1["layers"],
): ConformanceDifferenceV1[] {
  return layers.flatMap((layer) => {
    const evidenceIds = layer.evidenceIds;
    const layerSourceIds = layer.sources.map((source) => source.sourceId);
    const output: ConformanceDifferenceV1[] = [];
    if (layer.quality.completeness === "partial") {
      output.push(
        difference({
          environmentId: request.environment.environmentId,
          evidenceIds,
          kind: "partial-evidence",
          layer: layer.layer,
          remediation: { automatic: false, disposition: "review-required" },
          severity: "warning",
          solutionRevisionId: request.evaluatedSolutionRevision.id,
          sourceIds: layerSourceIds,
          summary: `${layer.layer} evidence is partial and cannot imply complete inventory.`,
        }),
      );
    } else if (layer.quality.completeness === "unknown") {
      output.push(
        difference({
          environmentId: request.environment.environmentId,
          evidenceIds,
          kind: "unknown-evidence",
          layer: layer.layer,
          remediation: { automatic: false, disposition: "review-required" },
          severity: "warning",
          solutionRevisionId: request.evaluatedSolutionRevision.id,
          sourceIds: layerSourceIds,
          summary: `${layer.layer} evidence completeness is unknown.`,
        }),
      );
    }
    if (layer.quality.freshness !== "current") {
      output.push(
        difference({
          environmentId: request.environment.environmentId,
          evidenceIds,
          kind:
            layer.quality.freshness === "stale"
              ? "stale-evidence"
              : layer.quality.freshness === "expired"
                ? "expired-evidence"
                : "invalid-evidence",
          layer: layer.layer,
          remediation: { automatic: false, disposition: "review-required" },
          severity: layer.quality.freshness === "stale" ? "warning" : "error",
          solutionRevisionId: request.evaluatedSolutionRevision.id,
          sourceIds: layerSourceIds,
          summary: `${layer.layer} evidence is not currently valid.`,
        }),
      );
    }
    return output;
  });
}

function issueSource(layer: ConformanceViewLayerV1) {
  return layer === "imported"
    ? ("repository-import-mismatch" as const)
    : layer === "planned"
      ? ("cloud-plan-change-set" as const)
      : layer === "deployed"
        ? ("deployment-smoke-integration" as const)
        : layer === "current-drift"
          ? ("deployed-drift" as const)
          : layer === "generated"
            ? ("compiler-parser-diagnostic" as const)
            : ("provider-architecture-validation" as const);
}

function closureLevel(layer: ConformanceViewLayerV1) {
  return layer === "imported"
    ? ({ kind: "repository-conformance", rank: 8 } as const)
    : layer === "planned"
      ? ({ kind: "cloud-plan-change-set", rank: 6 } as const)
      : layer === "deployed"
        ? ({ kind: "deployment-smoke-integration", rank: 7 } as const)
        : layer === "current-drift"
          ? ({ kind: "deployed-drift", rank: 9 } as const)
          : layer === "generated"
            ? ({ kind: "deterministic-target-compilation", rank: 3 } as const)
            : ({ kind: "structural-validity", rank: 1 } as const);
}

function affected(
  differenceValue: ConformanceDifferenceV1,
  request: ConformanceEvaluationRequestV1,
) {
  const references: unknown[] = [
    {
      kind: "solution-revision",
      solutionRevisionId: request.evaluatedSolutionRevision.id,
    },
  ];
  const mapped = differenceValue.subject?.mappedReference;
  if (mapped !== undefined) {
    references.push(mapped);
  }
  if (
    differenceValue.layer === "planned" ||
    differenceValue.layer === "deployed" ||
    differenceValue.layer === "current-drift"
  ) {
    references.push({
      environmentId: request.environment.environmentId,
      kind: "environment",
    });
  }
  differenceValue.evidenceIds.forEach((evidenceId) => {
    references.push({ evidenceId, kind: "evidence" });
  });
  return references;
}

function issueProvenanceSourceDigests(sourceDigests: readonly string[]) {
  const normalized = uniqueSorted(sourceDigests);
  return normalized.length <= CONFORMANCE_ISSUE_DIRECT_SOURCE_DIGEST_LIMIT
    ? normalized
    : [
        hashCanonicalValue({
          contractVersion: 1,
          kind: "cloudmarkup.conformance-issue-source-set",
          sourceDigests: normalized,
        }),
      ];
}
function issueCategory(differenceValue: ConformanceDifferenceV1) {
  if (
    differenceValue.kind === "iam-expansion" ||
    differenceValue.kind === "iam-reduction" ||
    differenceValue.kind === "permission-drift" ||
    differenceValue.kind === "network-drift" ||
    differenceValue.kind === "network-public-exposure-change"
  ) {
    return "security" as const;
  }
  if (differenceValue.kind === "ownership-import-mismatch") {
    return "source-ownership" as const;
  }
  if (differenceValue.layer === "imported") {
    return "repository-conformance" as const;
  }
  if (differenceValue.layer === "generated") return "generation" as const;
  if (differenceValue.layer === "current-drift") return "drift" as const;
  if (differenceValue.layer === "deployed") return "deployment" as const;
  return "verification" as const;
}

function buildIssue(
  request: ConformanceEvaluationRequestV1,
  differenceValue: ConformanceDifferenceV1,
): ActiveIssueV1 {
  const issueId = stableId("conformance-issue", {
    differenceDigest: differenceValue.differenceDigest,
    environmentId: request.environment.environmentId,
    solutionRevisionId: request.evaluatedSolutionRevision.id,
  });
  const sourceDigests = request.layers
    .flatMap((layer) => layer.sources)
    .filter((source) => differenceValue.sourceIds.includes(source.sourceId))
    .map((source) => source.digest);
  const draft = activeIssueV1Schema.parse({
    affected: affected(differenceValue, request),
    category: issueCategory(differenceValue),
    closureRequirements: [
      {
        description:
          "Re-evaluate the exact layer with current, matching, passing Evidence.",
        evidenceCheckId: `cloudmarkup.conformance.${differenceValue.layer}`,
        evidenceLevel: closureLevel(differenceValue.layer),
      },
    ],
    contractVersion: 1,
    currentRecordDigest: ZERO_DIGEST,
    id: issueId,
    lifecycle: { state: "current" },
    provenance: {
      actor: {
        kind: "deterministic-tool",
        tool: request.evaluator,
      },
      createdAt: request.evaluatedAt,
      inputDigests: uniqueSorted([
        differenceValue.differenceDigest,
        request.evaluatedSolutionRevision.digest,
        ...issueProvenanceSourceDigests(sourceDigests),
      ]),
    },
    recordVersion: 1,
    severity:
      differenceValue.severity === "security-error"
        ? "security-error"
        : differenceValue.severity === "error"
          ? "error"
          : differenceValue.severity === "information"
            ? "recommendation"
            : "warning",
    solutionRevisionId: request.evaluatedSolutionRevision.id,
    source: issueSource(differenceValue.layer),
    sourceRecordId: differenceValue.differenceId,
    summary: differenceValue.summary,
    technicalDetail:
      "The deterministic conformance projection found a source-linked difference. Review reconciliation; no source, plan, deployment, or cloud state was changed.",
  });
  return activeIssueV1Schema.parse({
    ...draft,
    currentRecordDigest: getActiveIssueRecordHash(draft),
  });
}

function isIssueDifference(value: ConformanceDifferenceV1): boolean {
  return !value.kind.startsWith("matching-");
}

export function getConformanceReportDigestV1(input: unknown) {
  const parsed = conformanceReportV1Schema.parse(input);
  const { reportDigest, ...basis } = parsed;
  void reportDigest;
  return hashCanonicalValue({
    contractVersion: 1,
    kind: "cloudmarkup.conformance-report-digest",
    report: basis,
  });
}

/**
 * Stable semantic state used to bind a previously returned report while a
 * trusted clock advances. The wall-clock observation and its derived envelope
 * identifiers are deliberately excluded; all six projections, provenance,
 * freshness results, differences, issues, and authority fields remain bound.
 */
export function getConformanceReportStateDigestV1(input: unknown) {
  const parsed = conformanceReportV1Schema.parse(input);
  const {
    evaluatedAt: _evaluatedAt,
    reportDigest: _reportDigest,
    reportId: _reportId,
    ...state
  } = parsed;
  void _evaluatedAt;
  void _reportDigest;
  void _reportId;
  return hashCanonicalValue({
    contractVersion: 1,
    kind: "cloudmarkup.conformance-report-state-digest",
    state,
  });
}

export function evaluateConformanceV1(input: unknown): ConformanceReportV1 {
  const request = conformanceEvaluationRequestV1Schema.parse(input);
  const layers = request.layers
    .map((layer) => ({
      authority:
        layer.layer === "designed"
          ? ("approved-design" as const)
          : ("evidence-only" as const),
      availability: layer.availability,
      ...(layer.boundSolutionRevision === undefined
        ? {}
        : { boundSolutionRevision: layer.boundSolutionRevision }),
      evidenceIds: uniqueSorted(layer.evidenceIds),
      evidenceType: layer.evidenceType,
      ...(layer.environmentId === undefined
        ? {}
        : { environmentId: layer.environmentId }),
      facts: layer.facts
        .map(normalizedFact)
        .sort((left, right) => compareUtf16(left.factId, right.factId)),
      layer: layer.layer,
      quality: layerQuality(request, layer),
      sources: [...layer.sources].sort((left, right) =>
        compareUtf16(
          `${left.kind}:${left.sourceId}:${left.digest}`,
          `${right.kind}:${right.sourceId}:${right.digest}`,
        ),
      ),
    }))
    .sort((left, right) => {
      const order: readonly ConformanceViewLayerV1[] = [
        "designed",
        "imported",
        "generated",
        "planned",
        "deployed",
        "current-drift",
      ];
      return order.indexOf(left.layer) - order.indexOf(right.layer);
    });

  const allDifferences = [
    ...qualityDifferences(request, layers),
    ...compareLayerFacts(request, "imported", "designed"),
    ...compareLayerFacts(request, "generated", "designed"),
    ...compareLayerFacts(request, "planned", "designed"),
    ...compareLayerFacts(request, "deployed", "designed"),
    ...compareLayerFacts(request, "current-drift", "deployed"),
  ];
  const byDigest = new Map(
    allDifferences.map((entry) => [entry.differenceDigest, entry] as const),
  );
  const differences = [...byDigest.values()].sort((left, right) =>
    compareUtf16(
      `${left.layer}:${left.kind}:${left.differenceId}`,
      `${right.layer}:${right.kind}:${right.differenceId}`,
    ),
  );
  const issues = differences
    .filter(isIssueDifference)
    .map((entry) => buildIssue(request, entry))
    .sort((left, right) => compareUtf16(left.id, right.id));
  const policy = {
    ...request.stalenessPolicy,
    rules: [...request.stalenessPolicy.rules].sort((left, right) =>
      compareUtf16(
        `${left.evidenceType}:${left.environmentType}`,
        `${right.evidenceType}:${right.environmentType}`,
      ),
    ),
  };
  const allSources = layers.flatMap((layer) => layer.sources);
  const base = {
    comparisonAuthority: "non-mutating-multi-layer" as const,
    contractVersion: 1 as const,
    currentSolutionRevision: request.currentSolutionRevision,
    differences,
    environment: request.environment,
    evaluatedAt: request.evaluatedAt,
    evaluatedSolutionRevision: request.evaluatedSolutionRevision,
    evaluator: request.evaluator,
    issues,
    kind: "cloudmarkup.continuous-conformance-report" as const,
    layers,
    mutationPolicy: "review-only-no-auto-remediation" as const,
    projectId: request.projectId,
    provenance: {
      inputDigests: uniqueSorted([
        request.currentSolutionRevision.digest,
        request.evaluatedSolutionRevision.digest,
        ...allSources.map((source) => source.digest),
      ]),
      sourceIds: uniqueSorted(allSources.map((source) => source.sourceId)),
    },
    stalenessPolicy: {
      digest: hashCanonicalValue(policy),
      id: request.stalenessPolicy.policyId,
    },
  };
  const reportId = stableId("conformance-report", base);
  const withId = { ...base, reportId };
  const report = conformanceReportV1Schema.parse({
    ...withId,
    reportDigest: hashCanonicalValue({
      contractVersion: 1,
      kind: "cloudmarkup.conformance-report-digest",
      report: withId,
    }),
  });
  return report;
}
