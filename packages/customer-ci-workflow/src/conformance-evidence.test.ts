import { describe, expect, it } from "vitest";

import {
  normalizeCloudFormationConformancePlanV1,
  normalizeDeploymentConformanceV1,
  normalizeDriftConformanceV1,
  normalizeTerraformConformancePlanV1,
  sanitizeCloudFormationChangeSetV1,
  verifyConformancePlanV1,
} from "./conformance-evidence.js";
import {
  projectNormalizedDeploymentToConformanceLayerInputV1,
  projectNormalizedDriftToConformanceLayerInputV1,
  projectNormalizedPlanToConformanceLayerInputV1,
} from "./conformance-layer-adapter.js";
import { canonicalJson, sha256 } from "./security.js";

const digest = (value: string) => sha256(`fixture:${value}`);
const commitSha = "a".repeat(40);
const solutionRevision = {
  digest: digest("solution-revision"),
  id: "solution_revision_conformance",
};
const tool = {
  digest: digest("tool"),
  id: "cloudmarkup.test-conformance-tool",
  version: "1.0.0",
};
const createdAt = "2026-08-29T10:00:00.000Z";
const expiresAt = "2026-08-29T11:00:00.000Z";

function semantics(input?: {
  readonly applicationBinding?: "match" | "mismatch";
  readonly iam?: "none" | "expansion" | "reduction";
  readonly network?:
    "none" | "public-exposure-increase" | "public-exposure-decrease";
}) {
  return {
    applicationBinding: input?.applicationBinding ?? "not-applicable",
    iam: input?.iam ?? "none",
    network: input?.network ?? "none",
  } as const;
}

