const requiredOutputKeys = [
  "AlarmTopicArn",
  "ApiUrl",
  "ApplicationUrl",
  "AwsAccountId",
  "AwsRegion",
  "CertificateArn",
  "CloudFrontDistributionDomainName",
  "CloudFrontDistributionId",
  "CognitoCallbackUrl",
  "CognitoDomain",
  "CognitoLogoutUrl",
  "CognitoPublicClientId",
  "CognitoUserPoolId",
  "DatabaseMigrationAppliedManifestSha256",
  "DatabaseMigrationAppliedVersion",
  "DatabaseMigrationCount",
  "DatabaseMigrationExpectedVersion",
  "DatabaseMigrationManifestSha256",
  "DeploymentEnvironment",
  "DirectOriginProtection",
  "DnsCreatedAutomatically",
  "DnsRecordName",
  "DnsRecordType",
  "DnsTarget",
  "DnsTargetHostedZoneId",
  "LogGroupNames",
  "PublicIngressType",
  "WebAssetsBucketName",
] as const;

const optionalOutputKeys = [
  "SolutionExportDelivery",
  "SandboxBillingDelivery",
  "StaticIngressIpv4Addresses",
  "StaticIngressIpv6Addresses",
  "OutboundEgressIpv4Addresses",
] as const;

type RequiredOutputKey = (typeof requiredOutputKeys)[number];
type OptionalOutputKey = (typeof optionalOutputKeys)[number];
type OutputKey = RequiredOutputKey | OptionalOutputKey;

const expectedStackNames = [
  "cloudmarkup-beta-application",
  "cloudmarkup-beta-edge",
  "cloudmarkup-beta-observability",
  "cloudmarkup-beta-stateful",
] as const;

const outputOwners: Readonly<
  Record<OutputKey, (typeof expectedStackNames)[number]>
> = Object.freeze({
  AlarmTopicArn: "cloudmarkup-beta-observability",
  ApiUrl: "cloudmarkup-beta-edge",
  ApplicationUrl: "cloudmarkup-beta-edge",
  AwsAccountId: "cloudmarkup-beta-edge",
  AwsRegion: "cloudmarkup-beta-edge",
  CertificateArn: "cloudmarkup-beta-edge",
  CloudFrontDistributionDomainName: "cloudmarkup-beta-edge",
  CloudFrontDistributionId: "cloudmarkup-beta-edge",
  CognitoCallbackUrl: "cloudmarkup-beta-application",
  CognitoDomain: "cloudmarkup-beta-application",
  CognitoLogoutUrl: "cloudmarkup-beta-application",
  CognitoPublicClientId: "cloudmarkup-beta-application",
  CognitoUserPoolId: "cloudmarkup-beta-application",
  DatabaseMigrationAppliedManifestSha256: "cloudmarkup-beta-application",
  DatabaseMigrationAppliedVersion: "cloudmarkup-beta-application",
  DatabaseMigrationCount: "cloudmarkup-beta-application",
  DatabaseMigrationExpectedVersion: "cloudmarkup-beta-application",
  DatabaseMigrationManifestSha256: "cloudmarkup-beta-application",
  DeploymentEnvironment: "cloudmarkup-beta-edge",
  DirectOriginProtection: "cloudmarkup-beta-application",
  DnsCreatedAutomatically: "cloudmarkup-beta-edge",
  DnsRecordName: "cloudmarkup-beta-edge",
  DnsRecordType: "cloudmarkup-beta-edge",
  DnsTarget: "cloudmarkup-beta-edge",
  DnsTargetHostedZoneId: "cloudmarkup-beta-edge",
  LogGroupNames: "cloudmarkup-beta-observability",
  SandboxBillingDelivery: "cloudmarkup-beta-application",
  SolutionExportDelivery: "cloudmarkup-beta-application",
  OutboundEgressIpv4Addresses: "cloudmarkup-beta-edge",
  PublicIngressType: "cloudmarkup-beta-edge",
  StaticIngressIpv4Addresses: "cloudmarkup-beta-edge",
  StaticIngressIpv6Addresses: "cloudmarkup-beta-edge",
  WebAssetsBucketName: "cloudmarkup-beta-edge",
});

