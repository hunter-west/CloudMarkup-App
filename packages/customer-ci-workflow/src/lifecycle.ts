import {
  evidenceRecordV1Schema,
  type EvidenceRecordV1,
} from "@cloudmarkup/schemas";

import {
  customerCiLifecycleResultV1Schema,
  savedTerraformPlanExpectedV1Schema,
  savedTerraformPlanManifestV1Schema,
  type CustomerCiEnvironmentIdV1,
  type CustomerCiIssueV1,
  type CustomerCiLifecycleResultV1,
} from "./contracts.js";
import { validateSavedTerraformPlanV1 } from "./plan-integrity.js";
import { canonicalJson, safeIssue, sha256 } from "./security.js";

type StageReceiptV1 = CustomerCiLifecycleResultV1["receipts"][number];
type DigestV1 = StageReceiptV1["inputDigests"][number];
type TimestampV1 = StageReceiptV1["createdAt"];
type RevisionReferenceV1 = StageReceiptV1["solutionRevision"];

function environmentType(
  environment: CustomerCiEnvironmentIdV1,
): "development" | "staging" | "production" {
  return environment === "dev" ? "development" : environment;
}

function evidence(
  input: Readonly<{
    artifactDigests: readonly DigestV1[];
    checkId: string;
    commitSha: string;
    createdAt: TimestampV1;
    environment: CustomerCiEnvironmentIdV1;
    kind: "plan" | "smoke" | "drift";
    passed: boolean;
    revisionId: string;
    summary: string;
    validUntil?: TimestampV1;
  }>,
): EvidenceRecordV1 {
  const rank = input.kind === "plan" ? 6 : input.kind === "drift" ? 9 : 7;
  const levelKind =
    rank === 6
      ? "cloud-plan-change-set"
      : rank === 9
        ? "deployed-drift"
        : "deployment-smoke-integration";
  const ciIdentity = `github:fake/customer:commit:${input.commitSha}`;
  const artifactBytes = canonicalJson(input.artifactDigests);
  return evidenceRecordV1Schema.parse({
    artifacts: input.artifactDigests.map((digest) => ({
      digest,
      mediaType: "application/json",
      sizeBytes: artifactBytes.length,
    })),
    checks: [
      {
        artifactDigests: input.artifactDigests,
        checkId: input.checkId,
        issueIds: [],
        ...(input.passed
          ? {}
          : {
              redactedFailure:
                "The customer-owned fake lifecycle reported a bounded failure; no raw response or credential data was retained.",
            }),
        status: input.passed ? "passed" : "failed",
        summary: input.summary,
      },
    ],
    ciIdentity,
    contractVersion: 1,
    environment: {
      environmentId: input.environment,
      environmentType: environmentType(input.environment),
    },
    id: `evidence-${input.kind}-${input.environment}-${input.commitSha.slice(0, 12)}`,
    layer: rank === 6 ? "planned" : "deployed",
    level: { kind: levelKind, rank },
    models: [],
    provenance: {
      actor: { ciIdentity, kind: "ci" },
      createdAt: input.createdAt,
      inputDigests: input.artifactDigests,
    },
    solutionRevisionId: input.revisionId,
    staleness:
      input.validUntil === undefined
        ? { assessedAt: input.createdAt, state: "current" }
        : {
            assessedAt: input.createdAt,
            state: "current",
            validUntil: input.validUntil,
          },
    tools: [
      {
        id: "cloudmarkup.customer-ci-workflow",
        version: "1.0.0",
      },
    ],
  });
}