describe("target-neutral conformance plan adapters", () => {
  it("preserves Terraform v1 structural actions while adding safe exact semantic bindings", () => {
    const mapped = digest("terraform-address-mapped");
    const unknown = digest("terraform-address-unmapped");
    const input = {
      bindings: [
        {
          addressDigest: mapped,
          confidence: "exact" as const,
          deploymentKey: "image_processor",
          graphId: "node.image_processor",
          ownership: "managed" as const,
          semantics: semantics({
            applicationBinding: "mismatch",
            iam: "expansion",
            network: "public-exposure-increase",
          }),
        },
      ],
      contractVersion: 1 as const,
      metadata: {
        backendConfigDigest: digest("backend"),
        commitSha,
        createdAt,
        environmentId: "environment.dev",
        expiresAt,
        generatedManifestDigest: digest("generated-manifest"),
        planChecksum: digest("terraform-plan"),
        scope: "partial" as const,
        solutionRevision,
        target: "terraform" as const,
        tool,
        workspace: "dev",
      },
      plan: {
        formatVersion: "1.2",
        resourceChanges: [
          {
            actions: ["update" as const],
            address: mapped,
            mode: "managed" as const,
            providerName: "registry.terraform.io/hashicorp/aws" as const,
            type: "aws_lambda_function",
          },
          {
            actions: ["delete" as const, "create" as const],
            address: unknown,
            mode: "managed" as const,
            providerName: "registry.terraform.io/hashicorp/aws" as const,
            type: "aws_s3_bucket",
          },
          {
            actions: ["no-op" as const],
            address: digest("no-op"),
            mode: "managed" as const,
            providerName: "registry.terraform.io/hashicorp/aws" as const,
            type: "aws_sqs_queue",
          },
        ],
        terraformVersion: "1.13.0",
      },
    };
    input.metadata.planChecksum = sha256(canonicalJson(input.plan));
    const first = normalizeTerraformConformancePlanV1(input);
    const second = normalizeTerraformConformancePlanV1(structuredClone(input));
    expect(second).toEqual(first);
    expect(first.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "update",
          applicationBinding: "mismatch",
          deploymentKey: "image_processor",
          graphId: "node.image_processor",
          iam: "expansion",
          network: "public-exposure-increase",
          ownership: "managed",
          resourceIdentityDigest: mapped,
        }),
        expect.objectContaining({
          action: "replace",
          applicationBinding: "unknown",
          confidence: "unknown",
          ownership: "unmanaged",
          resourceIdentityDigest: unknown,
        }),
      ]),
    );
    expect(first.changes).toHaveLength(2);
    const layer = projectNormalizedPlanToConformanceLayerInputV1({
      evidenceId: "evidence.plan.terraform",
      expected: {
        backendConfigDigest: digest("backend"),
        commitSha,
        evidenceChecksum: first.evidenceChecksum,
        environmentId: "environment.dev",
        generatedManifestDigest: digest("generated-manifest"),
        now: "2026-08-29T10:30:00.000Z",
        planChecksum: input.metadata.planChecksum,
        solutionRevision,
        target: "terraform",
        tool,
        workspace: "dev",
      },
      plan: first,
    });
    expect(layer).toMatchObject({
      completeness: "partial",
      evidenceType: "cloud-plan-change-set",
      integrity: "verified",
      layer: "planned",
    });
    expect(layer.facts.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining(["replace", "update"]),
    );

    const tampered = structuredClone(input);
    tampered.metadata.planChecksum = digest("matching-but-arbitrary");
    expect(() => normalizeTerraformConformancePlanV1(tampered)).toThrow(
      "Terraform plan checksum does not match the sanitized representation.",
    );

    const originalBinding = input.bindings[0];
    if (originalBinding === undefined) {
      throw new Error("Terraform fixture must include one semantic binding.");
    }
    const duplicateBinding = structuredClone(input);
    duplicateBinding.bindings.push({
      ...originalBinding,
      semantics: semantics({ iam: "reduction" }),
    });
    expect(() => normalizeTerraformConformancePlanV1(duplicateBinding)).toThrow(
      "Terraform semantic binding identities must be unique.",
    );

    const orphanBinding = structuredClone(input);
    orphanBinding.bindings.push({
      ...originalBinding,
      addressDigest: digest("terraform-address-orphan"),
    });
    expect(() => normalizeTerraformConformancePlanV1(orphanBinding)).toThrow(
      "Terraform semantic bindings must reference a sanitized resource change.",
    );

    const noOpBinding = structuredClone(input);
    noOpBinding.bindings.push({
      ...originalBinding,
      addressDigest: digest("no-op"),
    });
    expect(() =>
      normalizeTerraformConformancePlanV1(noOpBinding),
    ).not.toThrow();
  });

  it("sanitizes CloudFormation change sets and never retains stack IDs, logical IDs, or values", () => {
    const raw = {
      ChangeSetId:
        "arn:aws:cloudformation:us-east-1:111122223333:changeSet/reviewed/1234",
      Changes: [
        {
          ResourceChange: {
            Action: "Add" as const,
            LogicalResourceId: "CreatedFunction",
            ResourceType: "AWS::Lambda::Function",
          },
        },
        {
          ResourceChange: {
            Action: "Modify" as const,
            LogicalResourceId: "ReplacedTable",
            Replacement: "Conditional" as const,
            ResourceType: "AWS::DynamoDB::Table",
          },
        },
        {
          ResourceChange: {
            Action: "Remove" as const,
            LogicalResourceId: "DeletedQueue",
            ResourceType: "AWS::SQS::Queue",
          },
        },
      ],
      StackId:
        "arn:aws:cloudformation:us-east-1:111122223333:stack/reviewed/5678",
    };
    const sanitized = sanitizeCloudFormationChangeSetV1(raw);
    expect(sanitized.changes.map(({ action }) => action).sort()).toEqual([
      "create",
      "delete",
      "replace",
    ]);
    const encoded = JSON.stringify(sanitized);
    expect(encoded).not.toContain("111122223333");
    expect(encoded).not.toContain("CreatedFunction");
    expect(encoded).not.toContain("ReplacedTable");
    expect(encoded).not.toContain("DeletedQueue");
    expect(encoded).not.toContain("arn:aws");
  });

  it("normalizes and verifies an exact CloudFormation change-set identity and rejects revision, checksum, stack, and expiry drift", () => {
    const changeSet = sanitizeCloudFormationChangeSetV1({
      ChangeSetId: "change-set-reviewed",
      Changes: [
        {
          ResourceChange: {
            Action: "Modify",
            LogicalResourceId: "ProcessorFunction",
            Replacement: "False",
            ResourceType: "AWS::Lambda::Function",
          },
        },
      ],
      StackId: "stack-reviewed",
    });
    const planInput = {
      bindings: [
        {
          confidence: "exact",
          deploymentKey: "processor_function",
          graphId: "node.processor",
          logicalResourceIdDigest:
            changeSet.changes[0]?.logicalResourceIdDigest,
          ownership: "managed",
          semantics: semantics({ applicationBinding: "match" }),
        },
      ],
      changeSet,
      contractVersion: 1 as const,
      metadata: {
        changeSetIdentityDigest: changeSet.changeSetIdentityDigest,
        commitSha,
        createdAt,
        environmentId: "environment.dev",
        expiresAt,
        generatedManifestDigest: digest("generated-manifest"),
        planChecksum: changeSet.sourceChecksum,
        scope: "complete" as const,
        solutionRevision,
        stackIdentityDigest: changeSet.stackIdentityDigest,
        target: "cloudformation" as const,
        tool,
      },
    };
    const plan = normalizeCloudFormationConformancePlanV1(planInput);
    const tampered = structuredClone(planInput);
    tampered.metadata.planChecksum = digest("matching-but-arbitrary");
    expect(() => normalizeCloudFormationConformancePlanV1(tampered)).toThrow(
      "CloudFormation plan checksum does not match the sanitized change-set representation.",
    );
    const originalBinding = planInput.bindings[0];
    if (originalBinding === undefined) {
      throw new Error(
        "CloudFormation fixture must include one semantic binding.",
      );
    }
    const duplicateBinding = structuredClone(planInput);
    duplicateBinding.bindings.push({
      ...originalBinding,
      semantics: semantics({ network: "public-exposure-increase" }),
    });
    expect(() =>
      normalizeCloudFormationConformancePlanV1(duplicateBinding),
    ).toThrow("CloudFormation semantic binding identities must be unique.");

    const orphanBinding = structuredClone(planInput);
    orphanBinding.bindings.push({
      ...originalBinding,
      logicalResourceIdDigest: digest("cloudformation-logical-id-orphan"),
    });
    expect(() =>
      normalizeCloudFormationConformancePlanV1(orphanBinding),
    ).toThrow(
      "CloudFormation semantic bindings must reference a sanitized resource change.",
    );
    const expected = {
      changeSetIdentityDigest: changeSet.changeSetIdentityDigest,
      commitSha,
      evidenceChecksum: plan.evidenceChecksum,
      environmentId: "environment.dev",
      generatedManifestDigest: digest("generated-manifest"),
      now: "2026-08-29T10:30:00.000Z",
      planChecksum: changeSet.sourceChecksum,
      solutionRevision,
      stackIdentityDigest: changeSet.stackIdentityDigest,
      target: "cloudformation" as const,
      tool,
    };
    expect(verifyConformancePlanV1(plan, expected)).toEqual({
      issues: [],
      valid: true,
    });
    expect(
      projectNormalizedPlanToConformanceLayerInputV1({
        evidenceId: "evidence.plan.cloudformation",
        expected,
        plan,
      }),
    ).toMatchObject({
      completeness: "partial",
      integrity: "verified",
      layer: "planned",
      sources: [expect.objectContaining({ kind: "cloudformation-change-set" })],
    });
    const expiredExpected = { ...expected, now: expiresAt };
    expect(verifyConformancePlanV1(plan, expiredExpected)).toEqual({
      issues: [
        {
          code: "CONFORMANCE_PLAN_EXPIRED",
          field: "expiresAt",
          severity: "error",
        },
      ],
      valid: false,
    });
    const expiredLayer = projectNormalizedPlanToConformanceLayerInputV1({
      evidenceId: "evidence.plan.cloudformation.expired",
      expected: expiredExpected,
      plan,
    });
    expect(expiredLayer).toMatchObject({
      declaredFreshness: "stale",
      integrity: "verified",
      layer: "planned",
    });
    expect(expiredLayer).not.toHaveProperty("invalidReason");
    const changed = structuredClone(expected);
    changed.solutionRevision.digest = digest("new-revision");
    changed.stackIdentityDigest = digest("other-stack");
    changed.planChecksum = digest("other-change-set");
    changed.now = expiresAt;
    const invalid = verifyConformancePlanV1(plan, changed);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CONFORMANCE_PLAN_CHECKSUM_MISMATCH",
        "CONFORMANCE_PLAN_EXPIRED",
        "CONFORMANCE_SOLUTION_REVISION_MISMATCH",
        "CONFORMANCE_STACK_IDENTITY_DIGEST_MISMATCH",
      ]),
    );
  });
});

