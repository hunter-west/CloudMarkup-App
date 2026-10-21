import {
  BETA_CLOUDFORMATION_PROFILE,
  BETA_LIVE_PROFILE,
  BETA_EXPORT_LAYER,
  validateBetaSolutionExport,
} from "./beta-solution-export-admission.mjs";
import {
  parseBetaServiceProfile,
  validateBetaSandboxDelivery,
} from "./beta-sandbox-delivery-admission.mjs";

const BETA_PROJECT_CLEANUP_SCHEMA_CHECKSUM =
  "b5cd0bcb42f94baaa6266ed43e0222a89af7c4bd2b84535d9e6949a5c7a0ad4b";

export const BETA_RELEASE_EXPECTED = Object.freeze({
  accountId: "000000000000",
  baseUrl: "https://beta.example.invalid",
  environment: "beta",
  region: "us-east-1",
  roleArn: "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub",
});

export const BETA_REQUIRED_OUTPUTS = Object.freeze([
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
]);

const expectedStackNames = Object.freeze([
  "cloudmarkup-beta-application",
  "cloudmarkup-beta-edge",
  "cloudmarkup-beta-observability",
  "cloudmarkup-beta-stateful",
]);

const forbiddenBuildMarkers = [
  "VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN",
  "Local preview - authentication not connected",
  "local mock capability",
  "cloudmarkup-local",
  "Sign in unavailable",
  "Authentication is not configured",
  "Authentication callback placeholder",
  "No identity provider is connected",
  "Invitation placeholder",
];
const requiredWebAuthenticationMarker =
  "cloudmarkup.auth-composition/cognito-pkce-v1";
