import { describe, expect, it } from "vitest";

import type {
  CustomerCiEnvironmentIdV1,
  CustomerCiLifecycleResultV1,
} from "./contracts.js";
import {
  generateCustomerCiWorkflowSetV1,
  validateCustomerCiWorkflowSetV1,
} from "./generator.js";
import { runFakeCustomerCiLifecycleV1 } from "./lifecycle.js";
import {
  analyzeSanitizedTerraformPlanV1,
  sanitizeTerraformPlanV1,
  validatePromotionSequenceV1,
} from "./plan-integrity.js";
import { canonicalJson, sha256 } from "./security.js";
import {
  createCustomerCiWorkflowTestConfigV1,
  createSavedTerraformPlanTestPairV1,
} from "./testing.js";

type SavedPlanPairV1 = ReturnType<typeof createSavedTerraformPlanTestPairV1>;

function savedPlanPairForEnvironment(
  environment: CustomerCiEnvironmentIdV1,
): SavedPlanPairV1 {
  const pair = structuredClone(createSavedTerraformPlanTestPairV1());
  const environmentBindings = {
    artifactName: `cloudmarkup-plan-${environment}`,
    backendConfigDigest: sha256(`${environment}-backend-config`),
    encryptedPlanChecksum: sha256(
      `${environment}-encrypted-saved-terraform-plan`,
    ),
    environment,
    environmentConfigDigest: sha256(`${environment}-environment-config`),
    planChecksum: sha256(`${environment}-saved-terraform-plan`),
    sanitizedPlanChecksum: sha256(`${environment}-sanitized-terraform-plan`),
    semanticAnalysisChecksum: sha256(`${environment}-semantic-plan-analysis`),
    workflowConfigDigest: sha256(`${environment}-workflow-config`),
    workspace: `notes_${environment}`,
  };
  const targetAuthority = {
    ...pair.manifest.targetAuthority,
    deployRoleArnDigest: sha256(`${environment}-deploy-role`),
    driftRoleArnDigest: sha256(`${environment}-drift-role`),
    oidcSubject: `repo:customer-organization@1234567/customer-repository@987654321:environment:cloudmarkup-${environment}`,
    planRoleArnDigest: sha256(`${environment}-plan-role`),
  };
  Object.assign(pair.expected, environmentBindings, { targetAuthority });
  Object.assign(pair.manifest, environmentBindings, { targetAuthority });
  return pair;
}

function runVerifiedLifecycle(
  pair: SavedPlanPairV1,
  promotionPredecessor?: CustomerCiLifecycleResultV1,
): CustomerCiLifecycleResultV1 {
  return runFakeCustomerCiLifecycleV1({
    approval: "approved",
    drift: "clean",
    expected: pair.expected,
    manifest: pair.manifest,
    ...(promotionPredecessor === undefined ? {} : { promotionPredecessor }),
    smoke: "passed",
  });
}

function receiptForStage(
  result: CustomerCiLifecycleResultV1,
  stage: CustomerCiLifecycleResultV1["receipts"][number]["stage"],
): CustomerCiLifecycleResultV1["receipts"][number] {
  const receipt = result.receipts.find(
    (candidate) => candidate.stage === stage,
  );
  if (receipt === undefined) {
    throw new Error(`Expected a ${stage} lifecycle receipt.`);
  }
  return receipt;
}

