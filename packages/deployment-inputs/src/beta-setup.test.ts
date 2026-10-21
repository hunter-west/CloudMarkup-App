import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { DeploymentInputsV1 } from "./schema.js";
import { runBetaSetupCli } from "./beta-setup-cli.js";
import {
  mergeBetaSetupDiscoveryV1,
  validateBetaSetupDiscoveryV1,
  type BetaSetupDiscoveryV1,
} from "./beta-setup.js";
import { validateDeploymentInputsV1 } from "./validator.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadBetaBase(): DeploymentInputsV1 {
  const source = JSON.stringify(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../config/deployment-inputs/example.development.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown,
  );
  const base = JSON.parse(
    source
      .replaceAll("cloudmarkup.example", "cloudmarkup.com")
      .replaceAll("customer.example", "customer.test")
      .replaceAll("cloud-markup-example", "hunter-west")
      .replaceAll("cloud-markup-platform", "CloudMarkup")
      .replaceAll("ZEXAMPLE123456", "ZPREVIOUS123456")
      .replaceAll('"appId":"123456"', '"appId":"734829"')
      .replaceAll("development", "beta")
      .replaceAll("cloudmarkup/dev/", "cloudmarkup/beta/")
      .replaceAll("cloudmarkup-dev/", "cloudmarkup-beta/")
      .replaceAll("cloudmarkup-dev-", "cloudmarkup-beta-")
      .replaceAll(".pending", ".approved")
      .replaceAll('"status":"pending"', '"status":"approved"')
      .replaceAll('"status": "pending"', '"status": "approved"'),
  ) as DeploymentInputsV1;
  base.environment = { name: "beta", stage: "beta" };
  base.aws.accountId = "111111111111";
  base.aws.primaryRegion = "us-west-2";
  base.aws.platformDeployment.githubEnvironment = "Development";
  base.aws.platformDeployment.repository = {
    ...base.aws.platformDeployment.repository,
    approvedBranches: ["main"],
    name: "CloudMarkup",
    owner: "hunter-west",
  };
  base.aws.platformDeployment.roleArn =
    "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub";
  base.aws.platformDeployment.subject = `repo:hunter-west@${base.aws.platformDeployment.repository.ownerId}/CloudMarkup@${base.aws.platformDeployment.repository.id}:environment:Development`;
  base.domains.rootDomain = "cloudmarkup.com";
  base.domains.applicationDomain = "beta.example.invalid";
  base.domains.apiDomain = "beta.example.invalid";
  base.domains.certificateArn =
    "arn:aws:acm:us-east-1:111111111111:certificate/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  base.domains.hostedZoneId = "ZPREVIOUS123456";
  base.data.database.deletionProtection = true;
  base.cognito.mfa = "required";
  base.features.beta = true;
  return base;
}

