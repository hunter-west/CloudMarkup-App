import {
  CUSTOMER_CI_LIMITS_V1,
  sanitizedTerraformPlanV1Schema,
  savedTerraformPlanExpectedV1Schema,
  savedTerraformPlanManifestV1Schema,
  terraformSemanticPlanAnalysisV1Schema,
  type CustomerCiIssueV1,
  type SanitizedTerraformPlanV1,
  type SavedTerraformPlanExpectedV1,
  type SavedTerraformPlanManifestV1,
  type TerraformSemanticPlanAnalysisV1,
} from "./contracts.js";
import {
  canonicalJson,
  containsCredentialShape,
  safeIssue,
  sha256,
} from "./security.js";

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Terraform plan JSON must be an object.");
  }
  return value as Record<string, unknown>;
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function metadataString(
  value: unknown,
  maximumLength: number,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > maximumLength ||
    containsAsciiControlCharacter(value) ||
    containsCredentialShape(value)
  ) {
    throw new Error(`Terraform plan ${label} is unsafe or malformed.`);
  }
  return value;
}

const rawTerraformActions = new Set([
  "create",
  "read",
  "update",
  "delete",
  "no-op",
]);

const AWS_PROVIDER_NAME = "registry.terraform.io/hashicorp/aws";

function isIamOrPolicyType(type: string): boolean {
  return (
    type.startsWith("aws_iam_") ||
    type.includes("_policy") ||
    type === "aws_kms_grant" ||
    type.startsWith("aws_lakeformation_permissions") ||
    type.startsWith("aws_ssoadmin_")
  );
}

const networkTypePrefixes = [
  "aws_alb",
  "aws_api_gateway_vpc_link",
  "aws_apigatewayv2_vpc_link",
  "aws_ec2_transit_gateway",
  "aws_eip",
  "aws_elb",
  "aws_globalaccelerator",
  "aws_internet_gateway",
  "aws_lb",
  "aws_nat_gateway",
  "aws_network_acl",
  "aws_network_interface",
  "aws_route",
  "aws_security_group",
  "aws_subnet",
  "aws_vpc",
] as const;

const securityControlTypePrefixes = [
  "aws_accessanalyzer_",
  "aws_acm_",
  "aws_cloudtrail",
  "aws_config_",
  "aws_detective_",
  "aws_guardduty_",
  "aws_inspector",
  "aws_kms_",
  "aws_macie2_",
  "aws_networkfirewall_",
  "aws_s3_bucket_public_access_block",
  "aws_secretsmanager_",
  "aws_securityhub_",
  "aws_shield_",
  "aws_wafv2_",
] as const;

function normalizeActions(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 2 ||
    new Set(value).size !== value.length ||
    value.some(
      (item: unknown) =>
        typeof item !== "string" || !rawTerraformActions.has(item),
    )
  ) {
    throw new Error("Terraform plan actions are malformed or unsupported.");
  }
  const actions = value as string[];
  if (actions.length === 2) {
    if (actions.includes("delete") && actions.includes("create")) {
      return ["replace"];
    }
    throw new Error("Terraform plan action combinations are unsupported.");
  }
  return actions;
}