describe("Prompt 40A fake customer-owned CI/CD lifecycle", () => {
  it("generates, validates, exports, plans, and records an exact fake lifecycle without AWS authority", () => {
    const config = createCustomerCiWorkflowTestConfigV1();
    const workflows = generateCustomerCiWorkflowSetV1(config);
    const validation = validateCustomerCiWorkflowSetV1(config, workflows);
    const workflowFiles = workflows.manifest.files;

    expect(validation).toEqual({ issues: [], valid: true });
    expect(workflowFiles).toHaveLength(5);
    expect(
      workflowFiles.every(({ path }) => path.startsWith(".github/workflows/")),
    ).toBe(true);
    const workflowsByKind = new Map(
      workflowFiles.map(({ content, workflowKind }) => [workflowKind, content]),
    );
    for (const kind of ["validate", "plan", "smoke", "drift"] as const) {
      expect(workflowsByKind.get(kind)).not.toContain("secrets.");
    }
    expect(workflowsByKind.get("deploy")).toContain(
      `secrets.${config.plan.artifactEncryption.privateKeySecretName}`,
    );
    expect(workflowsByKind.get("deploy")?.match(/secrets\./gu)).toHaveLength(1);
    expect(
      workflowFiles.every(
        ({ content }) => !content.includes("pull_request_target"),
      ),
    ).toBe(true);

    const sanitizedPlan = sanitizeTerraformPlanV1({
      format_version: "1.2",
      resource_changes: [
        {
          address: "aws_lambda_function.notes_api",
          change: {
            actions: ["update"],
            after: { password: "must-never-reach-an-artifact" },
          },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_lambda_function",
        },
      ],
      terraform_version: config.terraform.version,
    });
    const analysis = analyzeSanitizedTerraformPlanV1(sanitizedPlan);
    expect(JSON.stringify({ analysis, sanitizedPlan })).not.toContain(
      "must-never-reach-an-artifact",
    );
    expect(analysis.counts.update).toBe(1);

    const pair = createSavedTerraformPlanTestPairV1();
    const lifecycleInput = {
      approval: "approved" as const,
      drift: "clean" as const,
      expected: pair.expected,
      manifest: pair.manifest,
      smoke: "passed" as const,
    };
    const lifecycle = runFakeCustomerCiLifecycleV1(lifecycleInput);
    expect(lifecycle.state).toBe("verified");
    expect(lifecycle.receipts.map(({ stage }) => stage)).toEqual([
      "plan",
      "deploy",
      "smoke",
      "drift",
    ]);
    expect(runFakeCustomerCiLifecycleV1(lifecycleInput)).toEqual(lifecycle);

    expect(
      validatePromotionSequenceV1(
        (["dev", "staging", "production"] as const).map(
          (environment, index) => ({
            approved: true,
            commitSha: pair.manifest.commitSha,
            deploymentReceiptDigest: sha256(
              `environment-deployment-${String(index)}`,
            ),
            environment,
            smokePassed: true,
            smokeReceiptDigest: sha256(`environment-smoke-${String(index)}`),
            planManifestChecksum: sha256(`environment-plan-${String(index)}`),
            ...(index === 0
              ? {}
              : {
                  promotionPredecessorReceiptDigest: sha256(
                    `environment-deployment-${String(index - 1)}`,
                  ),
                  promotionPredecessorSmokeReceiptDigest: sha256(
                    `environment-smoke-${String(index - 1)}`,
                  ),
                }),
            revisionDigest: pair.manifest.solutionRevision.digest,
            revisionId: pair.manifest.solutionRevision.id,
          }),
        ),
      ),
    ).toEqual({ issues: [], valid: true });
  });

  it("derives deterministic staging and production promotion bindings from exact predecessor receipts", () => {
    const devPair = savedPlanPairForEnvironment("dev");
    const dev = runVerifiedLifecycle(devPair);
    const stagingPair = savedPlanPairForEnvironment("staging");
    const staging = runVerifiedLifecycle(stagingPair, dev);
    const productionPair = savedPlanPairForEnvironment("production");
    const production = runVerifiedLifecycle(productionPair, staging);

    expect(dev.state).toBe("verified");
    expect(staging.state).toBe("verified");
    expect(production.state).toBe("verified");

    const devDeployment = receiptForStage(dev, "deploy");
    const devSmoke = receiptForStage(dev, "smoke");
    const stagingPlan = receiptForStage(staging, "plan");
    const stagingDeployment = receiptForStage(staging, "deploy");
    const stagingSmoke = receiptForStage(staging, "smoke");
    const productionPlan = receiptForStage(production, "plan");
    const productionDeployment = receiptForStage(production, "deploy");

    expect(devDeployment).not.toHaveProperty(
      "promotionPredecessorReceiptDigest",
    );
    expect(devDeployment).not.toHaveProperty(
      "promotionPredecessorSmokeReceiptDigest",
    );
    expect(devDeployment.inputDigests).toHaveLength(3);
    expect(stagingDeployment).toMatchObject({
      environment: "staging",
      predecessorReceiptDigest: sha256(canonicalJson(stagingPlan)),
      promotionPredecessorReceiptDigest: sha256(canonicalJson(devDeployment)),
      promotionPredecessorSmokeReceiptDigest: sha256(canonicalJson(devSmoke)),
      status: "passed",
    });
    expect(stagingDeployment.inputDigests.slice(-2)).toEqual([
      sha256(canonicalJson(devDeployment)),
      sha256(canonicalJson(devSmoke)),
    ]);
    expect(productionDeployment).toMatchObject({
      environment: "production",
      predecessorReceiptDigest: sha256(canonicalJson(productionPlan)),
      promotionPredecessorReceiptDigest: sha256(
        canonicalJson(stagingDeployment),
      ),
      promotionPredecessorSmokeReceiptDigest: sha256(
        canonicalJson(stagingSmoke),
      ),
      status: "passed",
    });
    expect(productionDeployment.inputDigests.slice(-2)).toEqual([
      sha256(canonicalJson(stagingDeployment)),
      sha256(canonicalJson(stagingSmoke)),
    ]);

    const blockedStaging = runFakeCustomerCiLifecycleV1({
      approval: "missing",
      drift: "not-run",
      expected: stagingPair.expected,
      manifest: stagingPair.manifest,
      promotionPredecessor: dev,
      smoke: "not-run",
    });
    const blockedStagingDeployment = receiptForStage(blockedStaging, "deploy");
    expect(blockedStagingDeployment.status).toBe("blocked");
    expect(blockedStagingDeployment.inputDigests).toEqual([
      sha256(canonicalJson(stagingPair.manifest)),
      stagingPair.manifest.planChecksum,
      sha256(canonicalJson(stagingPlan)),
      sha256(canonicalJson(devDeployment)),
      sha256(canonicalJson(devSmoke)),
    ]);

    expect(runVerifiedLifecycle(stagingPair, structuredClone(dev))).toEqual(
      staging,
    );
    expect(
      runVerifiedLifecycle(productionPair, structuredClone(staging)),
    ).toEqual(production);
  });

  it("rejects missing, ungrounded, incomplete, mismatched, and wrong-stage promotion predecessors", () => {
    const devPair = savedPlanPairForEnvironment("dev");
    const dev = runVerifiedLifecycle(devPair);
    const stagingPair = savedPlanPairForEnvironment("staging");
    const productionPair = savedPlanPairForEnvironment("production");

    const missing = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: stagingPair.expected,
      manifest: stagingPair.manifest,
      smoke: "passed",
    });
    expect(missing.state).toBe("deployment-blocked");
    expect(missing.receipts.map(({ stage }) => stage)).toEqual(["plan"]);
    expect(missing.issues).toEqual([
      expect.objectContaining({ code: "PROMOTION_PREDECESSOR_REQUIRED" }),
    ]);

    const directDigestClaims = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: stagingPair.expected,
      manifest: stagingPair.manifest,
      promotionPredecessorReceiptDigest: sha256(
        canonicalJson(receiptForStage(dev, "deploy")),
      ),
      promotionPredecessorSmokeReceiptDigest: sha256(
        canonicalJson(receiptForStage(dev, "smoke")),
      ),
      smoke: "passed",
    } as Parameters<typeof runFakeCustomerCiLifecycleV1>[0] &
      Record<string, unknown>);
    expect(directDigestClaims.state).toBe("deployment-blocked");
    expect(directDigestClaims.issues).toEqual([
      expect.objectContaining({ code: "PROMOTION_PREDECESSOR_REQUIRED" }),
    ]);

    const incomplete = structuredClone(dev);
    incomplete.receipts = incomplete.receipts.filter(
      ({ stage }) => stage !== "smoke",
    );
    const incompleteResult = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: stagingPair.expected,
      manifest: stagingPair.manifest,
      promotionPredecessor: incomplete,
      smoke: "passed",
    });
    expect(incompleteResult.state).toBe("deployment-blocked");
    expect(incompleteResult.issues).toEqual([
      expect.objectContaining({ code: "PROMOTION_PREDECESSOR_INCOMPLETE" }),
    ]);

    const mismatched = structuredClone(dev);
    receiptForStage(mismatched, "smoke").predecessorReceiptDigest = sha256(
      "mismatched-deployment-receipt",
    );
    const mismatchResult = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: stagingPair.expected,
      manifest: stagingPair.manifest,
      promotionPredecessor: mismatched,
      smoke: "passed",
    });
    expect(mismatchResult.state).toBe("deployment-blocked");
    expect(mismatchResult.issues).toEqual([
      expect.objectContaining({
        code: "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
      }),
    ]);

    const malformedPlanOutputs = structuredClone(dev);
    const malformedPlanReceipt = receiptForStage(malformedPlanOutputs, "plan");
    malformedPlanReceipt.outputDigests =
      malformedPlanReceipt.outputDigests.slice(0, 3);
    const malformedPlanReceiptDigest = sha256(
      canonicalJson(malformedPlanReceipt),
    );
    const reboundDeployment = receiptForStage(malformedPlanOutputs, "deploy");
    reboundDeployment.predecessorReceiptDigest = malformedPlanReceiptDigest;
    reboundDeployment.inputDigests[2] = malformedPlanReceiptDigest;
    const reboundDeploymentDigest = sha256(canonicalJson(reboundDeployment));
    const reboundSmoke = receiptForStage(malformedPlanOutputs, "smoke");
    reboundSmoke.predecessorReceiptDigest = reboundDeploymentDigest;
    reboundSmoke.inputDigests[0] = reboundDeploymentDigest;
    const malformedPlanResult = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: stagingPair.expected,
      manifest: stagingPair.manifest,
      promotionPredecessor: malformedPlanOutputs,
      smoke: "passed",
    });
    expect(malformedPlanResult.issues).toEqual([
      expect.objectContaining({
        code: "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
      }),
    ]);

    const wrongStageResult = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: productionPair.expected,
      manifest: productionPair.manifest,
      promotionPredecessor: dev,
      smoke: "passed",
    });
    expect(wrongStageResult.state).toBe("deployment-blocked");
    expect(wrongStageResult.issues).toEqual([
      expect.objectContaining({
        code: "PROMOTION_PREDECESSOR_SOURCE_MISMATCH",
      }),
    ]);

    const unexpectedDevResult = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected: devPair.expected,
      manifest: devPair.manifest,
      promotionPredecessor: dev,
      smoke: "passed",
    });
    expect(unexpectedDevResult.state).toBe("deployment-blocked");
    expect(unexpectedDevResult.issues).toEqual([
      expect.objectContaining({ code: "PROMOTION_PREDECESSOR_UNEXPECTED" }),
    ]);
  });

  it("fails closed before a fake deployment when an exact binding changes", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const expected = structuredClone(pair.expected);
    expected.commitSha = "abcdef0123456789abcdef0123456789abcdef01";

    const lifecycle = runFakeCustomerCiLifecycleV1({
      approval: "approved",
      drift: "not-run",
      expected,
      manifest: pair.manifest,
      smoke: "not-run",
    });

    expect(lifecycle.state).toBe("deployment-blocked");
    expect(lifecycle.receipts).toEqual([
      expect.objectContaining({ stage: "plan", status: "failed" }),
    ]);
    expect(lifecycle.evidence[0]?.checks[0]?.status).toBe("failed");
    expect(lifecycle.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SAVED_PLAN_COMMIT_SHA_MISMATCH" }),
      ]),
    );
  });
});
