import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { deploymentInputsV1Schema, type DeploymentInputsV1 } from "./index.js";
import { validateDeploymentInputsV1 } from "./validator.js";

function loadExample(): DeploymentInputsV1 {
  return JSON.parse(
    readFileSync(
      new URL(
        "../../../config/deployment-inputs/example.development.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as DeploymentInputsV1;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function promote(
  value: DeploymentInputsV1,
  stage: "beta" | "production" | "staging",
): DeploymentInputsV1 {
  const name =
    stage === "production" ? "prod" : stage === "beta" ? "beta" : "staging";
  const account =
    stage === "production"
      ? "271828182845"
      : stage === "beta"
        ? "141421356237"
        : "161803398874";
  const promoted = JSON.parse(
    JSON.stringify(value)
      .replaceAll("000000000000", account)
      .replaceAll("cloudmarkup.example", "cloudmarkup.test")
      .replaceAll("customer.example", "customer.test")
      .replaceAll("cloud-markup-example", "cloud-markup-operator")
      .replaceAll("ZEXAMPLE123456", "ZCLOUDMARKUP123456")
      .replaceAll('"appId":"123456"', '"appId":"734829"')
      .replaceAll("development", stage)
      .replaceAll("cloudmarkup/dev/", `cloudmarkup/${name}/`)
      .replaceAll("cloudmarkup-dev/", `cloudmarkup-${name}/`)
      .replaceAll("cloudmarkup-dev-", `cloudmarkup-${name}-`)
      .replaceAll(".pending", ".approved")
      .replaceAll('"status":"pending"', '"status":"approved"')
      .replaceAll('"status": "pending"', '"status": "approved"'),
  ) as DeploymentInputsV1;
  promoted.environment = { name, stage };
  promoted.data.database.deletionProtection = true;
  promoted.cognito.mfa = "required";
  if (stage === "beta") promoted.features.beta = true;
  return promoted;
}

function issueCodes(value: unknown): readonly string[] {
  const result = validateDeploymentInputsV1(value);
  return result.valid ? [] : result.issues.map(({ code }) => code);
}

describe("deployment input validation", () => {
  test("accepts deterministic development, beta, staging, and production fixtures", () => {
    const development = validateDeploymentInputsV1(loadExample());
    const beta = validateDeploymentInputsV1(promote(loadExample(), "beta"));
    const staging = validateDeploymentInputsV1(
      promote(loadExample(), "staging"),
    );
    const production = validateDeploymentInputsV1(
      promote(loadExample(), "production"),
    );

    expect(development.valid).toBe(true);
    expect(beta.valid).toBe(true);
    expect(staging.valid).toBe(true);
    expect(production.valid).toBe(true);
    expect(deploymentInputsV1Schema.safeParse(loadExample()).success).toBe(
      true,
    );
    if (!development.valid) throw new Error("fixture must validate");
    expect(validateDeploymentInputsV1(loadExample())).toMatchObject({
      digest: development.digest,
      valid: true,
    });
  });

  test("fails closed for unsafe beta state and disabled access", () => {
    const deletion = promote(loadExample(), "beta");
    deletion.data.database.deletionProtection = false;
    expect(issueCodes(deletion)).toContain(
      "deployment-input.beta-deletion-protection",
    );

    const backup = promote(loadExample(), "beta");
    backup.data.backup.retentionDays = 6;
    expect(issueCodes(backup)).toContain(
      "deployment-input.beta-backup-retention",
    );

    const disabled = promote(loadExample(), "beta");
    disabled.features.beta = false;
    expect(issueCodes(disabled)).toContain(
      "deployment-input.beta-feature-disabled",
    );
  });

  test("rejects missing and placeholder staging inputs", () => {
    const missing = promote(loadExample(), "staging");
    delete (missing as Partial<DeploymentInputsV1>).domains;
    expect(issueCodes(missing)).toContain("deployment-input.schema-invalid");

    const placeholder = promote(loadExample(), "staging");
    placeholder.contacts.security.email = "security@example.com";
    expect(issueCodes(placeholder)).toContain(
      "deployment-input.placeholder-prohibited",
    );
  });

  test("rejects literal secrets and an application model API key", () => {
    const stripeSecret = loadExample();
    (stripeSecret.stripe as unknown as { apiKey: string }).apiKey = [
      "sk",
      "live",
      "syntheticNeverAllowed",
    ].join("_");
    expect(issueCodes(stripeSecret)).toEqual(
      expect.arrayContaining([
        "deployment-input.literal-secret",
        "deployment-input.literal-secret-field",
      ]),
    );

    const modelApiKey = loadExample();
    (
      modelApiKey.modelRuntime
        .amazonBedrock as typeof modelApiKey.modelRuntime.amazonBedrock & {
        modelApiKey?: string;
      }
    ).modelApiKey = "literal-model-credential";
    expect(issueCodes(modelApiKey)).toContain(
      "deployment-input.literal-secret-field",
    );
  });

  test("enforces Starter and Pro Stripe mappings and mode separation", () => {
    const wrongCredits = loadExample();
    const testMapping = wrongCredits.stripe.planMappings.test;
    if (!testMapping.configured)
      throw new Error("test fixture mapping missing");
    testMapping.starter.credits = 201;
    expect(issueCodes(wrongCredits)).toContain(
      "deployment-input.stripe-credit-mapping-invalid",
    );

    const missingMapping = loadExample();
    missingMapping.stripe.enabled = true;
    missingMapping.stripe.mode = "live";
    expect(issueCodes(missingMapping)).toContain(
      "deployment-input.stripe-mapping-missing",
    );
  });

  test("validates Bedrock Region, capability, inference profile, IAM, and budget", () => {
    const wrongRegion = loadExample();
    wrongRegion.modelRuntime.amazonBedrock.primaryRegion = "us-west-2";
    expect(issueCodes(wrongRegion)).toContain(
      "deployment-input.bedrock-region-mismatch",
    );

    const wrongCapability = loadExample();
    wrongCapability.modelRuntime.amazonBedrock.routes.standard.capabilityId =
      "bedrock.missing";
    expect(issueCodes(wrongCapability)).toContain(
      "deployment-input.bedrock-route-capability-missing",
    );

    const missingProfile = loadExample();
    const [missingProfileCapability] =
      missingProfile.modelRuntime.amazonBedrock.capabilities;
    if (missingProfileCapability === undefined) {
      throw new Error("The example must include a model capability.");
    }
    missingProfileCapability.inferenceProfileArn = null;
    missingProfileCapability.inferenceProfileId = null;
    expect(issueCodes(missingProfile)).toContain(
      "deployment-input.bedrock-profile-required",
    );

    const missingIam = loadExample();
    missingIam.modelRuntime.amazonBedrock.workerIam.invocationResourceArns.pop();
    expect(issueCodes(missingIam)).toContain(
      "deployment-input.bedrock-iam-resource-missing",
    );

    const excessiveIam = loadExample();
    excessiveIam.modelRuntime.amazonBedrock.workerIam.invocationResourceArns.push(
      "arn:aws:bedrock:us-east-1::foundation-model/vendor.unreviewed-v1:0",
    );
    expect(issueCodes(excessiveIam)).toContain(
      "deployment-input.bedrock-iam-resource-overreach",
    );

    const excessiveBudget = loadExample();
    excessiveBudget.modelRuntime.amazonBedrock.costControls.monthlyBudgetUsd = 2_000;
    expect(issueCodes(excessiveBudget)).toContain(
      "deployment-input.bedrock-budget-mismatch",
    );
    const invalidModel = loadExample();
    const [firstCapability] =
      invalidModel.modelRuntime.amazonBedrock.capabilities;
    if (firstCapability === undefined) {
      throw new Error("The example must include a model capability.");
    }
    firstCapability.modelId = "invalid model identifier";
    expect(issueCodes(invalidModel)).toContain(
      "deployment-input.schema-invalid",
    );
  });

  test("rejects GitHub import overreach and permission-feature mismatch", () => {
    const overreach = loadExample();
    overreach.github.import.permissions.workflows = "read";
    expect(issueCodes(overreach)).toContain(
      "deployment-input.github-import-permission-overreach",
    );

    const mismatch = loadExample();
    mismatch.features.githubExport = true;
    expect(issueCodes(mismatch)).toContain(
      "deployment-input.feature-export-inconsistent",
    );
  });

  test("rejects cross-environment secret references", () => {
    const fixture = promote(loadExample(), "staging");
    fixture.stripe.apiKey.secretsManagerReference =
      "cloudmarkup/prod/stripe/api-key";
    expect(issueCodes(fixture)).toContain(
      "deployment-input.secret-environment-mismatch",
    );
    const modelLimit = loadExample();
    modelLimit.platformLimits.resources.maxModelInputBytes =
      4 * 1024 * 1024 + 1;
    expect(issueCodes(modelLimit)).toContain("deployment-input.schema-invalid");
  });

  test("bounds repository import and evidence retention", () => {
    const repository = loadExample();
    repository.repositorySync.importLimits.maxFiles = 4_097;
    expect(issueCodes(repository)).toContain("deployment-input.schema-invalid");

    const retention = loadExample();
    retention.data.retention.evidenceDays = 29;
    expect(issueCodes(retention)).toContain("deployment-input.schema-invalid");
  });

  test("requires exact platform GitHub OIDC provider and immutable repository identity", () => {
    for (const oidcProviderArn of [
      "arn:aws:iam::000000000000:oidc-provider/attacker.example",
      "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com",
      "arn:aws-cn:iam::000000000000:oidc-provider/token.actions.githubusercontent.com",
      "arn:aws:iam::000000000000:oidc-provider/token.actions.githubusercontent.com/",
      "arn:aws:iam::000000000000:oidc-provider/Token.actions.githubusercontent.com",
    ] as const) {
      const provider = loadExample();
      provider.aws.platformDeployment.oidcProviderArn = oidcProviderArn;
      expect(issueCodes(provider), oidcProviderArn).toContain(
        "deployment-input.platform-oidc-provider-mismatch",
      );
      expect(
        deploymentInputsV1Schema.safeParse(provider).success,
        oidcProviderArn,
      ).toBe(false);
    }

    const mutableSubject = loadExample();
    const { repository, githubEnvironment } =
      mutableSubject.aws.platformDeployment;
    mutableSubject.aws.platformDeployment.subject = `repo:${repository.owner}/${repository.name}:environment:${githubEnvironment}`;
    expect(issueCodes(mutableSubject)).toContain(
      "deployment-input.platform-oidc-subject-mismatch",
    );
    expect(deploymentInputsV1Schema.safeParse(mutableSubject).success).toBe(
      false,
    );

    const changedRepository = loadExample();
    changedRepository.aws.platformDeployment.repository.id = "987654321";
    expect(issueCodes(changedRepository)).toContain(
      "deployment-input.platform-oidc-subject-mismatch",
    );
    expect(deploymentInputsV1Schema.safeParse(changedRepository).success).toBe(
      false,
    );

    const changedOwner = loadExample();
    changedOwner.aws.platformDeployment.repository.ownerId = "987654321";
    expect(issueCodes(changedOwner)).toContain(
      "deployment-input.platform-oidc-subject-mismatch",
    );
    expect(deploymentInputsV1Schema.safeParse(changedOwner).success).toBe(
      false,
    );

    const changedEnvironment = loadExample();
    changedEnvironment.aws.platformDeployment.githubEnvironment = "other";
    expect(issueCodes(changedEnvironment)).toContain(
      "deployment-input.platform-oidc-subject-mismatch",
    );
    expect(deploymentInputsV1Schema.safeParse(changedEnvironment).success).toBe(
      false,
    );
  });

  test("rejects customer OIDC trust mismatch, role overlap, and backend mismatch", () => {
    const oidc = loadExample();
    oidc.customerCiCd.oidc.subjectPrefix = "repo:mutable/name:environment:";
    expect(issueCodes(oidc)).toContain(
      "deployment-input.customer-oidc-subject-mismatch",
    );

    const overlap = loadExample();
    overlap.customerCiCd.roles.deploy.roleArn =
      overlap.customerCiCd.roles.plan.roleArn;
    expect(issueCodes(overlap)).toContain("deployment-input.role-overlap");

    const backend = loadExample();
    backend.customerCiCd.backend.region = "us-west-2";
    expect(issueCodes(backend)).toContain(
      "deployment-input.customer-backend-mismatch",
    );
  });

  test("rejects inconsistent AI, build, billing, target, plan, and drift flags", () => {
    const cases = [
      ["ai", "deployment-input.feature-ai-inconsistent"],
      [
        "applicationBuild",
        "deployment-input.feature-build-scanner-inconsistent",
      ],
      ["billing", "deployment-input.feature-billing-inconsistent"],
      ["customerPlan", "deployment-input.feature-plan-inconsistent"],
      ["customerDeploy", "deployment-input.feature-deploy-inconsistent"],
      ["customerDrift", "deployment-input.feature-drift-inconsistent"],
    ] as const;
    for (const [flag, code] of cases) {
      const fixture = clone(loadExample());
      fixture.features[flag] = true;
      expect(issueCodes(fixture), flag).toContain(code);
    }

    const noTarget = loadExample();
    noTarget.features.terraform = false;
    noTarget.features.cloudFormation = false;
    expect(issueCodes(noTarget)).toContain(
      "deployment-input.feature-iac-target-missing",
    );
  });

  test("requires approved optional providers without changing the Bedrock boundary", () => {
    const optional = loadExample();
    optional.modelRuntime.optionalProviders.enabled = true;
    expect(issueCodes(optional)).toContain(
      "deployment-input.optional-provider-inconsistent",
    );
    expect(optional.modelRuntime.providerBoundary).toBe(
      "provider-neutral-model-gateway-v1",
    );
  });
});