export const BETA_WEB_BRAND_ASSETS = Object.freeze([
  Object.freeze({
    byteLength: 14_068,
    path: "app-icon-192.png",
    sha256: "095ac95ff35ffd1827f575517d1e21d793d338517eb04b505321ea7dc69124b2",
  }),
  Object.freeze({
    byteLength: 76_220,
    path: "app-icon-512.png",
    sha256: "e709f179d32d7cf347310deaa7336257aecded9a28efe80c02f3f2e13c47890f",
  }),
  Object.freeze({
    byteLength: 12_644,
    path: "apple-touch-icon.png",
    sha256: "72821d128eb2a35071c1bcaea0509c8c47278991a09c5c0c579c1f8dc52bacbe",
  }),
  Object.freeze({
    byteLength: 313_933,
    path: "cloudmarkup-logo.png",
    sha256: "5de84bce69f6348cb1c8a2272c4bc966dcde444c87df0808f48dbae953e70bf6",
  }),
  Object.freeze({
    byteLength: 34_983,
    path: "favicon.ico",
    sha256: "642c6ea593ac33a7af644bb6fb3e5fec71abd33b52095b5782b564d14889bcc2",
  }),
]);
const expectedWebManifest = Object.freeze({
  id: "/",
  name: "Cloud Markup",
  short_name: "Cloud Markup",
  description: "Design, validate, and review professional cloud architecture.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: [
    {
      src: "/app-icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/app-icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ],
});
const requiredApiCompositionMarker =
  "cloudmarkup.api-composition/cognito-rds-s3-v1";
const betaAssetBucketName =
  "cloudmarkup-beta-cdk-assets-000000000000-us-east-1";
const betaAssetKeyPattern = /^assets\/([0-9a-f]{64})\.zip$/u;
const bootstrapApiHeadersExport =
  "cloudmarkup-beta-bootstrap:ApiSecurityHeadersPolicyId";
const bootstrapPublicAssetHeadersExport =
  "cloudmarkup-beta-bootstrap:PublicAssetHeadersPolicyId";
const publicAssetPathPatterns = [
  "/assets/*-????????.js",
  "/assets/*-????????.css",
];
const bootstrapSecurityHeadersExport =
  "cloudmarkup-beta-bootstrap:SecurityHeadersPolicyId";
const bootstrapWebOriginAccessControlExport =
  "cloudmarkup-beta-bootstrap:WebOriginAccessControlId";
const reviewedApiPrefixFunction = Object.freeze({
  code: `
function handler(event) {
  var request = event.request;
  if (request.uri === '/api') {
    request.uri = '/';
  } else if (request.uri.indexOf('/api/') === 0) {
    request.uri = request.uri.substring(4);
  }
  return request;
}`,
  comment: "Remove the browser-only /api prefix before HTTP API routing",
  name: "cloudmarkup-beta-strip-api-prefix",
  runtime: "cloudfront-js-2.0",
});
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObjectKeys(value, keys) {
  return (
    plain(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function exactRef(value, logicalId) {
  return exactObjectKeys(value, ["Ref"]) && value.Ref === logicalId;
}

function exactGetAtt(value, logicalId, attribute) {
  const getAtt = plain(value) ? value["Fn::GetAtt"] : undefined;
  return (
    exactObjectKeys(value, ["Fn::GetAtt"]) &&
    Array.isArray(getAtt) &&
    getAtt.length === 2 &&
    getAtt[0] === logicalId &&
    getAtt[1] === attribute
  );
}

function exactImportValue(value, exportName) {
  return (
    exactObjectKeys(value, ["Fn::ImportValue"]) &&
    value["Fn::ImportValue"] === exportName
  );
}

function exactSecretDynamicImport(value, exportName) {
  const join = plain(value) ? value["Fn::Join"] : undefined;
  const parts = Array.isArray(join) ? join[1] : undefined;
  const importValue = Array.isArray(parts) ? parts[1] : undefined;
  return (
    typeof exportName === "string" &&
    exactObjectKeys(value, ["Fn::Join"]) &&
    Array.isArray(join) &&
    join.length === 2 &&
    join[0] === "" &&
    Array.isArray(parts) &&
    parts.length === 3 &&
    parts[0] === "{{resolve:secretsmanager:" &&
    exactObjectKeys(importValue, ["Fn::ImportValue"]) &&
    importValue["Fn::ImportValue"] === exportName &&
    parts[2] === ":SecretString:::}}"
  );
}

function matchesReviewedApiPrefixFunction(resource) {
  const properties = resource?.Properties;
  const config = properties?.FunctionConfig;
  return (
    resource?.Type === "AWS::CloudFront::Function" &&
    resource.Condition === undefined &&
    properties?.AutoPublish === true &&
    properties?.FunctionCode === reviewedApiPrefixFunction.code &&
    exactObjectKeys(config, ["Comment", "Runtime"]) &&
    config.Comment === reviewedApiPrefixFunction.comment &&
    config.Runtime === reviewedApiPrefixFunction.runtime &&
    properties?.Name === reviewedApiPrefixFunction.name
  );
}

function exactRegionalStageArn(value, restApiLogicalId, stageLogicalId) {
  const join = plain(value) ? value["Fn::Join"] : undefined;
  const parts = Array.isArray(join) ? join[1] : undefined;
  return (
    exactObjectKeys(value, ["Fn::Join"]) &&
    Array.isArray(join) &&
    join.length === 2 &&
    join[0] === "" &&
    Array.isArray(parts) &&
    parts.length === 6 &&
    parts[0] === "arn:" &&
    exactRef(parts[1], "AWS::Partition") &&
    parts[2] === `:apigateway:${BETA_RELEASE_EXPECTED.region}::/restapis/` &&
    exactRef(parts[3], restApiLogicalId) &&
    parts[4] === "/stages/" &&
    exactRef(parts[5], stageLogicalId)
  );
}

function matchesBetaCloudFrontRateRule(
  rule,
  { limit, name, pathPrefix, priority },
) {
  if (!plain(rule)) return false;
  const rate = rule.Statement?.RateBasedStatement;
  const byteMatch = rate?.ScopeDownStatement?.ByteMatchStatement;
  const transformations = byteMatch?.TextTransformations;
  const uriPath = byteMatch?.FieldToMatch?.UriPath;
  return (
    rule.Name === name &&
    rule.Priority === priority &&
    rule.Action?.Block?.CustomResponse?.ResponseCode === 429 &&
    rule.VisibilityConfig?.CloudWatchMetricsEnabled === true &&
    rule.VisibilityConfig?.MetricName === name &&
    rule.VisibilityConfig?.SampledRequestsEnabled === false &&
    rate?.AggregateKeyType === "IP" &&
    rate?.EvaluationWindowSec === 300 &&
    rate?.Limit === limit &&
    plain(uriPath) &&
    Object.keys(uriPath).length === 0 &&
    byteMatch?.PositionalConstraint === "STARTS_WITH" &&
    byteMatch?.SearchString === pathPrefix &&
    Array.isArray(transformations) &&
    transformations.length === 1 &&
    transformations[0]?.Priority === 0 &&
    transformations[0]?.Type === "NONE"
  );
}

function finding(code, path, detail) {
  return { code, detail, path };
}

function valueAt(record, key) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export function validateBetaReleaseEnvironment(environment, options = {}) {
  const findings = [];
  try {
    parseBetaServiceProfile(environment);
  } catch {
    findings.push(
      finding(
        "BETA_SERVICE_PROFILE_INVALID",
        "BETA_SERVICE_PROFILE",
        "The beta service profile must be an exact reviewed core, sandbox, GitHub connections or restricted CloudFormation variant.",
      ),
    );
  }
  const requireActivation = options.requireActivation !== false;
  const required = [
    "AWS_ACCOUNT_ID",
    "AWS_REGION",
    "BETA_BASE_URL",
    "BETA_CERTIFICATE_ARN",
    "BETA_CREATE_DNS_RECORDS",
    "CLOUDMARKUP_ENVIRONMENT",
  ];
  if (requireActivation) {
    required.push(
      "AWS_ROLE_ARN",
      "DEPLOYMENT_BUNDLE_SHA256",
      "GITHUB_SHA",
      "SOURCE_REVISION",
    );
  }
  for (const key of required) {
    if (valueAt(environment, key).length === 0) {
      findings.push(
        finding(
          "BETA_INPUT_MISSING",
          key,
          "A required non-secret beta deployment input is missing.",
        ),
      );
    }
  }

  if (
    valueAt(environment, "CLOUDMARKUP_ENVIRONMENT") !==
    BETA_RELEASE_EXPECTED.environment
  ) {
    findings.push(
      finding(
        "BETA_ENVIRONMENT_NOT_APPROVED",
        "CLOUDMARKUP_ENVIRONMENT",
        "Only the explicit beta profile is approved for a networked beta.",
      ),
    );
  }
  if (
    valueAt(environment, "AWS_ACCOUNT_ID") !== BETA_RELEASE_EXPECTED.accountId
  ) {
    findings.push(
      finding(
        "BETA_ACCOUNT_MISMATCH",
        "AWS_ACCOUNT_ID",
        "The beta account must match the reviewed non-secret account coordinate.",
      ),
    );
  }
  if (valueAt(environment, "AWS_REGION") !== BETA_RELEASE_EXPECTED.region) {
    findings.push(
      finding(
        "BETA_REGION_MISMATCH",
        "AWS_REGION",
        "The beta Region must match the reviewed non-secret Region coordinate.",
      ),
    );
  }
  if (
    requireActivation &&
    valueAt(environment, "AWS_ROLE_ARN") !== BETA_RELEASE_EXPECTED.roleArn
  ) {
    findings.push(
      finding(
        "BETA_ROLE_MISMATCH",
        "AWS_ROLE_ARN",
        "The deployment role must match the reviewed Development OIDC role ARN.",
      ),
    );
  }
  if (
    requireActivation &&
    !/^[0-9a-f]{64}$/u.test(valueAt(environment, "DEPLOYMENT_BUNDLE_SHA256"))
  ) {
    findings.push(
      finding(
        "BETA_DEPLOYMENT_BUNDLE_DIGEST_INVALID",
        "DEPLOYMENT_BUNDLE_SHA256",
        "The same-run deployment bundle must be bound to an exact path-and-byte digest.",
      ),
    );
  }
  if (
    requireActivation &&
    (!/^[0-9a-f]{40}$/u.test(valueAt(environment, "GITHUB_SHA")) ||
      valueAt(environment, "SOURCE_REVISION") !==
        valueAt(environment, "GITHUB_SHA"))
  ) {
    findings.push(
      finding(
        "BETA_SOURCE_REVISION_MISMATCH",
        "SOURCE_REVISION",
        "The deployment bundle must identify the exact triggering commit.",
      ),
    );
  }
  if (valueAt(environment, "BETA_BASE_URL") !== BETA_RELEASE_EXPECTED.baseUrl) {
    findings.push(
      finding(
        "BETA_BASE_URL_INVALID",
        "BETA_BASE_URL",
        "The first beta origin must be exactly https://beta.example.invalid.",
      ),
    );
  }

  const certificateArn = valueAt(environment, "BETA_CERTIFICATE_ARN");
  const certificatePattern = new RegExp(
    `^arn:aws:acm:${BETA_RELEASE_EXPECTED.region}:${BETA_RELEASE_EXPECTED.accountId}:certificate/[0-9a-f-]{36}$`,
    "u",
  );
  if (!certificatePattern.test(certificateArn)) {
    findings.push(
      finding(
        "BETA_CERTIFICATE_ARN_INVALID",
        "BETA_CERTIFICATE_ARN",
        "The certificate must be an exact ACM ARN in the reviewed account and us-east-1.",
      ),
    );
  }

  const createDns = valueAt(environment, "BETA_CREATE_DNS_RECORDS");
  if (createDns !== "false") {
    findings.push(
      finding(
        "BETA_DNS_MODE_INVALID",
        "BETA_CREATE_DNS_RECORDS",
        "Controlled beta DNS is owned by the separate DNS account, so application-stack Route 53 creation must remain exactly lowercase false.",
      ),
    );
  }

  return findings;
}

export function validateBetaWebBuild(files) {
  const findings = [];
  const fileNames = files.map(({ path }) => path);
  const filesByPath = new Map();
  for (const file of files) {
    if (filesByPath.has(file.path)) {
      findings.push(
        finding(
          "BETA_WEB_DUPLICATE_FILE",
          file.path,
          "The production web build cannot contain duplicate file paths.",
        ),
      );
      continue;
    }
    filesByPath.set(file.path, file);
  }
  let combinedJavaScript = "";
  if (!fileNames.includes("index.html")) {
    findings.push(
      finding(
        "BETA_WEB_INDEX_MISSING",
        "apps/web/dist/index.html",
        "The production web build must contain index.html.",
      ),
    );
  }
  if (!fileNames.some((path) => /^assets\/.+\.js$/u.test(path))) {
    findings.push(
      finding(
        "BETA_WEB_JAVASCRIPT_MISSING",
        "apps/web/dist/assets",
        "The production web build must contain a bundled JavaScript asset.",
      ),
    );
  }
  for (const expected of BETA_WEB_BRAND_ASSETS) {
    const actual = filesByPath.get(expected.path);
    if (actual === undefined) {
      findings.push(
        finding(
          "BETA_WEB_BRAND_ASSET_MISSING",
          `apps/web/dist/${expected.path}`,
          "The production web build must contain the reviewed local Cloud Markup brand asset.",
        ),
      );
    } else if (
      actual.byteLength !== expected.byteLength ||
      actual.sha256 !== expected.sha256
    ) {
      findings.push(
        finding(
          "BETA_WEB_BRAND_ASSET_INVALID",
          `apps/web/dist/${expected.path}`,
          "The production web brand asset does not match the reviewed local byte identity.",
        ),
      );
    }
  }

  const index = filesByPath.get("index.html");
  const requiredBrandMetadata = [
    /<link\b(?=[^>]*\brel="icon")(?=[^>]*\bhref="\/favicon\.ico")(?=[^>]*\bsizes="any")(?=[^>]*\btype="image\/x-icon")[^>]*>/iu,
    /<link\b(?=[^>]*\brel="icon")(?=[^>]*\bhref="\/app-icon-192\.png")(?=[^>]*\bsizes="192x192")(?=[^>]*\btype="image\/png")[^>]*>/iu,
    /<link\b(?=[^>]*\brel="apple-touch-icon")(?=[^>]*\bhref="\/apple-touch-icon\.png")(?=[^>]*\bsizes="180x180")(?=[^>]*\btype="image\/png")[^>]*>/iu,
    /<link\b(?=[^>]*\brel="manifest")(?=[^>]*\bhref="\/site\.webmanifest")[^>]*>/iu,
  ];
  if (
    typeof index?.text !== "string" ||
    !requiredBrandMetadata.every((pattern) => pattern.test(index.text))
  ) {
    findings.push(
      finding(
        "BETA_WEB_BRAND_METADATA_INVALID",
        "apps/web/dist/index.html",
        "The production web document must link the reviewed favicon, app icon, Apple touch icon, and manifest.",
      ),
    );
  }

  const manifest = filesByPath.get("site.webmanifest");
  let parsedManifest;
  if (typeof manifest?.text === "string") {
    try {
      parsedManifest = JSON.parse(manifest.text);
    } catch {
      // The bounded finding below intentionally exposes no manifest content.
    }
  }
  if (
    parsedManifest === undefined ||
    JSON.stringify(parsedManifest) !== JSON.stringify(expectedWebManifest)
  ) {
    findings.push(
      finding(
        "BETA_WEB_MANIFEST_INVALID",
        "apps/web/dist/site.webmanifest",
        "The production web manifest must bind the reviewed Cloud Markup identity and local 192/512 pixel icons.",
      ),
    );
  }
  for (const file of files) {
    if (typeof file.text !== "string") continue;
    if (file.path.endsWith(".js")) combinedJavaScript += file.text;
    if (
      // Match the local host as a hostname, including bare or URL forms, but
      // not its letters inside a different name such as "localhost-only".
      /(?<![a-z0-9_-])(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?(?![a-z0-9_-])/iu.test(
        file.text,
      )
    ) {
      findings.push(
        finding(
          "BETA_WEB_LOCAL_URL",
          file.path,
          "The production web build contains a localhost URL.",
        ),
      );
    }
    for (const marker of forbiddenBuildMarkers) {
      if (file.text.includes(marker)) {
        findings.push(
          finding(
            "BETA_WEB_LOCAL_COMPOSITION",
            file.path,
            "The production web build contains a local or mock identity/composition marker.",
          ),
        );
        break;
      }
    }
    if (
      /VITE_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/u.test(file.text)
    ) {
      findings.push(
        finding(
          "BETA_WEB_PUBLIC_SECRET_VARIABLE",
          file.path,
          "A secret-shaped Vite variable is present in public browser code.",
        ),
      );
    }
    if (
      /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk_live_[A-Za-z0-9]{12,}\b|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----)/u.test(
        file.text,
      )
    ) {
      findings.push(
        finding(
          "BETA_WEB_SECRET_LITERAL",
          file.path,
          "The production web build contains a high-confidence secret literal.",
        ),
      );
    }
  }
  if (!combinedJavaScript.includes(requiredWebAuthenticationMarker)) {
    findings.push(
      finding(
        "BETA_WEB_AUTH_COMPOSITION_MISSING",
        "apps/web/dist",
        "The production web build must contain the reviewed Cognito Authorization Code + PKCE/session/logout composition marker; the preceding browser gates must supply integration evidence.",
      ),
    );
  }
  return findings;
}

export function validateBetaApiBuild(files) {
  const findings = [];
  const byPath = new Map(
    files
      .filter(({ text }) => typeof text === "string")
      .map(({ path, text }) => [path, text]),
  );
  const lambda = byPath.get("lambda.js");
  const composition = byPath.get("production-composition.js");
  if (lambda === undefined) {
    findings.push(
      finding(
        "BETA_API_LAMBDA_ENTRY_MISSING",
        "apps/api/dist/lambda.js",
        "The production API Lambda build entry is missing.",
      ),
    );
  } else if (
    !lambda.includes("./production-composition.js") ||
    lambda.includes('from "./app.js"') ||
    lambda.includes("from './app.js'")
  ) {
    findings.push(
      finding(
        "BETA_API_PRODUCTION_ENTRY_MISSING",
        "apps/api/dist/lambda.js",
        "The Lambda entry must import the reviewed production composition rather than the unavailable default application.",
      ),
    );
  }
  if (
    composition === undefined ||
    !composition.includes(requiredApiCompositionMarker)
  ) {
    findings.push(
      finding(
        "BETA_API_PRODUCTION_COMPOSITION_MISSING",
        "apps/api/dist/production-composition.js",
        "The API build must contain the reviewed Cognito/RDS/S3 production composition marker; the preceding API gates must supply integration evidence.",
      ),
    );
  }
  if (
    composition !== undefined &&
    /(?:anonymousPrincipalResolver|unavailableApplication|InMemoryCloudMarkupApplication|createRepositoryBackedLocalApplication|local-development|testing\/in-memory-adapters)/u.test(
      composition,
    )
  ) {
    findings.push(
      finding(
        "BETA_API_UNAVAILABLE_COMPOSITION",
        "apps/api/dist/production-composition.js",
        "The production API composition contains an unavailable, anonymous, in-memory, or local-only adapter.",
      ),
    );
  }
  return findings;
}

function validateBetaApiBundle(files, path) {
  const findings = [];
  const javaScript = files
    .filter((file) => /\.m?js$/u.test(file.path))
    .map((file) => file.text)
    .join("\n");
  if (javaScript.length === 0) {
    findings.push(
      finding(
        "BETA_API_DEPLOYABLE_JAVASCRIPT_MISSING",
        path,
        "The exact deployable API asset must contain JavaScript.",
      ),
    );
    return findings;
  }
  if (!javaScript.includes(requiredApiCompositionMarker)) {
    findings.push(
      finding(
        "BETA_API_DEPLOYABLE_COMPOSITION_MISSING",
        path,
        "The exact deployable API asset must contain the reviewed Cognito/RDS/S3 production composition marker; the preceding API gates must supply integration evidence.",
      ),
    );
  }
  if (
    /(?:anonymousPrincipalResolver|unavailableApplication|InMemoryCloudMarkupApplication|createRepositoryBackedLocalApplication|local-development|testing\/in-memory-adapters)/u.test(
      javaScript,
    )
  ) {
    findings.push(
      finding(
        "BETA_API_DEPLOYABLE_UNAVAILABLE_COMPOSITION",
        path,
        "The exact deployable API asset contains an unavailable, anonymous, in-memory, or local-only composition marker.",
      ),
    );
  }
  return findings;
}

function validateDeployableAssets(stacks, assets) {
  const findings = [];
  const stackByName = new Map(stacks.map((stack) => [stack.stackName, stack]));
  const application = stackByName.get("cloudmarkup-beta-application");
  const apiFunctions =
    application === undefined
      ? []
      : resourcesOf(application).filter(
          ([, resource]) =>
            resource.Type === "AWS::Lambda::Function" &&
            resource.Properties?.FunctionName === "cloudmarkup-beta-api",
        );
  const apiCode = apiFunctions[0]?.[1]?.Properties?.Code;
  const apiKey = apiCode?.S3Key;
  const apiAssetId =
    apiFunctions.length === 1 &&
    exactObjectKeys(apiCode, ["S3Bucket", "S3Key"]) &&
    apiCode.S3Bucket === betaAssetBucketName &&
    typeof apiKey === "string"
      ? betaAssetKeyPattern.exec(apiKey)?.[1]
      : undefined;

  const edge = stackByName.get("cloudmarkup-beta-edge");
  const webDeployments =
    edge === undefined
      ? []
      : resourcesOf(edge).filter(
          ([, resource]) =>
            new Set([
              "Custom::CDKBucketDeployment",
              "AWS::CloudFormation::CustomResource",
            ]).has(resource.Type) &&
            Array.isArray(resource.Properties?.DistributionPaths) &&
            resource.Properties.DistributionPaths.length === 1 &&
            resource.Properties.DistributionPaths[0] === "/*",
        );
  const webKeys = webDeployments[0]?.[1]?.Properties?.SourceObjectKeys;
  const webBuckets = webDeployments[0]?.[1]?.Properties?.SourceBucketNames;
  const webAssetId =
    webDeployments.length === 1 &&
    Array.isArray(webBuckets) &&
    webBuckets.length === 1 &&
    webBuckets[0] === betaAssetBucketName &&
    Array.isArray(webKeys) &&
    webKeys.length === 1 &&
    typeof webKeys[0] === "string"
      ? betaAssetKeyPattern.exec(webKeys[0])?.[1]
      : undefined;

  for (const requirement of [
    {
      assetId: apiAssetId,
      displayName: "ApiFunction/Code",
      missingCode: "BETA_API_DEPLOYABLE_ASSET_MISSING",
      resourcePath: "cloudmarkup-beta-application.cloudmarkup-beta-api.Code",
      validate: (asset) => validateBetaApiBundle(asset.files, asset.path),
    },
    {
      assetId: webAssetId,
      displayName: "DeployWebAssets/Asset1",
      missingCode: "BETA_WEB_DEPLOYABLE_ASSET_MISSING",
      resourcePath: "cloudmarkup-beta-edge.DeployWebAssets.SourceObjectKeys",
      validate: (asset) => validateBetaWebBuild(asset.files),
    },
  ]) {
    if (requirement.assetId === undefined) {
      findings.push(
        finding(
          "BETA_DEPLOYABLE_RESOURCE_BINDING_INVALID",
          requirement.resourcePath,
          "The owning synthesized resource must reference exactly one content-addressed zip asset.",
        ),
      );
      continue;
    }
    const matches = assets.filter(({ id }) => id === requirement.assetId);
    if (matches.length !== 1) {
      findings.push(
        finding(
          requirement.missingCode,
          "artifacts/platform/cdk.out",
          `The beta assembly must contain exactly one ${requirement.displayName} deployable asset.`,
        ),
      );
      continue;
    }
    const asset = matches[0];
    if (
      asset.displayName !== requirement.displayName ||
      asset.fingerprint !== asset.id ||
      asset.packaging !== "zip" ||
      !Array.isArray(asset.files) ||
      asset.files.length === 0
    ) {
      findings.push(
        finding(
          "BETA_DEPLOYABLE_ASSET_BINDING_INVALID",
          asset.path,
          "The exact deployable asset must match its owning resource, reviewed display name, CDK content fingerprint, and zip source.",
        ),
      );
    }
    findings.push(...requirement.validate(asset));
  }
  return findings;
}

function resourcesOf(stack) {
  return plain(stack.template.Resources)
    ? Object.entries(stack.template.Resources)
    : [];
}

function outputNames(stacks) {
  return new Set(
    stacks.flatMap(({ template }) =>
      plain(template.Outputs) ? Object.keys(template.Outputs) : [],
    ),
  );
}

function deletionRetained(resource) {
  return (
    new Set(["Retain", "RetainExceptOnCreate", "Snapshot"]).has(
      resource.DeletionPolicy,
    ) && new Set(["Retain", "Snapshot"]).has(resource.UpdateReplacePolicy)
  );
}

function lambdaVariables(resource) {
  const variables = resource?.Properties?.Environment?.Variables;
  return plain(variables) ? variables : {};
}

/** Bind the import switch to one reviewed layer and its actual deployed bytes. */
export function validateBetaRepositoryImport(stacks, profile, assets) {
  const entries = stacks.flatMap((stack) =>
    resourcesOf(stack).map(([id, resource]) => ({
      stack: stack.stackName,
      id,
      resource,
    })),
  );
  const functions = entries.filter(
    ({ resource }) => resource.Type === "AWS::Lambda::Function",
  );
  const apis = functions.filter(
    ({ resource }) =>
      resource.Properties?.FunctionName === "cloudmarkup-beta-api",
  );
  const api = apis[0];
  const layers = entries.filter(
    ({ resource }) =>
      resource.Type === "AWS::Lambda::LayerVersion" &&
      resource.Properties?.LayerName ===
        "cloudmarkup-beta-repository-import-parser",
  );
  const enabled = [
    "stripe-sandbox-github-connections-v1",
    "stripe-sandbox-github-cloudformation-v1",
    "stripe-live-github-cloudformation-v1",
  ].includes(profile.profile);
  const variables = lambdaVariables(api?.resource);
  const invalid = () => [
    finding(
      "BETA_REPOSITORY_IMPORT_BINDING_INVALID",
      "cloudmarkup-beta-api",
      "Repository imports require the exact enabled GitHub profile, API-only layer binding, and digest-matched Linux ARM64 parser asset.",
    ),
  ];
  const keys = [
    "CLOUDMARKUP_REPOSITORY_IMPORTS_ENABLED",
    "CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_PATH",
    "CLOUDMARKUP_REPOSITORY_IMPORT_COMPILER_SHA256",
  ];
  if (
    functions.some((entry) =>
      Object.keys(lambdaVariables(entry.resource)).some(
        (key) =>
          key.startsWith("CLOUDMARKUP_REPOSITORY_IMPORT") &&
          (!enabled || entry !== api || !keys.includes(key)),
      ),
    )
  )
    return invalid();
  if (!enabled) return layers.length === 0 ? [] : invalid();
  const layer = layers[0];
  const exportLayer = entries.filter(
    (entry) =>
      entry.resource.Type === "AWS::Lambda::LayerVersion" &&
      entry.resource.Properties?.LayerName === BETA_EXPORT_LAYER,
  );
  const expectedLayers = [
    { Ref: layer?.id },
    ...([BETA_CLOUDFORMATION_PROFILE, BETA_LIVE_PROFILE].includes(
      profile.profile,
    ) && exportLayer.length === 1
      ? [{ Ref: exportLayer[0].id }]
      : []),
  ];
  if (
    apis.length !== 1 ||
    layers.length !== 1 ||
    api?.stack !== "cloudmarkup-beta-application" ||
    layer?.stack !== api.stack ||
    api.resource.Condition !== undefined ||
    layer.resource.Condition !== undefined ||
    variables[keys[0]] !== "true" ||
    variables[keys[1]] !== "/opt/cloudmarkup-iac-import" ||
    !/^[a-f0-9]{64}$/u.test(variables[keys[2]] ?? "") ||
    JSON.stringify(api.resource.Properties?.Layers) !==
      JSON.stringify(expectedLayers) ||
    JSON.stringify(layer.resource.Properties?.CompatibleArchitectures) !==
      '["arm64"]' ||
    JSON.stringify(layer.resource.Properties?.CompatibleRuntimes) !==
      '["nodejs24.x"]'
  )
    return invalid();
  if (
    functions.some(
      (entry) =>
        entry !== api &&
        (!Array.isArray(entry.resource.Properties?.Layers ?? []) ||
          (entry.resource.Properties?.Layers ?? []).some(
            (value) => value?.Ref === layer.id,
          )),
    )
  )
    return invalid();
  const content = layer.resource.Properties?.Content;
  const assetId =
    content?.S3Bucket === betaAssetBucketName &&
    exactObjectKeys(content, ["S3Bucket", "S3Key"])
      ? betaAssetKeyPattern.exec(content.S3Key ?? "")?.[1]
      : undefined;
  const matches = assets.filter((asset) => asset.id === assetId);
  const asset = matches[0];
  const binary = asset?.files?.[0];
  if (
    assetId === undefined ||
    matches.length !== 1 ||
    asset.displayName !== "RepositoryImportParser/Code" ||
    asset.fingerprint !== assetId ||
    asset.packaging !== "zip" ||
    !Array.isArray(asset.files) ||
    asset.files.length !== 1 ||
    binary?.path !== "cloudmarkup-iac-import" ||
    binary.sha256 !== variables[keys[2]] ||
    !Number.isSafeInteger(binary.byteLength) ||
    binary.byteLength < 64 ||
    binary.byteLength > 10 * 1024 * 1024 ||
    !/^7f454c460201[a-f0-9]{24}b700$/u.test(binary.headerHex ?? "")
  )
    return invalid();
  return [];
}

export function validateBetaAssembly(stacks, environment, assets = []) {
  const findings = validateDeployableAssets(stacks, assets);
  let serviceProfile;
  try {
    serviceProfile = parseBetaServiceProfile(environment);
  } catch {
    return [
      ...findings,
      finding(
        "BETA_SERVICE_PROFILE_INVALID",
        "BETA_SERVICE_PROFILE",
        "Assembly admission requires the exact reviewed service profile inputs.",
      ),
    ];
  }
  findings.push(...validateBetaSandboxDelivery(stacks, serviceProfile, assets));
  findings.push(...validateBetaSolutionExport(stacks, serviceProfile, assets));
  findings.push(
    ...validateBetaRepositoryImport(stacks, serviceProfile, assets),
  );
  const actualStackNames = stacks.map(({ stackName }) => stackName).sort();
  if (
    JSON.stringify(actualStackNames) !== JSON.stringify([...expectedStackNames])
  ) {
    findings.push(
      finding(
        "BETA_STACK_SET_INVALID",
        "artifacts/platform/cdk.out",
        "The beta assembly must contain exactly the four reviewed platform stacks.",
      ),
    );
  }
  for (const stack of stacks) {
    if (
      !plain(stack.template.Resources) ||
      Object.keys(stack.template.Resources).length === 0
    ) {
      findings.push(
        finding(
          "BETA_STACK_EMPTY",
          stack.path,
          "Every beta stack must contain at least one AWS resource.",
        ),
      );
    }
    const text = JSON.stringify(stack.template);
    if (
      /(?:placeholder|localhost|127\.0\.0\.1|\.example(?:[/."]|$))/iu.test(text)
    ) {
      findings.push(
        finding(
          "BETA_TEMPLATE_PLACEHOLDER",
          stack.path,
          "The synthesized beta template contains a placeholder or local-only value.",
        ),
      );
    }
    if (
      /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b|\bwhsec_[A-Za-z0-9]{12,}\b|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----)/u.test(
        text,
      )
    ) {
      findings.push(
        finding(
          "BETA_TEMPLATE_SECRET_LITERAL",
          stack.path,
          "The synthesized template contains a high-confidence secret literal.",
        ),
      );
    }
  }

  const outputs = outputNames(stacks);
  for (const output of BETA_REQUIRED_OUTPUTS) {
    if (!outputs.has(output)) {
      findings.push(
        finding(
          "BETA_OUTPUT_MISSING",
          output,
          "A required non-secret deployment or handoff output is missing.",
        ),
      );
    }
  }

  const resources = stacks.flatMap((stack) =>
    resourcesOf(stack).map(([logicalId, resource]) => ({
      logicalId,
      path: `${stack.stackName}.Resources.${logicalId}`,
      resource,
      stackName: stack.stackName,
    })),
  );
  const statefulStack = stacks.find(
    ({ stackName }) => stackName === "cloudmarkup-beta-stateful",
  );
  const statefulResources =
    statefulStack === undefined
      ? []
      : resourcesOf(statefulStack).map(([logicalId, resource]) => ({
          logicalId,
          resource,
        }));
  const originSecrets = statefulResources.filter(
    ({ resource }) =>
      resource.Type === "AWS::SecretsManager::Secret" &&
      resource.Properties?.Name === "cloudmarkup-beta/edge/origin-verification",
  );
  const originSecret = originSecrets[0];
  const originSecretGeneration =
    originSecret?.resource.Properties?.GenerateSecretString;
  const statefulOutputs = plain(statefulStack?.template.Outputs)
    ? Object.values(statefulStack.template.Outputs)
    : [];
  const originSecretExports = statefulOutputs.filter(
    (output) =>
      plain(output) &&
      originSecret !== undefined &&
      exactRef(output.Value, originSecret.logicalId) &&
      plain(output.Export) &&
      typeof output.Export.Name === "string" &&
      output.Export.Name.startsWith("cloudmarkup-beta-stateful:"),
  );
  const originSecretExportName = originSecretExports[0]?.Export?.Name;
  const ownedOriginSecretValid =
    originSecrets.length === 1 &&
    originSecret.resource.Condition === undefined &&
    deletionRetained(originSecret.resource) &&
    exactObjectKeys(originSecretGeneration, [
      "ExcludePunctuation",
      "IncludeSpace",
      "PasswordLength",
    ]) &&
    originSecretGeneration.ExcludePunctuation === true &&
    originSecretGeneration.IncludeSpace === false &&
    originSecretGeneration.PasswordLength === 64 &&
    originSecretExports.length === 1 &&
    originSecretExports[0].Condition === undefined;
  const cloudFrontWebAcls = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::WAFv2::WebACL" &&
      resource.Properties?.Scope === "CLOUDFRONT",
  );
  const cloudFrontWebAcl = cloudFrontWebAcls[0];
  const cloudFrontRules = cloudFrontWebAcl?.resource.Properties?.Rules;
  const webhookRateRule = Array.isArray(cloudFrontRules)
    ? cloudFrontRules.find(
        (rule) => plain(rule) && rule.Name === "WebhookRateControl",
      )
    : undefined;
  const apiRateRule = Array.isArray(cloudFrontRules)
    ? cloudFrontRules.find(
        (rule) => plain(rule) && rule.Name === "ApiRateControl",
      )
    : undefined;
  const ownedCloudFrontWafValid =
    cloudFrontWebAcls.length === 1 &&
    cloudFrontWebAcl?.stackName === "cloudmarkup-beta-edge" &&
    cloudFrontWebAcl?.resource.Condition === undefined &&
    cloudFrontWebAcl?.resource.Properties?.Name ===
      "cloudmarkup-beta-edge-rate-controls" &&
    plain(cloudFrontWebAcl.resource.Properties?.DefaultAction?.Allow) &&
    cloudFrontWebAcl.resource.Properties?.VisibilityConfig
      ?.CloudWatchMetricsEnabled === true &&
    cloudFrontWebAcl.resource.Properties?.VisibilityConfig?.MetricName ===
      "cloudmarkup-beta-edge-rate-controls" &&
    cloudFrontWebAcl.resource.Properties?.VisibilityConfig
      ?.SampledRequestsEnabled === false &&
    Array.isArray(cloudFrontRules) &&
    cloudFrontRules.length === 2 &&
    matchesBetaCloudFrontRateRule(webhookRateRule, {
      limit: 1_000,
      name: "WebhookRateControl",
      pathPrefix: "/api/webhooks/",
      priority: 0,
    }) &&
    matchesBetaCloudFrontRateRule(apiRateRule, {
      limit: 5_000,
      name: "ApiRateControl",
      pathPrefix: "/api/",
      priority: 1,
    });
  if (!ownedCloudFrontWafValid) {
    findings.push(
      finding(
        "BETA_CLOUDFRONT_WAF_INVALID",
        "cloudmarkup-beta-edge",
        "The beta assembly must own exactly one named CloudFront Web ACL with the reviewed webhook and API rate controls.",
      ),
    );
  }
  const originAccessControls = resources.filter(
    ({ resource }) => resource.Type === "AWS::CloudFront::OriginAccessControl",
  );
  const bootstrapOriginAccessControlValid = originAccessControls.length === 0;
  const apiGatewayV2Resources = resources.filter(
    ({ resource }) =>
      typeof resource.Type === "string" &&
      resource.Type.startsWith("AWS::ApiGatewayV2::"),
  );
  const restApis = resources.filter(
    ({ resource }) => resource.Type === "AWS::ApiGateway::RestApi",
  );
  const restStages = resources.filter(
    ({ resource }) => resource.Type === "AWS::ApiGateway::Stage",
  );
  const regionalWebAcls = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::WAFv2::WebACL" &&
      resource.Properties?.Scope === "REGIONAL",
  );
  const regionalAssociations = resources.filter(
    ({ resource }) => resource.Type === "AWS::WAFv2::WebACLAssociation",
  );
  const restApi = restApis[0];
  const restStage = restStages[0];
  const regionalWebAcl = regionalWebAcls[0];
  const regionalAssociation = regionalAssociations[0];
  const regionalRules = regionalWebAcl?.resource.Properties?.Rules;
  const markerRule = Array.isArray(regionalRules)
    ? regionalRules.find(
        (rule) => plain(rule) && rule.Name === "RequireCloudFrontOriginMarker",
      )
    : undefined;
  const markerByteMatch =
    markerRule?.Statement?.NotStatement?.Statement?.ByteMatchStatement;
  const markerTransformations = markerByteMatch?.TextTransformations;
  const regionalMarkerValue = markerByteMatch?.SearchString;
  const regionalOriginBoundaryValid =
    ownedOriginSecretValid &&
    apiGatewayV2Resources.length === 0 &&
    restApis.length === 1 &&
    restStages.length === 1 &&
    regionalWebAcls.length === 1 &&
    regionalAssociations.length === 1 &&
    restApi?.stackName === "cloudmarkup-beta-application" &&
    restStage?.stackName === "cloudmarkup-beta-application" &&
    regionalWebAcl?.stackName === "cloudmarkup-beta-application" &&
    regionalAssociation?.stackName === "cloudmarkup-beta-application" &&
    restApi?.resource.Condition === undefined &&
    restStage?.resource.Condition === undefined &&
    regionalWebAcl?.resource.Condition === undefined &&
    regionalAssociation?.resource.Condition === undefined &&
    restApi?.resource.Properties?.Name === "cloudmarkup-beta-api" &&
    restApi.resource.Properties?.DisableExecuteApiEndpoint === false &&
    JSON.stringify(
      restApi.resource.Properties?.EndpointConfiguration?.Types,
    ) === JSON.stringify(["REGIONAL"]) &&
    restStage?.resource.Properties?.StageName === "beta" &&
    restStage.resource.Properties?.RestApiId?.Ref === restApi.logicalId &&
    plain(restStage.resource.Properties?.AccessLogSetting) &&
    Array.isArray(restStage.resource.Properties?.MethodSettings) &&
    regionalWebAcl?.resource.Properties?.Name ===
      "cloudmarkup-beta-regional-origin-access" &&
    regionalWebAcl.resource.Properties?.DefaultAction?.Allow !== undefined &&
    regionalWebAcl.resource.Properties?.VisibilityConfig?.MetricName ===
      "cloudmarkup-beta-regional-origin-access" &&
    regionalWebAcl.resource.Properties?.VisibilityConfig
      ?.CloudWatchMetricsEnabled === true &&
    regionalWebAcl.resource.Properties?.VisibilityConfig
      ?.SampledRequestsEnabled === false &&
    Array.isArray(regionalRules) &&
    regionalRules.length === 1 &&
    markerRule?.Action?.Block !== undefined &&
    markerRule?.Priority === 0 &&
    markerRule?.VisibilityConfig?.MetricName ===
      "RequireCloudFrontOriginMarker" &&
    markerRule?.VisibilityConfig?.CloudWatchMetricsEnabled === true &&
    markerRule?.VisibilityConfig?.SampledRequestsEnabled === false &&
    markerByteMatch?.FieldToMatch?.SingleHeader?.Name ===
      "x-cloudmarkup-edge-origin" &&
    markerByteMatch?.PositionalConstraint === "EXACTLY" &&
    Array.isArray(markerTransformations) &&
    markerTransformations.length === 1 &&
    markerTransformations[0]?.Priority === 0 &&
    markerTransformations[0]?.Type === "NONE" &&
    exactSecretDynamicImport(regionalMarkerValue, originSecretExportName) &&
    exactRegionalStageArn(
      regionalAssociation.resource.Properties?.ResourceArn,
      restApi.logicalId,
      restStage.logicalId,
    ) &&
    exactGetAtt(
      regionalAssociation.resource.Properties?.WebACLArn,
      regionalWebAcl.logicalId,
      "Arn",
    );
  if (!regionalOriginBoundaryValid) {
    findings.push(
      finding(
        "BETA_REGIONAL_ORIGIN_PROTECTION_MISSING",
        "cloudmarkup-beta-application",
        "The beta assembly must use exactly one Regional REST API and stage, no API Gateway v2 resources, and one stage-associated Regional WAF rule that blocks requests without the exact generated CloudFront marker.",
      ),
    );
  }
  const runtimeConfigResources = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::ApiGateway::Resource" &&
      resource.Properties?.PathPart === "runtime-config",
  );
  const runtimeConfigResource = runtimeConfigResources[0];
  const apiLambdaResource = resources.find(
    ({ resource }) =>
      resource.Type === "AWS::Lambda::Function" &&
      resource.Properties?.FunctionName === "cloudmarkup-beta-api",
  );
  const runtimeConfigMethods = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::ApiGateway::Method" &&
      resource.Properties?.HttpMethod === "GET" &&
      runtimeConfigResource !== undefined &&
      exactRef(
        resource.Properties?.ResourceId,
        runtimeConfigResource.logicalId,
      ),
  );
  if (
    runtimeConfigResources.length !== 1 ||
    !exactGetAtt(
      runtimeConfigResource?.resource.Properties?.ParentId,
      restApi?.logicalId,
      "RootResourceId",
    ) ||
    runtimeConfigMethods.length !== 1 ||
    runtimeConfigMethods[0]?.resource.Properties?.AuthorizationType !==
      "NONE" ||
    runtimeConfigMethods[0]?.resource.Properties?.Integration?.Type !==
      "AWS_PROXY" ||
    apiLambdaResource === undefined ||
    !JSON.stringify(
      runtimeConfigMethods[0]?.resource.Properties?.Integration?.Uri,
    ).includes(
      JSON.stringify({
        "Fn::GetAtt": [apiLambdaResource.logicalId, "Arn"],
      }),
    ) ||
    restStage?.resource.Properties?.CacheClusterEnabled === true ||
    JSON.stringify(restStage?.resource.Properties?.MethodSettings).includes(
      '"CachingEnabled":true',
    )
  ) {
    findings.push(
      finding(
        "BETA_RUNTIME_CONFIG_ROUTE_INVALID",
        "cloudmarkup-beta-application",
        "GET /runtime-config must be a single unauthenticated API Lambda route with API Gateway caching disabled.",
      ),
    );
  }
  for (const functionName of [
    "cloudmarkup-beta-api",
    ...(serviceProfile.profile !== "core-v1"
      ? ["cloudmarkup-beta-billing-webhook"]
      : []),
  ]) {
    const owningFunctions = resources.filter(
      ({ resource }) =>
        resource.Type === "AWS::Lambda::Function" &&
        resource.Properties?.FunctionName === functionName,
    );
    const owningFunction = owningFunctions[0];
    const lambdaMarker = lambdaVariables(owningFunction?.resource)[
      "CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION"
    ];
    if (
      owningFunctions.length !== 1 ||
      owningFunction.stackName !== "cloudmarkup-beta-application" ||
      owningFunction.resource.Condition !== undefined ||
      !ownedOriginSecretValid ||
      regionalMarkerValue === undefined ||
      !exactSecretDynamicImport(lambdaMarker, originSecretExportName) ||
      JSON.stringify(lambdaMarker) !== JSON.stringify(regionalMarkerValue)
    ) {
      findings.push(
        finding(
          "BETA_LAMBDA_ORIGIN_MARKER_BINDING_INVALID",
          `cloudmarkup-beta-application.${functionName}.CLOUDMARKUP_EDGE_ORIGIN_VERIFICATION`,
          "The exact API Lambda must bind its defense-in-depth origin check to the same generated stateful secret dynamic import used by Regional WAF and CloudFront.",
        ),
      );
    }
  }
  const buckets = resources.filter(
    ({ resource }) => resource.Type === "AWS::S3::Bucket",
  );
  for (const bucket of buckets) {
    const properties = bucket.resource.Properties;
    const publicBlock = properties?.PublicAccessBlockConfiguration;
    if (
      !plain(publicBlock) ||
      [
        "BlockPublicAcls",
        "BlockPublicPolicy",
        "IgnorePublicAcls",
        "RestrictPublicBuckets",
      ].some((key) => publicBlock[key] !== true)
    ) {
      findings.push(
        finding(
          "BETA_BUCKET_PUBLIC_BLOCK_MISSING",
          bucket.path,
          "Every beta bucket must block all public access modes.",
        ),
      );
    }
    if (!plain(properties?.BucketEncryption)) {
      findings.push(
        finding(
          "BETA_BUCKET_ENCRYPTION_MISSING",
          bucket.path,
          "Every beta bucket must configure encryption at rest.",
        ),
      );
    }
    if (properties?.VersioningConfiguration?.Status !== "Enabled") {
      findings.push(
        finding(
          "BETA_BUCKET_VERSIONING_MISSING",
          bucket.path,
          "Every beta data or web-assets bucket must enable versioning.",
        ),
      );
    }
    if (!deletionRetained(bucket.resource)) {
      findings.push(
        finding(
          "BETA_BUCKET_LIFECYCLE_UNSAFE",
          bucket.path,
          "Beta buckets must be retained across stack deletion and replacement.",
        ),
      );
    }
  }

  const clusters = resources.filter(
    ({ resource }) => resource.Type === "AWS::RDS::DBCluster",
  );
  if (clusters.length !== 1) {
    findings.push(
      finding(
        "BETA_DATABASE_CLUSTER_INVALID",
        "cloudmarkup-beta-stateful",
        "The beta assembly must contain exactly one durable database cluster.",
      ),
    );
  }
  for (const cluster of clusters) {
    const properties = cluster.resource.Properties;
    if (
      properties?.StorageEncrypted !== true ||
      properties?.DeletionProtection !== true ||
      !Number.isInteger(properties?.BackupRetentionPeriod) ||
      properties.BackupRetentionPeriod < 7 ||
      !deletionRetained(cluster.resource)
    ) {
      findings.push(
        finding(
          "BETA_DATABASE_LIFECYCLE_UNSAFE",
          cluster.path,
          "The beta database must be encrypted, deletion-protected, retained/snapshotted, and backed up for at least seven days.",
        ),
      );
    }
  }
  for (const instance of resources.filter(
    ({ resource }) => resource.Type === "AWS::RDS::DBInstance",
  )) {
    if (instance.resource.Properties?.PubliclyAccessible !== false) {
      findings.push(
        finding(
          "BETA_DATABASE_PUBLIC",
          instance.path,
          "Beta database instances must not be publicly accessible.",
        ),
      );
    }
  }

  const apiPrefixFunctions = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::CloudFront::Function" &&
      resource.Properties?.Name === reviewedApiPrefixFunction.name,
  );
  const apiPrefixFunction = apiPrefixFunctions[0];
  const ownedApiPrefixFunctionValid =
    apiPrefixFunctions.length === 1 &&
    apiPrefixFunction.stackName === "cloudmarkup-beta-edge" &&
    matchesReviewedApiPrefixFunction(apiPrefixFunction.resource);
  const distributions = resources.filter(
    ({ resource }) => resource.Type === "AWS::CloudFront::Distribution",
  );
  if (distributions.length !== 1) {
    findings.push(
      finding(
        "BETA_CLOUDFRONT_INVALID",
        "cloudmarkup-beta-edge",
        "The beta assembly must contain exactly one CloudFront public ingress.",
      ),
    );
  }
  for (const distribution of distributions) {
    const config = distribution.resource.Properties?.DistributionConfig;
    const serialized = JSON.stringify(config);
    const origins = Array.isArray(config?.Origins) ? config.Origins : [];
    const apiOrigins = origins.filter((origin) =>
      JSON.stringify(origin?.DomainName).includes(".execute-api."),
    );
    const apiOrigin = apiOrigins[0];
    const s3Origins = origins.filter((origin) => plain(origin?.S3OriginConfig));
    const s3Origin = s3Origins[0];
    const originHeaders = Array.isArray(apiOrigin?.OriginCustomHeaders)
      ? apiOrigin.OriginCustomHeaders
      : [];
    const markerHeaders = originHeaders.filter(
      (header) => header?.HeaderName === "x-cloudmarkup-edge-origin",
    );
    const markerHeader = markerHeaders[0];
    const cacheBehaviors = Array.isArray(config?.CacheBehaviors)
      ? config.CacheBehaviors
      : [];
    const apiBehaviors = cacheBehaviors.filter(
      (behavior) => behavior?.PathPattern === "/api/*",
    );
    const apiBehavior = apiBehaviors[0];
    const publicAssetBehaviorsValid = publicAssetPathPatterns.every(
      (pattern) => {
        const matches = cacheBehaviors.filter(
          (behavior) => behavior?.PathPattern === pattern,
        );
        const behavior = matches[0];
        return (
          matches.length === 1 &&
          behavior?.TargetOriginId === s3Origin?.Id &&
          exactImportValue(
            behavior?.ResponseHeadersPolicyId,
            bootstrapPublicAssetHeadersExport,
          ) &&
          behavior?.CachePolicyId === "658327ea-f89d-4fab-a63d-7e88639e58f6" &&
          behavior?.Compress === true &&
          JSON.stringify(behavior?.AllowedMethods) ===
            JSON.stringify(["GET", "HEAD"]) &&
          behavior?.ViewerProtocolPolicy === "redirect-to-https" &&
          behavior?.FunctionAssociations === undefined &&
          behavior?.LambdaFunctionAssociations === undefined
        );
      },
    );
    const apiFunctionAssociations = Array.isArray(
      apiBehavior?.FunctionAssociations,
    )
      ? apiBehavior.FunctionAssociations
      : [];
    const apiFunctionAssociation = apiFunctionAssociations[0];
    const apiPrefixAssociationValid =
      ownedApiPrefixFunctionValid &&
      apiFunctionAssociations.length === 1 &&
      apiBehavior?.LambdaFunctionAssociations === undefined &&
      exactObjectKeys(apiFunctionAssociation, ["EventType", "FunctionARN"]) &&
      apiFunctionAssociation.EventType === "viewer-request" &&
      exactGetAtt(
        apiFunctionAssociation.FunctionARN,
        apiPrefixFunction.logicalId,
        "FunctionARN",
      );
    if (
      !plain(config) ||
      distribution.stackName !== "cloudmarkup-beta-edge" ||
      distribution.resource.Condition !== undefined ||
      !ownedCloudFrontWafValid ||
      !exactGetAtt(config.WebACLId, cloudFrontWebAcl.logicalId, "Arn") ||
      !ownedOriginSecretValid ||
      !bootstrapOriginAccessControlValid ||
      s3Origins.length !== 1 ||
      !exactImportValue(
        s3Origin?.OriginAccessControlId,
        bootstrapWebOriginAccessControlExport,
      ) ||
      config.DefaultCacheBehavior?.TargetOriginId !== s3Origin?.Id ||
      !exactImportValue(
        config.DefaultCacheBehavior?.ResponseHeadersPolicyId,
        bootstrapSecurityHeadersExport,
      ) ||
      !serialized.includes("beta.example.invalid") ||
      apiOrigins.length !== 1 ||
      apiOrigin?.CustomOriginConfig?.OriginProtocolPolicy !== "https-only" ||
      !JSON.stringify(apiOrigin?.OriginPath).includes(
        "RestApiDeploymentStage",
      ) ||
      markerHeaders.length !== 1 ||
      regionalMarkerValue === undefined ||
      !exactSecretDynamicImport(
        markerHeader?.HeaderValue,
        originSecretExportName,
      ) ||
      JSON.stringify(markerHeader?.HeaderValue) !==
        JSON.stringify(regionalMarkerValue) ||
      !publicAssetBehaviorsValid ||
      cacheBehaviors.length !== 3 ||
      apiBehavior?.CachePolicyId !== "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" ||
      apiBehavior?.Compress !== false ||
      apiBehaviors.length !== 1 ||
      apiBehavior?.TargetOriginId !== apiOrigin?.Id ||
      !exactImportValue(
        apiBehavior?.ResponseHeadersPolicyId,
        bootstrapApiHeadersExport,
      ) ||
      !apiPrefixAssociationValid
    ) {
      findings.push(
        finding(
          "BETA_INGRESS_PROTECTION_MISSING",
          distribution.path,
          "CloudFront must use WAF, private S3 origin access, one HTTPS Regional REST origin, the exact generated origin marker, a non-cached /api/* behavior with the reviewed viewer-request prefix function, two compressed content-hashed public bundle behaviors, and the exact beta hostname.",
        ),
      );
    }
  }

  const deployments = resources.filter(
    ({ resource }) =>
      new Set([
        "Custom::CDKBucketDeployment",
        "AWS::CloudFormation::CustomResource",
      ]).has(resource.Type) &&
      JSON.stringify(resource).includes("DistributionPaths"),
  );
  if (
    deployments.length !== 1 ||
    !JSON.stringify(deployments[0]?.resource).includes("/*")
  ) {
    findings.push(
      finding(
        "BETA_WEB_ASSET_DEPLOYMENT_MISSING",
        "cloudmarkup-beta-edge",
        "The beta edge stack must deploy the built web assets and invalidate CloudFront /*.",
      ),
    );
  }

  const codeBuildProjects = resources.filter(
    ({ resource }) => resource.Type === "AWS::CodeBuild::Project",
  );
  const buildVpcEndpoints = resources.filter(
    ({ resource }) => resource.Type === "AWS::EC2::VPCEndpoint",
  );
  const disabledAsyncResources = resources.filter(({ resource }) =>
    new Set([
      "AWS::StepFunctions::StateMachine",
      ...(serviceProfile.profile === "core-v1" ? ["AWS::SQS::Queue"] : []),
    ]).has(resource.Type),
  );
  if (
    codeBuildProjects.length !== 0 ||
    buildVpcEndpoints.length !== 0 ||
    disabledAsyncResources.length !== 0
  ) {
    findings.push(
      finding(
        "BETA_DISABLED_PROVIDER_RESOURCE_PRESENT",
        "cloudmarkup-beta-application",
        "Beta must omit hosted CodeBuild, build-service VPC endpoints and orchestration; only the separately admitted sandbox may own its exact two billing queues.",
      ),
    );
  }

  const functions = resources.filter(
    ({ resource }) => resource.Type === "AWS::Lambda::Function",
  );
  let productionApiSeen = false;
  // Owner-authorized erasure must keep its two controls synchronized. Schema
  // pins and the exact worker identity still fail closed.
  const cleanupEnabled = functions.some(
    (entry) =>
      entry.resource.Properties?.FunctionName ===
        "cloudmarkup-beta-project-content-cleanup" &&
      lambdaVariables(entry.resource).CLOUDMARKUP_PROJECT_CLEANUP_ENABLED ===
        "true",
  );
  for (const entry of resources) {
    const props = entry.resource.Properties;
    const name = "cloudmarkup-beta-project-content-cleanup";
    if (
      (entry.resource.Type === "AWS::Events::Rule" &&
        props?.Name === name &&
        props.State !== (cleanupEnabled ? "ENABLED" : "DISABLED")) ||
      (entry.resource.Type === "AWS::Lambda::Function" &&
        (props?.FunctionName === name ||
          Object.hasOwn(
            lambdaVariables(entry.resource),
            "CLOUDMARKUP_PROJECT_CLEANUP_ENABLED",
          )) &&
        (props?.FunctionName !== name ||
          lambdaVariables(entry.resource)
            .CLOUDMARKUP_PROJECT_CLEANUP_ENABLED !==
            (cleanupEnabled ? "true" : "false") ||
          lambdaVariables(entry.resource)
            .CLOUDMARKUP_EXPECTED_SCHEMA_VERSION !== "0138"))
    ) {
      findings.push(
        finding(
          "BETA_PROJECT_CLEANUP_ACTIVATION_UNREVIEWED",
          entry.path,
          "The project cleanup runtime and schedule must agree and use the reviewed schema and exact identity.",
        ),
      );
    }
  }
  for (const lambda of functions) {
    const variables = lambdaVariables(lambda.resource);
    if (
      lambda.resource.Properties?.FunctionName ===
      "cloudmarkup-beta-project-content-cleanup"
    ) {
      const code = lambda.resource.Properties.Code;
      const id = betaAssetKeyPattern.exec(code?.S3Key ?? "")?.[1];
      const matches = assets.filter((asset) => asset.id === id);
      const asset = matches[0];
      const text = (asset?.files ?? [])
        .filter((file) => file.path.endsWith(".js"))
        .map((file) => file.text ?? "")
        .join("\n");
      const checksums = [
        ...text.matchAll(
          /\b(?:var|let|const) schemaChecksum\s*=\s*"([0-9a-f]{64})"/gu,
        ),
      ].map((match) => match[1]);
      if (
        id === undefined ||
        code?.S3Bucket !== betaAssetBucketName ||
        matches.length !== 1 ||
        asset?.fingerprint !== id ||
        asset?.packaging !== "zip" ||
        asset?.displayName !== "ProjectContentCleanup/WorkerFunction/Code" ||
        checksums.length !== 1 ||
        checksums[0] !== BETA_PROJECT_CLEANUP_SCHEMA_CHECKSUM ||
        !text.includes(
          "j.idempotency_scope IS DISTINCT FROM 'cloudmarkup.beta-infrastructure-proposals.create'",
        )
      ) {
        findings.push(
          finding(
            "BETA_PROJECT_CLEANUP_RUNTIME_STALE",
            lambda.path,
            "The deployed cleanup bundle must contain the current reviewed migration checksum and exact beta proposal producer guard. Rebuild API dependencies before synthesis.",
          ),
        );
      }
    }
    if (
      Object.hasOwn(variables, "CLOUDMARKUP_ENVIRONMENT") &&
      variables.CLOUDMARKUP_ENVIRONMENT !== "beta"
    ) {
      findings.push(
        finding(
          "BETA_RUNTIME_ENVIRONMENT_INVALID",
          lambda.path,
          "Every environment-bound runtime must use the beta profile.",
        ),
      );
    }
    if (variables.CLOUDMARKUP_DEPLOYMENT_SHELL === "true") {
      findings.push(
        finding(
          "BETA_RUNTIME_PLACEHOLDER_COMPOSITION",
          lambda.path,
          "The placeholder deployment shell is not a production runtime composition.",
        ),
      );
    }
    if (
      String(lambda.resource.Properties?.FunctionName) ===
      "cloudmarkup-beta-api"
    ) {
      const runtimeConfig =
        JSON.stringify(variables.CLOUDMARKUP_PUBLIC_RUNTIME_CONFIG) ?? "";
      const runtimeConfigValid = [
        "schemaVersion",
        "authentication",
        "provider",
        "cognito",
        "clientId",
        "domain",
        "callbackUrl",
        "logoutUrl",
        "openid",
        "profile",
        "cloudmarkup-api/access",
      ].every((marker) => runtimeConfig.includes(marker));
      productionApiSeen =
        variables.CLOUDMARKUP_RUNTIME_COMPOSITION === "production-v1" &&
        variables.CLOUDMARKUP_EXPECTED_SCHEMA_VERSION === "0138" &&
        runtimeConfigValid;
    }
    if (
      String(lambda.resource.Properties?.FunctionName) ===
      "cloudmarkup-beta-api"
    ) {
      if (
        Object.keys(variables).some((key) =>
          key.startsWith("CLOUDMARKUP_FEATURE_"),
        )
      ) {
        findings.push(
          finding(
            "BETA_REDUNDANT_FEATURE_ENVIRONMENT",
            lambda.path,
            "Production uses the separately validated runtime activation settings; generic deployment-shell feature metadata must be absent to preserve Lambda's environment budget.",
          ),
        );
      }
    }
  }
  if (!productionApiSeen) {
    findings.push(
      finding(
        "BETA_PRODUCTION_COMPOSITION_MISSING",
        "cloudmarkup-beta-api",
        "The API must bind the production-v1 composition, exact schema version 0138, and complete Cognito public runtime config.",
      ),
    );
  }

  const migrators = functions.filter(
    ({ resource }) =>
      resource.Properties?.FunctionName ===
      "cloudmarkup-beta-database-migrator",
  );
  const migrationResources = resources.filter(
    ({ resource }) =>
      resource.Type === "AWS::CloudFormation::CustomResource" &&
      resource.Properties?.ExpectedSchemaVersion === "0138" &&
      /^[0-9a-f]{64}$/u.test(resource.Properties?.ManifestSha256 ?? ""),
  );
  if (migrators.length !== 1 || migrationResources.length !== 1) {
    findings.push(
      finding(
        "BETA_MIGRATION_GATE_MISSING",
        "cloudmarkup-beta-application",
        "The beta assembly must contain one checksum-bound schema-0044 migrator and CloudFormation gate.",
      ),
    );
  }
  const migrationLogicalId = migrationResources[0]?.logicalId;
  if (migrationLogicalId !== undefined) {
    const publications = resources.filter(
      ({ resource }) =>
        (resource.Type === "AWS::Lambda::Function" &&
          resource.Properties?.FunctionName === "cloudmarkup-beta-api") ||
        resource.Type === "AWS::ApiGateway::Deployment",
    );
    for (const publication of publications) {
      const dependencies = Array.isArray(publication.resource.DependsOn)
        ? publication.resource.DependsOn
        : [publication.resource.DependsOn];
      if (!dependencies.includes(migrationLogicalId)) {
        findings.push(
          finding(
            "BETA_RUNTIME_MIGRATION_DEPENDENCY_MISSING",
            publication.path,
            "API Lambda and API Gateway deployment publication must depend on successful schema migration.",
          ),
        );
      }
    }
  }
  return findings;
}
