import {
  assertApplicationReachabilityBindingResultV1,
  canonicalJson,
  sha256Digest,
  type ApplicationReachabilityBindingResultV1,
  type ApplicationReachabilityCapabilityV1,
  type ApplicationReachabilityPathV1,
} from "@cloudmarkup/application-generator";

export const APPLICATION_REACHABILITY_EVIDENCE_CONFIGURATION_ID =
  "cloudmarkup.application-reachability-evidence-configuration" as const;
export const APPLICATION_REACHABILITY_EVIDENCE_CONFIGURATION_VERSION =
  "1.0.0" as const;

export interface ApplicationReachabilityEvidenceCheckV1 {
  readonly checkId: string;
  readonly capability: ApplicationReachabilityCapabilityV1;
  readonly expectedPath: ApplicationReachabilityPathV1;
  readonly observation: "indirect-through-application-contract";
  readonly workloadId: string;
}

export interface ApplicationReachabilityEvidenceWorkloadV1 {
  readonly workloadId: string;
  readonly readiness: "blocked" | "ready-for-runtime-observation";
  readonly smokeProfile:
    | "application-contract"
    | "application-contract-with-private-reachability"
    | "application-contract-with-reviewed-egress";
  readonly checks: readonly ApplicationReachabilityEvidenceCheckV1[];
}

export interface ApplicationReachabilityEvidenceConfigurationArtifactV1 {
  readonly contractVersion: 1;
  readonly kind: "cloudmarkup.application-reachability-evidence-configuration";
  readonly configuration: {
    readonly id: typeof APPLICATION_REACHABILITY_EVIDENCE_CONFIGURATION_ID;
    readonly version: typeof APPLICATION_REACHABILITY_EVIDENCE_CONFIGURATION_VERSION;
  };
  readonly buildExecution: {
    readonly network: "deny";
    readonly sourceInspectionForReachability: "deny";
  };
  readonly expectedEvidence: {
    readonly kind: "deployment-smoke-integration";
    readonly minimumLevel: 7;
    readonly authority: "customer-runtime-observation-required";
  };
  readonly reachabilityArtifactDigest: `sha256:${string}`;
  readonly solutionRevisionId: string;
  readonly workloads: readonly ApplicationReachabilityEvidenceWorkloadV1[];
}

export interface ApplicationReachabilityEvidenceConfigurationResultV1 {
  readonly contractVersion: 1;
  readonly artifact: ApplicationReachabilityEvidenceConfigurationArtifactV1;
  readonly artifactDigest: `sha256:${string}`;
}

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Creates a data-only handoff for later customer-owned smoke/Evidence work.
 * This does not run a probe, grant network access, or create Evidence.
 */
export function configureApplicationReachabilityEvidenceV1(
  reachability: ApplicationReachabilityBindingResultV1,
): ApplicationReachabilityEvidenceConfigurationResultV1 {
  assertApplicationReachabilityBindingResultV1(reachability);
  const workloads = reachability.artifact.workloads
    .map((workload): ApplicationReachabilityEvidenceWorkloadV1 => {
      const hasUnresolved = workload.assumptions.some(
        (assumption) => assumption.state === "unresolved",
      );
      const hasPrivatePath = workload.assumptions.some(
        (assumption) => assumption.expectedPath === "private-service-endpoint",
      );
      const hasReviewedEgress = workload.assumptions.some(
        (assumption) => assumption.expectedPath === "reviewed-public-egress",
      );
      return {
        workloadId: workload.workloadId,
        readiness: hasUnresolved ? "blocked" : "ready-for-runtime-observation",
        smokeProfile: hasPrivatePath
          ? "application-contract-with-private-reachability"
          : hasReviewedEgress
            ? "application-contract-with-reviewed-egress"
            : "application-contract",
        checks: workload.assumptions
          .map((assumption) => ({
            checkId: `reachability_check_${sha256Digest(
              canonicalJson({
                assumptionId: assumption.assumptionId,
                capability: assumption.capability,
                expectedPath: assumption.expectedPath,
                workloadId: workload.workloadId,
              }),
            ).slice(7, 31)}`,
            capability: assumption.capability,
            expectedPath: assumption.expectedPath,
            observation: "indirect-through-application-contract" as const,
            workloadId: workload.workloadId,
          }))
          .sort((left, right) => compareUtf16(left.checkId, right.checkId)),
      };
    })
    .sort((left, right) => compareUtf16(left.workloadId, right.workloadId));
  const artifact: ApplicationReachabilityEvidenceConfigurationArtifactV1 = {
    contractVersion: 1,
    kind: "cloudmarkup.application-reachability-evidence-configuration",
    configuration: {
      id: APPLICATION_REACHABILITY_EVIDENCE_CONFIGURATION_ID,
      version: APPLICATION_REACHABILITY_EVIDENCE_CONFIGURATION_VERSION,
    },
    buildExecution: {
      network: "deny",
      sourceInspectionForReachability: "deny",
    },
    expectedEvidence: {
      kind: "deployment-smoke-integration",
      minimumLevel: 7,
      authority: "customer-runtime-observation-required",
    },
    reachabilityArtifactDigest: reachability.artifactDigest,
    solutionRevisionId: reachability.artifact.solutionRevisionId,
    workloads,
  };
  return {
    contractVersion: 1,
    artifact,
    artifactDigest: sha256Digest(canonicalJson(artifact)),
  };
}
