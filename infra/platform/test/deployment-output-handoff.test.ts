import { fileURLToPath } from "node:url";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, test } from "vitest";
import { createBetaEnvironmentConfig } from "../lib/config/environments/beta.js";
import { CloudMarkupStage } from "../lib/stages/cloudmarkup-stage.js";
import { createTemplateTestApp } from "./template-test-app.js";

import {
  collectDeploymentOutputs,
  renderDeploymentHandoff,
  serializeDeploymentOutputs,
} from "../lib/deployment-output-handoff.js";

const outputs = {
  "cloudmarkup-beta-application": {
    CognitoCallbackUrl: "https://beta.example.invalid/auth/callback",
    CognitoDomain:
      "https://cloudmarkup-beta-000000000000.auth.us-east-1.amazoncognito.com",
    CognitoLogoutUrl: "https://beta.example.invalid",
    CognitoPublicClientId: "0123456789abcdefghijklmnop",
    CognitoUserPoolId: "us-east-1_0123456789",
    DatabaseMigrationAppliedManifestSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    DatabaseMigrationAppliedVersion: "0138",
    DatabaseMigrationCount: "120",
    DatabaseMigrationExpectedVersion: "0138",
    DatabaseMigrationManifestSha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    DirectOriginProtection: "regional-waf-secrets-manager-edge-marker-required",
  },
  "cloudmarkup-beta-edge": {
    ApiUrl: "https://beta.example.invalid/api",
    ApplicationUrl: "https://beta.example.invalid",
    AwsAccountId: "000000000000",
    AwsRegion: "us-east-1",
    CertificateArn:
      "arn:aws:acm:us-east-1:000000000000:certificate/11111111-2222-3333-4444-555555555555",
    CloudFrontDistributionDomainName: "d111111abcdef8.cloudfront.net",
    CloudFrontDistributionId: "E123456789ABCD",
    DeploymentEnvironment: "beta",
    DnsCreatedAutomatically: "false",
    DnsRecordName: "beta.example.invalid",
    DnsRecordType: "CNAME",
    DnsTarget: "d111111abcdef8.cloudfront.net",
    DnsTargetHostedZoneId: "Z2FDTNDATAQYW2",
    PublicIngressType: "CloudFront",
    WebAssetsBucketName: "cloudmarkup-beta-000000000000-us-east-1-web",
  },
  "cloudmarkup-beta-observability": {
    AlarmTopicArn: "arn:aws:sns:us-east-1:000000000000:cloudmarkup-beta-alarms",
    LogGroupNames: JSON.stringify([
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
    ]),
  },
  "cloudmarkup-beta-stateful": {},
} as const;

function fixtureStack(
  document: Record<string, Record<string, string>>,
  stackName: string,
): Record<string, string> {
  const stack = document[stackName];
  if (stack === undefined) {
    throw new TypeError(`${stackName} fixture missing`);
  }
  return stack;
}