function validDiscovery(): BetaSetupDiscoveryV1 {
  const revision = "a".repeat(40);
  return {
    application: {
      accountId: "000000000000",
      bootstrap: {
        roles: {
          cloudFormationExecution:
            "arn:aws:iam::000000000000:role/cdk-hnb659fds-cfn-exec-role-000000000000-us-east-1",
          deploymentAction:
            "arn:aws:iam::000000000000:role/cdk-hnb659fds-deploy-role-000000000000-us-east-1",
          filePublishing:
            "arn:aws:iam::000000000000:role/cdk-hnb659fds-file-publishing-role-000000000000-us-east-1",
          imagePublishing:
            "arn:aws:iam::000000000000:role/cdk-hnb659fds-image-publishing-role-000000000000-us-east-1",
          lookup:
            "arn:aws:iam::000000000000:role/cdk-hnb659fds-lookup-role-000000000000-us-east-1",
        },
        stackName: "CDKToolkit",
        stackStatus: "UPDATE_COMPLETE",
        version: "27",
      },
      githubRoleArn: "arn:aws:iam::000000000000:role/CloudMarkup-Beta-GitHub",
      region: "us-east-1",
    },
    certificate: {
      arn: "arn:aws:acm:us-east-1:000000000000:certificate/123e4567-e89b-42d3-a456-426614174000",
      domainName: "beta.example.invalid",
      status: "ISSUED",
      validationMethod: "DNS",
    },
    dns: {
      accountId: "000000000001",
      createApplicationRecords: false,
      hostedZoneId: "ZCLOUDMARKUP123456",
      hostedZoneName: "cloudmarkup.com",
      recordName: "beta.example.invalid",
      roleArn: "arn:aws:iam::000000000001:role/CloudMarkup-Beta-DNS",
    },
    images: {
      applicationBuild: {
        contextSha256: "d".repeat(64),
        criticalFindings: 0,
        digest: `sha256:${"b".repeat(64)}`,
        highFindings: 0,
        provenance: "attached",
        provenanceDigest: `sha256:${"e".repeat(64)}`,
        provenanceIdentity:
          "https://github.com/hunter-west/CloudMarkup/.github/workflows/beta-setup.yml@refs/heads/main",
        provenancePredicateType:
          "https://cloudmarkup.com/attestations/beta-image-build/v1",
        provenanceSourceRevision: revision,
        repositoryName: "cloudmarkup/application-build",
        repositoryUri:
          "000000000000.dkr.ecr.us-east-1.amazonaws.com/cloudmarkup/application-build",
        sbom: "attached",
        sbomDigest: `sha256:${"f".repeat(64)}`,
        sbomFormat: "cyclonedx-json",
        scanDigest: `sha256:${"1".repeat(64)}`,
        scanStatus: "COMPLETE",
        scanner: "trivy@0.74.0",
        signatureIdentity:
          "https://github.com/hunter-west/CloudMarkup/.github/workflows/beta-setup.yml@refs/heads/main",
        signatureIssuer: "https://token.actions.githubusercontent.com",
        signatureStatus: "VERIFIED",
        signatureVerificationDigest: `sha256:${"2".repeat(64)}`,
        tag: `git-${revision}`,
      },
      terraformValidation: {
        contextSha256: "3".repeat(64),
        criticalFindings: 0,
        digest: `sha256:${"c".repeat(64)}`,
        highFindings: 0,
        provenance: "attached",
        provenanceDigest: `sha256:${"4".repeat(64)}`,
        provenanceIdentity:
          "https://github.com/hunter-west/CloudMarkup/.github/workflows/beta-setup.yml@refs/heads/main",
        provenancePredicateType:
          "https://cloudmarkup.com/attestations/beta-image-build/v1",
        provenanceSourceRevision: revision,
        repositoryName: "cloudmarkup/terraform-validation",
        repositoryUri:
          "000000000000.dkr.ecr.us-east-1.amazonaws.com/cloudmarkup/terraform-validation",
        sbom: "attached",
        sbomDigest: `sha256:${"5".repeat(64)}`,
        sbomFormat: "cyclonedx-json",
        scanDigest: `sha256:${"6".repeat(64)}`,
        scanStatus: "COMPLETE",
        scanner: "trivy@0.74.0",
        signatureIdentity:
          "https://github.com/hunter-west/CloudMarkup/.github/workflows/beta-setup.yml@refs/heads/main",
        signatureIssuer: "https://token.actions.githubusercontent.com",
        signatureStatus: "VERIFIED",
        signatureVerificationDigest: `sha256:${"7".repeat(64)}`,
        tag: `git-${revision}`,
      },
    },
    kind: "cloudmarkup.beta-setup-discovery",
    schemaVersion: 1,
    source: {
      generatedAt: "2026-09-01T12:00:00.000Z",
      ref: "refs/heads/main",
      repository: "hunter-west/CloudMarkup",
      revision,
      runAttempt: 1,
      runId: "123456789",
      workflow: "beta-setup.yml",
    },
  };
}