function stageReceipt(
  input: Readonly<{
    commitSha: string;
    createdAt: TimestampV1;
    environment: CustomerCiEnvironmentIdV1;
    inputDigests: readonly DigestV1[];
    outputDigests: readonly DigestV1[];
    predecessorReceiptDigest?: DigestV1;
    promotionPredecessorReceiptDigest?: DigestV1;
    promotionPredecessorSmokeReceiptDigest?: DigestV1;
    revision: RevisionReferenceV1;
    stage: "plan" | "deploy" | "smoke" | "drift";
    targetAuthorityDigest: DigestV1;
    status: "passed" | "failed" | "blocked";
  }>,
): StageReceiptV1 {
  const identity = sha256(
    canonicalJson({
      commitSha: input.commitSha,
      environment: input.environment,
      inputDigests: input.inputDigests,
      outputDigests: input.outputDigests,
      predecessorReceiptDigest: input.predecessorReceiptDigest ?? null,
      promotionPredecessorReceiptDigest:
        input.promotionPredecessorReceiptDigest ?? null,
      promotionPredecessorSmokeReceiptDigest:
        input.promotionPredecessorSmokeReceiptDigest ?? null,
      revision: input.revision,
      stage: input.stage,
      targetAuthorityDigest: input.targetAuthorityDigest,
    }),
  ).slice(7, 23);
  return {
    commitSha: input.commitSha,
    contractVersion: 1,
    createdAt: input.createdAt,
    environment: input.environment,
    idempotencyKey: `customer-ci-${input.stage}-${identity}`,
    inputDigests: [...input.inputDigests],
    kind: "cloudmarkup.customer-ci-stage-receipt",
    outputDigests: [...input.outputDigests],
    ...(input.predecessorReceiptDigest === undefined
      ? {}
      : { predecessorReceiptDigest: input.predecessorReceiptDigest }),
    ...(input.promotionPredecessorReceiptDigest === undefined
      ? {}
      : {
          promotionPredecessorReceiptDigest:
            input.promotionPredecessorReceiptDigest,
        }),
    ...(input.promotionPredecessorSmokeReceiptDigest === undefined
      ? {}
      : {
          promotionPredecessorSmokeReceiptDigest:
            input.promotionPredecessorSmokeReceiptDigest,
        }),
    receiptId: `receipt-${input.stage}-${input.environment}-${identity}`,
    targetAuthorityDigest: input.targetAuthorityDigest,
    solutionRevision: input.revision,
    stage: input.stage,
    status: input.status,
  };
}

function receiptDigest(receipt: StageReceiptV1): DigestV1 {
  return sha256(canonicalJson(receipt));
}

type PromotionPredecessorValidationV1 =
  | Readonly<{
      deploymentReceiptDigest?: DigestV1;
      smokeReceiptDigest?: DigestV1;
      valid: true;
    }>
  | Readonly<{
      issue: CustomerCiIssueV1;
      valid: false;
    }>;

function promotionIssue(
  code: string,
  message: string,
): PromotionPredecessorValidationV1 {
  return { issue: safeIssue(code, message), valid: false };
}

