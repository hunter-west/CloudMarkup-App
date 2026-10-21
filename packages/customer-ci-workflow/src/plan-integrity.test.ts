import { describe, expect, it } from "vitest";

import {
  CUSTOMER_CI_LIMITS_V1,
  savedTerraformPlanManifestV1Schema,
  type SavedTerraformPlanManifestV1,
} from "./contracts.js";
import {
  analyzeSanitizedTerraformPlanV1,
  sanitizeTerraformPlanV1,
  validatePromotionSequenceV1,
  validateSavedTerraformPlanV1,
  type PromotionStageV1,
} from "./plan-integrity.js";
import { canonicalJson, sha256 } from "./security.js";
import { createSavedTerraformPlanTestPairV1 } from "./testing.js";

describe("Terraform plan sanitization and semantic analysis", () => {
  it("retains only structural change data and never leaks raw values", () => {
    const fakeAccessKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const plan = sanitizeTerraformPlanV1({
      format_version: "1.2",
      output_changes: {
        database_password: {
          after: "do-not-retain-output-secret",
          sensitive: true,
        },
      },
      resource_changes: [
        {
          address: "aws_s3_bucket.logs",
          change: {
            actions: ["create"],
            after: { token: "do-not-retain-token" },
            before: null,
          },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_s3_bucket",
        },
        {
          address: "aws_lambda_function.api",
          change: {
            actions: ["delete", "create"],
            after: { environment: { SECRET: "do-not-retain-env" } },
            before: { source_code_hash: "do-not-retain-hash" },
          },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_lambda_function",
        },
      ],
      terraform_version: "1.15.8",
      variables: { access_key: { value: fakeAccessKey } },
    });
    const encoded = canonicalJson(plan);

    const expectedAddresses = ["aws_lambda_function.api", "aws_s3_bucket.logs"]
      .map((address) =>
        sha256(`cloudmarkup.terraform-resource-address.v1\u0000${address}`),
      )
      .sort((left, right) => left.localeCompare(right, "en"));
    expect(plan.resourceChanges.map(({ address }) => address)).toEqual(
      expectedAddresses,
    );
    expect(
      plan.resourceChanges.find(({ actions }) => actions[0] === "replace"),
    ).toBeDefined();
    expect(encoded).not.toContain("do-not-retain");
    expect(encoded).not.toContain(fakeAccessKey);
    expect(encoded).not.toContain("aws_lambda_function.api");
    expect(encoded).not.toContain("aws_s3_bucket.logs");
    expect(encoded).not.toContain("output_changes");
    expect(encoded).not.toContain("variables");
  });

  it("counts structural operations and calls out destructive changes honestly", () => {
    const sanitized = sanitizeTerraformPlanV1({
      format_version: "1.2",
      resource_changes: [
        {
          address: "aws_dynamodb_table.notes",
          change: { actions: ["create"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_dynamodb_table",
        },
        {
          address: "aws_lambda_function.api",
          change: { actions: ["update"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_lambda_function",
        },
        {
          address: "aws_s3_bucket.assets",
          change: { actions: ["delete", "create"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_s3_bucket",
        },
        {
          address: "data.aws_caller_identity.current",
          change: { actions: ["read"] },
          mode: "data",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_caller_identity",
        },
      ],
      terraform_version: "1.15.8",
    });
    const analysis = analyzeSanitizedTerraformPlanV1(sanitized);

    expect(analysis.counts).toEqual({
      create: 1,
      delete: 0,
      noOp: 0,
      read: 1,
      replace: 1,
      update: 1,
    });
    expect(analysis.issues).toEqual([
      expect.objectContaining({
        code: "DESTRUCTIVE_PLAN_CHANGE",
        field: sha256(
          "cloudmarkup.terraform-resource-address.v1\u0000aws_s3_bucket.assets",
        ),
        severity: "warning",
      }),
    ]);
    expect(analysis.unresolvedBehavior).toContain("remain unresolved");
  });

  it("calls out permission, network-boundary, and security-control changes without exposing addresses", () => {
    const rawAddresses = [
      "aws_iam_role_policy.runtime",
      "aws_security_group.private_api",
      "aws_kms_key.data",
      "aws_iam_role.unchanged",
    ];
    const sanitized = sanitizeTerraformPlanV1({
      format_version: "1.2",
      resource_changes: [
        {
          address: rawAddresses[0],
          change: { actions: ["update"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_iam_role_policy",
        },
        {
          address: rawAddresses[1],
          change: { actions: ["create"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_security_group",
        },
        {
          address: rawAddresses[2],
          change: { actions: ["update"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_kms_key",
        },
        {
          address: rawAddresses[3],
          change: { actions: ["no-op"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_iam_role",
        },
      ],
      terraform_version: "1.15.8",
    });
    const analysis = analyzeSanitizedTerraformPlanV1(sanitized);

    expect(analysis.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "IAM_OR_POLICY_PLAN_CHANGE",
        "NETWORK_BOUNDARY_PLAN_CHANGE",
        "SECURITY_CONTROL_PLAN_CHANGE",
      ]),
    );
    expect(
      analysis.issues.filter(
        ({ code }) => code === "IAM_OR_POLICY_PLAN_CHANGE",
      ),
    ).toHaveLength(1);
    for (const address of rawAddresses) {
      expect(canonicalJson(analysis)).not.toContain(address);
    }
    expect(
      analysis.issues.every(({ field }) => field?.startsWith("sha256:")),
    ).toBe(true);
  });

  it("rejects malformed, unsafe, duplicate, and silently-defaultable metadata", () => {
    const base = {
      format_version: "1.2",
      resource_changes: [
        {
          address: "aws_s3_bucket.logs",
          change: { actions: ["create"] },
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          type: "aws_s3_bucket",
        },
      ],
      terraform_version: "1.15.8",
    };

    expect(() =>
      sanitizeTerraformPlanV1({
        ...base,
        resource_changes: [base.resource_changes[0], base.resource_changes[0]],
      }),
    ).toThrow("addresses must be unique");
    expect(() =>
      sanitizeTerraformPlanV1({
        ...base,
        resource_changes: [
          {
            ...base.resource_changes[0],
            mode: "unexpected",
          },
        ],
      }),
    ).toThrow("mode is unsupported");
    expect(() =>
      sanitizeTerraformPlanV1({
        ...base,
        resource_changes: [
          {
            ...base.resource_changes[0],
            change: { actions: ["create", "create"] },
          },
        ],
      }),
    ).toThrow("actions are malformed or unsupported");
    expect(() =>
      sanitizeTerraformPlanV1({
        ...base,
        resource_changes: [
          {
            ...base.resource_changes[0],
            provider_name: "aws_access_key_id=unsafe",
          },
        ],
      }),
    ).toThrow("unsafe or malformed");
    expect(() =>
      sanitizeTerraformPlanV1({
        ...base,
        resource_changes: [
          {
            ...base.resource_changes[0],
            provider_name: "registry.terraform.io/hashicorp/random",
          },
        ],
      }),
    ).toThrow("only registry.terraform.io/hashicorp/aws is allowed");
    expect(() =>
      sanitizeTerraformPlanV1({
        ...base,
        resource_changes: [
          {
            ...base.resource_changes[0],
            address: "界".repeat(171),
          },
        ],
      }),
    ).toThrow("unsafe or malformed");
  });

  it("measures the raw plan limit in UTF-8 bytes", () => {
    expect(() =>
      sanitizeTerraformPlanV1({
        format_version: "1.2",
        resource_changes: [],
        terraform_version: "界".repeat(2_796_203),
      }),
    ).toThrow("exceeds the sanitization limit");
  });

  it("bounds destructive findings without silently hiding overflow", () => {
    const sanitized = sanitizeTerraformPlanV1({
      format_version: "1.2",
      resource_changes: Array.from({ length: 300 }, (_, index) => ({
        address: `aws_s3_bucket.logs_${String(index).padStart(3, "0")}`,
        change: { actions: ["delete"] },
        mode: "managed",
        provider_name: "registry.terraform.io/hashicorp/aws",
        type: "aws_s3_bucket",
      })),
      terraform_version: "1.15.8",
    });
    const analysis = analyzeSanitizedTerraformPlanV1(sanitized);

    expect(analysis.issues).toHaveLength(256);
    expect(analysis.issues.at(-1)).toMatchObject({
      code: "PLAN_SECURITY_REVIEW_OVERFLOW",
      severity: "warning",
    });
    expect(analysis.issues.at(-1)?.message).toContain("45 additional");
    expect(analysis.changes).toHaveLength(300);
  });

  it("rejects malformed, unsupported-action, and excessive-resource plan output", () => {
    expect(() => sanitizeTerraformPlanV1({})).toThrow(
      "no resource_changes array",
    );
    expect(() =>
      sanitizeTerraformPlanV1({
        format_version: "1.2",
        resource_changes: [
          {
            address: "aws_s3_bucket.logs",
            change: { actions: ["execute"] },
            mode: "managed",
            provider_name: "registry.terraform.io/hashicorp/aws",
            type: "aws_s3_bucket",
          },
        ],
        terraform_version: "1.15.8",
      }),
    ).toThrow();
    expect(() =>
      sanitizeTerraformPlanV1({
        resource_changes: Array.from(
          { length: CUSTOMER_CI_LIMITS_V1.planResources + 1 },
          () => ({}),
        ),
      }),
    ).toThrow("too many resource changes");
  });
});

describe("saved Terraform plan integrity", () => {
  it("accepts only the exact unexpired approved bindings", () => {
    const pair = createSavedTerraformPlanTestPairV1();

    expect(validateSavedTerraformPlanV1(pair.manifest, pair.expected)).toEqual({
      issues: [],
      valid: true,
    });
  });

  const mismatchCases: readonly (readonly [
    string,
    (manifest: SavedTerraformPlanManifestV1) => void,
  ])[] = [
    [
      "artifactName",
      (value) => void (value.artifactName = "cloudmarkup-plan-staging"),
    ],
    [
      "backendConfigDigest",
      (value) => void (value.backendConfigDigest = sha256("changed-backend")),
    ],
    [
      "commitSha",
      (value) =>
        void (value.commitSha = "abcdef0123456789abcdef0123456789abcdef01"),
    ],
    [
      "encryptedPlanChecksum",
      (value) =>
        void (value.encryptedPlanChecksum = sha256("changed-envelope")),
    ],
    ["environment", (value) => void (value.environment = "staging")],
    [
      "environmentConfigDigest",
      (value) =>
        void (value.environmentConfigDigest = sha256("changed-environment")),
    ],
    [
      "infrastructureArtifactDigest",
      (value) =>
        void (value.infrastructureArtifactDigest = sha256(
          "changed-infrastructure",
        )),
    ],
    [
      "planChecksum",
      (value) => void (value.planChecksum = sha256("changed-plan")),
    ],
    [
      "planEncryption",
      (value) =>
        void (value.planEncryption.publicKeyDigest =
          sha256("changed-public-key")),
    ],
    [
      "providerLockHash",
      (value) =>
        void (value.providerLockHash = sha256("changed-provider-lock")),
    ],
    ["planRunAttempt", (value) => void (value.planRunAttempt = 2)],
    ["planRunEvent", (value) => void (value.planRunEvent = "push")],
    ["planRunId", (value) => void (value.planRunId = "400101")],
    [
      "planRunRef",
      (value) => void (value.planRunRef = "refs/heads/feature/review"),
    ],
    [
      "sanitizedPlanChecksum",
      (value) =>
        void (value.sanitizedPlanChecksum = sha256("changed-sanitized-plan")),
    ],
    [
      "semanticAnalysisChecksum",
      (value) =>
        void (value.semanticAnalysisChecksum = sha256("changed-analysis")),
    ],
    [
      "solutionExportManifestDigest",
      (value) =>
        void (value.solutionExportManifestDigest = sha256(
          "changed-export-manifest",
        )),
    ],
    [
      "solutionRepositoryLockDigest",
      (value) =>
        void (value.solutionRepositoryLockDigest = sha256(
          "changed-repository-lock",
        )),
    ],
    [
      "targetAuthority",
      (value) => void (value.targetAuthority.region = "us-west-2"),
    ],
    ["terraformVersion", (value) => void (value.terraformVersion = "1.14.7")],
    [
      "workflowConfigDigest",
      (value) =>
        void (value.workflowConfigDigest = sha256("changed-workflow-config")),
    ],
    [
      "workflowPolicyDigest",
      (value) =>
        void (value.workflowPolicyDigest = sha256("changed-workflow-policy")),
    ],
    ["workspace", (value) => void (value.workspace = "notes_changed")],
  ];

  it.each(mismatchCases)("rejects a %s mismatch", (field, mutate) => {
    const pair = createSavedTerraformPlanTestPairV1();
    const manifest = structuredClone(pair.manifest);
    mutate(manifest);

    const result = validateSavedTerraformPlanV1(manifest, pair.expected);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    );
  });

  it("rejects changed Solution Revision identity and expiry independently", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    const revisionChanged = structuredClone(pair.manifest);
    revisionChanged.solutionRevision.digest = sha256("changed-revision");
    expect(
      validateSavedTerraformPlanV1(revisionChanged, pair.expected).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SAVED_PLAN_SOLUTION_REVISION_MISMATCH",
        }),
      ]),
    );

    const expired = savedTerraformPlanManifestV1Schema.parse({
      ...structuredClone(pair.manifest),
      expiresAt: "2026-08-24T12:10:00.000Z",
    });
    expect(validateSavedTerraformPlanV1(expired, pair.expected).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SAVED_PLAN_EXPIRED" }),
      ]),
    );
  });

  it("fails closed on a malformed manifest or expected binding set", () => {
    const pair = createSavedTerraformPlanTestPairV1();
    expect(
      validateSavedTerraformPlanV1(
        { ...pair.manifest, planChecksum: "sha256:invalid" },
        pair.expected,
      ),
    ).toEqual({
      issues: [
        expect.objectContaining({ code: "SAVED_PLAN_MANIFEST_MALFORMED" }),
      ],
      valid: false,
    });
  });
});

describe("environment promotion integrity", () => {
  function promotionStages(): PromotionStageV1[] {
    const shared = {
      approved: true,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      revisionDigest: sha256("solution-revision"),
      revisionId: "solution-revision-0040a",
    };
    const devReceipt = sha256("deployment-dev");
    const stagingReceipt = sha256("deployment-staging");
    const devSmokeReceipt = sha256("smoke-dev");
    const stagingSmokeReceipt = sha256("smoke-staging");
    return [
      {
        ...shared,
        deploymentReceiptDigest: devReceipt,
        environment: "dev",
        planManifestChecksum: sha256("plan-dev"),
        smokePassed: true,
        smokeReceiptDigest: devSmokeReceipt,
      },
      {
        ...shared,
        deploymentReceiptDigest: stagingReceipt,
        environment: "staging",
        planManifestChecksum: sha256("plan-staging"),
        promotionPredecessorReceiptDigest: devReceipt,
        promotionPredecessorSmokeReceiptDigest: devSmokeReceipt,
        smokePassed: true,
        smokeReceiptDigest: stagingSmokeReceipt,
      },
      {
        ...shared,
        deploymentReceiptDigest: sha256("deployment-production"),
        environment: "production",
        planManifestChecksum: sha256("plan-production"),
        promotionPredecessorReceiptDigest: stagingReceipt,
        promotionPredecessorSmokeReceiptDigest: stagingSmokeReceipt,
        smokePassed: true,
        smokeReceiptDigest: sha256("smoke-production"),
      },
    ];
  }

  function requireStages(): readonly [
    PromotionStageV1,
    PromotionStageV1,
    PromotionStageV1,
  ] {
    const [dev, staging, production] = promotionStages();
    if (
      dev === undefined ||
      staging === undefined ||
      production === undefined
    ) {
      throw new Error("The promotion fixture is incomplete.");
    }
    return [dev, staging, production];
  }

  it("requires a separate approved plan for each ordered environment", () => {
    expect(validatePromotionSequenceV1(promotionStages())).toEqual({
      issues: [],
      valid: true,
    });
  });

  it("rejects cross-environment plan reuse", () => {
    const [dev, staging, production] = requireStages();
    const stages = [
      dev,
      staging,
      {
        ...production,
        planManifestChecksum: staging.planManifestChecksum,
      },
    ];

    expect(validatePromotionSequenceV1(stages)).toMatchObject({
      issues: [
        expect.objectContaining({ code: "PROMOTION_PLAN_REUSE_REJECTED" }),
      ],
      valid: false,
    });
  });

  it("rejects a missing, unexpected, wrong, or reused predecessor receipt", () => {
    const [dev, staging, production] = requireStages();

    const unexpectedDev = validatePromotionSequenceV1([
      {
        ...dev,
        promotionPredecessorSmokeReceiptDigest: sha256("unexpected"),
      },
      staging,
      production,
    ]);
    expect(unexpectedDev.issues.map(({ code }) => code)).toContain(
      "PROMOTION_PREDECESSOR_UNEXPECTED",
    );

    const wrongStaging = validatePromotionSequenceV1([
      dev,
      { ...staging, promotionPredecessorReceiptDigest: sha256("wrong-dev") },
      production,
    ]);
    expect(wrongStaging.issues.map(({ code }) => code)).toContain(
      "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
    );

    const {
      promotionPredecessorReceiptDigest: productionPredecessor,
      promotionPredecessorSmokeReceiptDigest: productionSmokePredecessor,
      ...productionWithoutPredecessor
    } = production as PromotionStageV1 & {
      promotionPredecessorSmokeReceiptDigest: string;
    };
    expect(productionPredecessor).toBeDefined();
    expect(productionSmokePredecessor).toBeDefined();
    const missingProduction = validatePromotionSequenceV1([
      dev,
      staging,
      productionWithoutPredecessor,
    ]);
    expect(missingProduction.issues.map(({ code }) => code)).toContain(
      "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
    );

    const reused = validatePromotionSequenceV1([
      dev,
      staging,
      {
        ...production,
        deploymentReceiptDigest: staging.deploymentReceiptDigest,
      },
    ]);
    expect(reused.issues.map(({ code }) => code)).toContain(
      "PROMOTION_DEPLOYMENT_RECEIPT_REUSE_REJECTED",
    );

    const wrongSmoke = validatePromotionSequenceV1([
      dev,
      {
        ...staging,
        promotionPredecessorSmokeReceiptDigest: sha256("wrong-dev-smoke"),
      },
      production,
    ]);
    expect(wrongSmoke.issues.map(({ code }) => code)).toContain(
      "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
    );

    const failedSmoke = validatePromotionSequenceV1([
      { ...dev, smokePassed: false },
      staging,
      production,
    ]);
    expect(failedSmoke.issues.map(({ code }) => code)).toContain(
      "PROMOTION_SMOKE_REQUIRED",
    );
  });

  it("rejects order, approval, commit, and revision divergence", () => {
    const [dev, staging, production] = requireStages();
    const stages = [
      staging,
      { ...dev, approved: false },
      {
        ...production,
        commitSha: "abcdef0123456789abcdef0123456789abcdef01",
        revisionDigest: sha256("different-revision"),
      },
    ];

    expect(
      validatePromotionSequenceV1(stages).issues.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining([
        "PROMOTION_ORDER_INVALID",
        "PROMOTION_SOURCE_MISMATCH",
        "PROMOTION_APPROVAL_MISSING",
      ]),
    );
  });
});
