import {
  conformanceLayerInputV1Schema,
  type ConformanceLayerInputV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import {
  conformanceDriftClassV1Schema,
  conformancePlanExpectedV1Schema,
  normalizedConformancePlanV1Schema,
  normalizedDeploymentConformanceV1Schema,
  normalizedDriftConformanceV1Schema,
  verifyConformancePlanV1,
  type NormalizedConformancePlanV1,
} from "./conformance-evidence.js";
import { canonicalJson, sha256 } from "./security.js";

type NormalizedPlanChangeV1 = NormalizedConformancePlanV1["changes"][number];

function stableId(prefix: string, digest: string): string {
  return prefix + "." + digest.slice("sha256:".length, 31);
}

function applicationBinding(
  value: NormalizedPlanChangeV1["applicationBinding"],
) {
  return value === "match"
    ? ("matching" as const)
    : value === "mismatch"
      ? ("mismatch" as const)
      : value === "unknown"
        ? ("unknown" as const)
        : ("not-applicable" as const);
}

function iamAccess(value: NormalizedPlanChangeV1["iam"]) {
  return value === "expansion"
    ? ("expanded" as const)
    : value === "reduction"
      ? ("reduced" as const)
      : value === "none"
        ? ("equivalent" as const)
        : ("unknown" as const);
}

function publicExposure(value: NormalizedPlanChangeV1["network"]) {
  return value === "public-exposure-increase"
    ? ("public" as const)
    : value === "public-exposure-decrease" ||
        value === "private-boundary-change"
      ? ("private" as const)
      : value === "none"
        ? ("none" as const)
        : ("unknown" as const);
}

function ownership(value: NormalizedPlanChangeV1["ownership"]) {
  return value === "managed"
    ? ("generated" as const)
    : value === "user-extension"
      ? ("user-extension" as const)
      : value === "external"
        ? ("imported" as const)
        : value === "unmanaged"
          ? ("unmanaged" as const)
          : ("unknown" as const);
}

function management(value: NormalizedPlanChangeV1["ownership"]) {
  return value === "external"
    ? ("external" as const)
    : value === "unmanaged"
      ? ("unmanaged" as const)
      : value === "unknown"
        ? ("unknown" as const)
        : ("managed" as const);
}

function planResourceFact(
  change: NormalizedPlanChangeV1,
  evidenceId: string,
  sourceId: string,
) {
  const stableKey =
    change.graphId ??
    change.deploymentKey ??
    stableId("planned-resource", change.resourceIdentityDigest);
  return {
    applicationBinding: "not-applicable" as const,
    evidenceIds: [evidenceId],
    extensionPoint: change.ownership === "user-extension",
    factId: stableId(
      "planned-resource-fact",
      sha256(
        canonicalJson({
          resourceIdentityDigest: change.resourceIdentityDigest,
          stableKey,
        }),
      ),
    ),
    iamAccess: "not-applicable" as const,
    iamPermissions: [],
    layer: "planned" as const,
    management: management(change.ownership),
    operation: change.action,
    ownership: ownership(change.ownership),
    publicExposure: "unknown" as const,
    semanticComparison: {
      basis: "opaque" as const,
      contractVersion: 1 as const,
      coverage: "operation-only" as const,
    },
    semanticDigest: sha256(
      canonicalJson({
        ownership: change.ownership,
        resourceIdentityDigest: change.resourceIdentityDigest,
        resourceType: change.resourceType,
      }),
    ),
    sourceIds: [sourceId],
    sourceLocations: [],
    subject: {
      kind:
        change.ownership === "external"
          ? ("external-resource" as const)
          : ("resource" as const),
      ...(change.graphId === undefined
        ? {}
        : {
            mappedReference: {
              kind: "architecture-node" as const,
              nodeId: change.graphId,
            },
          }),
      stableKey,
    },
  };
}

function planSignalFact(
  base: ReturnType<typeof planResourceFact>,
  change: NormalizedPlanChangeV1,
  kind: "application-contract" | "iam-policy" | "network-exposure",
  suffix: "application" | "iam" | "network",
  value: unknown,
) {
  const stableKey = `${base.subject.stableKey}.${suffix}`;
  return {
    ...base,
    factId: stableId(
      `planned-${suffix}-fact`,
      sha256(
        canonicalJson({
          resourceIdentityDigest: change.resourceIdentityDigest,
          stableKey,
          value,
        }),
      ),
    ),
    operation: "none" as const,
    semanticDigest: sha256(
      canonicalJson({
        resourceIdentityDigest: change.resourceIdentityDigest,
        signal: suffix,
        value,
      }),
    ),
    subject: { ...base.subject, kind, stableKey },
  };
}

function planFacts(
  change: NormalizedPlanChangeV1,
  evidenceId: string,
  sourceId: string,
) {
  const base = planResourceFact(change, evidenceId, sourceId);
  return [
    base,
    ...(change.applicationBinding === "not-applicable"
      ? []
      : [
          {
            ...planSignalFact(
              base,
              change,
              "application-contract",
              "application",
              change.applicationBinding,
            ),
            applicationBinding: applicationBinding(change.applicationBinding),
            applicationBindingDigest: sha256(
              canonicalJson(change.applicationBinding),
            ),
          },
        ]),
    ...(change.iam === "expansion" || change.iam === "reduction"
      ? [
          {
            ...planSignalFact(base, change, "iam-policy", "iam", change.iam),
            iamAccess: iamAccess(change.iam),
          },
        ]
      : []),
    ...(change.network !== "none" && change.network !== "unknown"
      ? [
          {
            ...planSignalFact(
              base,
              change,
              "network-exposure",
              "network",
              change.network,
            ),
            publicExposure: publicExposure(change.network),
          },
        ]
      : []),
  ];
}

export function projectNormalizedPlanToConformanceLayerInputV1(input: {
  readonly evidenceId: string;
  readonly expected: unknown;
  readonly plan: unknown;
}): ConformanceLayerInputV1 {
  const plan = normalizedConformancePlanV1Schema.parse(input.plan);
  const expected = conformancePlanExpectedV1Schema.parse(input.expected);
  const verification = verifyConformancePlanV1(plan, expected);
  const integrityValid =
    verification.valid ||
    verification.issues.every(
      ({ code }) => code === "CONFORMANCE_PLAN_EXPIRED",
    );
  const sourceId = stableId("planned-source", plan.evidenceChecksum);
  const expired = Date.parse(plan.expiresAt) <= Date.parse(expected.now);
  return conformanceLayerInputV1Schema.parse({
    availability: "available",
    boundSolutionRevision: plan.solutionRevision,
    completeness: plan.scope,
    declaredFreshness: expired ? "stale" : "current",
    evidenceIds: [input.evidenceId],
    evidenceType: "cloud-plan-change-set",
    environmentId: plan.environmentId,
    explicitExpiresAt: plan.expiresAt,
    facts: plan.changes.flatMap((change) =>
      planFacts(change, input.evidenceId, sourceId),
    ),
    integrity: integrityValid ? "verified" : "invalid",
    ...(integrityValid
      ? {}
      : {
          invalidReason:
            "Sanitized plan evidence failed exact identity, checksum, tool, or expiry verification.",
        }),
    layer: "planned",
    sources: [
      {
        digest: plan.evidenceChecksum,
        kind:
          plan.target === "terraform"
            ? "terraform-plan"
            : "cloudformation-change-set",
        observedAt: plan.createdAt,
        repositoryCommit: plan.commitSha,
        solutionRevisionId: plan.solutionRevision.id,
        sourceId,
        tool: plan.tool,
      },
    ],
    verifiedAt: expected.now,
  });
}

function checksumIsValid(
  value: Record<string, unknown> & { readonly evidenceChecksum: string },
): boolean {
  const { evidenceChecksum, ...projection } = value;
  return sha256(canonicalJson(projection)) === evidenceChecksum;
}

export function projectNormalizedDeploymentToConformanceLayerInputV1(input: {
  readonly deployment: unknown;
  readonly evidenceId: string;
}): ConformanceLayerInputV1 {
  const deployment = normalizedDeploymentConformanceV1Schema.parse(
    input.deployment,
  );
  const sourceId = stableId("deployed-source", deployment.evidenceChecksum);
  const valid =
    checksumIsValid(deployment) && deployment.completeness !== "invalid";
  const smokeSourceId =
    deployment.smoke.evidenceDigest === undefined
      ? undefined
      : stableId("smoke-source", deployment.smoke.evidenceDigest);
  return conformanceLayerInputV1Schema.parse({
    availability: "available",
    boundSolutionRevision: deployment.solutionRevision,
    completeness:
      deployment.artifactAttestations.length === 0 ? "unknown" : "partial",
    declaredFreshness: "current",
    evidenceIds: [input.evidenceId],
    evidenceType: "deployment-smoke-integration",
    environmentId: deployment.environmentId,
    facts: deployment.artifactAttestations.map((attestation) => {
      return {
        applicationBinding: "matching",
        applicationBindingDigest: attestation.applicationBindingDigest,
        applicationContractDigest: attestation.applicationContractDigest,
        evidenceIds: [input.evidenceId],
        extensionPoint: false,
        factId: stableId("deployed-fact", attestation.attestationDigest),
        iamAccess: "not-applicable",
        iamPermissions: [],
        layer: "deployed",
        management: "managed",
        operation: "none",
        ownership: "generated",
        publicExposure: "unknown",
        semanticComparison: {
          basis: "artifact-binding" as const,
          contractVersion: 1 as const,
          coverage: "complete" as const,
        },
        semanticDigest: attestation.applicationBindingDigest,
        sourceIds: [sourceId],
        sourceLocations: [],
        subject: {
          kind: "artifact",
          mappedReference: {
            artifactId: attestation.artifactId,
            kind: "artifact",
          },
          stableKey: `application:${attestation.workloadId}`,
        },
      };
    }),
    integrity: valid ? "verified" : "invalid",
    ...(valid
      ? {}
      : {
          invalidReason:
            "Deployment evidence failed exact saved-plan, artifact, workflow, or checksum verification.",
        }),
    layer: "deployed",
    sources: [
      {
        digest: deployment.evidenceChecksum,
        kind: "deployment-attestation",
        observedAt: deployment.observedAt,
        repositoryCommit: deployment.commitSha,
        solutionRevisionId: deployment.solutionRevision.id,
        sourceId,
      },
      ...(smokeSourceId === undefined ||
      deployment.smoke.evidenceDigest === undefined
        ? []
        : [
            {
              digest: deployment.smoke.evidenceDigest,
              kind: "smoke-integration-result" as const,
              observedAt: deployment.observedAt,
              solutionRevisionId: deployment.solutionRevision.id,
              sourceId: smokeSourceId,
            },
          ]),
    ],
    verifiedAt: deployment.observedAt,
  });
}

function driftSubjectKind(
  classification: z.output<typeof conformanceDriftClassV1Schema>,
) {
  return classification === "permission-drift"
    ? ("iam-policy" as const)
    : classification === "network-drift"
      ? ("network-exposure" as const)
      : classification === "application-binding-drift"
        ? ("application-contract" as const)
        : classification === "external-resource"
          ? ("external-resource" as const)
          : ("resource" as const);
}

export function projectNormalizedDriftToConformanceLayerInputV1(input: {
  readonly drift: unknown;
  readonly evidenceId: string;
}): ConformanceLayerInputV1 {
  const drift = normalizedDriftConformanceV1Schema.parse(input.drift);
  const sourceId = stableId("drift-source", drift.evidenceChecksum);
  const valid = checksumIsValid(drift) && drift.scope !== "invalid";
  return conformanceLayerInputV1Schema.parse({
    availability: "available",
    boundSolutionRevision: drift.solutionRevision,
    completeness: drift.scope === "invalid" ? "partial" : drift.scope,
    declaredFreshness: drift.staleness,
    evidenceIds: [input.evidenceId],
    evidenceType: "read-only-drift",
    environmentId: drift.environmentId,
    explicitExpiresAt: drift.validUntil,
    facts: drift.changes.map((change) => {
      const stableKey =
        change.graphId ??
        change.deploymentKey ??
        stableId("drift-resource", change.resourceIdentityDigest);
      return {
        applicationBinding:
          change.classification === "application-binding-drift"
            ? "mismatch"
            : change.classification === "unknown"
              ? "unknown"
              : "not-applicable",
        driftClassification: change.classification,
        evidenceIds: [input.evidenceId],
        extensionPoint: change.ownership === "user-extension",
        factId: stableId(
          "drift-fact",
          sha256(canonicalJson({ change, stableKey })),
        ),
        iamAccess:
          change.classification === "permission-drift"
            ? "unknown"
            : "not-applicable",
        iamPermissions: [],
        layer: "current-drift",
        management: management(change.ownership),
        operation: change.action,
        ownership: ownership(change.ownership),
        publicExposure:
          change.classification === "network-drift" ? "unknown" : "none",
        semanticDigest: sha256(canonicalJson(change)),
        sourceIds: [sourceId],
        sourceLocations: [],
        semanticComparison: {
          basis: "opaque" as const,
          contractVersion: 1 as const,
          coverage: "partial" as const,
        },
        subject: {
          kind: driftSubjectKind(change.classification),
          ...(change.graphId === undefined
            ? {}
            : {
                mappedReference: {
                  kind: "architecture-node" as const,
                  nodeId: change.graphId,
                },
              }),
          stableKey,
        },
      };
    }),
    integrity: valid ? "verified" : "invalid",
    ...(valid
      ? {}
      : {
          invalidReason:
            "Read-only drift evidence failed baseline, scope, or checksum verification.",
        }),
    layer: "current-drift",
    sources: [
      {
        digest: drift.evidenceChecksum,
        kind: "read-only-drift-result",
        observedAt: drift.observedAt,
        solutionRevisionId: drift.solutionRevision.id,
        sourceId,
      },
    ],
    verifiedAt: drift.observedAt,
  });
}