function validatePromotionPredecessor(
  input: Readonly<{
    commitSha: string;
    environment: CustomerCiEnvironmentIdV1;
    predecessor?: CustomerCiLifecycleResultV1;
    revision: RevisionReferenceV1;
  }>,
): PromotionPredecessorValidationV1 {
  if (input.environment === "dev") {
    return input.predecessor === undefined
      ? { valid: true }
      : promotionIssue(
          "PROMOTION_PREDECESSOR_UNEXPECTED",
          "Development cannot name a predecessor deployment or smoke receipt.",
        );
  }
  if (input.predecessor === undefined) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_REQUIRED",
      input.environment === "staging"
        ? "Staging requires the exact passing development deployment and smoke receipts."
        : "Production requires the exact passing staging deployment and smoke receipts.",
    );
  }

  const parsed = customerCiLifecycleResultV1Schema.safeParse(input.predecessor);
  if (!parsed.success) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_INVALID",
      "The promotion predecessor lifecycle result is malformed or violates its receipt contract.",
    );
  }
  const expectedEnvironment =
    input.environment === "staging" ? "dev" : "staging";
  const stageReceipts = (stage: StageReceiptV1["stage"]) =>
    parsed.data.receipts.filter((receipt) => receipt.stage === stage);
  const planReceipts = stageReceipts("plan");
  const deploymentReceipts = stageReceipts("deploy");
  const smokeReceipts = stageReceipts("smoke");
  if (
    parsed.data.state !== "verified" ||
    planReceipts.length !== 1 ||
    deploymentReceipts.length !== 1 ||
    smokeReceipts.length !== 1
  ) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_INCOMPLETE",
      "Promotion requires one passed plan, deployment, and bounded smoke receipt from the predecessor lifecycle.",
    );
  }
  const planReceipt = planReceipts[0];
  const deploymentReceipt = deploymentReceipts[0];
  const smokeReceipt = smokeReceipts[0];
  if (
    planReceipt === undefined ||
    deploymentReceipt === undefined ||
    smokeReceipt === undefined
  ) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_INCOMPLETE",
      "Promotion requires one passed plan, deployment, and bounded smoke receipt from the predecessor lifecycle.",
    );
  }

  const predecessorReceipts = [planReceipt, deploymentReceipt, smokeReceipt];
  if (
    predecessorReceipts.some(
      (receipt) =>
        receipt.environment !== expectedEnvironment ||
        receipt.commitSha !== input.commitSha ||
        receipt.solutionRevision.id !== input.revision.id ||
        receipt.solutionRevision.digest !== input.revision.digest,
    )
  ) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_SOURCE_MISMATCH",
      `Promotion to ${input.environment} must use passed ${expectedEnvironment} receipts for the same exact commit and Solution Revision.`,
    );
  }
  if (
    predecessorReceipts.some(({ status }) => status !== "passed") ||
    deploymentReceipt.targetAuthorityDigest !==
      planReceipt.targetAuthorityDigest ||
    smokeReceipt.targetAuthorityDigest !== planReceipt.targetAuthorityDigest
  ) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_NOT_PASSED",
      "Promotion requires passed predecessor receipts bound to one exact target authority.",
    );
  }

  const planReceiptDigest = receiptDigest(planReceipt);
  const deploymentReceiptDigest = receiptDigest(deploymentReceipt);
  const smokeReceiptDigest = receiptDigest(smokeReceipt);
  const manifestDigest = planReceipt.inputDigests[0];
  const planChecksum = planReceipt.inputDigests[1];
  const promotionDeploymentDigest =
    deploymentReceipt.promotionPredecessorReceiptDigest;
  const promotionSmokeDigest =
    deploymentReceipt.promotionPredecessorSmokeReceiptDigest;
  const promotionInputDigests =
    expectedEnvironment === "dev"
      ? promotionDeploymentDigest === undefined &&
        promotionSmokeDigest === undefined
        ? []
        : undefined
      : promotionDeploymentDigest !== undefined &&
          promotionSmokeDigest !== undefined
        ? [promotionDeploymentDigest, promotionSmokeDigest]
        : undefined;
  const expectedDeploymentInputDigests =
    manifestDigest !== undefined &&
    planChecksum !== undefined &&
    planReceipt.inputDigests.length === 2 &&
    planReceipt.outputDigests.length === 4 &&
    planReceipt.outputDigests[1] === planChecksum &&
    promotionInputDigests !== undefined
      ? [
          manifestDigest,
          planChecksum,
          planReceiptDigest,
          ...promotionInputDigests,
        ]
      : undefined;
  if (
    expectedDeploymentInputDigests === undefined ||
    deploymentReceipt.predecessorReceiptDigest !== planReceiptDigest ||
    JSON.stringify(deploymentReceipt.inputDigests) !==
      JSON.stringify(expectedDeploymentInputDigests) ||
    JSON.stringify(deploymentReceipt.outputDigests) !==
      JSON.stringify([planChecksum]) ||
    smokeReceipt.predecessorReceiptDigest !== deploymentReceiptDigest ||
    JSON.stringify(smokeReceipt.inputDigests) !==
      JSON.stringify([
        deploymentReceiptDigest,
        deploymentReceipt.targetAuthorityDigest,
      ])
  ) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
      "The predecessor deployment and smoke receipts do not form the exact canonical receipt chain.",
    );
  }

  const hasPassingSmokeEvidence = parsed.data.evidence.some(
    (record) =>
      record.solutionRevisionId === input.revision.id &&
      record.environment.environmentId === expectedEnvironment &&
      record.checks.some(
        (check) =>
          check.checkId === "cloudmarkup.customer-ci.smoke-integration" &&
          check.status === "passed" &&
          check.artifactDigests.includes(smokeReceiptDigest),
      ),
  );
  if (!hasPassingSmokeEvidence) {
    return promotionIssue(
      "PROMOTION_PREDECESSOR_EVIDENCE_MISSING",
      "The predecessor lifecycle does not contain passing smoke Evidence for the exact smoke receipt.",
    );
  }
  return { deploymentReceiptDigest, smokeReceiptDigest, valid: true };
}

