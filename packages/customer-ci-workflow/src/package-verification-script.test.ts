import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateCustomerCiWorkflowSetV1 } from "./generator.js";
import { sha256 } from "./security.js";
import {
  CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
  createCustomerCiWorkflowTestConfigV1,
} from "./testing.js";
import { packageVerificationScriptV1 } from "./workflow-scripts.js";

const PROVIDER_LOCK = `provider "registry.terraform.io/hashicorp/aws" {
  version = "5.100.0"
  hashes = ["zh:${"a".repeat(64)}"]
}
`;
const VERIFICATION_FAILURE_MESSAGE =
  "The reviewed Solution package tree failed integrity validation.";

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map(async (root) => {
      await rm(root, { force: true, recursive: true });
    }),
  );
  temporaryRoots.clear();
});

function extractVerifierBody(script: string): string {
  const lines = script.split("\n");
  const opening = "node --input-type=module <<'CLOUDMARKUP_VERIFY'";
  if (lines[0] !== opening || lines.at(-1) !== "CLOUDMARKUP_VERIFY") {
    throw new Error("Malformed generated package-verifier fixture.");
  }
  return lines.slice(1, -1).join("\n");
}

async function writeRepositoryFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, { flag: "wx" });
}

function declaration(path: string, content: string) {
  return {
    checksum: sha256(content),
    path,
    sizeBytes: Buffer.byteLength(content),
  };
}

async function executePackageVerifier(
  sourcePath: "main.tf" | "main.tf.json",
  source: string,
  backendConfig = CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
  beforeVerify?: (
    fixture: Readonly<{
      root: string;
      workflowContent: string;
      workflowPath: string;
    }>,
  ) => Promise<void>,
  applicationBuild?:
    "passed" | "missing-evidence" | "failed" | "wrong-ownership",
): Promise<SpawnSyncReturns<string>> {
  const root = await mkdtemp(join(tmpdir(), "cloudmarkup-package-verifier-"));
  temporaryRoots.add(root);
  const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
  const terraformRoot = "infrastructure/terraform";
  const terraformFiles = [
    declaration(`${terraformRoot}/.terraform.lock.hcl`, PROVIDER_LOCK),
    declaration(`${terraformRoot}/backend.hcl`, backendConfig),
    declaration(`${terraformRoot}/${sourcePath}`, source),
  ];
  config.terraform.packageTreeDigest = sha256(
    JSON.stringify(
      terraformFiles
        .map(({ checksum, path }) => ({ checksum, path }))
        .sort((left, right) => left.path.localeCompare(right.path, "en")),
    ),
  );

  const generated = generateCustomerCiWorkflowSetV1(config);
  const packagePrefix = config.repository.destinationFolder;
  for (const file of terraformFiles) {
    const content = file.path.endsWith(".terraform.lock.hcl")
      ? PROVIDER_LOCK
      : file.path.endsWith("backend.hcl")
        ? backendConfig
        : source;
    await writeRepositoryFile(root, `${packagePrefix}/${file.path}`, content);
  }

  const workflowFiles = generated.manifest.files.map((file) => ({
    checksum: file.checksum,
    path: file.path,
    sizeBytes: Buffer.byteLength(file.content),
  }));
  for (const file of generated.manifest.files) {
    await writeRepositoryFile(root, file.path, file.content);
  }

  const applicationPayloads: {
    content: string;
    mediaType: string;
    ownership: string;
    path: string;
  }[] = [];
  if (applicationBuild !== undefined) {
    const artifactPath =
      "application/artifacts/workload_event_consumer/function.zip";
    const artifactContent = "PK\u0003\u0004cloudmarkup-handler-zip";
    const artifactChecksum = sha256(artifactContent);
    applicationPayloads.push({
      content: artifactContent,
      mediaType: "application/zip",
      ownership:
        applicationBuild === "wrong-ownership"
          ? "generated-replaceable"
          : "generated-build-artifact",
      path: artifactPath,
    });
    if (applicationBuild !== "missing-evidence") {
      const evidence = {
        artifacts: [
          {
            digest: artifactChecksum,
            mediaType: "application/zip",
            sizeBytes: Buffer.byteLength(artifactContent),
          },
        ],
        checks: [
          {
            artifactDigests: [artifactChecksum],
            checkId: "cloudmarkup.evidence.application-build-and-tests",
            generationCoverageRequirement: "application-build-and-tests",
            issueIds: [],
            status: applicationBuild === "failed" ? "failed" : "passed",
            summary: "Application build and generated tests completed.",
          },
          {
            artifactDigests: [artifactChecksum],
            checkId: "cloudmarkup.evidence.application-security-checks",
            generationCoverageRequirement: "application-security-checks",
            issueIds: [],
            status: "passed",
            summary: "Application security checks passed.",
          },
        ],
        contractVersion: 1,
        environment: { environmentType: "unknown" },
        id: "evidence_event_handler_build",
        layer: "generated",
        level: { kind: "application-build-and-tests", rank: 5 },
        models: [],
        provenance: {
          actor: {
            kind: "deterministic-tool",
            tool: {
              digest: sha256("application-build-runner"),
              id: "cloudmarkup.application-build-runner",
              version: "1.0.0",
            },
          },
          createdAt: "2026-08-27T00:00:00.000Z",
          inputDigests: [config.solutionRevision.digest],
        },
        solutionRevisionId: config.solutionRevision.id,
        staleness: {
          assessedAt: "2026-08-27T00:00:00.000Z",
          state: "current",
        },
        tools: [],
      };
      applicationPayloads.push({
        content: `${JSON.stringify(evidence)}\n`,
        mediaType: "application/json",
        ownership: "evidence-artifact",
        path: "application/evidence/workload_event_consumer/application-build-evidence.json",
      });
    }
  }
  for (const file of applicationPayloads) {
    await writeRepositoryFile(
      root,
      `${packagePrefix}/${file.path}`,
      file.content,
    );
  }
  const applicationFiles = applicationPayloads.map(
    ({ content, ...metadata }) => ({
      ...declaration(metadata.path, content),
      ...metadata,
    }),
  );

  const solutionExportManifest = {
    contractVersion: 1,
    files: [...terraformFiles, ...applicationFiles],
    kind: "cloudmarkup.solution-export-manifest",
    repositoryWorkflows: { files: workflowFiles },
    solutionRevision: config.solutionRevision,
    target: {
      providers: [
        {
          source: "hashicorp/aws",
          versionConstraint: "~> 5.0",
        },
      ],
    },
  };
  await writeRepositoryFile(
    root,
    `${packagePrefix}/cloudmarkup/cloudmarkup.manifest.json`,
    `${JSON.stringify(solutionExportManifest)}\n`,
  );
  await writeRepositoryFile(
    root,
    `${packagePrefix}/cloudmarkup/cloudmarkup.lock.json`,
    `${JSON.stringify({ solutionRevision: config.solutionRevision })}\n`,
  );

  const workflowFile = generated.manifest.files[0];
  if (workflowFile === undefined) {
    throw new Error("Generated workflow fixture is empty.");
  }
  await beforeVerify?.({
    root,
    workflowContent: workflowFile.content,
    workflowPath: workflowFile.path,
  });

  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      extractVerifierBody(packageVerificationScriptV1(config)),
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CLOUDMARKUP_AWS_REGION: "us-east-1",
      },
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