function discoveryIssueCodes(value: unknown): readonly string[] {
  const result = validateBetaSetupDiscoveryV1(value);
  return result.valid ? [] : result.issues.map(({ code }) => code);
}

describe("beta setup discovery", () => {
  test("accepts only complete exact setup evidence and hashes it canonically", () => {
    const discovery = validDiscovery();
    const first = validateBetaSetupDiscoveryV1(discovery);
    const reordered = validateBetaSetupDiscoveryV1(
      JSON.parse(JSON.stringify(discovery)) as unknown,
    );

    expect(first.valid).toBe(true);
    expect(reordered.valid).toBe(true);
    if (!first.valid || !reordered.valid) throw new Error("fixture must pass");
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(reordered.digest).toBe(first.digest);
  });

  test("rejects the legacy shared GitHub role", () => {
    const discovery = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (discovery["application"] as Record<string, unknown>)["githubRoleArn"] =
      "arn:aws:iam::000000000000:role/CloudMarkup-GitHub";

    expect(discoveryIssueCodes(discovery)).toContain(
      "beta-setup-discovery.schema-invalid",
    );
  });

  test("rejects incomplete status, mutable tags, identity drift, and unknown fields", () => {
    const certificate = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (certificate["certificate"] as Record<string, unknown>)["status"] =
      "PENDING_VALIDATION";
    expect(discoveryIssueCodes(certificate)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const scan = clone(validDiscovery()) as unknown as Record<string, unknown>;
    (
      (scan["images"] as Record<string, unknown>)["applicationBuild"] as Record<
        string,
        unknown
      >
    )["scanStatus"] = "IN_PROGRESS";
    expect(discoveryIssueCodes(scan)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const scanner = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (scanner["images"] as Record<string, unknown>)[
        "applicationBuild"
      ] as Record<string, unknown>
    )["scanner"] = "trivy@0.66.0";
    expect(discoveryIssueCodes(scanner)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const bootstrap = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (bootstrap["application"] as Record<string, unknown>)[
        "bootstrap"
      ] as Record<string, unknown>
    )["stackStatus"] = "UPDATE_ROLLBACK_COMPLETE";
    expect(discoveryIssueCodes(bootstrap)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const critical = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (critical["images"] as Record<string, unknown>)[
        "applicationBuild"
      ] as Record<string, unknown>
    )["criticalFindings"] = 1;
    expect(discoveryIssueCodes(critical)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const high = clone(validDiscovery()) as unknown as Record<string, unknown>;
    (
      (high["images"] as Record<string, unknown>)["applicationBuild"] as Record<
        string,
        unknown
      >
    )["highFindings"] = 1;
    expect(discoveryIssueCodes(high)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const unattested = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (unattested["images"] as Record<string, unknown>)[
        "terraformValidation"
      ] as Record<string, unknown>
    )["provenance"] = "missing";
    expect(discoveryIssueCodes(unattested)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const unboundProvenance = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (unboundProvenance["images"] as Record<string, unknown>)[
        "applicationBuild"
      ] as Record<string, unknown>
    )["provenanceSourceRevision"] = "9".repeat(40);
    expect(discoveryIssueCodes(unboundProvenance)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const unverifiedSignature = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (unverifiedSignature["images"] as Record<string, unknown>)[
        "terraformValidation"
      ] as Record<string, unknown>
    )["signatureStatus"] = "MISSING";
    expect(discoveryIssueCodes(unverifiedSignature)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const unapprovedContext = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (
      (unapprovedContext["images"] as Record<string, unknown>)[
        "applicationBuild"
      ] as Record<string, unknown>
    )["contextSha256"] = "0".repeat(64);
    expect(discoveryIssueCodes(unapprovedContext)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const dns = clone(validDiscovery()) as unknown as Record<string, unknown>;
    (dns["dns"] as Record<string, unknown>)["createApplicationRecords"] = true;
    expect(discoveryIssueCodes(dns)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const tag = clone(validDiscovery()) as unknown as Record<string, unknown>;
    (
      (tag["images"] as Record<string, unknown>)[
        "terraformValidation"
      ] as Record<string, unknown>
    )["tag"] = `git-${"d".repeat(40)}`;
    expect(discoveryIssueCodes(tag)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const account = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (account["application"] as Record<string, unknown>)["accountId"] =
      "111111111111";
    expect(discoveryIssueCodes(account)).toContain(
      "beta-setup-discovery.schema-invalid",
    );

    const extra = clone(validDiscovery()) as unknown as Record<string, unknown>;
    extra["unreviewed"] = true;
    expect(discoveryIssueCodes(extra)).toContain(
      "beta-setup-discovery.schema-invalid",
    );
  });

  test("rejects secret-shaped fields and values, controls, and placeholders without echoing values", () => {
    const credential = ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join(
      "_",
    );
    const secret = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    secret["accessToken"] = credential;
    const result = validateBetaSetupDiscoveryV1(secret);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("secret fixture must fail");
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "beta-setup-discovery.literal-secret",
        "beta-setup-discovery.schema-invalid",
        "beta-setup-discovery.secret-field",
      ]),
    );
    expect(JSON.stringify(result.issues)).not.toContain(credential);

    const secretKey = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    secretKey[credential] = "prohibited";
    const secretKeyResult = validateBetaSetupDiscoveryV1(secretKey);
    expect(secretKeyResult.valid).toBe(false);
    if (secretKeyResult.valid) throw new Error("secret key fixture must fail");
    expect(secretKeyResult.issues.map(({ code }) => code)).toContain(
      "beta-setup-discovery.secret-field",
    );
    expect(JSON.stringify(secretKeyResult.issues)).not.toContain(credential);

    const control = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (control["source"] as Record<string, unknown>)["runId"] = "123\n456";
    expect(discoveryIssueCodes(control)).toContain(
      "beta-setup-discovery.control-character",
    );

    const placeholder = clone(validDiscovery()) as unknown as Record<
      string,
      unknown
    >;
    (placeholder["dns"] as Record<string, unknown>)["hostedZoneId"] =
      "ZEXAMPLE123";
    expect(discoveryIssueCodes(placeholder)).toContain(
      "beta-setup-discovery.placeholder-prohibited",
    );
  });
});

describe("beta setup deployment-input merge", () => {
  test("overlays only observed account, Region, certificate, and hosted-zone fields", () => {
    const base = loadBetaBase();
    const original = clone(base);
    const discovery = validDiscovery();
    const result = mergeBetaSetupDiscoveryV1(base, discovery);

    expect(result.valid).toBe(true);
    expect(base).toEqual(original);
    if (!result.valid) throw new Error("merge fixture must pass");
    const expected = clone(original);
    expected.aws.accountId = discovery.application.accountId;
    expected.aws.primaryRegion = discovery.application.region;
    expected.domains.certificateArn = discovery.certificate.arn;
    expected.domains.hostedZoneId = discovery.dns.hostedZoneId;
    expect(result.data).toEqual(expected);
    expect(result.discoveryDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const expectedValidation = validateDeploymentInputsV1(expected);
    expect(expectedValidation.valid).toBe(true);
    if (!expectedValidation.valid) {
      throw new Error("expected deployment input fixture must pass");
    }
    expect(result.deploymentInputsDigest).toBe(expectedValidation.digest);
  });

  test("fails closed across environment, role, repository, branch, and domain boundaries", () => {
    const mutations: ((value: DeploymentInputsV1) => void)[] = [
      (value) => {
        value.environment = { name: "dev", stage: "development" };
      },
      (value) => {
        value.aws.platformDeployment.roleArn =
          "arn:aws:iam::000000000000:role/CloudMarkup-Other";
      },
      (value) => {
        value.aws.platformDeployment.repository.owner = "attacker";
      },
      (value) => {
        value.aws.platformDeployment.repository.approvedBranches = [
          "main",
          "release",
        ];
      },
      (value) => {
        value.domains.applicationDomain = "www.cloudmarkup.com";
      },
    ];

    for (const mutate of mutations) {
      const base = loadBetaBase();
      mutate(base);
      const result = mergeBetaSetupDiscoveryV1(base, validDiscovery());
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("boundary fixture must fail");
      expect(result.issues.map(({ code }) => code)).toContain(
        "beta-setup-merge.boundary-mismatch",
      );
    }
  });

  test("does not turn unresolved human decisions into deployment authority", () => {
    const base = loadBetaBase();
    base.stripe.businessDecisions.terms.status = "pending";
    base.stripe.businessDecisions.terms.evidenceReference =
      "decision.stripe-terms.pending";

    const result = mergeBetaSetupDiscoveryV1(base, validDiscovery());
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("pending input must fail");
    expect(result.issues.map(({ code }) => code)).toContain(
      "beta-setup-merge.base-placeholder-prohibited",
    );
  });
});

describe("beta setup CLI filesystem boundary", () => {
  test("validates a bounded discovery file through the CLI entrypoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-setup-"));
    try {
      const discoveryPath = join(directory, "discovery.json");
      await writeFile(discoveryPath, JSON.stringify(validDiscovery()), "utf8");
      const emitted: unknown[] = [];

      expect(
        await runBetaSetupCli(["validate", discoveryPath], (value) =>
          emitted.push(value),
        ),
      ).toBe(0);
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          valid: true,
        }),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("creates a new merge output once and never overwrites it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-setup-"));
    try {
      const basePath = join(directory, "base.json");
      const discoveryPath = join(directory, "discovery.json");
      const outputPath = join(directory, "merged.json");
      await Promise.all([
        writeFile(basePath, JSON.stringify(loadBetaBase()), "utf8"),
        writeFile(discoveryPath, JSON.stringify(validDiscovery()), "utf8"),
      ]);
      const emitted: unknown[] = [];

      expect(
        await runBetaSetupCli(
          ["merge", basePath, discoveryPath, outputPath],
          (value) => emitted.push(value),
        ),
      ).toBe(0);
      const firstOutput = await readFile(outputPath, "utf8");
      const parsedOutput: unknown = JSON.parse(firstOutput);
      const outputValidation = validateDeploymentInputsV1(parsedOutput);
      expect(outputValidation.valid).toBe(true);
      if (!outputValidation.valid) throw new Error("CLI output must validate");
      expect(outputValidation.data.aws.accountId).toBe("000000000000");
      expect(outputValidation.data.aws.primaryRegion).toBe("us-east-1");
      expect(outputValidation.data.domains.hostedZoneId).toBe(
        validDiscovery().dns.hostedZoneId,
      );

      expect(
        await runBetaSetupCli(
          ["merge", basePath, discoveryPath, outputPath],
          (value) => emitted.push(value),
        ),
      ).toBe(2);
      expect(await readFile(outputPath, "utf8")).toBe(firstOutput);
      expect(emitted.at(-1)).toEqual(
        expect.objectContaining({
          code: "beta-setup-input.output-unavailable",
          valid: false,
        }),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("rejects an output path that overlaps either input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloudmarkup-beta-setup-"));
    try {
      const basePath = join(directory, "base.json");
      const discoveryPath = join(directory, "discovery.json");
      await Promise.all([
        writeFile(basePath, JSON.stringify(loadBetaBase()), "utf8"),
        writeFile(discoveryPath, JSON.stringify(validDiscovery()), "utf8"),
      ]);
      const originalBase = await readFile(basePath, "utf8");
      const emitted: unknown[] = [];

      expect(
        await runBetaSetupCli(
          ["merge", basePath, discoveryPath, basePath],
          (value) => emitted.push(value),
        ),
      ).toBe(2);
      expect(await readFile(basePath, "utf8")).toBe(originalBase);
      expect(emitted).toEqual([
        expect.objectContaining({
          code: "beta-setup-input.output-overlap",
          valid: false,
        }),
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