const expectedLogGroups = Object.freeze([
  "/aws/apigateway/cloudmarkup-beta-api",
  "/aws/lambda/cloudmarkup-beta-api",
  "/aws/lambda/cloudmarkup-beta-database-migrator",
  "/aws/codebuild/cloudmarkup-beta-application-build",
  "/aws/lambda/cloudmarkup-beta-billing-webhook",
  "/aws/vendedlogs/states/cloudmarkup-beta-jobs",
  "/aws/lambda/cloudmarkup-beta-job-worker",
  "/aws/codebuild/cloudmarkup-beta-terraform-validation",
  "/aws/rds/cluster/cloudmarkup-beta-postgresql/postgresql",
  "/aws/lambda/cloudmarkup-beta-project-content-cleanup",
]);

export type DeploymentOutputs = Readonly<
  Record<RequiredOutputKey, string> & Partial<Record<OptionalOutputKey, string>>
>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function assertSafeText(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    hasControlCharacter(value) ||
    /[<>]/u.test(value) ||
    /(?:-----BEGIN|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk_(?:live|test)_|\bwhsec_|\bgh[pousr]_)/u.test(
      value,
    )
  ) {
    throw new TypeError(`${label} contains unsafe or secret-shaped text.`);
  }
}

function parseHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(`${label} must be an HTTPS URL.`);
  }
  return parsed;
}

function hostname(value: string, label: string): void {
  if (
    value.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(value)
  ) {
    throw new TypeError(`${label} must be a normalized DNS hostname.`);
  }
}