function expectAccepted(result: SpawnSyncReturns<string>): void {
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain(
    "The reviewed Solution package tree, exact revision, and remote backend authority are intact.",
  );
}

function expectRejected(result: SpawnSyncReturns<string>): void {
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(VERIFICATION_FAILURE_MESSAGE);
}

const ORDINARY_TERRAFORM = `terraform {
  required_version = ">= 1.5.0"
}

resource "aws_s3_bucket" "assets" {}
`;

describe("generated package verifier workflow byte admission", () => {
  it("rejects changed workflow bytes after the manifest was sealed", async () => {
    const result = await executePackageVerifier(
      "main.tf",
      ORDINARY_TERRAFORM,
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
      async ({ root, workflowContent, workflowPath }) => {
        await writeFile(
          join(root, ...workflowPath.split("/")),
          `${workflowContent}# changed after review\n`,
          "utf8",
        );
      },
    );

    expectRejected(result);
  });
});

describe("generated package verifier handler build Evidence admission", () => {
  it("accepts a manifest-bound handler ZIP with passing deterministic build, test, and security Evidence", async () => {
    expectAccepted(
      await executePackageVerifier(
        "main.tf",
        ORDINARY_TERRAFORM,
        CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
        undefined,
        "passed",
      ),
    );
  });

  it.each(["missing-evidence", "failed", "wrong-ownership"] as const)(
    "rejects a generated handler ZIP when build Evidence is %s",
    async (applicationBuild) => {
      expectRejected(
        await executePackageVerifier(
          "main.tf",
          ORDINARY_TERRAFORM,
          CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
          undefined,
          applicationBuild,
        ),
      );
    },
  );
});

describe("generated package verifier Terraform backend admission", () => {
  it("accepts the exact encrypted native-lockfile S3 backend with workspace isolation", async () => {
    expectAccepted(
      await executePackageVerifier(
        "main.tf",
        ORDINARY_TERRAFORM,
        CUSTOMER_CI_TEST_BACKEND_CONFIG_V1,
      ),
    );
  });
  it.each([
    [
      "encryption disabled",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        "encrypt = true",
        "encrypt = false",
      ),
    ],
    [
      "native lockfile disabled",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        "use_lockfile = true",
        "use_lockfile = false",
      ),
    ],
    [
      "workspace isolation removed",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        'workspace_key_prefix = "cloudmarkup/notes"\n',
        "",
      ),
    ],
    [
      "duplicate assignment",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        'region = "us-east-1"',
        'bucket = "second-state-bucket"',
      ),
    ],
    [
      "credential assignment",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        'workspace_key_prefix = "cloudmarkup/notes"',
        'access_key = "forbidden"',
      ),
    ],
    [
      "endpoint assignment",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        'workspace_key_prefix = "cloudmarkup/notes"',
        'endpoint = "attacker.example"',
      ),
    ],
    [
      "malformed assignment",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace("bucket =", "bucket :"),
    ],
    [
      "comment-based encryption bypass",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        "encrypt = true",
        "encrypt = true # access_key = forbidden",
      ),
    ],
    [
      "changed backend region",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace("us-east-1", "us-west-2"),
    ],
    [
      "state key traversal",
      CUSTOMER_CI_TEST_BACKEND_CONFIG_V1.replace(
        "solutions/notes/terraform.tfstate",
        "../other/terraform.tfstate",
      ),
    ],
  ])("rejects %s", async (_label, backendConfig) => {
    expectRejected(
      await executePackageVerifier(
        "main.tf",
        ORDINARY_TERRAFORM,
        backendConfig,
      ),
    );
  });
});