export function runFakeCustomerCiLifecycleV1(
  input: Readonly<{
    approval: "approved" | "denied" | "missing";
    drift: "clean" | "changed" | "not-run";
    expected: unknown;
    manifest: unknown;
    promotionPredecessor?: CustomerCiLifecycleResultV1;
    smoke: "passed" | "failed" | "not-run";
  }>,
): CustomerCiLifecycleResultV1 {
  const manifest = savedTerraformPlanManifestV1Schema.parse(input.manifest);
  const expected = savedTerraformPlanExpectedV1Schema.parse(input.expected);
  const integrity = validateSavedTerraformPlanV1(manifest, expected);
  const manifestDigest = sha256(canonicalJson(manifest));
  const planReceipt = stageReceipt({
    commitSha: manifest.commitSha,
    createdAt: manifest.createdAt,
    environment: manifest.environment,
    inputDigests: [manifestDigest, manifest.planChecksum],
    outputDigests: integrity.valid
      ? [
          manifest.encryptedPlanChecksum,
          manifest.planChecksum,
          manifest.sanitizedPlanChecksum,
          manifest.semanticAnalysisChecksum,
        ]
      : [],
    revision: manifest.solutionRevision,
    stage: "plan",
    status: integrity.valid ? "passed" : "failed",
    targetAuthorityDigest: manifest.environmentConfigDigest,
  });
  const planReceiptDigest = receiptDigest(planReceipt);
  const receipts: StageReceiptV1[] = [planReceipt];
  const records: EvidenceRecordV1[] = [
    evidence({
      artifactDigests: [planReceiptDigest],
      checkId: "cloudmarkup.customer-ci.saved-plan-integrity",
      commitSha: manifest.commitSha,
      createdAt: manifest.createdAt,
      environment: manifest.environment,
      kind: "plan",
      passed: integrity.valid,
      revisionId: manifest.solutionRevision.id,
      summary: integrity.valid
        ? "The fake lifecycle verified the exact revision-bound saved plan."
        : "The fake lifecycle rejected a saved plan whose bindings no longer matched.",
      validUntil: manifest.expiresAt,
    }),
  ];
  const issues: CustomerCiIssueV1[] = [...integrity.issues];
  if (!integrity.valid) {
    return customerCiLifecycleResultV1Schema.parse({
      contractVersion: 1,
      evidence: records,
      issues,
      receipts,
      state: "deployment-blocked",
    });
  }
  const promotion = validatePromotionPredecessor({
    commitSha: manifest.commitSha,
    environment: manifest.environment,
    ...(input.promotionPredecessor === undefined
      ? {}
      : { predecessor: input.promotionPredecessor }),
    revision: manifest.solutionRevision,
  });
  if (!promotion.valid) {
    issues.push(promotion.issue);
    return customerCiLifecycleResultV1Schema.parse({
      contractVersion: 1,
      evidence: records,
      issues,
      receipts,
      state: "deployment-blocked",
    });
  }
  const promotionReceiptFields =
    promotion.deploymentReceiptDigest === undefined ||
    promotion.smokeReceiptDigest === undefined
      ? {}
      : {
          promotionPredecessorReceiptDigest: promotion.deploymentReceiptDigest,
          promotionPredecessorSmokeReceiptDigest: promotion.smokeReceiptDigest,
        };
  const promotionInputDigests =
    promotion.deploymentReceiptDigest === undefined ||
    promotion.smokeReceiptDigest === undefined
      ? []
      : [promotion.deploymentReceiptDigest, promotion.smokeReceiptDigest];
  if (input.approval !== "approved") {
    issues.push(
      safeIssue(
        "CUSTOMER_CI_APPROVAL_REQUIRED",
        input.approval === "denied"
          ? "The customer denied this environment deployment."
          : "This environment still needs explicit customer approval.",
      ),
    );
    receipts.push(
      stageReceipt({
        commitSha: manifest.commitSha,
        createdAt: expected.now,
        environment: manifest.environment,
        inputDigests: [
          manifestDigest,
          manifest.planChecksum,
          planReceiptDigest,
          ...promotionInputDigests,
        ],
        outputDigests: [],
        predecessorReceiptDigest: planReceiptDigest,
        ...promotionReceiptFields,
        revision: manifest.solutionRevision,
        stage: "deploy",
        status: "blocked",
        targetAuthorityDigest: manifest.environmentConfigDigest,
      }),
    );
    return customerCiLifecycleResultV1Schema.parse({
      contractVersion: 1,
      evidence: records,
      issues,
      receipts,
      state: "deployment-blocked",
    });
  }
  const deployReceipt = stageReceipt({
    commitSha: manifest.commitSha,
    createdAt: expected.now,
    environment: manifest.environment,
    inputDigests: [
      manifestDigest,
      manifest.planChecksum,
      planReceiptDigest,
      ...promotionInputDigests,
    ],
    outputDigests: [manifest.planChecksum],
    predecessorReceiptDigest: planReceiptDigest,
    ...promotionReceiptFields,
    revision: manifest.solutionRevision,
    stage: "deploy",
    status: "passed",
    targetAuthorityDigest: manifest.environmentConfigDigest,
  });
  const deployReceiptDigest = receiptDigest(deployReceipt);
  receipts.push(deployReceipt);
  let smokeReceiptDigest: DigestV1 | undefined;
  if (input.smoke !== "not-run") {
    const passed = input.smoke === "passed";
    const smokeResultDigest = sha256(
      canonicalJson({ passed, profile: "bounded-read-only-v1" }),
    );
    const smokeReceipt = stageReceipt({
      commitSha: manifest.commitSha,
      createdAt: expected.now,
      environment: manifest.environment,
      inputDigests: [deployReceiptDigest, manifest.environmentConfigDigest],
      outputDigests: [smokeResultDigest],
      predecessorReceiptDigest: deployReceiptDigest,
      revision: manifest.solutionRevision,
      stage: "smoke",
      status: passed ? "passed" : "failed",
      targetAuthorityDigest: manifest.environmentConfigDigest,
    });
    smokeReceiptDigest = receiptDigest(smokeReceipt);
    receipts.push(smokeReceipt);
    records.push(
      evidence({
        artifactDigests: [smokeReceiptDigest, smokeResultDigest],
        checkId: "cloudmarkup.customer-ci.smoke-integration",
        commitSha: manifest.commitSha,
        createdAt: expected.now,
        environment: manifest.environment,
        kind: "smoke",
        passed,
        revisionId: manifest.solutionRevision.id,
        summary: passed
          ? "The fake bounded smoke check passed for the exact deployment receipt."
          : "The fake bounded smoke check failed without retaining a raw response.",
      }),
    );
    if (!passed) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_SMOKE_FAILED",
          "The deployment completed, but the bounded smoke check failed. Investigate before promotion.",
          undefined,
          "warning",
        ),
      );
      return customerCiLifecycleResultV1Schema.parse({
        contractVersion: 1,
        evidence: records,
        issues,
        receipts,
        state: "smoke-failed",
      });
    }
  }
  if (input.drift !== "not-run") {
    const changed = input.drift === "changed";
    const driftResultDigest = sha256(
      canonicalJson({
        baseline: deployReceiptDigest,
        changed,
        environment: manifest.environment,
      }),
    );
    const driftReceipt = stageReceipt({
      commitSha: manifest.commitSha,
      createdAt: expected.now,
      environment: manifest.environment,
      inputDigests: [
        deployReceiptDigest,
        ...(smokeReceiptDigest === undefined ? [] : [smokeReceiptDigest]),
      ],
      outputDigests: [driftResultDigest],
      predecessorReceiptDigest: deployReceiptDigest,
      revision: manifest.solutionRevision,
      stage: "drift",
      status: "passed",
      targetAuthorityDigest: manifest.environmentConfigDigest,
    });
    const driftReceiptDigest = receiptDigest(driftReceipt);
    receipts.push(driftReceipt);
    records.push(
      evidence({
        artifactDigests: [driftReceiptDigest, driftResultDigest],
        checkId: "cloudmarkup.customer-ci.deployed-drift",
        commitSha: manifest.commitSha,
        createdAt: expected.now,
        environment: manifest.environment,
        kind: "drift",
        passed: true,
        revisionId: manifest.solutionRevision.id,
        summary: changed
          ? "Read-only fake drift inspection found a change against the exact deployment baseline."
          : "Read-only fake drift inspection found no change against the exact deployment baseline.",
      }),
    );
    if (changed) {
      issues.push(
        safeIssue(
          "CUSTOMER_CI_DRIFT_FOUND",
          "Read-only drift inspection found a difference. Review the sanitized artifact; nothing was applied.",
          undefined,
          "warning",
        ),
      );
    }
  }
  return customerCiLifecycleResultV1Schema.parse({
    contractVersion: 1,
    evidence: records,
    issues,
    receipts,
    state: input.smoke === "passed" ? "verified" : "deployed",
  });
}