function validateOutputs(outputs: DeploymentOutputs): void {
  for (const [key, value] of Object.entries(outputs)) {
    assertSafeText(value, key);
  }
  if (outputs.DeploymentEnvironment !== "beta") {
    throw new TypeError("DeploymentEnvironment must be beta.");
  }
  if (outputs.DatabaseMigrationExpectedVersion !== "0138") {
    throw new TypeError(
      "DatabaseMigrationExpectedVersion must be the exact reviewed schema version 0138.",
    );
  }
  if (
    outputs.DatabaseMigrationAppliedVersion !==
    outputs.DatabaseMigrationExpectedVersion
  ) {
    throw new TypeError(
      "DatabaseMigrationAppliedVersion must equal the expected schema version.",
    );
  }
  if (!/^[0-9a-f]{64}$/u.test(outputs.DatabaseMigrationManifestSha256)) {
    throw new TypeError(
      "DatabaseMigrationManifestSha256 must be an exact lowercase SHA-256 digest.",
    );
  }
  if (
    outputs.DatabaseMigrationAppliedManifestSha256 !==
    outputs.DatabaseMigrationManifestSha256
  ) {
    throw new TypeError(
      "DatabaseMigrationAppliedManifestSha256 must equal the checked manifest digest.",
    );
  }
  if (outputs.DatabaseMigrationCount !== "120") {
    throw new TypeError(
      "DatabaseMigrationCount must prove all 120 checked migrations were validated.",
    );
  }
  if (outputs.AwsAccountId !== "000000000000") {
    throw new TypeError(
      "AwsAccountId must be the exact reviewed beta account.",
    );
  }
  if (outputs.AwsRegion !== "us-east-1") {
    throw new TypeError("AwsRegion must be the exact reviewed beta Region.");
  }
  if (outputs.PublicIngressType !== "CloudFront") {
    throw new TypeError("PublicIngressType must be CloudFront.");
  }
  const application = parseHttpsUrl(outputs.ApplicationUrl, "ApplicationUrl");
  if (
    application.href !== "https://beta.example.invalid/" ||
    outputs.ApplicationUrl !== "https://beta.example.invalid"
  ) {
    throw new TypeError(
      "ApplicationUrl must be the exact reviewed beta origin.",
    );
  }
  const api = parseHttpsUrl(outputs.ApiUrl, "ApiUrl");
  if (
    api.origin !== application.origin ||
    api.pathname.replace(/\/$/u, "") !== "/api"
  ) {
    throw new TypeError("ApiUrl must be the same-origin /api base URL.");
  }
  hostname(outputs.DnsRecordName, "DnsRecordName");
  if (outputs.DnsRecordName !== "beta.example.invalid") {
    throw new TypeError("DnsRecordName must be the exact reviewed beta host.");
  }
  hostname(outputs.DnsTarget, "DnsTarget");
  hostname(
    outputs.CloudFrontDistributionDomainName,
    "CloudFrontDistributionDomainName",
  );
  if (
    outputs.DnsTarget !== outputs.CloudFrontDistributionDomainName ||
    !outputs.DnsTarget.endsWith(".cloudfront.net")
  ) {
    throw new TypeError(
      "DnsTarget must be the CloudFront distribution domain.",
    );
  }
  if (
    outputs.DnsRecordType !== "A and AAAA alias" &&
    outputs.DnsRecordType !== "CNAME"
  ) {
    throw new TypeError("DnsRecordType is unsupported.");
  }
  if (
    (outputs.DnsCreatedAutomatically === "true" &&
      outputs.DnsRecordType !== "A and AAAA alias") ||
    (outputs.DnsCreatedAutomatically === "false" &&
      outputs.DnsRecordType !== "CNAME")
  ) {
    throw new TypeError(
      "DnsCreatedAutomatically and DnsRecordType must describe the same DNS ownership mode.",
    );
  }
  if (outputs.DnsTargetHostedZoneId !== "Z2FDTNDATAQYW2") {
    throw new TypeError(
      "DnsTargetHostedZoneId must be the canonical CloudFront alias zone.",
    );
  }
  if (!/^E[A-Z0-9]{6,31}$/u.test(outputs.CloudFrontDistributionId)) {
    throw new TypeError("CloudFrontDistributionId is invalid.");
  }
  const certificatePattern = new RegExp(
    `^arn:aws:acm:us-east-1:${outputs.AwsAccountId}:certificate/[0-9a-f-]{36}$`,
    "u",
  );
  if (!certificatePattern.test(outputs.CertificateArn)) {
    throw new TypeError(
      "CertificateArn must be a us-east-1 certificate in the target account.",
    );
  }
  if (
    !/^[a-z0-9-]{1,63}_[A-Za-z0-9]{1,128}$/u.test(outputs.CognitoUserPoolId) ||
    !outputs.CognitoUserPoolId.startsWith("us-east-1_")
  ) {
    throw new TypeError("CognitoUserPoolId is invalid.");
  }
  if (!/^[a-z0-9]{10,128}$/u.test(outputs.CognitoPublicClientId)) {
    throw new TypeError("CognitoPublicClientId is invalid.");
  }
  const cognito = parseHttpsUrl(outputs.CognitoDomain, "CognitoDomain");
  if (
    cognito.pathname !== "/" ||
    outputs.CognitoDomain !==
      "https://cloudmarkup-beta-000000000000.auth.us-east-1.amazoncognito.com"
  ) {
    throw new TypeError("CognitoDomain must use the target Cognito Region.");
  }
  if (
    outputs.CognitoCallbackUrl !== `${outputs.ApplicationUrl}/auth/callback` ||
    outputs.CognitoLogoutUrl !== outputs.ApplicationUrl
  ) {
    throw new TypeError(
      "Cognito callback and logout URLs must bind the public application.",
    );
  }
  if (
    outputs.WebAssetsBucketName !==
    "cloudmarkup-beta-000000000000-us-east-1-web"
  ) {
    throw new TypeError("WebAssetsBucketName is outside the beta namespace.");
  }
  if (
    outputs.AlarmTopicArn !==
    "arn:aws:sns:us-east-1:000000000000:cloudmarkup-beta-alarms"
  ) {
    throw new TypeError(
      "AlarmTopicArn must bind the target account and Region.",
    );
  }
  let logGroups: unknown;
  try {
    logGroups = JSON.parse(outputs.LogGroupNames);
  } catch {
    throw new TypeError("LogGroupNames must be a JSON array.");
  }
  const billingDelivery = outputs.SandboxBillingDelivery;
  if (
    billingDelivery !== undefined &&
    billingDelivery !== "stripe-test-fifo-v1"
  ) {
    throw new TypeError(
      "SandboxBillingDelivery must be the exact reviewed test composition.",
    );
  }
  const exportDelivery = outputs.SolutionExportDelivery;
  if (
    exportDelivery !== undefined &&
    (exportDelivery !== "cloudformation-export-v1" ||
      billingDelivery !== "stripe-test-fifo-v1")
  ) {
    throw new TypeError(
      "SolutionExportDelivery requires the exact reviewed export and sandbox composition.",
    );
  }
  const configuredLogGroups = [
    ...expectedLogGroups.slice(0, -1),
    ...(exportDelivery === undefined
      ? []
      : ["/aws/lambda/cloudmarkup-beta-solution-export-worker"]),
    ...expectedLogGroups.slice(-1),
    ...(billingDelivery === undefined
      ? []
      : ["/aws/lambda/cloudmarkup-beta-billing-worker"]),
  ];
  if (
    !Array.isArray(logGroups) ||
    JSON.stringify(logGroups) !== JSON.stringify(configuredLogGroups)
  ) {
    throw new TypeError(
      "LogGroupNames must list the exact ten beta log groups and only the declared export and sandbox delivery workers.",
    );
  }
  if (
    outputs.DnsCreatedAutomatically !== "false" &&
    outputs.DnsCreatedAutomatically !== "true"
  ) {
    throw new TypeError("DnsCreatedAutomatically must be true or false.");
  }
  if (
    outputs.DirectOriginProtection !==
    "regional-waf-secrets-manager-edge-marker-required"
  ) {
    throw new TypeError("DirectOriginProtection is invalid.");
  }
  for (const key of [
    "StaticIngressIpv4Addresses",
    "StaticIngressIpv6Addresses",
    "OutboundEgressIpv4Addresses",
  ] as const) {
    if (outputs[key] !== undefined && outputs[key] !== "none") {
      throw new TypeError(
        `${key} must be absent or none for this architecture.`,
      );
    }
  }
}

