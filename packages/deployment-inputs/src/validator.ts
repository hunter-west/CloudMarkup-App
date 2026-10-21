import { createHash } from "node:crypto";

import {
  deploymentInputsV1StructuralSchema,
  platformDeploymentOidcProviderArnV1,
  platformDeploymentOidcSubjectV1,
  type DeploymentInputsV1,
} from "./schema.js";

export interface DeploymentInputIssueV1 {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export type DeploymentInputsValidationResultV1 =
  | {
      readonly data: DeploymentInputsV1;
      readonly digest: `sha256:${string}`;
      readonly environment: DeploymentInputsV1["environment"];
      readonly issues: readonly [];
      readonly valid: true;
      readonly warnings: readonly DeploymentInputIssueV1[];
    }
  | {
      readonly issues: readonly DeploymentInputIssueV1[];
      readonly valid: false;
      readonly warnings: readonly DeploymentInputIssueV1[];
    };

const literalSecretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}\b/u,
  /\bwhsec_[A-Za-z0-9_]{8,}\b/u,
] as const;
const secretKeyFragments = [
  "accesskey",
  "apikey",
  "clientsecret",
  "credential",
  "password",
  "privatekey",
  "secret",
  "sessiontoken",
  "token",
] as const;
const placeholderPattern =
  /(?:\b(?:change[-_ ]?me|placeholder|replace[-_ ]?me|tbd|todo|pending)\b|example)/iu;

interface ParsedArn {
  readonly account: string;
  readonly partition: string;
  readonly region: string;
  readonly resource: string;
  readonly service: string;
}

function issue(
  code: string,
  path: string,
  message: string,
): DeploymentInputIssueV1 {
  return Object.freeze({ code, message, path });
}

function joinPath(parent: string, child: string | number): string {
  return typeof child === "number"
    ? `${parent}[${String(child)}]`
    : parent.length === 0
      ? child
      : `${parent}.${child}`;
}

function parseArn(value: string): ParsedArn | null {
  const match = /^arn:([^:]+):([^:]+):([^:]*):([^:]*):(.+)$/u.exec(value);
  if (match === null) return null;
  const [, partition, service, region, account, resource] = match;
  return partition === undefined ||
    service === undefined ||
    region === undefined ||
    account === undefined ||
    resource === undefined
    ? null
    : { account, partition, region, resource, service };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}