export function sanitizeTerraformPlanV1(
  input: unknown,
): SanitizedTerraformPlanV1 {
  const raw = plainObject(input);
  const encoded = canonicalJson(raw);
  if (Buffer.byteLength(encoded, "utf8") > 8 * 1024 * 1024) {
    throw new Error("Terraform plan JSON exceeds the sanitization limit.");
  }
  const changes = raw["resource_changes"];
  if (!Array.isArray(changes)) {
    throw new Error("Terraform plan JSON has no resource_changes array.");
  }
  if (changes.length > CUSTOMER_CI_LIMITS_V1.planResources) {
    throw new Error("Terraform plan contains too many resource changes.");
  }
  const seenAddresses = new Set<string>();
  const resourceChanges = changes
    .map((item) => {
      const record = plainObject(item);
      const change = plainObject(record["change"]);
      const rawAddress = metadataString(record["address"], 512, "address");
      if (seenAddresses.has(rawAddress)) {
        throw new Error("Terraform plan resource addresses must be unique.");
      }
      seenAddresses.add(rawAddress);
      if (record["mode"] !== "managed" && record["mode"] !== "data") {
        throw new Error("Terraform plan resource mode is unsupported.");
      }
      const providerName = metadataString(
        record["provider_name"],
        256,
        "provider name",
      );
      if (providerName !== AWS_PROVIDER_NAME) {
        throw new Error(
          "Terraform plan provider is unsupported; only registry.terraform.io/hashicorp/aws is allowed.",
        );
      }
      const type = metadataString(record["type"], 256, "resource type");
      if (!/^aws_[a-z0-9_]{1,251}$/.test(type)) {
        throw new Error("Terraform plan resource type is unsupported.");
      }
      return {
        actions: normalizeActions(change["actions"]),
        address: sha256(
          `cloudmarkup.terraform-resource-address.v1\u0000${rawAddress}`,
        ),
        mode: record["mode"],
        providerName,
        type,
      };
    })
    .sort((left, right) => left.address.localeCompare(right.address, "en"));
  return sanitizedTerraformPlanV1Schema.parse({
    formatVersion: metadataString(raw["format_version"], 32, "format version"),
    resourceChanges,
    terraformVersion: metadataString(
      raw["terraform_version"],
      32,
      "Terraform version",
    ),
  });
}

export function analyzeSanitizedTerraformPlanV1(
  input: unknown,
): TerraformSemanticPlanAnalysisV1 {
  const plan = sanitizedTerraformPlanV1Schema.parse(input);
  const counts = {
    create: 0,
    delete: 0,
    noOp: 0,
    read: 0,
    replace: 0,
    update: 0,
  };
  const issues: CustomerCiIssueV1[] = [];
  const omittedIssueCounts = new Map<string, number>();
  const addReviewIssue = (issue: CustomerCiIssueV1): void => {
    if (issues.length < 255) {
      issues.push(issue);
      return;
    }
    omittedIssueCounts.set(
      issue.code,
      (omittedIssueCounts.get(issue.code) ?? 0) + 1,
    );
  };
  for (const change of plan.resourceChanges) {
    for (const action of change.actions) {
      if (action === "no-op") counts.noOp += 1;
      else counts[action] += 1;
    }
    const changesInfrastructure = change.actions.some(
      (action) => action !== "no-op" && action !== "read",
    );
    if (
      change.actions.includes("delete") ||
      change.actions.includes("replace")
    ) {
      addReviewIssue(
        safeIssue(
          "DESTRUCTIVE_PLAN_CHANGE",
          "This change removes or replaces a resource and needs explicit review.",
          change.address,
          "warning",
        ),
      );
    }
    if (changesInfrastructure && isIamOrPolicyType(change.type)) {
      addReviewIssue(
        safeIssue(
          "IAM_OR_POLICY_PLAN_CHANGE",
          "This change affects permissions or a policy. Review the allowed actions, resources, and trust conditions.",
          change.address,
          "warning",
        ),
      );
    }
    if (
      changesInfrastructure &&
      networkTypePrefixes.some((prefix) => change.type.startsWith(prefix))
    ) {
      addReviewIssue(
        safeIssue(
          "NETWORK_BOUNDARY_PLAN_CHANGE",
          "This change affects network routing or an access boundary. Review ingress, egress, routes, and exposure.",
          change.address,
          "warning",
        ),
      );
    }
    if (
      changesInfrastructure &&
      securityControlTypePrefixes.some((prefix) =>
        change.type.startsWith(prefix),
      )
    ) {
      addReviewIssue(
        safeIssue(
          "SECURITY_CONTROL_PLAN_CHANGE",
          "This change affects a security control, key, secret, certificate, audit trail, or threat-detection setting and needs explicit review.",
          change.address,
          "warning",
        ),
      );
    }
  }
  const omittedIssueTotal = [...omittedIssueCounts.values()].reduce(
    (total, count) => total + count,
    0,
  );
  if (omittedIssueTotal > 0) {
    issues.push(
      safeIssue(
        "PLAN_SECURITY_REVIEW_OVERFLOW",
        `${String(omittedIssueTotal)} additional security-sensitive or destructive findings need review; inspect the complete sanitized change list.`,
        undefined,
        "warning",
      ),
    );
  }
  return terraformSemanticPlanAnalysisV1Schema.parse({
    changes: plan.resourceChanges.map(({ actions, address, type }) => ({
      actions,
      address,
      type,
    })),
    contractVersion: 1,
    counts,
    issues,
    kind: "cloudmarkup.terraform-semantic-plan-analysis",
    unresolvedBehavior:
      "Provider-computed values, account policy, quotas, and runtime behavior remain unresolved until the customer reviews and executes this plan.",
  });
}