describe("deployment and drift conformance adapters", () => {
  const baseDeployment = {
    approvedPlanEvidenceChecksum: digest("approved-plan-evidence"),
    artifactAttestations: [
      {
        applicationBindingDigest: digest("application-binding"),
        applicationContractDigest: digest("application-contract"),
        artifactDigest: digest("lambda-zip"),
        artifactId: "artifact.lambda.notes",
        attestationDigest: digest("lambda-attestation"),
        workloadId: "workload_notes_api",
      },
    ],
    commitSha,
    contractVersion: 1 as const,
    environmentId: "environment.dev",
    executedPlanEvidenceChecksum: digest("approved-plan-evidence"),
    generatedManifestDigest: digest("generated-manifest"),
    observedAt: "2026-08-29T10:40:00.000Z",
    planIdentityDigest: digest("saved-plan-identity"),
    smoke: {
      evidenceDigest: digest("smoke-evidence"),
      state: "passed" as const,
    },
    solutionRevision,
    target: "terraform" as const,
    workflow: {
      runAttempt: 1,
      runId: "1234",
      workflowDigest: digest("deploy-workflow"),
    },
  };
  const expected = {
    approvedPlanEvidenceChecksum: digest("approved-plan-evidence"),
    commitSha,
    environmentId: "environment.dev",
    expectedArtifactBindings: [
      {
        applicationBindingDigest: digest("application-binding"),
        applicationContractDigest: digest("application-contract"),
        artifactDigest: digest("lambda-zip"),
        artifactId: "artifact.lambda.notes",
        workloadId: "workload_notes_api",
      },
    ],
    generatedManifestDigest: digest("generated-manifest"),
    planIdentityDigest: digest("saved-plan-identity"),
    solutionRevision,
    target: "terraform" as const,
    workflow: baseDeployment.workflow,
  };

  it("marks exact deployment evidence complete, missing smoke partial, and any identity mismatch invalid", () => {
    const complete = normalizeDeploymentConformanceV1(baseDeployment, expected);
    expect(complete.completeness).toBe("complete");
    expect(complete.issues).toEqual([]);
    expect(
      projectNormalizedDeploymentToConformanceLayerInputV1({
        deployment: complete,
        evidenceId: "evidence.deployment",
      }),
    ).toMatchObject({
      completeness: "partial",
      facts: [
        {
          applicationBinding: "matching",
          semanticDigest: digest("application-binding"),
          subject: { stableKey: "application:workload_notes_api" },
        },
      ],
      integrity: "verified",
      layer: "deployed",
    });

    const withoutSmoke = {
      ...structuredClone(baseDeployment),
      smoke: { state: "not-run" as const },
    };
    const partial = normalizeDeploymentConformanceV1(withoutSmoke, expected);
    expect(partial.completeness).toBe("partial");
    expect(partial.issues).toContainEqual(
      expect.objectContaining({ code: "CONFORMANCE_DEPLOYMENT_SMOKE_MISSING" }),
    );

    const wrong = structuredClone(baseDeployment);
    wrong.executedPlanEvidenceChecksum = digest("different-plan-evidence");
    wrong.commitSha = "b".repeat(40);
    const invalid = normalizeDeploymentConformanceV1(wrong, expected);
    expect(invalid.completeness).toBe("invalid");
    expect(invalid.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CONFORMANCE_DEPLOYMENT_COMMIT_SHA_MISMATCH",
        "CONFORMANCE_DEPLOYMENT_PLAN_IDENTITY_MISMATCH",
      ]),
    );

    const substitutedArtifact = structuredClone(baseDeployment);
    const [artifactAttestation] = substitutedArtifact.artifactAttestations;
    if (artifactAttestation === undefined) {
      throw new Error("Expected one deployment artifact attestation fixture.");
    }
    artifactAttestation.artifactDigest = digest("substituted-lambda-zip");
    const invalidArtifact = normalizeDeploymentConformanceV1(
      substitutedArtifact,
      expected,
    );
    expect(invalidArtifact.completeness).toBe("invalid");
    expect(invalidArtifact.issues).toContainEqual(
      expect.objectContaining({
        code: "CONFORMANCE_DEPLOYMENT_ARTIFACT_MISMATCH",
      }),
    );
  });

  it("classifies managed, unmanaged, permission, network, application, external, and unknown drift without remediation", () => {
    const baseline = digest("deployment-evidence");
    const classifications = [
      "managed-drift",
      "unmanaged-resource",
      "permission-drift",
      "network-drift",
      "application-binding-drift",
      "external-resource",
      "unknown",
    ] as const;
    const driftInput = {
      baselineDeploymentEvidenceChecksum: baseline,
      changes: classifications.map((classification, index) => ({
        action: classification === "unknown" ? "unknown" : "update",
        classification,
        confidence: classification === "unknown" ? "unknown" : "exact",
        deploymentKey: `resource_${String(index)}`,
        graphId: `node.resource.${String(index)}`,
        ownership:
          classification === "unmanaged-resource"
            ? "unmanaged"
            : classification === "external-resource"
              ? "external"
              : classification === "unknown"
                ? "unknown"
                : "managed",
        resourceIdentityDigest: digest(`drift-${String(index)}`),
      })),
      contractVersion: 1 as const,
      environmentId: "environment.dev",
      observedAt: "2026-08-29T10:45:00.000Z",
      scope: "partial" as const,
      solutionRevision,
      source: "terraform-refresh-only" as const,
      target: "terraform" as const,
      validUntil: "2026-08-29T11:00:00.000Z",
    };
    const expectedDrift = {
      approvedDeploymentEvidenceChecksum: baseline,
      environmentId: "environment.dev",
      solutionRevision,
      target: "terraform" as const,
    };
    const first = normalizeDriftConformanceV1(
      driftInput,
      expectedDrift,
      "2026-08-29T11:00:00.000Z",
    );
    const second = normalizeDriftConformanceV1(
      {
        ...driftInput,
        changes: [...first.changes].reverse(),
      },
      expectedDrift,
      "2026-08-29T11:00:00.000Z",
    );
    expect(second.evidenceChecksum).toBe(first.evidenceChecksum);
    expect(first.changes.map(({ classification }) => classification)).toEqual(
      expect.arrayContaining([...classifications]),
    );
    expect(first.remediation).toBe("none");
    expect(first.scope).toBe("partial");
    expect(first.staleness).toBe("stale");
    expect(canonicalJson(first)).not.toContain("apply");
    const layer = projectNormalizedDriftToConformanceLayerInputV1({
      drift: first,
      evidenceId: "evidence.drift",
    });
    expect(layer).toMatchObject({
      completeness: "partial",
      declaredFreshness: "stale",
      integrity: "verified",
      layer: "current-drift",
    });
    expect(
      new Set(
        layer.facts.map(({ driftClassification }) => driftClassification),
      ),
    ).toEqual(new Set(classifications));

    const arbitraryBaseline = normalizeDriftConformanceV1(
      {
        ...driftInput,
        baselineDeploymentEvidenceChecksum: digest("caller-invented-baseline"),
      },
      expectedDrift,
      "2026-08-29T10:50:00.000Z",
    );
    expect(arbitraryBaseline.scope).toBe("invalid");
    expect(arbitraryBaseline.issues).toContainEqual(
      expect.objectContaining({ code: "CONFORMANCE_DRIFT_BASELINE_MISMATCH" }),
    );

    const wrongEnvironment = normalizeDriftConformanceV1(
      { ...driftInput, environmentId: "environment.other" },
      expectedDrift,
      "2026-08-29T10:50:00.000Z",
    );
    expect(wrongEnvironment.issues).toContainEqual(
      expect.objectContaining({
        code: "CONFORMANCE_DRIFT_ENVIRONMENT_ID_MISMATCH",
      }),
    );
  });
});