describe("generated package verifier Terraform source admission", () => {
  it("accepts ordinary provider-local Terraform", async () => {
    const result = await executePackageVerifier(
      "main.tf",
      `terraform {
  required_version = ">= 1.5.0"
}

resource "aws_s3_bucket" "assets" {
  bucket = "customer-owned-assets"
}
`,
    );

    expectAccepted(result);
  });

  it("ignores forbidden-looking text in comments, quoted strings, and heredocs", async () => {
    const result = await executePackageVerifier(
      "main.tf",
      String.raw`# module "commented" { source = "./ignored" }
// provisioner "local-exec" { command = "ignored" }
/*
module "block-commented" {
  source = "./ignored"
}
*/
locals {
  quoted = "module \"inside-a-string\" { provisioner \"also-inside\" {"
  rendered = <<-EOT
    module "inside-a-heredoc" {
      provisioner "local-exec" {
        command = "ignored"
      }
    }
  EOT
}

resource "aws_s3_bucket" "assets" {}
`,
    );

    expectAccepted(result);
  });

  it("accepts ordinary Terraform JSON when forbidden words are values, not keys", async () => {
    const result = await executePackageVerifier(
      "main.tf.json",
      JSON.stringify({
        locals: { description: "module and provisioner are ordinary text" },
        resource: {
          aws_s3_bucket: { assets: { bucket: "customer-owned-assets" } },
        },
        terraform: { required_version: ">= 1.5.0" },
      }),
    );

    expectAccepted(result);
  });

  it.each([
    [
      "module",
      `module /* reviewed comments do not hide the block */ "network" {
  source = "./network"
}
`,
    ],
    [
      "provisioner",
      `resource "aws_s3_bucket" "assets" {
  provisioner // comments do not break the token sequence
    "local-exec" {
    command = "false"
  }
}
`,
    ],
    [
      "provider",
      `provider "aws" {
  access_key = "forbidden"
  endpoints { sts = "https://attacker.invalid" }
}
`,
    ],
  ])("rejects a real %s block", async (_kind, source) => {
    expectRejected(await executePackageVerifier("main.tf", source));
  });

  it("rejects a provider alias meta-argument", async () => {
    expectRejected(
      await executePackageVerifier(
        "main.tf",
        `resource "aws_s3_bucket" "assets" {
  provider = aws.role_hop
}
`,
      ),
    );
  });

  it.each([
    [
      "Unicode-escaped module key",
      String.raw`{"mod\u0075le":{"blocked":{"source":"./blocked"}}}`,
    ],
    [
      "Unicode-escaped provisioner key",
      String.raw`{"resource":{"aws_s3_bucket":{"assets":{"provis\u0069oner":{"local-exec":{"command":"false"}}}}}}`,
    ],
    [
      "Unicode-escaped provider key",
      String.raw`{"provi\u0064er":{"aws":{"access_key":"forbidden","endpoints":{"sts":"https://attacker.invalid"}}}}`,
    ],
  ])("rejects a decoded Terraform JSON %s", async (_kind, source) => {
    expectRejected(await executePackageVerifier("main.tf.json", source));
  });

  it.each([
    ["unterminated quoted string", `locals { value = "never closes\n}\n`],
    ["unterminated block comment", `locals {}\n/* never closes\n`],
    ["unterminated heredoc", `locals { value = <<EOT\nnever closes\n}\n`],
    ["mismatched delimiters", `locals { value = [1, 2 }\n`],
  ])("rejects malformed HCL with an %s", async (_kind, source) => {
    expectRejected(await executePackageVerifier("main.tf", source));
  });

  it("rejects malformed Terraform JSON", async () => {
    expectRejected(
      await executePackageVerifier("main.tf.json", `{"resource":`),
    );
  });

  it("rejects Terraform source beyond the lexical token limit", async () => {
    expectRejected(
      await executePackageVerifier("main.tf", "+".repeat(250_001)),
    );
  });

  it.each([
    [
      "HCL",
      "main.tf" as const,
      `locals { value = ${"[".repeat(129)}0${"]".repeat(129)} }`,
    ],
    [
      "Terraform JSON",
      "main.tf.json" as const,
      `${'{"nested":'.repeat(129)}null${"}".repeat(129)}`,
    ],
  ])(
    "rejects %s beyond the structural depth limit",
    async (_kind, path, source) => {
      expectRejected(await executePackageVerifier(path, source));
    },
  );
});