export function createSavedTerraformPlanManifestV1(
  input: unknown,
): SavedTerraformPlanManifestV1 {
  return savedTerraformPlanManifestV1Schema.parse(input);
}

export function validateSavedTerraformPlanV1(
  manifestInput: unknown,
  expectedInput: unknown,
): { readonly issues: readonly CustomerCiIssueV1[]; readonly valid: boolean } {
  const manifest = savedTerraformPlanManifestV1Schema.safeParse(manifestInput);
  const expected = savedTerraformPlanExpectedV1Schema.safeParse(expectedInput);
  if (!manifest.success || !expected.success) {
    return {
      issues: [
        safeIssue(
          "SAVED_PLAN_MANIFEST_MALFORMED",
          "The saved-plan manifest or expected deployment bindings are malformed.",
        ),
      ],
      valid: false,
    };
  }
  const issues: CustomerCiIssueV1[] = [];
  const exactFields = [
    ["artifactName", "artifact name"],
    ["backendConfigDigest", "backend configuration"],
    ["commitSha", "commit"],
    ["encryptedPlanChecksum", "encrypted saved plan"],
    ["environment", "environment"],
    ["environmentConfigDigest", "environment configuration"],
    ["infrastructureArtifactDigest", "infrastructure artifact"],
    ["planChecksum", "saved plan"],
    ["planRunRef", "planning workflow ref"],
    ["planRunPath", "planning workflow path"],
    ["planRunId", "planning workflow run"],
    ["planRunEvent", "planning workflow event"],
    ["planRunAttempt", "planning workflow run attempt"],
    ["planEncryption", "saved-plan encryption policy"],
    ["providerLockHash", "provider lock"],
    ["sanitizedPlanChecksum", "sanitized plan"],
    ["semanticAnalysisChecksum", "semantic analysis"],
    ["solutionExportManifestDigest", "Solution export manifest"],
    ["solutionRepositoryLockDigest", "Solution repository lock"],
    ["targetAuthority", "resolved target authority"],
    ["terraformVersion", "Terraform version"],
    ["workflowConfigDigest", "workflow configuration"],
    ["workflowPolicyDigest", "workflow policy"],
    ["workspace", "Terraform workspace"],
  ] as const;
  for (const [field, label] of exactFields) {
    if (
      canonicalJson(manifest.data[field]) !==
      canonicalJson(expected.data[field])
    ) {
      issues.push(
        safeIssue(
          `SAVED_PLAN_${field.replaceAll(/([A-Z])/g, "_$1").toUpperCase()}_MISMATCH`,
          `The ${label} no longer matches the approved saved plan. Create and approve a new plan.`,
          field,
        ),
      );
    }
  }
  if (
    manifest.data.solutionRevision.id !== expected.data.solutionRevision.id ||
    manifest.data.solutionRevision.digest !==
      expected.data.solutionRevision.digest
  ) {
    issues.push(
      safeIssue(
        "SAVED_PLAN_SOLUTION_REVISION_MISMATCH",
        "The Solution Revision changed after planning. Create and approve a new plan.",
        "solutionRevision",
      ),
    );
  }
  if (Date.parse(manifest.data.expiresAt) <= Date.parse(expected.data.now)) {
    issues.push(
      safeIssue(
        "SAVED_PLAN_EXPIRED",
        "The saved plan expired. Create and approve a new plan before deployment.",
        "expiresAt",
      ),
    );
  }
  return { issues, valid: issues.length === 0 };
}