describe("deployment output handoff", () => {
  test("admits the actual synthesized restricted export log composition", () => {
    const config = createBetaEnvironmentConfig({
      domain: {
        certificateArn: outputs["cloudmarkup-beta-edge"].CertificateArn,
        createDnsRecords: false,
        domainName: "beta.example.invalid",
      },
      target: { account: "000000000000", region: "us-east-1" },
      service: {
        profile: "stripe-sandbox-github-cloudformation-v1",
        sessionsEnabled: false,
        signingArn:
          "arn:aws:secretsmanager:us-east-1:000000000000:secret:cloudmarkup/beta/stripe/webhook-signing-secret-a1b2c3",
        previousArn: "",
      },
    });
    const stage = new CloudMarkupStage(
      createTemplateTestApp(),
      "ExportOutputFixture",
      {
        config,
        webAssetsPath: fileURLToPath(
          new URL("fixtures/web-dist/", import.meta.url),
        ),
      },
    );
    const applicationTemplate = Template.fromStack(stage.application);
    const functions = applicationTemplate.findResources(
      "AWS::Lambda::Function",
    );
    const functionName = (resource: Record<string, unknown>) =>
      (resource["Properties"] as Record<string, unknown>)["FunctionName"];
    const api = Object.values(functions).find(
      (resource) => functionName(resource) === "cloudmarkup-beta-api",
    );
    const workers = Object.entries(functions)
      .filter(([, resource]) =>
        [
          "cloudmarkup-beta-proposal-worker",
          "cloudmarkup-beta-solution-export-worker",
        ].includes(String(functionName(resource))),
      )
      .map(([logicalId]) => logicalId);
    expect(api).toBeDefined();
    expect(workers).toHaveLength(2);
    expect(api?.["DependsOn"]).toEqual(expect.arrayContaining(workers));
    applicationTemplate.hasOutput("SolutionExportDelivery", {
      Value: "cloudformation-export-v1",
    });
    const candidate = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const application = fixtureStack(candidate, "cloudmarkup-beta-application");
    const observability = fixtureStack(
      candidate,
      "cloudmarkup-beta-observability",
    );
    for (const key of ["SandboxBillingDelivery", "SolutionExportDelivery"]) {
      const output = applicationTemplate.findOutputs(key)[key] as {
        Value: string;
      };
      application[key] = output.Value;
    }
    const logOutput = Template.fromStack(stage.observability).findOutputs(
      "LogGroupNames",
    )["LogGroupNames"] as { Value: string };
    observability["LogGroupNames"] = logOutput.Value;
    const collected = collectDeploymentOutputs(candidate);
    expect(collected.SolutionExportDelivery).toBe("cloudformation-export-v1");
    expect(JSON.parse(collected.LogGroupNames)).toHaveLength(12);
    expect(renderDeploymentHandoff(collected)).toContain(
      "/aws/lambda/cloudmarkup-beta-solution-export-worker",
    );

    delete application["SolutionExportDelivery"];
    expect(() => collectDeploymentOutputs(candidate)).toThrow(/LogGroupNames/u);
    application["SolutionExportDelivery"] = "cloudformation-export-v1";
    delete application["SandboxBillingDelivery"];
    expect(() => collectDeploymentOutputs(candidate)).toThrow(
      /SolutionExportDelivery/u,
    );
  }, 120_000);

  test.each(["unknown-export", ""])(
    "rejects undeclared export composition %s",
    (value) => {
      const candidate = structuredClone(outputs) as Record<
        string,
        Record<string, string>
      >;
      fixtureStack(candidate, "cloudmarkup-beta-application")[
        "SolutionExportDelivery"
      ] = value;
      expect(() => collectDeploymentOutputs(candidate)).toThrow();
    },
  );

  test.each(["missing", "duplicate", "reordered", "foreign"])(
    "rejects %s export worker logs",
    (mutation) => {
      const candidate = structuredClone(outputs) as Record<
        string,
        Record<string, string>
      >;
      const application = fixtureStack(
        candidate,
        "cloudmarkup-beta-application",
      );
      application["SolutionExportDelivery"] = "cloudformation-export-v1";
      application["SandboxBillingDelivery"] = "stripe-test-fifo-v1";
      const groups = JSON.parse(
        outputs["cloudmarkup-beta-observability"].LogGroupNames,
      ) as string[];
      groups.splice(
        9,
        0,
        "/aws/lambda/cloudmarkup-beta-solution-export-worker",
      );
      groups.push("/aws/lambda/cloudmarkup-beta-billing-worker");
      if (mutation === "missing") groups.splice(9, 1);
      if (mutation === "duplicate") groups.push(groups[9] ?? "");
      if (mutation === "reordered") groups.reverse();
      if (mutation === "foreign") groups[9] = "/aws/lambda/other-export-worker";
      fixtureStack(candidate, "cloudmarkup-beta-observability")[
        "LogGroupNames"
      ] = JSON.stringify(groups);
      expect(() => collectDeploymentOutputs(candidate)).toThrow(
        /LogGroupNames/u,
      );
    },
  );

  test("rejects an export marker from the wrong stack", () => {
    const candidate = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    fixtureStack(candidate, "cloudmarkup-beta-edge")["SolutionExportDelivery"] =
      "cloudformation-export-v1";
    expect(() => collectDeploymentOutputs(candidate)).toThrow(
      /must be emitted only/u,
    );
  });

  test("admits only the exact declared sandbox worker log variant", () => {
    const candidate = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const application = fixtureStack(candidate, "cloudmarkup-beta-application");
    const observability = fixtureStack(
      candidate,
      "cloudmarkup-beta-observability",
    );
    application["SandboxBillingDelivery"] = "stripe-test-fifo-v1";
    expect(() => collectDeploymentOutputs(candidate)).toThrow(/LogGroupNames/u);
    observability["LogGroupNames"] = JSON.stringify([
      ...(JSON.parse(
        outputs["cloudmarkup-beta-observability"].LogGroupNames,
      ) as string[]),
      "/aws/lambda/cloudmarkup-beta-billing-worker",
    ]);
    expect(collectDeploymentOutputs(candidate).SandboxBillingDelivery).toBe(
      "stripe-test-fifo-v1",
    );
    application["SandboxBillingDelivery"] = "stripe-live";
    expect(() => collectDeploymentOutputs(candidate)).toThrow(
      /SandboxBillingDelivery/u,
    );
    delete application["SandboxBillingDelivery"];
    expect(() => collectDeploymentOutputs(candidate)).toThrow(/LogGroupNames/u);
  });

  test("renders deterministic manual DNS and smoke instructions", () => {
    const collected = collectDeploymentOutputs(outputs);
    const first = renderDeploymentHandoff(collected);
    const second = renderDeploymentHandoff(collectDeploymentOutputs(outputs));

    expect(second).toBe(first);
    expect(first).toContain(
      "Create `CNAME` record `beta.example.invalid` pointing to `d111111abcdef8.cloudfront.net`.",
    );
    expect(first).toContain(
      "curl --fail --silent --show-error --max-time 30 'https://beta.example.invalid/api/health'",
    );
    expect(first).toContain(
      "curl --fail --silent --show-error --max-time 30 'https://beta.example.invalid/api/ready'",
    );
    expect(first).toContain("no static ingress IP");
    expect(first).toContain(
      "Direct-origin protection: `regional-waf-secrets-manager-edge-marker-required`",
    );
    expect(first).toContain("Database schema version: `0138`");
    expect(first).toContain("Validated migration count: `120`");
    expect(first).toContain(
      "Migration manifest SHA-256: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`",
    );
    expect(first).not.toMatch(/secret value|password|private key/iu);
  });

  test("rejects a predecessor migration count at the current schema version", () => {
    const stale = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    fixtureStack(stale, "cloudmarkup-beta-application")[
      "DatabaseMigrationCount"
    ] = "53";
    expect(() => collectDeploymentOutputs(stale)).toThrow(
      /all 120 checked migrations/u,
    );
  });

  test("renders automatic Route 53 ownership without manual CNAME guidance", () => {
    const automatic = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const edgeOutputs = automatic["cloudmarkup-beta-edge"];
    if (edgeOutputs === undefined) {
      throw new Error("Expected the beta edge stack outputs fixture.");
    }
    edgeOutputs["DnsCreatedAutomatically"] = "true";
    edgeOutputs["DnsRecordType"] = "A and AAAA alias";
    const rendered = renderDeploymentHandoff(
      collectDeploymentOutputs(automatic),
    );

    expect(rendered).toContain(
      "the Edge stack created Route 53 A and AAAA alias records",
    );
    expect(rendered).not.toContain("Create `CNAME` record");
  });

  test("fails closed for missing, conflicting, or unsafe values", () => {
    const missing = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    delete missing["cloudmarkup-beta-edge"]?.["ApplicationUrl"];
    expect(() => collectDeploymentOutputs(missing)).toThrow(
      /Missing CDK outputs: ApplicationUrl/u,
    );

    const missingRuntimeBoundary = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    delete missingRuntimeBoundary["cloudmarkup-beta-application"]?.[
      "DirectOriginProtection"
    ];
    expect(() => collectDeploymentOutputs(missingRuntimeBoundary)).toThrow(
      /Missing CDK outputs: DirectOriginProtection/u,
    );

    const missingDnsMode = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    delete missingDnsMode["cloudmarkup-beta-edge"]?.["DnsCreatedAutomatically"];
    expect(() => collectDeploymentOutputs(missingDnsMode)).toThrow(
      /Missing CDK outputs: DnsCreatedAutomatically/u,
    );

    const conflicting = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    fixtureStack(conflicting, "cloudmarkup-beta-application")["AwsRegion"] =
      "us-west-2";
    expect(() => collectDeploymentOutputs(conflicting)).toThrow(
      /AwsRegion must be emitted only by cloudmarkup-beta-edge/u,
    );

    const unsafe = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const edge = unsafe["cloudmarkup-beta-edge"];
    if (edge === undefined) throw new TypeError("edge fixture missing");
    edge["DnsRecordName"] = "beta.example.invalid\nwhsec_not-allowed";
    expect(() => collectDeploymentOutputs(unsafe)).toThrow(
      /unsafe or secret-shaped/u,
    );
  });

  test("binds the exact account, domain, stack ownership, DNS mode, and required logs", () => {
    const wrongAccount = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    fixtureStack(wrongAccount, "cloudmarkup-beta-edge")["AwsAccountId"] =
      "111122223333";
    expect(() => collectDeploymentOutputs(wrongAccount)).toThrow(
      /exact reviewed beta account/u,
    );

    const wrongDomain = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    fixtureStack(wrongDomain, "cloudmarkup-beta-edge")["ApplicationUrl"] =
      "https://other.cloudmarkup.com";
    expect(() => collectDeploymentOutputs(wrongDomain)).toThrow(
      /exact reviewed beta origin/u,
    );

    const missingStack = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    delete missingStack["cloudmarkup-beta-stateful"];
    expect(() => collectDeploymentOutputs(missingStack)).toThrow(
      /exactly the four reviewed beta stacks/u,
    );

    const incompleteLogs = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const observability = incompleteLogs["cloudmarkup-beta-observability"];
    if (observability === undefined) {
      throw new TypeError("observability fixture missing");
    }
    const parsedLogGroups: unknown = JSON.parse(
      observability["LogGroupNames"] ?? "[]",
    );
    if (!Array.isArray(parsedLogGroups)) {
      throw new TypeError("log group fixture must be an array");
    }
    observability["LogGroupNames"] = JSON.stringify(
      (parsedLogGroups as unknown[]).slice(0, 7),
    );
    expect(() => collectDeploymentOutputs(incompleteLogs)).toThrow(
      /exact ten beta log groups/u,
    );

    const contradictoryDns = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    fixtureStack(contradictoryDns, "cloudmarkup-beta-edge")[
      "DnsCreatedAutomatically"
    ] = "true";
    expect(() => collectDeploymentOutputs(contradictoryDns)).toThrow(
      /same DNS ownership mode/u,
    );
  });

  test("requires the exact deployed schema and checksum-bound migration manifest", () => {
    const wrongVersion = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const application = wrongVersion["cloudmarkup-beta-application"];
    if (application === undefined) {
      throw new TypeError("application fixture missing");
    }
    application["DatabaseMigrationExpectedVersion"] = "0015";
    expect(() => collectDeploymentOutputs(wrongVersion)).toThrow(
      /exact reviewed schema version 0138/u,
    );

    const invalidManifest = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    const invalidApplication = invalidManifest["cloudmarkup-beta-application"];
    if (invalidApplication === undefined) {
      throw new TypeError("application fixture missing");
    }
    invalidApplication["DatabaseMigrationManifestSha256"] = "A".repeat(64);
    expect(() => collectDeploymentOutputs(invalidManifest)).toThrow(
      /exact lowercase SHA-256 digest/u,
    );
  });

  test("serializes only the validated allowlisted output projection", () => {
    const raw = structuredClone(outputs) as Record<
      string,
      Record<string, string>
    >;
    raw["cloudmarkup-beta-stateful"] = {
      DatabaseSecretArn:
        "arn:aws:secretsmanager:us-east-1:000000000000:secret:not-for-artifact",
      VpcId: "vpc-0123456789abcdef0",
    };
    const serialized = serializeDeploymentOutputs(
      collectDeploymentOutputs(raw),
    );

    expect(serialized).toContain('"ApplicationUrl"');
    expect(serialized).toContain('"DatabaseMigrationManifestSha256"');
    expect(serialized).not.toContain("DatabaseSecretArn");
    expect(serialized).not.toContain("not-for-artifact");
    expect(serialized).not.toContain("VpcId");
  });
});