function scanLiteralSecrets(
  value: unknown,
  issues: DeploymentInputIssueV1[],
  path = "",
): void {
  if (typeof value === "string") {
    if (literalSecretPatterns.some((pattern) => pattern.test(value))) {
      issues.push(
        issue(
          "deployment-input.literal-secret",
          path,
          "Literal secret material is prohibited; supply only an approved reference.",
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      scanLiteralSecrets(entry, issues, joinPath(path, index));
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = joinPath(path, key);
    const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase();
    const referenceKey =
      normalizedKey.endsWith("reference") ||
      normalizedKey.endsWith("secretname") ||
      normalizedKey.endsWith("variable") ||
      normalizedKey.endsWith("identifier");
    const secretKey = secretKeyFragments.some(
      (fragment) =>
        normalizedKey === fragment || normalizedKey.endsWith(fragment),
    );
    if (secretKey && !referenceKey && typeof entry !== "object") {
      issues.push(
        issue(
          "deployment-input.literal-secret-field",
          childPath,
          "Secret-bearing fields must contain a structured reference, never a literal value.",
        ),
      );
    }
    scanLiteralSecrets(entry, issues, childPath);
  }
}

function stageOf(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("environment" in value)
  ) {
    return null;
  }
  const environment = value.environment;
  return typeof environment === "object" &&
    environment !== null &&
    "stage" in environment &&
    typeof environment.stage === "string"
    ? environment.stage
    : null;
}

function scanPlaceholders(
  value: unknown,
  issues: DeploymentInputIssueV1[],
  path = "",
): void {
  if (typeof value === "string") {
    if (
      placeholderPattern.test(value) ||
      value === "000000000000" ||
      value === "123456" ||
      value === "123456789012"
    ) {
      issues.push(
        issue(
          "deployment-input.placeholder-prohibited",
          path,
          "Beta, staging, and production inputs cannot contain placeholders or pending decisions.",
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      scanPlaceholders(entry, issues, joinPath(path, index));
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    scanPlaceholders(entry, issues, joinPath(path, key));
  }
}

function expect(
  condition: boolean,
  issues: DeploymentInputIssueV1[],
  code: string,
  path: string,
  message: string,
): void {
  if (!condition) issues.push(issue(code, path, message));
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function isSubdomain(value: string, root: string): boolean {
  return value === root || value.endsWith(`.${root}`);
}

function accountOfArn(value: string): string | null {
  return parseArn(value)?.account ?? null;
}

function regionOfArn(value: string): string | null {
  return parseArn(value)?.region ?? null;
}

function crossValidate(
  data: DeploymentInputsV1,
): readonly DeploymentInputIssueV1[] {
  const issues: DeploymentInputIssueV1[] = [];
  const expectedName =
    data.environment.stage === "development"
      ? "dev"
      : data.environment.stage === "beta"
        ? "beta"
        : data.environment.stage === "production"
          ? "prod"
          : "staging";
  expect(
    data.environment.name === expectedName,
    issues,
    "deployment-input.environment-mismatch",
    "environment",
    "Environment name and stage must describe the same isolated environment.",
  );
  expect(
    data.aws.enabledRegions.includes(data.aws.primaryRegion) &&
      unique(data.aws.enabledRegions),
    issues,
    "deployment-input.aws-regions-invalid",
    "aws.enabledRegions",
    "Enabled Regions must be unique and include the primary Region.",
  );
  const expectedPartition = data.aws.primaryRegion.startsWith("us-gov-")
    ? "aws-us-gov"
    : data.aws.primaryRegion.startsWith("cn-")
      ? "aws-cn"
      : "aws";
  expect(
    data.aws.partition === expectedPartition,
    issues,
    "deployment-input.aws-partition-mismatch",
    "aws.partition",
    "AWS partition must match the primary Region.",
  );
  expect(
    accountOfArn(data.aws.platformDeployment.roleArn) === data.aws.accountId,
    issues,
    "deployment-input.platform-role-account-mismatch",
    "aws.platformDeployment.roleArn",
    "Platform deployment role must belong to the platform account.",
  );
  expect(
    data.aws.platformDeployment.oidcProviderArn ===
      platformDeploymentOidcProviderArnV1(
        data.aws.partition,
        data.aws.accountId,
      ),
    issues,
    "deployment-input.platform-oidc-provider-mismatch",
    "aws.platformDeployment.oidcProviderArn",
    "Platform deployment must use the exact GitHub Actions OIDC provider in the platform account.",
  );
  const platformRepository = data.aws.platformDeployment.repository;
  expect(
    data.aws.platformDeployment.subject ===
      platformDeploymentOidcSubjectV1(
        platformRepository.owner,
        platformRepository.ownerId,
        platformRepository.name,
        platformRepository.id,
        data.aws.platformDeployment.githubEnvironment,
      ),
    issues,
    "deployment-input.platform-oidc-subject-mismatch",
    "aws.platformDeployment.subject",
    "Platform deployment OIDC subject must exactly bind immutable owner and repository IDs plus the reviewed GitHub Environment.",
  );

  for (const [path, hostname] of [
    ["domains.apiDomain", data.domains.apiDomain],
    ["domains.applicationDomain", data.domains.applicationDomain],
  ] as const) {
    expect(
      isSubdomain(hostname, data.domains.rootDomain),
      issues,
      "deployment-input.domain-boundary",
      path,
      "Application hostnames must remain under the configured root domain.",
    );
  }
  expect(
    accountOfArn(data.domains.certificateArn) === data.aws.accountId &&
      regionOfArn(data.domains.certificateArn) === "us-east-1",
    issues,
    "deployment-input.certificate-target-mismatch",
    "domains.certificateArn",
    "The CloudFront certificate must be in us-east-1 and the platform account.",
  );
  const ownedUrls = [
    ["domains.privacyUrl", data.domains.privacyUrl],
    ["domains.securityUrl", data.domains.securityUrl],
    ["domains.supportUrl", data.domains.supportUrl],
    ["domains.termsUrl", data.domains.termsUrl],
    ["github.callbackUrl", data.github.callbackUrl],
    ["github.setupUrl", data.github.setupUrl],
    ["github.webhookUrl", data.github.webhookUrl],
    ["stripe.cancelUrl", data.stripe.cancelUrl],
    ["stripe.portalReturnUrl", data.stripe.portalReturnUrl],
    ["stripe.successUrl", data.stripe.successUrl],
  ] as const;
  for (const [path, value] of ownedUrls) {
    expect(
      isSubdomain(new URL(value).hostname, data.domains.rootDomain),
      issues,
      "deployment-input.url-domain-mismatch",
      path,
      "Operator URLs must use the configured Cloud Markup domain boundary.",
    );
  }
  for (const [kind, values] of [
    ["callbackUrls", data.cognito.callbackUrls],
    ["logoutUrls", data.cognito.logoutUrls],
  ] as const) {
    values.forEach((value, index) => {
      expect(
        isSubdomain(new URL(value).hostname, data.domains.rootDomain),
        issues,
        "deployment-input.cognito-url-domain-mismatch",
        `cognito.${kind}[${String(index)}]`,
        "Cognito URLs must use the configured Cloud Markup domain boundary.",
      );
    });
  }

  expect(
    data.data.database.region === data.aws.primaryRegion &&
      data.data.storage.region === data.aws.primaryRegion &&
      data.data.residency.allowedRegions.includes(data.aws.primaryRegion),
    issues,
    "deployment-input.data-region-mismatch",
    "data",
    "Database, storage, and residency inputs must include the platform primary Region.",
  );
  const environmentName = data.environment.name;
  const secretReferences = [
    data.data.database.credentials.secretReference,
    data.stripe.apiKey.secretsManagerReference,
    data.stripe.webhookSigningSecret.secretsManagerReference,
    ...(data.stripe.webhookSigningSecretPrevious === null
      ? []
      : [data.stripe.webhookSigningSecretPrevious.secretsManagerReference]),
    data.github.clientSecret.secretsManagerReference,
    data.github.privateKey.secretsManagerReference,
    data.github.webhookSecret.secretsManagerReference,
    ...data.modelRuntime.optionalProviders.adapters.map(
      ({ secret }) => secret.secretsManagerReference,
    ),
  ];
  const logicalPrefixes = [
    "cloudmarkup/" + environmentName + "/",
    "cloudmarkup-" + environmentName + "/",
  ];
  for (const [index, reference] of secretReferences.entries()) {
    const parsedReference = parseArn(reference);
    const environmentMatches =
      parsedReference === null
        ? logicalPrefixes.some((prefix) => reference.startsWith(prefix))
        : parsedReference.service === "secretsmanager" &&
          parsedReference.account === data.aws.accountId &&
          parsedReference.region === data.aws.primaryRegion &&
          logicalPrefixes.some((prefix) =>
            parsedReference.resource.startsWith("secret:" + prefix),
          );
    expect(
      environmentMatches,
      issues,
      "deployment-input.secret-environment-mismatch",
      "secretReferences[" + String(index) + "]",
      "Every secret reference must bind the exact platform environment, account, and Region.",
    );
  }

  if (data.environment.stage === "production") {
    expect(
      data.data.database.deletionProtection,
      issues,
      "deployment-input.production-deletion-protection",
      "data.database.deletionProtection",
      "Production requires database deletion protection.",
    );
    expect(
      data.cognito.mfa !== "off-beta-blocked",
      issues,
      "deployment-input.production-mfa-required",
      "cognito.mfa",
      "Production cannot disable MFA for controlled beta.",
    );
  }
  if (data.environment.stage === "beta") {
    expect(
      data.data.database.deletionProtection,
      issues,
      "deployment-input.beta-deletion-protection",
      "data.database.deletionProtection",
      "Beta requires database deletion protection.",
    );
    expect(
      data.data.backup.retentionDays >= 7,
      issues,
      "deployment-input.beta-backup-retention",
      "data.backup.retentionDays",
      "Beta requires at least seven days of database backup retention.",
    );
    expect(
      data.cognito.mfa !== "off-beta-blocked",
      issues,
      "deployment-input.beta-mfa-required",
      "cognito.mfa",
      "Beta cannot disable MFA.",
    );
    expect(
      data.features.beta,
      issues,
      "deployment-input.beta-feature-disabled",
      "features.beta",
      "The beta environment must enable controlled-beta access.",
    );
  }

  const bedrock = data.modelRuntime.amazonBedrock;
  expect(
    bedrock.primaryRegion === data.aws.primaryRegion,
    issues,
    "deployment-input.bedrock-region-mismatch",
    "modelRuntime.amazonBedrock.primaryRegion",
    "Bedrock source Region must match the reviewed platform primary Region.",
  );
  expect(
    accountOfArn(bedrock.workerIam.roleArn) === data.aws.accountId,
    issues,
    "deployment-input.bedrock-role-account-mismatch",
    "modelRuntime.amazonBedrock.workerIam.roleArn",
    "Bedrock worker role must belong to the platform account.",
  );
  const capabilities = new Map(
    bedrock.capabilities.map((capability) => [capability.id, capability]),
  );
  expect(
    capabilities.size === bedrock.capabilities.length,
    issues,
    "deployment-input.bedrock-capability-duplicate",
    "modelRuntime.amazonBedrock.capabilities",
    "Bedrock capability IDs must be unique.",
  );
  const enabledTargets = new Set<string>();
  let needsStreamingAction = false;
  for (const [routeName, route] of Object.entries(bedrock.routes)) {
    const capability = capabilities.get(route.capabilityId);
    expect(
      capability !== undefined,
      issues,
      "deployment-input.bedrock-route-capability-missing",
      `modelRuntime.amazonBedrock.routes.${routeName}.capabilityId`,
      "Every model route must reference a declared capability.",
    );
    if (capability === undefined) continue;
    expect(
      route.maximumOutputTokens <= capability.outputLimitTokens,
      issues,
      "deployment-input.bedrock-output-limit-excessive",
      `modelRuntime.amazonBedrock.routes.${routeName}.maximumOutputTokens`,
      "Route output cannot exceed the reviewed capability limit.",
    );
    expect(
      route.maximumConcurrency <=
        data.platformLimits.concurrency.modelInvocations,
      issues,
      "deployment-input.bedrock-concurrency-excessive",
      `modelRuntime.amazonBedrock.routes.${routeName}.maximumConcurrency`,
      "Route concurrency cannot exceed the reviewed platform model concurrency.",
    );
    if (route.enabled) {
      expect(
        capability.residency === bedrock.inferenceMode &&
          capability.selectedRegion === bedrock.primaryRegion,
        issues,
        "deployment-input.bedrock-residency-mismatch",
        `modelRuntime.amazonBedrock.routes.${routeName}`,
        "Enabled routes must use the approved inference mode and source Region.",
      );
      enabledTargets.add(capability.modelArn);
      if (capability.inferenceProfileArn !== null) {
        enabledTargets.add(capability.inferenceProfileArn);
      }
      needsStreamingAction ||= capability.streaming;
    }
    if (routeName === "deep" && route.enabled) {
      expect(
        route.allowedPlans.length === 1 && route.allowedPlans[0] === "pro",
        issues,
        "deployment-input.bedrock-deep-plan-overreach",
        "modelRuntime.amazonBedrock.routes.deep.allowedPlans",
        "Deep model routing is restricted to the Pro plan.",
      );
    }
    if (routeName === "strictStructuredOutput" && route.enabled) {
      expect(
        capability.structuredOutput === "native-json-schema" ||
          capability.toolUse,
        issues,
        "deployment-input.bedrock-structured-output-unsupported",
        "modelRuntime.amazonBedrock.routes.strictStructuredOutput",
        "Strict structured output requires native JSON Schema or reviewed tool-schema support.",
      );
    }
  }
  for (const target of enabledTargets) {
    expect(
      bedrock.workerIam.invocationResourceArns.includes(target),
      issues,
      "deployment-input.bedrock-iam-resource-missing",
      "modelRuntime.amazonBedrock.workerIam.invocationResourceArns",
      "Bedrock worker IAM must name every enabled model and inference-profile ARN.",
    );
  }
  expect(
    bedrock.workerIam.invocationResourceArns.length === enabledTargets.size &&
      bedrock.workerIam.invocationResourceArns.every((target) =>
        enabledTargets.has(target),
      ),
    issues,
    "deployment-input.bedrock-iam-resource-overreach",
    "modelRuntime.amazonBedrock.workerIam.invocationResourceArns",
    "Bedrock worker IAM resources must exactly match the enabled model and inference-profile targets.",
  );

  expect(
    unique(bedrock.workerIam.actions) &&
      unique(bedrock.workerIam.invocationResourceArns),
    issues,
    "deployment-input.bedrock-iam-duplicate",
    "modelRuntime.amazonBedrock.workerIam",
    "Bedrock IAM actions and resources must be unique.",
  );
  if (needsStreamingAction) {
    expect(
      bedrock.workerIam.actions.includes(
        "bedrock:InvokeModelWithResponseStream",
      ),
      issues,
      "deployment-input.bedrock-stream-permission-missing",
      "modelRuntime.amazonBedrock.workerIam.actions",
      "Streaming routes require the exact streaming invocation action.",
    );
  }
  for (const capability of bedrock.capabilities) {
    const modelArn = parseArn(capability.modelArn);
    expect(
      modelArn?.service === "bedrock" &&
        modelArn.account === "" &&
        (modelArn.region === "" ||
          modelArn.region === capability.selectedRegion),
      issues,
      "deployment-input.bedrock-model-arn-invalid",
      "modelRuntime.amazonBedrock.capabilities",
      "Foundation-model ARN must be accountless and source-Regional or global.",
    );
    if (capability.inferenceProfileArn !== null) {
      expect(
        accountOfArn(capability.inferenceProfileArn) === data.aws.accountId &&
          regionOfArn(capability.inferenceProfileArn) === bedrock.primaryRegion,
        issues,
        "deployment-input.bedrock-profile-arn-mismatch",
        "modelRuntime.amazonBedrock.capabilities",
        "Inference-profile ARN must bind the platform account and source Region.",
      );
    }
    expect(
      capability.residency === "single-region" ||
        capability.inferenceProfileArn !== null,
      issues,
      "deployment-input.bedrock-profile-required",
      "modelRuntime.amazonBedrock.capabilities",
      "Cross-Region capabilities require an inference-profile ID and ARN.",
    );
  }
  expect(
    bedrock.costControls.monthlyBudgetUsd <=
      data.platformLimits.budgets.monthlyPlatformUsd,
    issues,
    "deployment-input.bedrock-budget-mismatch",
    "modelRuntime.amazonBedrock.costControls.monthlyBudgetUsd",
    "Bedrock budget cannot exceed the reviewed platform monthly budget.",
  );
  expect(
    bedrock.routes.repair.maximumAttempts <=
      data.platformLimits.resources.maxRepairAttempts + 1,
    issues,
    "deployment-input.bedrock-repair-limit-mismatch",
    "modelRuntime.amazonBedrock.routes.repair.maximumAttempts",
    "Repair attempts must remain within the reviewed platform limit.",
  );

  const activeStripeMapping =
    data.stripe.mode === "test"
      ? data.stripe.planMappings.test
      : data.stripe.planMappings.live;
  if (data.stripe.enabled) {
    expect(
      activeStripeMapping.configured,
      issues,
      "deployment-input.stripe-mapping-missing",
      `stripe.planMappings.${data.stripe.mode}`,
      "Enabled billing requires a configured mapping for the selected Stripe mode.",
    );
  }
  for (const [mode, mapping] of Object.entries(data.stripe.planMappings)) {
    if (!mapping.configured) continue;
    expect(
      mapping.starter.credits === 200 && mapping.pro.credits === 1_000,
      issues,
      "deployment-input.stripe-credit-mapping-invalid",
      `stripe.planMappings.${mode}`,
      "Starter must map to 200 credits and Pro to 1,000 credits.",
    );
    expect(
      mapping.starter.priceId !== mapping.pro.priceId &&
        mapping.starter.productId !== mapping.pro.productId,
      issues,
      "deployment-input.stripe-plan-identity-overlap",
      `stripe.planMappings.${mode}`,
      "Starter and Pro require distinct Product and Price IDs.",
    );
  }
  if (
    data.stripe.planMappings.test.configured &&
    data.stripe.planMappings.live.configured
  ) {
    const testIds = [
      data.stripe.planMappings.test.starter.priceId,
      data.stripe.planMappings.test.starter.productId,
      data.stripe.planMappings.test.pro.priceId,
      data.stripe.planMappings.test.pro.productId,
    ];
    const liveIds = [
      data.stripe.planMappings.live.starter.priceId,
      data.stripe.planMappings.live.starter.productId,
      data.stripe.planMappings.live.pro.priceId,
      data.stripe.planMappings.live.pro.productId,
    ];
    expect(
      !testIds.some((identifier) => liveIds.includes(identifier)),
      issues,
      "deployment-input.stripe-mode-overlap",
      "stripe.planMappings",
      "Stripe test and live Product/Price identifiers must remain separated.",
    );
  }
  expect(
    data.stripe.webhookSigningSecretPrevious?.secretsManagerReference !==
      data.stripe.webhookSigningSecret.secretsManagerReference,
    issues,
    "deployment-input.stripe-webhook-secret-overlap",
    "stripe.webhookSigningSecretPrevious",
    "Current and previous webhook secret references must differ.",
  );

  const importPermissions = data.github.import.permissions;
  expect(
    importPermissions.contents === "read" &&
      importPermissions.metadata === "read" &&
      importPermissions.pullRequests === "none" &&
      importPermissions.workflows === "none",
    issues,
    "deployment-input.github-import-permission-overreach",
    "github.import.permissions",
    "Repository import must be Metadata read and Contents read only.",
  );
  const exportPermissions = data.github.export.permissions;
  expect(
    !data.github.export.enabled ||
      (exportPermissions.contents === "write" &&
        exportPermissions.metadata === "read" &&
        exportPermissions.pullRequests === "write" &&
        exportPermissions.workflows === "none"),
    issues,
    "deployment-input.github-export-permissions-invalid",
    "github.export.permissions",
    "Source export requires separate Contents/Pull requests write and no Workflows permission.",
  );
  const workflowPermissions = data.github.workflowExport.permissions;
  expect(
    !data.github.workflowExport.enabled ||
      (workflowPermissions.contents === "write" &&
        workflowPermissions.metadata === "read" &&
        workflowPermissions.pullRequests === "write" &&
        workflowPermissions.workflows === "write"),
    issues,
    "deployment-input.github-workflow-permissions-invalid",
    "github.workflowExport.permissions",
    "Workflow export requires its separately approved Workflows write permission set.",
  );
  expect(
    unique(data.repositorySync.allowedOrganizations) &&
      unique(data.repositorySync.allowedRepositories) &&
      data.repositorySync.allowedRepositories.every((repository) =>
        data.repositorySync.allowedOrganizations.includes(
          repository.split("/")[0] ?? "",
        ),
      ),
    issues,
    "deployment-input.repository-allowlist-mismatch",
    "repositorySync",
    "Repository allow-list entries must be unique and belong to an allowed organization.",
  );

  const customerCi = data.customerCiCd;
  const customerRepository = customerCi.oidc.repository;
  expect(
    customerCi.oidc.subjectPrefix ===
      `repo:${customerRepository.owner}@${customerRepository.ownerId}/${customerRepository.name}@${customerRepository.id}:environment:`,
    issues,
    "deployment-input.customer-oidc-subject-mismatch",
    "customerCiCd.oidc.subjectPrefix",
    "Customer OIDC subject prefix must bind immutable owner and repository IDs.",
  );
  expect(
    accountOfArn(customerCi.oidc.providerArn) === customerCi.target.accountId,
    issues,
    "deployment-input.customer-oidc-account-mismatch",
    "customerCiCd.oidc.providerArn",
    "Customer OIDC provider must belong to the customer target account.",
  );
  const customerRoles = [
    customerCi.roles.plan.roleArn,
    customerCi.roles.deploy.roleArn,
    customerCi.roles.drift.roleArn,
    ...(customerCi.roles.ephemeral === null
      ? []
      : [customerCi.roles.ephemeral.roleArn]),
  ];
  expect(
    unique([
      data.aws.platformDeployment.roleArn,
      bedrock.workerIam.roleArn,
      ...customerRoles,
    ]),
    issues,
    "deployment-input.role-overlap",
    "customerCiCd.roles",
    "Platform deployment, Bedrock worker, and customer CI roles must be distinct.",
  );
  expect(
    customerRoles.every(
      (roleArn) => accountOfArn(roleArn) === customerCi.target.accountId,
    ),
    issues,
    "deployment-input.customer-role-account-mismatch",
    "customerCiCd.roles",
    "Customer CI roles must belong to the declared customer target account.",
  );
  expect(
    customerCi.roles.ephemeral === null,
    issues,
    "deployment-input.customer-ephemeral-unsupported",
    "customerCiCd.roles.ephemeral",
    "Ephemeral customer environments remain unsupported pending a later contract.",
  );
  expect(
    customerCi.backend.region === customerCi.target.region &&
      regionOfArn(customerCi.backend.kmsKeyArn) === customerCi.target.region &&
      accountOfArn(customerCi.backend.kmsKeyArn) ===
        customerCi.target.accountId,
    issues,
    "deployment-input.customer-backend-mismatch",
    "customerCiCd.backend",
    "Backend Region and KMS key must match the customer target.",
  );
  expect(
    unique(
      customerCi.github.environments.map(({ name }) => name.toLowerCase()),
    ),
    issues,
    "deployment-input.customer-environment-duplicate",
    "customerCiCd.github.environments",
    "Customer GitHub Environment names must be unique ignoring case.",
  );
  if (data.features.customerDeploy) {
    const production = customerCi.github.environments.find(
      ({ name }) => name.toLowerCase() === "production",
    );
    expect(
      production !== undefined &&
        production.protected &&
        production.requiredReviewers > 0,
      issues,
      "deployment-input.customer-production-approval-missing",
      "customerCiCd.github.environments",
      "Customer deployment requires a protected production environment with reviewers.",
    );
  }

  const features = data.features;
  expect(
    !features.ai ||
      (bedrock.enabled &&
        !bedrock.costControls.killSwitch &&
        !bedrock.costControls.administrativeSuspension &&
        bedrock.dataResidencyDecision.status === "approved" &&
        bedrock.prerequisites.modelAccess.status === "approved" &&
        bedrock.prerequisites.quotas.status === "approved" &&
        bedrock.prerequisites.terms.status === "approved"),
    issues,
    "deployment-input.feature-ai-inconsistent",
    "features.ai",
    "AI requires enabled, approved, unsuspended Bedrock configuration.",
  );
  expect(
    !features.aiCustomGeneration ||
      (features.ai && features.applicationBuild && features.scanners),
    issues,
    "deployment-input.feature-custom-generation-inconsistent",
    "features.aiCustomGeneration",
    "AI custom generation requires AI, application build, and scanners.",
  );
  expect(
    !features.applicationBuild || features.scanners,
    issues,
    "deployment-input.feature-build-scanner-inconsistent",
    "features.applicationBuild",
    "Application build requires the configured scanners boundary.",
  );
  expect(
    !features.billing || data.stripe.enabled,
    issues,
    "deployment-input.feature-billing-inconsistent",
    "features.billing",
    "Billing feature requires enabled Stripe configuration.",
  );
  expect(
    features.repositoryImport === data.github.import.enabled,
    issues,
    "deployment-input.feature-import-inconsistent",
    "features.repositoryImport",
    "Repository import feature and GitHub import boundary must agree.",
  );
  expect(
    features.githubExport === data.github.export.enabled,
    issues,
    "deployment-input.feature-export-inconsistent",
    "features.githubExport",
    "GitHub export feature and source-export boundary must agree.",
  );
  expect(
    features.workflowExport === data.github.workflowExport.enabled,
    issues,
    "deployment-input.feature-workflow-inconsistent",
    "features.workflowExport",
    "Workflow export feature and Workflows permission boundary must agree.",
  );
  expect(
    features.terraform || features.cloudFormation,
    issues,
    "deployment-input.feature-iac-target-missing",
    "features",
    "At least one deterministic IaC target must remain enabled.",
  );
  expect(
    !features.customerPlan || (features.terraform && features.workflowExport),
    issues,
    "deployment-input.feature-plan-inconsistent",
    "features.customerPlan",
    "Customer planning requires Terraform and workflow export.",
  );
  expect(
    !features.customerDeploy ||
      (features.customerPlan && features.workflowExport),
    issues,
    "deployment-input.feature-deploy-inconsistent",
    "features.customerDeploy",
    "Customer deploy workflow export requires planning and workflow export.",
  );
  expect(
    !features.customerDrift ||
      (features.customerPlan && features.workflowExport),
    issues,
    "deployment-input.feature-drift-inconsistent",
    "features.customerDrift",
    "Customer drift workflow export requires planning and workflow export.",
  );
  expect(
    data.modelRuntime.optionalProviders.enabled ===
      data.modelRuntime.optionalProviders.adapters.length > 0,
    issues,
    "deployment-input.optional-provider-inconsistent",
    "modelRuntime.optionalProviders",
    "Optional providers are enabled only with separately approved adapters.",
  );
  data.modelRuntime.optionalProviders.adapters.forEach((adapter, index) => {
    expect(
      adapter.approval.status === "approved",
      issues,
      "deployment-input.optional-provider-unapproved",
      `modelRuntime.optionalProviders.adapters[${String(index)}]`,
      "Every optional provider adapter requires separate approval.",
    );
  });
  expect(
    data.platformLimits.waf.webhookRequestsPerFiveMinutes <=
      data.platformLimits.waf.apiRequestsPerFiveMinutes,
    issues,
    "deployment-input.waf-limit-mismatch",
    "platformLimits.waf",
    "Webhook WAF rate cannot exceed the aggregate API rate.",
  );
  return Object.freeze(issues);
}

function warningsFor(
  data: DeploymentInputsV1,
): readonly DeploymentInputIssueV1[] {
  return Object.freeze([
    ...(data.environment.stage === "development"
      ? [
          issue(
            "deployment-input.development-only",
            "environment.stage",
            "Development validation is not staging/production readiness or deployment authority.",
          ),
        ]
      : []),
    ...(!data.features.beta
      ? [
          issue(
            "deployment-input.beta-disabled",
            "features.beta",
            "Controlled-beta access remains disabled.",
          ),
        ]
      : []),
  ]);
}

export function validateDeploymentInputsV1(
  value: unknown,
): DeploymentInputsValidationResultV1 {
  const issues: DeploymentInputIssueV1[] = [];
  scanLiteralSecrets(value, issues);
  const stage = stageOf(value);
  if (stage === "beta" || stage === "staging" || stage === "production") {
    scanPlaceholders(value, issues);
  }
  const parsed = deploymentInputsV1StructuralSchema.safeParse(value);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      issues.push(
        issue(
          "deployment-input.schema-invalid",
          zodIssue.path.reduce<string>(
            (path, part) =>
              joinPath(path, typeof part === "symbol" ? String(part) : part),
            "",
          ),
          zodIssue.message,
        ),
      );
    }
  } else {
    issues.push(...crossValidate(parsed.data));
  }
  const deduplicated = Object.freeze(
    [
      ...new Map(
        issues.map((entry) => [
          `${entry.code}|${entry.path}|${entry.message}`,
          entry,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        compareUtf16(left.path, right.path) ||
        compareUtf16(left.code, right.code),
    ),
  );
  if (!parsed.success || deduplicated.length > 0) {
    return Object.freeze({ issues: deduplicated, valid: false, warnings: [] });
  }
  const digest = `sha256:${createHash("sha256")
    .update(canonicalize(parsed.data))
    .digest("hex")}` as const;
  return Object.freeze({
    data: parsed.data,
    digest,
    environment: parsed.data.environment,
    issues: [] as const,
    valid: true,
    warnings: warningsFor(parsed.data),
  });
}

export function parseDeploymentInputsV1(value: unknown): DeploymentInputsV1 {
  const result = validateDeploymentInputsV1(value);
  if (!result.valid) {
    throw new TypeError("Cloud Markup deployment inputs are invalid.");
  }
  return result.data;
}