export type PromotionStageV1 = Readonly<{
  approved: boolean;
  commitSha: string;
  deploymentReceiptDigest: string;
  environment: "dev" | "staging" | "production";
  planManifestChecksum: string;
  promotionPredecessorReceiptDigest?: string;
  promotionPredecessorSmokeReceiptDigest?: string;
  smokePassed: boolean;
  smokeReceiptDigest: string;
  revisionDigest: string;
  revisionId: string;
}>;

export function validatePromotionSequenceV1(
  stages: readonly PromotionStageV1[],
): { readonly issues: readonly CustomerCiIssueV1[]; readonly valid: boolean } {
  const issues: CustomerCiIssueV1[] = [];
  const expectedOrder = ["dev", "staging", "production"];
  if (
    stages.length !== expectedOrder.length ||
    stages.some((stage, index) => stage.environment !== expectedOrder[index])
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_ORDER_INVALID",
        "Promotion must move explicitly from dev to staging to production.",
      ),
    );
  }
  const first = stages[0];
  if (
    first !== undefined &&
    stages.some(
      (stage) =>
        stage.commitSha !== first.commitSha ||
        stage.revisionId !== first.revisionId ||
        stage.revisionDigest !== first.revisionDigest,
    )
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_SOURCE_MISMATCH",
        "Every promotion stage must name the same exact commit and Solution Revision.",
      ),
    );
  }
  if (stages.some((stage) => !stage.approved)) {
    issues.push(
      safeIssue(
        "PROMOTION_APPROVAL_MISSING",
        "Every environment needs its own successful plan and explicit approval.",
      ),
    );
  }
  if (stages.some((stage) => !stage.smokePassed)) {
    issues.push(
      safeIssue(
        "PROMOTION_SMOKE_REQUIRED",
        "Every environment must have a passing bounded smoke receipt before it can be promoted.",
      ),
    );
  }
  if (
    new Set(stages.map(({ planManifestChecksum }) => planManifestChecksum))
      .size !== stages.length
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_PLAN_REUSE_REJECTED",
        "A saved plan cannot be reused across environments. Plan separately for each stage.",
      ),
    );
  }
  if (
    new Set(
      stages.map(({ deploymentReceiptDigest }) => deploymentReceiptDigest),
    ).size !== stages.length
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_DEPLOYMENT_RECEIPT_REUSE_REJECTED",
        "A deployment receipt cannot be reused for another promotion stage.",
      ),
    );
  }
  if (
    new Set(stages.map(({ smokeReceiptDigest }) => smokeReceiptDigest)).size !==
    stages.length
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_SMOKE_RECEIPT_REUSE_REJECTED",
        "A smoke receipt cannot be reused for another promotion stage.",
      ),
    );
  }
  const [dev, staging, production] = stages;
  if (
    dev?.environment === "dev" &&
    (dev.promotionPredecessorReceiptDigest !== undefined ||
      dev.promotionPredecessorSmokeReceiptDigest !== undefined)
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_PREDECESSOR_UNEXPECTED",
        "Development cannot name a predecessor deployment or smoke receipt.",
      ),
    );
  }
  if (
    staging?.environment === "staging" &&
    (dev === undefined ||
      staging.promotionPredecessorReceiptDigest !==
        dev.deploymentReceiptDigest ||
      staging.promotionPredecessorSmokeReceiptDigest !== dev.smokeReceiptDigest)
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
        "Staging must bind the exact passing development deployment and smoke receipts.",
      ),
    );
  }
  if (
    production?.environment === "production" &&
    (staging === undefined ||
      production.promotionPredecessorReceiptDigest !==
        staging.deploymentReceiptDigest ||
      production.promotionPredecessorSmokeReceiptDigest !==
        staging.smokeReceiptDigest)
  ) {
    issues.push(
      safeIssue(
        "PROMOTION_PREDECESSOR_RECEIPT_MISMATCH",
        "Production must bind the exact passing staging deployment and smoke receipts.",
      ),
    );
  }
  return { issues, valid: issues.length === 0 };
}

export function expectedSavedPlanBindingsV1(
  input: SavedTerraformPlanExpectedV1,
): SavedTerraformPlanExpectedV1 {
  return savedTerraformPlanExpectedV1Schema.parse(input);
}