export function collectDeploymentOutputs(value: unknown): DeploymentOutputs {
  const document = record(value, "CDK outputs");
  const actualStackNames = Object.keys(document).sort();
  if (
    JSON.stringify(actualStackNames) !== JSON.stringify([...expectedStackNames])
  ) {
    throw new TypeError(
      "CDK outputs must contain exactly the four reviewed beta stacks.",
    );
  }
  const collected = new Map<string, string>();
  for (const [stackName, rawStackOutputs] of Object.entries(document).sort(
    ([left], [right]) => (left === right ? 0 : left < right ? -1 : 1),
  )) {
    const stackOutputs = record(rawStackOutputs, `outputs for ${stackName}`);
    for (const key of [...requiredOutputKeys, ...optionalOutputKeys]) {
      const candidate = stackOutputs[key];
      if (candidate === undefined) continue;
      if (outputOwners[key] !== stackName) {
        throw new TypeError(
          `${key} must be emitted only by ${outputOwners[key]}.`,
        );
      }
      if (typeof candidate !== "string") {
        throw new TypeError(`${stackName}.${key} must be a string.`);
      }
      const previous = collected.get(key);
      if (previous !== undefined && previous !== candidate) {
        throw new TypeError(`Conflicting CDK output ${key}.`);
      }
      collected.set(key, candidate);
    }
  }
  const missing = requiredOutputKeys.filter((key) => !collected.has(key));
  if (missing.length > 0) {
    throw new TypeError(`Missing CDK outputs: ${missing.join(", ")}.`);
  }
  const outputs = Object.fromEntries(collected) as DeploymentOutputs;
  validateOutputs(outputs);
  return Object.freeze(outputs);
}

export function serializeDeploymentOutputs(outputs: DeploymentOutputs): string {
  validateOutputs(outputs);
  return `${JSON.stringify(outputs, null, 2)}\n`;
}

