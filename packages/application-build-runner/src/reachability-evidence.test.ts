import {
  APPLICATION_REACHABILITY_CATALOG_BINDING,
  APPLICATION_REACHABILITY_BINDING_DIGEST,
  APPLICATION_REACHABILITY_BINDING_ID,
  APPLICATION_REACHABILITY_BINDING_VERSION,
  canonicalJson,
  sha256Digest,
  type ApplicationReachabilityBindingResultV1,
  type ApplicationReachabilityCapabilityV1,
  type ApplicationReachabilityPathV1,
} from "@cloudmarkup/application-generator";
import { describe, expect, it } from "vitest";

import { configureApplicationReachabilityEvidenceV1 } from "./reachability-evidence.js";

function reachabilityResult(
  expectedPath: ApplicationReachabilityPathV1,
  state: "declared" | "unresolved" = "declared",
): ApplicationReachabilityBindingResultV1 {
  const capability: ApplicationReachabilityCapabilityV1 =
    expectedPath === "private-service-endpoint"
      ? "object-storage-api"
      : "internet-egress";
  const artifact = {
    contractVersion: 1 as const,
    kind: "cloudmarkup.application-reachability-assumptions" as const,
    binding: {
      id: APPLICATION_REACHABILITY_BINDING_ID,
      version: APPLICATION_REACHABILITY_BINDING_VERSION,
      digest: APPLICATION_REACHABILITY_BINDING_DIGEST,
    },
    catalog: {
      id: APPLICATION_REACHABILITY_CATALOG_BINDING.id,
      version: APPLICATION_REACHABILITY_CATALOG_BINDING.version,
      digest: APPLICATION_REACHABILITY_CATALOG_BINDING.digest,
    },
    normalizedSolutionDigest: `sha256:${"2".repeat(64)}` as const,
    solutionRevisionId: "solution_revision_network",
    workloads: [
      {
        workloadId: "workload_notes",
        networkAttachment: "customer-network-interface" as const,
        outboundRequirement:
          expectedPath === "private-service-endpoint"
            ? ("object-storage" as const)
            : ("internet" as const),
        assumptions: [
          {
            assumptionId: "reachability_assumption",
            capability,
            expectedPath,
            state,
            sourceReferences: [
              {
                id: "network_configuration",
                kind: "normalized-configuration" as const,
                path: "$.configuration.values.egressRequirement",
              },
            ],
          },
        ],
        sourceReferences: [
          { id: "workload_notes", kind: "normalized-workload" as const },
        ],
      },
    ],
  };
  return {
    contractVersion: 1,
    artifact,
    artifactDigest: sha256Digest(canonicalJson(artifact)),
  };
}

describe("application reachability Evidence configuration v1", () => {
  it("selects a private-reachability smoke profile without enabling build network access", () => {
    const result = configureApplicationReachabilityEvidenceV1(
      reachabilityResult("private-service-endpoint"),
    );

    expect(result.artifact).toMatchObject({
      buildExecution: {
        network: "deny",
        sourceInspectionForReachability: "deny",
      },
      expectedEvidence: {
        authority: "customer-runtime-observation-required",
        kind: "deployment-smoke-integration",
        minimumLevel: 7,
      },
      workloads: [
        {
          readiness: "ready-for-runtime-observation",
          smokeProfile: "application-contract-with-private-reachability",
          checks: [
            {
              capability: "object-storage-api",
              expectedPath: "private-service-endpoint",
              observation: "indirect-through-application-contract",
            },
          ],
        },
      ],
    });
    expect(result.artifactDigest).toBe(
      sha256Digest(canonicalJson(result.artifact)),
    );
  });

  it("changes the smoke and Evidence binding when reachability changes from endpoint to reviewed egress", () => {
    const endpoint = configureApplicationReachabilityEvidenceV1(
      reachabilityResult("private-service-endpoint"),
    );
    const egress = configureApplicationReachabilityEvidenceV1(
      reachabilityResult("reviewed-public-egress"),
    );

    expect(endpoint.artifact.workloads[0]?.smokeProfile).toBe(
      "application-contract-with-private-reachability",
    );
    expect(egress.artifact.workloads[0]?.smokeProfile).toBe(
      "application-contract-with-reviewed-egress",
    );
    expect(endpoint.artifactDigest).not.toBe(egress.artifactDigest);
  });

  it("blocks operational observation when a required path is unresolved", () => {
    const result = configureApplicationReachabilityEvidenceV1(
      reachabilityResult("private-service-endpoint", "unresolved"),
    );
    expect(result.artifact.workloads[0]).toMatchObject({
      readiness: "blocked",
      smokeProfile: "application-contract-with-private-reachability",
    });
  });

  it("rejects a tampered reachability artifact before configuring downstream checks", () => {
    const valid = reachabilityResult("private-service-endpoint");
    expect(() =>
      configureApplicationReachabilityEvidenceV1({
        ...valid,
        artifactDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow(/failed its exact version or digest binding/i);
  });
});