function inline(value: string): string {
  return "`" + value + "`";
}

export function renderDeploymentHandoff(outputs: DeploymentOutputs): string {
  validateOutputs(outputs);
  const dnsCreated = outputs.DnsCreatedAutomatically === "true";
  const logGroups = JSON.parse(outputs.LogGroupNames) as string[];
  const dnsInstructions = dnsCreated
    ? [
        "- DNS mode: the Edge stack created Route 53 A and AAAA alias records.",
        `- Record: ${inline(outputs.DnsRecordName)} → ${inline(outputs.DnsTarget)}.`,
      ]
    : [
        "- DNS mode: manual; the stack did not modify DNS.",
        `- Create ${inline(outputs.DnsRecordType)} record ${inline(outputs.DnsRecordName)} pointing to ${inline(outputs.DnsTarget)}.`,
        `- For a Route 53 alias, use CloudFront hosted-zone ID ${inline(outputs.DnsTargetHostedZoneId)} and create both A and AAAA aliases.`,
      ];
  return [
    "# Cloud Markup beta deployment handoff",
    "",
    "This deterministic handoff contains non-secret CloudFormation outputs only.",
    "",
    "## Deployment",
    "",
    `- Environment: ${inline(outputs.DeploymentEnvironment)}`,
    `- AWS account: ${inline(outputs.AwsAccountId)}`,
    `- AWS Region: ${inline(outputs.AwsRegion)}`,
    `- Public ingress: ${inline(outputs.PublicIngressType)} (no static ingress IP)`,
    `- Application: ${inline(outputs.ApplicationUrl)}`,
    `- API: ${inline(outputs.ApiUrl)}`,
    "",
    "## DNS and certificate",
    "",
    ...dnsInstructions,
    `- ACM certificate: ${inline(outputs.CertificateArn)} (must already be issued in us-east-1).`,
    "- No certificate-validation record is emitted because the stack consumes an existing certificate.",
    "",
    "## CloudFront and web assets",
    "",
    `- Distribution ID: ${inline(outputs.CloudFrontDistributionId)}`,
    `- Distribution domain: ${inline(outputs.CloudFrontDistributionDomainName)}`,
    `- Private web bucket: ${inline(outputs.WebAssetsBucketName)}`,
    "- The beta assembly deploys the reviewed web build and invalidates `/*` through CloudFormation.",
    "",
    "## Authentication",
    "",
    `- User pool: ${inline(outputs.CognitoUserPoolId)}`,
    `- Public SPA client: ${inline(outputs.CognitoPublicClientId)}`,
    `- Cognito managed-login domain: ${inline(outputs.CognitoDomain)}`,
    `- Callback URL: ${inline(outputs.CognitoCallbackUrl)}`,
    `- Logout URL: ${inline(outputs.CognitoLogoutUrl)}`,
    `- Direct-origin protection: ${inline(outputs.DirectOriginProtection)}`,
    "",
    "## Operations",
    "",
    `- Database schema version: ${inline(outputs.DatabaseMigrationAppliedVersion)} (expected ${inline(outputs.DatabaseMigrationExpectedVersion)})`,
    `- Migration manifest SHA-256: ${inline(outputs.DatabaseMigrationAppliedManifestSha256)}`,
    `- Validated migration count: ${inline(outputs.DatabaseMigrationCount)}`,
    `- Alarm topic: ${inline(outputs.AlarmTopicArn)}`,
    ...logGroups.map((name) => `- Log group: ${inline(name)}`),
    "",
    "## Smoke checks",
    "",
    "Run only after CloudFormation, certificate, and DNS are healthy:",
    "",
    "~~~sh",
    `curl --fail --silent --show-error --max-time 30 '${outputs.ApplicationUrl}/'`,
    `curl --fail --silent --show-error --max-time 30 '${outputs.ApiUrl}/health'`,
    `curl --fail --silent --show-error --max-time 30 '${outputs.ApiUrl}/ready'`,
    "~~~",
    "",
    "A failed smoke check must fail the release; it must not destroy retained state.",
    "",
  ].join("\n");
}
