import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { modelInvocationDescriptorV1Schema } from "@cloudmarkup/schemas";

import {
  APPROVED_VALIDATION_COMMANDS,
  canonicalDigest,
  createTerraformValidationRunner,
  isApprovedInvocation,
  sanitizeToolText,
  sha256,
  terraformValidationTreeDigest,
  terraformValidationDiagnosticV1Schema,
  terraformValidationFileV1Schema,
  terraformValidationPolicyV1Schema,
  terraformValidationReferenceV1Schema,
  terraformValidationRequestV1Schema,
  terraformValidationResultV1Schema,
  validationToolPinV1Schema,
  type OrganizationPolicyEvaluator,
  type TerraformValidationFileV1,
  type TerraformValidationPolicyV1,
  type TerraformValidationRequestV1,
  type ValidationCommandInvocation,
  type ValidationCommandResult,
  type ValidationWorkspaceExecutor,
  type ValidationWorkspaceSession,
} from "./index.js";

const compiler = validationToolPinV1Schema.parse({
  digest: sha256("compiler@1.0.0"),
  id: "cloudmarkup.iac-compiler",
  version: "1.0.0",
});
const terraform = {
  digest: sha256("terraform@1.13.5"),
  id: "hashicorp.terraform",
  version: "1.13.5",
} as const;
const tflint = {
  digest: sha256("tflint@0.59.1"),
  id: "terraform-linters.tflint",
  version: "0.59.1",
} as const;
const scanner = {
  digest: sha256("trivy@0.66.0"),
  id: "aquasecurity.trivy",
  version: "0.66.0",
} as const;
const validationRunner = {
  digest: sha256("cloudmarkup.terraform-validation-runner@1.0.0"),
  id: "cloudmarkup.terraform-validation-runner",
  version: "1.0.0",
} as const;
const organizationPolicy = {
  digest: sha256("organization-policy@1.0.0"),
  id: "cloudmarkup.organization-policy",
  version: "1.0.0",
} as const;
const providerLockContent = `provider "registry.terraform.io/hashicorp/aws" {
  version = "6.0.0"
  hashes = ["h1:reviewed-fixture"]
}
`;

function policy(
  options: {
    readonly includeOrganizationPolicy?: boolean;
    readonly scannerRequired?: boolean;
    readonly tflintRequired?: boolean;
  } = {},
): TerraformValidationPolicyV1 {
  return terraformValidationPolicyV1Schema.parse({
    compiler,
    container: {
      digest: sha256("reviewed-validation-image"),
      image: "registry.example.invalid/cloudmarkup/terraform-validation",
      platform: "linux/amd64",
      providerMirrorPath: "/opt/cloudmarkup/provider-mirror",
      terraformCliConfigPath: "/opt/cloudmarkup/terraform.rc",
    },
    contractVersion: 1,
    limits: {
      cpuSeconds: 30,
      maxFileBytes: 64 * 1024,
      maxFiles: 64,
      maxOutputBytes: 64 * 1024,
      maxProcesses: 16,
      maxTotalFileBytes: 512 * 1024,
      memoryMiB: 512,
      wallTimeMilliseconds: 30_000,
    },
    modules: [],
    ...(options.includeOrganizationPolicy === true
      ? {
          organizationPolicy: {
            configDigest: sha256("organization-policy-config"),
            required: true,
            tool: organizationPolicy,
          },
        }
      : {}),
    providerLock: {
      checksum: sha256(providerLockContent),
      content: providerLockContent,
    },
    providers: [
      {
        mirrorPackageDigest: sha256("aws-provider-package"),
        source: "hashicorp/aws",
        version: "6.0.0",
      },
    ],
    runner: validationRunner,
    scanner: {
      configDigest: sha256("trivy-config"),
      required: options.scannerRequired ?? false,
      tool: scanner,
    },
    terraform,
    tflint: {
      configDigest: sha256("tflint-config"),
      required: options.tflintRequired ?? false,
      tool: tflint,
    },
  });
}

function references() {
  return terraformValidationReferenceV1Schema.parse({
    edgeIds: ["edge_notes_table"],
    nodeIds: ["node_notes_lambda"],
    ownedPolicyIds: ["policy_notes_read"],
    solutionRevisionId: "solution-revision-fixture",
  });
}

function terraformFile(
  content = `terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "6.0.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
`,
  path = "infrastructure/versions.tf",
): TerraformValidationFileV1 {
  return terraformValidationFileV1Schema.parse({
    checksum: sha256(content),
    content,
    path,
    references: references(),
  });
}

function request(
  files: readonly TerraformValidationFileV1[] = [terraformFile()],
): TerraformValidationRequestV1 {
  return terraformValidationRequestV1Schema.parse({
    artifactDigest: canonicalDigest(
      files.map(({ checksum, path }) => ({ checksum, path })),
    ),
    assessedAt: "2026-08-17T20:00:00.000Z",
    compiler,
    contractVersion: 1,
    environment: {
      environmentId: "environment.development",
      environmentType: "development",
    },
    files: [...files],
    solutionRevisionDigest: sha256("solution-revision-fixture"),
    solutionRevisionId: "solution-revision-fixture",
  });
}

const extensionModelDescriptor = modelInvocationDescriptorV1Schema.parse({
  budgetDecisionId: "budget-decision-terraform-test",
  complexity: "deep",
  contractVersion: 1,
  entitlementDecisionId: "entitlement-decision-terraform-test",
  evaluationPolicyId: "cloudmarkup.model-evaluation",
  evaluationPolicyVersion: "1.0.0",
  feature: "iac-extension.generate",
  idempotencyKeyDigest: sha256("terraform-extension-idempotency"),
  inputDigest: sha256("terraform-extension-input"),
  invocationId: "invocation-terraform-extension-test",
  modelId: "model.terraform-fixture",
  modelVersion: "2026-08-21",
  promptDigest: sha256("terraform-extension-prompt"),
  promptTemplateId: "cloudmarkup.prompt.terraform-extension",
  promptVersion: "1.0.0",
  providerFamily: "deterministic-fake",
  providerId: "provider.model-fixture",
  requestedMode: "professional",
  role: "deep-architecture-custom-generation",
  scope: {
    organizationId: "organization-terraform-test",
    projectId: "project-terraform-test",
    solutionRevisionId: "solution-revision-fixture",
    userId: "user-terraform-test",
  },
  toolAuthority: "none",
});

const validExtensionContent = `resource "aws_s3_bucket" "custom" {
  bucket = "cloudmarkup-extension-fixture"
}
`;

interface ExtensionRequestOptions {
  readonly allowedProviderSources?: readonly string[];
  readonly allowedResourceTypes?: readonly string[];
  readonly artifactDigest?: TerraformValidationRequestV1["artifactDigest"];
  readonly candidateArtifactDigest?: TerraformValidationRequestV1["artifactDigest"];
  readonly candidateContent?: string;
  readonly candidateDigest?: TerraformValidationRequestV1["artifactDigest"];
  readonly candidatePath?: string;
  readonly maximumResourceCount?: number;
  readonly modelDescriptor?: typeof extensionModelDescriptor;
  readonly ownedResourceAddresses?: readonly string[];
  readonly protectCandidatePath?: boolean;
  readonly protectedResourceAddresses?: readonly string[];
  readonly providerVersionConstraint?: string;
}

function extensionRequest(
  options: ExtensionRequestOptions = {},
): TerraformValidationRequestV1 {
  const baselineFile = terraformFile();
  const candidateFile = terraformFile(
    options.candidateContent ?? validExtensionContent,
    options.candidatePath ?? "infrastructure/extensions/custom.tf",
  );
  const files =
    options.protectCandidatePath === true
      ? [candidateFile]
      : [baselineFile, candidateFile];
  const protectedFiles =
    options.protectCandidatePath === true
      ? [{ checksum: candidateFile.checksum, path: candidateFile.path }]
      : [{ checksum: baselineFile.checksum, path: baselineFile.path }];
  return terraformValidationRequestV1Schema.parse({
    artifactDigest:
      options.artifactDigest ?? terraformValidationTreeDigest(files),
    assessedAt: "2026-08-17T20:00:00.000Z",
    compiler,
    contractVersion: 1,
    environment: {
      environmentId: "environment.development",
      environmentType: "development",
    },
    extensionContext: {
      baseline: {
        artifactDigest: terraformValidationTreeDigest(
          options.protectCandidatePath === true
            ? [candidateFile]
            : [baselineFile],
        ),
        compiler,
        solutionRevisionDigest: sha256("solution-revision-fixture"),
      },
      candidateArtifactDigest:
        options.candidateArtifactDigest ?? sha256("candidate-artifact-fixture"),
      candidateDigest:
        options.candidateDigest ??
        terraformValidationTreeDigest([candidateFile]),
      candidateDigestCanonicalization:
        "cloudmarkup.terraform-validation-tree.path-checksum.v1",
      candidateOwnedPaths: [candidateFile.path],
      contractVersion: 1,
      extensionId: "extension.terraform.custom",
      maximumResourceCount: options.maximumResourceCount ?? 8,
      mode: "ai-authored-extension",
      modelDescriptor: options.modelDescriptor ?? extensionModelDescriptor,
      modelOutputDigest: sha256("model-output-fixture"),
      officialSchemaAuthorities: [
        {
          schemaDigest: sha256("terraform-provider-schema-fixture"),
          schemaId: "schema.terraform-provider-fixture",
          schemaVersion: "1.0.0",
        },
      ],
      ownedResourceAddresses: options.ownedResourceAddresses ?? [
        "aws_s3_bucket.custom",
      ],
      providerAuthorities: (
        options.allowedProviderSources ?? ["hashicorp/aws"]
      ).map((source, index) => ({
        providerId: "provider.extension-" + String(index),
        source,
        versionConstraint: options.providerVersionConstraint ?? "6.0.0",
      })),
      protectedDeterministicFiles: protectedFiles,
      protectedDeterministicResourceAddresses:
        options.protectedResourceAddresses ?? ["aws_lambda_function.notes"],
      resourceAuthorities: (
        options.allowedResourceTypes ?? ["aws_s3_bucket"]
      ).map((resourceType) => ({
        blockKind: "resource" as const,
        providerId: "provider.extension-0",
        resourceType,
      })),
      slotId: "cloudmarkup.extension.slot.terraform",
      target: "terraform",
      validationTreeDigestCanonicalization:
        "cloudmarkup.terraform-validation-tree.path-checksum.v1",
    },
    files,
    solutionRevisionDigest: sha256("solution-revision-fixture"),
    solutionRevisionId: "solution-revision-fixture",
  });
}

const successByStep = {
  fmt: {
    exitCode: 0,
    outputBytes: 0,
    stderr: "",
    stdout: "",
    termination: "completed",
  },
  init: {
    exitCode: 0,
    outputBytes: 24,
    stderr: "",
    stdout: "Terraform initialized.",
    termination: "completed",
  },
  scanner: {
    exitCode: 0,
    outputBytes: 14,
    stderr: "",
    stdout: '{"Results":[]}',
    termination: "completed",
  },
  tflint: {
    exitCode: 0,
    outputBytes: 13,
    stderr: "",
    stdout: '{"issues":[]}',
    termination: "completed",
  },
  validate: {
    exitCode: 0,
    outputBytes: 48,
    stderr: "",
    stdout: '{"format_version":"1.0","valid":true,"diagnostics":[]}',
    termination: "completed",
  },
} as const satisfies Readonly<Record<string, ValidationCommandResult>>;

class FakeSession implements ValidationWorkspaceSession {
  public readonly invocations: ValidationCommandInvocation[] = [];
  public disposed = false;
  readonly #result: (
    invocation: ValidationCommandInvocation,
    signal?: AbortSignal,
  ) => ValidationCommandResult;

  public constructor(
    result: (
      invocation: ValidationCommandInvocation,
      signal?: AbortSignal,
    ) => ValidationCommandResult,
  ) {
    this.#result = result;
  }

  public execute(
    invocation: ValidationCommandInvocation,
    signal?: AbortSignal,
  ): Promise<ValidationCommandResult> {
    this.invocations.push({ ...invocation, args: [...invocation.args] });
    return Promise.resolve(this.#result(invocation, signal));
  }

  public dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}

class FakeExecutor implements ValidationWorkspaceExecutor {
  public readonly sessions: FakeSession[] = [];
  readonly #factory: () => FakeSession;

  public constructor(
    factory: () => FakeSession = () =>
      new FakeSession((invocation) => successByStep[invocation.step]),
  ) {
    this.#factory = factory;
  }

  public open(): Promise<ValidationWorkspaceSession> {
    const session = this.#factory();
    this.sessions.push(session);
    return Promise.resolve(session);
  }
}

function runner(
  executor: ValidationWorkspaceExecutor,
  runnerPolicy = policy(),
  evaluator?: OrganizationPolicyEvaluator,
) {
  return createTerraformValidationRunner({
    executor,
    policy: runnerPolicy,
    ...(evaluator === undefined ? {} : { organizationPolicy: evaluator }),
  });
}

describe("Terraform validation runner", () => {
  it("runs only the fixed offline command sequence and emits two exact Evidence records", async () => {
    const executor = new FakeExecutor();
    const result = await runner(executor).run(request());

    expect(result.state).toBe("passed");
    expect(result.diagnostics).toEqual([]);
    expect(executor.sessions[0]?.invocations).toEqual([
      APPROVED_VALIDATION_COMMANDS.fmt,
      APPROVED_VALIDATION_COMMANDS.init,
      APPROVED_VALIDATION_COMMANDS.validate,
      APPROVED_VALIDATION_COMMANDS.tflint,
      APPROVED_VALIDATION_COMMANDS.scanner,
    ]);
    expect(executor.sessions[0]?.disposed).toBe(true);
    expect(result.evidenceRecords).toHaveLength(2);
    expect(result.evidenceRecords.map(({ level }) => level)).toEqual([
      { kind: "deterministic-target-compilation", rank: 3 },
      { kind: "deterministic-target-compilation", rank: 3 },
    ]);
    expect(
      result.evidenceRecords.every(
        ({ environment }) =>
          JSON.stringify(environment) === JSON.stringify(request().environment),
      ),
    ).toBe(true);
    expect(result.evidenceRecords[1]?.provenance.actor).toEqual({
      kind: "deterministic-tool",
      tool: validationRunner,
    });
    expect(result.evidenceRecords[0]?.checks[0]).toEqual(
      expect.objectContaining({
        generationCoverageRequirement:
          "deterministic-infrastructure-compilation",
        status: "passed",
      }),
    );
    expect(result.evidenceRecords[1]?.checks[0]?.status).toBe("passed");
  });

  it.each([
    ["timeout", "error"],
    ["output-limit", "error"],
  ] as const)("fails closed on %s", async (termination, expectedState) => {
    const executor = new FakeExecutor(
      () =>
        new FakeSession((invocation) =>
          invocation.step === "fmt"
            ? {
                exitCode: null,
                outputBytes: 65_537,
                stderr: "",
                stdout: "",
                termination,
              }
            : successByStep[invocation.step],
        ),
    );
    const result = await runner(executor).run(request());
    expect(result.state).toBe(expectedState);
    expect(result.commandSummaries).toHaveLength(1);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      `terraform.validation.command-${termination}`,
    );
  });

  it("returns cancelled and disposes its workspace when cancellation wins", async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = new FakeExecutor(
      () =>
        new FakeSession((invocation, signal) =>
          invocation.step === "fmt" && signal?.aborted === true
            ? {
                exitCode: null,
                outputBytes: 0,
                stderr: "",
                stdout: "",
                termination: "cancelled",
              }
            : successByStep[invocation.step],
        ),
    );
    const result = await runner(executor).run(request(), {
      signal: controller.signal,
    });
    expect(result.state).toBe("cancelled");
    expect(executor.sessions[0]?.disposed).toBe(true);
  });

  it("rejects malformed Terraform diagnostics", async () => {
    const executor = new FakeExecutor(
      () =>
        new FakeSession((invocation) =>
          invocation.step === "validate"
            ? {
                exitCode: 1,
                outputBytes: 8,
                stderr: "",
                stdout: "not-json",
                termination: "completed",
              }
            : successByStep[invocation.step],
        ),
    );
    const result = await runner(executor).run(request());
    expect(result.state).toBe("error");
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "terraform.validation.diagnostics-malformed",
    );
  });

  it.each([
    ["tflint", "{}", 1, "terraform.validation.analyzer-failed"],
    ["scanner", "{}", 1, "terraform.validation.analyzer-failed"],
    ["tflint", "", 0, "terraform.validation.diagnostics-malformed"],
    ["scanner", "", 0, "terraform.validation.diagnostics-malformed"],
    [
      "tflint",
      '{"errors":[]}',
      0,
      "terraform.validation.diagnostics-malformed",
    ],
    [
      "scanner",
      '{"SchemaVersion":2}',
      0,
      "terraform.validation.diagnostics-malformed",
    ],
  ] as const)(
    "fails closed when %s returns an invalid analyzer result",
    async (step, stdout, exitCode, expectedCode) => {
      const executor = new FakeExecutor(
        () =>
          new FakeSession((invocation) =>
            invocation.step === step
              ? {
                  exitCode,
                  outputBytes: Buffer.byteLength(stdout),
                  stderr: exitCode === 0 ? "" : "operational failure",
                  stdout,
                  termination: "completed",
                }
              : successByStep[invocation.step],
          ),
      );

      const result = await runner(executor).run(request());

      expect(result.state).toBe("error");
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        expectedCode,
      );
      expect(result.evidenceRecords[1]?.checks[0]).toEqual(
        expect.objectContaining({ status: "error" }),
      );
      if (exitCode !== 0) {
        expect(result.commandSummaries).toContainEqual(
          expect.objectContaining({ state: "failed", step }),
        );
      }
    },
  );

  it("rejects a passed result contract that contains a failed command", () => {
    const valid = terraformValidationResultV1Schema.parse({
      commandSummaries: [],
      contractVersion: 1,
      diagnostics: [],
      evidenceRecords: [],
      reportDigest: sha256("result-contract"),
      state: "passed",
    });

    expect(
      terraformValidationResultV1Schema.safeParse({
        ...valid,
        commandSummaries: [
          {
            executable: "tflint",
            outputBytes: 2,
            state: "failed",
            step: "tflint",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("cannot be tricked into argument injection or a forbidden binary", () => {
    expect(
      isApprovedInvocation({
        args: ["validate;", "apply"],
        executable: "terraform",
        step: "validate",
      }),
    ).toBe(false);
    expect(
      isApprovedInvocation({
        args: [],
        executable: "bash" as "terraform",
        step: "validate",
      }),
    ).toBe(false);
    expect(JSON.stringify(APPROVED_VALIDATION_COMMANDS)).not.toMatch(
      /\b(?:plan|apply|destroy|import|console)\b/u,
    );
  });

  it("pins compatible networkless TFLint and Trivy invocations", () => {
    expect(APPROVED_VALIDATION_COMMANDS.tflint.args).toEqual([
      "--chdir=.",
      "--format=json",
      "--no-color",
      "--force",
    ]);
    expect(APPROVED_VALIDATION_COMMANDS.scanner.args).toEqual([
      "config",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--quiet",
      "--disable-telemetry",
      "--skip-version-check",
      "--skip-check-update",
      ".",
    ]);

    expect(
      isApprovedInvocation({
        args: ["--format=json", "--no-color", "--force", "."],
        executable: "tflint",
        step: "tflint",
      }),
    ).toBe(false);
    expect(
      isApprovedInvocation({
        args: [
          "config",
          "--format",
          "json",
          "--offline-scan",
          "--skip-db-update",
          "--exit-code",
          "0",
          "--no-progress",
          ".",
        ],
        executable: "trivy",
        step: "scanner",
      }),
    ).toBe(false);

    for (const requiredSafetyArgument of [
      "--disable-telemetry",
      "--skip-version-check",
      "--skip-check-update",
    ]) {
      expect(
        isApprovedInvocation({
          ...APPROVED_VALIDATION_COMMANDS.scanner,
          args: APPROVED_VALIDATION_COMMANDS.scanner.args.filter(
            (argument) => argument !== requiredSafetyArgument,
          ),
        }),
      ).toBe(false);
    }
  });

  it("reports optional tool unavailability without upgrading a passing required chain", async () => {
    const executor = new FakeExecutor(
      () =>
        new FakeSession((invocation) =>
          invocation.step === "tflint" || invocation.step === "scanner"
            ? {
                exitCode: null,
                outputBytes: 0,
                stderr: "",
                stdout: "",
                termination: "unavailable",
              }
            : successByStep[invocation.step],
        ),
    );
    const result = await runner(executor).run(request());
    expect(result.state).toBe("passed");
    expect(result.diagnostics).toHaveLength(2);
    expect(
      result.diagnostics.every(({ severity }) => severity === "warning"),
    ).toBe(true);
  });

  it("fails when an approved required extension is unavailable", async () => {
    const executor = new FakeExecutor(
      () =>
        new FakeSession((invocation) =>
          invocation.step === "tflint"
            ? {
                exitCode: null,
                outputBytes: 0,
                stderr: "",
                stdout: "",
                termination: "unavailable",
              }
            : successByStep[invocation.step],
        ),
    );
    const result = await runner(executor, policy({ tflintRequired: true })).run(
      request(),
    );
    expect(result.state).not.toBe("passed");
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "terraform.validation.required-tool-unavailable",
    );
  });

  it.each([
    [
      `terraform { required_providers { random = { source = "hashicorp/random" version = "3.0.0" } } }`,
      "terraform.validation.source-unsupported",
    ],
    [
      `terraform { required_providers { aws = { source = "hashicorp/aws" version = "5.0.0" } } }`,
      "terraform.validation.provider-version-unsupported",
    ],
    [
      `module "network" { source = "example/network/aws" version = "1.0.0" }`,
      "terraform.validation.module-unsupported",
    ],
    [
      `resource "aws_instance" "bad" { provisioner "local-exec" { command = "echo unsafe" } }`,
      "terraform.validation.provisioner-forbidden",
    ],
    [
      `data "external" "bad" { program = ["helper"] }`,
      "terraform.validation.external-data-forbidden",
    ],
  ] as const)(
    "rejects unsafe or unsupported HCL before execution",
    async (content, code) => {
      const executor = new FakeExecutor();
      const result = await runner(executor).run(
        request([terraformFile(content)]),
      );
      expect(result.state).toBe("failed");
      expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
      expect(executor.sessions).toHaveLength(0);
    },
  );

  it("rejects secret and local-path input without reflecting either value", async () => {
    const sensitive = [
      'variable "token" {',
      '  default = "Bearer abcdefghijklmnopqrstuvwxyz"',
      "}",
      "# C:\\Users\\someone\\source.tf",
    ].join("\n");
    const result = await runner(new FakeExecutor()).run(
      request([terraformFile(sensitive)]),
    );
    const serialized = JSON.stringify(result);
    expect(result.state).toBe("failed");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain("C:\\Users");
  });

  it("redacts secret-shaped and machine-local tool diagnostics", async () => {
    const executor = new FakeExecutor(
      () =>
        new FakeSession((invocation) =>
          invocation.step === "validate"
            ? {
                exitCode: 1,
                outputBytes: 256,
                stderr: "",
                stdout: JSON.stringify({
                  diagnostics: [
                    {
                      detail:
                        "C:\\Users\\someone\\workspace\\versions.tf Bearer abcdefghijklmnopqrstuvwxyz",
                      range: { filename: "versions.tf" },
                      severity: "error",
                      summary: "unsafe diagnostic",
                    },
                  ],
                }),
                termination: "completed",
              }
            : successByStep[invocation.step],
        ),
    );
    const result = await runner(executor).run(request());
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("[path]");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("C:\\Users");
    expect(serialized).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(result.diagnostics[0]?.references).toEqual(references());
  });

  it("runs a provider-neutral networking organization-policy pack through the approved evaluator seam", async () => {
    const fixtureInput: unknown = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/networking-organization-policy-pack.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const fixture = fixtureInput as {
      readonly findings: readonly unknown[];
      readonly policyPack: {
        readonly id: string;
        readonly providerNeutral: boolean;
        readonly version: string;
      };
    };
    expect(fixture.policyPack).toEqual({
      id: "cloudmarkup.organization-policy.networking-baseline",
      providerNeutral: true,
      version: "1.0.0",
    });
    const fixtureFindings = fixture.findings.map((finding) =>
      terraformValidationDiagnosticV1Schema.parse(finding),
    );
    const evaluator: OrganizationPolicyEvaluator = {
      evaluate(input) {
        expect(input.files.map(({ path }) => path)).toEqual([
          "infrastructure/networking.tf",
        ]);
        return Promise.resolve(fixtureFindings);
      },
    };
    const networkingFile = terraformFile(
      `terraform {
  required_version = ">= 1.13.0, < 2.0.0"
}
`,
      "infrastructure/networking.tf",
    );
    const result = await runner(
      new FakeExecutor(),
      policy({ includeOrganizationPolicy: true }),
      evaluator,
    ).run(request([networkingFile]));

    expect(result.state).toBe("failed");
    expect(
      result.diagnostics
        .filter(({ source }) => source === "organization-policy")
        .map(({ code, path, severity, source }) => ({
          code,
          path,
          severity,
          source,
        })),
    ).toEqual([
      {
        code: "cloudmarkup.organization-policy.networking.sensitive-ingress",
        path: "infrastructure/networking.tf",
        severity: "error",
        source: "organization-policy",
      },
      {
        code: "cloudmarkup.organization-policy.networking.multi-zone",
        path: "infrastructure/networking.tf",
        severity: "warning",
        source: "organization-policy",
      },
    ]);
    expect(
      result.evidenceRecords.flatMap(({ checks }) =>
        checks.flatMap(({ issueIds }) => issueIds),
      ),
    ).toEqual(expect.arrayContaining(fixtureFindings.map(({ code }) => code)));
  });

  it("is deterministic across repeated runs and analyzer finding order", async () => {
    let reverse = false;
    const evaluator: OrganizationPolicyEvaluator = {
      evaluate(input) {
        reverse = !reverse;
        const findings = ["a", "b"].map((suffix) =>
          terraformValidationDiagnosticV1Schema.parse({
            code: `terraform.validation.organization-${suffix}`,
            detail: `Finding ${suffix}`,
            path: input.files[0]?.path,
            references: input.files[0]?.references ?? references(),
            severity: "warning",
            source: "organization-policy",
            summary: `Finding ${suffix}`,
          }),
        );
        return Promise.resolve(reverse ? findings.reverse() : findings);
      },
    };
    const validationPolicy = policy({ includeOrganizationPolicy: true });
    const first = await runner(
      new FakeExecutor(),
      validationPolicy,
      evaluator,
    ).run(request());
    const second = await runner(
      new FakeExecutor(),
      validationPolicy,
      evaluator,
    ).run(request());
    expect(second).toEqual(first);

    expect(first.state).toBe("passed");
    expect(first.diagnostics[0]?.source).toBe("organization-policy");
  });

  it("enforces file count, byte, checksum, and provider-lock integrity before opening a workspace", async () => {
    const tiny = policy();
    const executor = new FakeExecutor();
    const invalidChecksum = { ...terraformFile(), checksum: sha256("wrong") };
    const result = await runner(executor, {
      ...tiny,
      limits: { ...tiny.limits, maxFileBytes: 16 },
      providerLock: { ...tiny.providerLock, checksum: sha256("wrong-lock") },
    }).run(request([invalidChecksum]));
    expect(result.state).toBe("failed");
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "terraform.validation.file-limit",
        "terraform.validation.provider-lock-invalid",
      ]),
    );
    expect(executor.sessions).toHaveLength(0);
  });

  it("fails closed when an approved organization-policy evaluator is missing or malformed", async () => {
    const validationPolicy = policy({ includeOrganizationPolicy: true });
    const missing = await runner(new FakeExecutor(), validationPolicy).run(
      request(),
    );
    expect(missing.state).toBe("error");
    expect(missing.diagnostics.map(({ code }) => code)).toContain(
      "terraform.validation.required-tool-unavailable",
    );

    const malformedEvaluator: OrganizationPolicyEvaluator = {
      evaluate() {
        return Promise.resolve([{} as never]);
      },
    };
    const malformed = await runner(
      new FakeExecutor(),
      validationPolicy,
      malformedEvaluator,
    ).run(request());
    expect(malformed.state).toBe("error");
    expect(malformed.diagnostics.map(({ code }) => code)).toContain(
      "terraform.validation.organization-policy-error",
    );
  });

  it("bounds approved policy findings and binds every policy digest into Evidence", async () => {
    const evaluator: OrganizationPolicyEvaluator = {
      evaluate(input) {
        return Promise.resolve(
          Array.from({ length: 1_001 }, () =>
            terraformValidationDiagnosticV1Schema.parse({
              code: "terraform.validation.organization-policy-finding",
              detail: "Bounded policy finding.",
              references: input.files[0]?.references ?? references(),
              severity: "warning",
              source: "organization-policy",
              summary: "Bounded policy finding.",
            }),
          ),
        );
      },
    };
    const validationPolicy = policy({ includeOrganizationPolicy: true });
    const result = await runner(
      new FakeExecutor(),
      validationPolicy,
      evaluator,
    ).run(request());
    expect(result.state).toBe("error");
    expect(result.diagnostics).toHaveLength(1_000);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "terraform.validation.diagnostics-overflow",
    );
    const staticEvidence = result.evidenceRecords[1];
    expect(staticEvidence?.checks[0]?.issueIds).toContain(
      "terraform.validation.diagnostics-overflow",
    );
    expect(staticEvidence?.provenance.inputDigests).toEqual(
      expect.arrayContaining([
        canonicalDigest(validationPolicy),
        canonicalDigest(request()),
        validationPolicy.container.digest,
        validationPolicy.providerLock.checksum,
        validationPolicy.providers[0]?.mirrorPackageDigest,
        validationPolicy.tflint?.configDigest,
        validationPolicy.scanner?.configDigest,
        validationPolicy.organizationPolicy?.configDigest,
      ]),
    );
  });

  it("rejects ambiguous approved provider and module declarations", () => {
    const validationPolicy = policy();
    expect(
      terraformValidationPolicyV1Schema.safeParse({
        ...validationPolicy,
        providers: [
          validationPolicy.providers[0],
          validationPolicy.providers[0],
        ],
      }).success,
    ).toBe(false);
    const approvedModule = {
      digest: sha256("module"),
      source: "example/network/aws",
      version: "1.0.0",
    };
    expect(
      terraformValidationPolicyV1Schema.safeParse({
        ...validationPolicy,
        modules: [approvedModule, approvedModule],
      }).success,
    ).toBe(false);
  });
  it("sanitizes standalone text deterministically", () => {
    expect(
      sanitizeToolText(
        " /tmp/workspace/main.tf Bearer abcdefghijklmnopqrstuvwxyz ",
      ),
    ).toBe("[path] [redacted]");
  });
});

describe("AI-authored Terraform extension validation", () => {
  it("validates one exact detached tree through the fixed offline matrix and emits only rank-4 Evidence", async () => {
    const exactRequest = extensionRequest();
    const executor = new FakeExecutor();
    const result = await runner(executor).run(exactRequest);

    expect(result.state).toBe("passed");
    expect(result.diagnostics).toEqual([]);
    expect(executor.sessions[0]?.invocations).toEqual([
      APPROVED_VALIDATION_COMMANDS.fmt,
      APPROVED_VALIDATION_COMMANDS.init,
      APPROVED_VALIDATION_COMMANDS.validate,
      APPROVED_VALIDATION_COMMANDS.tflint,
      APPROVED_VALIDATION_COMMANDS.scanner,
    ]);
    expect(result.evidenceRecords).toHaveLength(1);
    expect(result.evidenceRecords[0]?.level).toEqual({
      kind: "ai-extension-parse-static-validity",
      rank: 4,
    });
    expect(result.evidenceRecords.some(({ level }) => level.rank === 3)).toBe(
      false,
    );
    const context = exactRequest.extensionContext;
    if (context === undefined) {
      throw new TypeError("Missing exact AI-extension context.");
    }
    const evidenceCheck = result.evidenceRecords[0]?.checks[0];
    expect(evidenceCheck?.artifactDigests).toContain(
      context.candidateArtifactDigest,
    );
    expect(evidenceCheck?.generationCoverageRequirement).toBe(
      "ai-extension-parse-static-validity",
    );
    expect(evidenceCheck?.status).toBe("passed");
    expect(result.evidenceRecords[0]?.provenance.inputDigests).toEqual(
      expect.arrayContaining([
        exactRequest.artifactDigest,
        context.baseline.artifactDigest,
        context.candidateArtifactDigest,
        context.candidateDigest,
        canonicalDigest(context.modelDescriptor),
        context.modelOutputDigest,
        context.officialSchemaAuthorities[0]?.schemaDigest,
      ]),
    );
    expect(result.evidenceRecords[0]?.models).toEqual([
      {
        modelId: extensionModelDescriptor.modelId,
        modelVersion: extensionModelDescriptor.modelVersion,
        promptVersion: extensionModelDescriptor.promptVersion,
        providerId: extensionModelDescriptor.providerId,
      },
    ]);
  });

  it.each([
    [
      "provider",
      () =>
        extensionRequest({
          allowedProviderSources: ["hashicorp/random"],
          allowedResourceTypes: ["random_pet"],
          candidateContent: 'resource "random_pet" "custom" {}',
          ownedResourceAddresses: ["random_pet.custom"],
        }),
      "terraform.validation.extension-provider-unsupported",
    ],
    [
      "resource type",
      () =>
        extensionRequest({
          candidateContent: 'resource "aws_instance" "custom" {}',
        }),
      "terraform.validation.extension-resource-unsupported",
    ],
  ] as const)(
    "rejects an unknown %s before opening a workspace",
    async (_kind, makeRequest, code) => {
      const executor = new FakeExecutor();
      const result = await runner(executor).run(makeRequest());

      expect(result.state).toBe("failed");
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        code,
      );
      expect(executor.sessions).toHaveLength(0);
      expect(result.evidenceRecords.map(({ level }) => level.rank)).toEqual([
        4,
      ]);
    },
  );

  it.each([
    [
      "resource/data block-kind confusion",
      () =>
        extensionRequest({
          candidateContent: 'data "aws_s3_bucket" "custom" {}',
        }),
      "terraform.validation.extension-resource-unsupported",
    ],
    [
      "provider version outside the exact constraint",
      () =>
        extensionRequest({
          providerVersionConstraint: ">= 7.0.0, < 8.0.0",
        }),
      "terraform.validation.extension-provider-version-unsupported",
    ],
    [
      "resource address outside owned authority",
      () =>
        extensionRequest({
          ownedResourceAddresses: ["aws_s3_bucket.approved"],
        }),
      "terraform.validation.extension-address-not-owned",
    ],
    [
      "model descriptor bound to another revision",
      () =>
        extensionRequest({
          modelDescriptor: modelInvocationDescriptorV1Schema.parse({
            ...extensionModelDescriptor,
            scope: {
              ...extensionModelDescriptor.scope,
              solutionRevisionId: "solution-revision-other",
            },
          }),
        }),
      "terraform.validation.extension-model-provenance-mismatch",
    ],
  ] as const)(
    "rejects %s before opening a workspace",
    async (_kind, makeRequest, code) => {
      const executor = new FakeExecutor();
      const result = await runner(executor).run(makeRequest());

      expect(result.state).toBe("failed");
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        code,
      );
      expect(executor.sessions).toHaveLength(0);
      expect(result.evidenceRecords[0]?.checks[0]?.artifactDigests).toContain(
        result.evidenceRecords[0]?.artifacts[0]?.digest,
      );
    },
  );

  it("rejects missing official schema authority at the strict request boundary", () => {
    const exact = extensionRequest();
    expect(
      terraformValidationRequestV1Schema.safeParse({
        ...exact,
        extensionContext: {
          ...exact.extensionContext,
          officialSchemaAuthorities: [],
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      "module",
      'module "network" { source = "example/network/aws" version = "1.0.0" }',
      "terraform.validation.extension-module-forbidden",
    ],
    [
      "backend",
      'terraform { backend "s3" {} }',
      "terraform.validation.backend-forbidden",
    ],
    [
      "provisioner or shell command",
      'resource "aws_s3_bucket" "custom" { provisioner "local-exec" { command = "echo unsafe" } }',
      "terraform.validation.provisioner-forbidden",
    ],
    [
      "provider authority override",
      `provider "aws" {
  assume_role { role_arn = "arn:aws:iam::111122223333:role/role-hop" }
  endpoints { sts = "https://attacker.invalid" }
  shared_config_files = ["/tmp/attacker-config"]
  skip_credentials_validation = true
}
resource "aws_s3_bucket" "custom" {}`,
      "terraform.validation.extension-provider-configuration-forbidden",
    ],
    [
      "provider alias binding",
      `resource "aws_s3_bucket" "custom" {
  provider = aws.role_hop
}`,
      "terraform.validation.extension-provider-configuration-forbidden",
    ],
    [
      "external command",
      'data "external" "custom" { program = ["helper"] }',
      "terraform.validation.external-data-forbidden",
    ],
    [
      "plan operation",
      'run "candidate" { command = plan }',
      "terraform.validation.extension-plan-forbidden",
    ],
    [
      "state operation",
      'import { to = aws_s3_bucket.custom id = "existing" }',
      "terraform.validation.extension-state-forbidden",
    ],
    [
      "malformed HCL",
      'resource "aws_s3_bucket" "custom" {',
      "terraform.validation.hcl-malformed",
    ],
  ] as const)(
    "rejects candidate %s before execution",
    async (_kind, candidateContent, code) => {
      const executor = new FakeExecutor();
      const result = await runner(executor).run(
        extensionRequest({ candidateContent }),
      );

      expect(result.state).toBe("failed");
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        code,
      );
      expect(executor.sessions).toHaveLength(0);
    },
  );

  it("rejects exact candidate path and deterministic resource-address collisions", async () => {
    const pathCollision = await runner(new FakeExecutor()).run(
      extensionRequest({ protectCandidatePath: true }),
    );
    expect(pathCollision.state).toBe("failed");
    expect(
      pathCollision.diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("terraform.validation.extension-path-collision");

    const addressCollision = await runner(new FakeExecutor()).run(
      extensionRequest({
        ownedResourceAddresses: ["aws_s3_bucket.approved"],
        protectedResourceAddresses: ["aws_s3_bucket.custom"],
      }),
    );
    expect(addressCollision.state).toBe("failed");
    expect(
      addressCollision.diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("terraform.validation.extension-address-collision");
  });

  it("rejects complete-tree and candidate digest mismatches without execution", async () => {
    const exactRequest = extensionRequest();
    const context = exactRequest.extensionContext;
    if (context === undefined) throw new TypeError("Missing test context.");
    const mismatches = [
      terraformValidationRequestV1Schema.parse({
        ...exactRequest,
        artifactDigest: sha256("wrong-complete-tree"),
      }),
      terraformValidationRequestV1Schema.parse({
        ...exactRequest,
        extensionContext: {
          ...context,
          candidateDigest: sha256("wrong-candidate"),
        },
      }),
    ];

    for (const [index, candidate] of mismatches.entries()) {
      const executor = new FakeExecutor();
      const result = await runner(executor).run(candidate);
      expect(result.state, String(index)).toBe("failed");
      expect(executor.sessions, String(index)).toHaveLength(0);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        index === 0
          ? "terraform.validation.extension-artifact-digest-mismatch"
          : "terraform.validation.extension-candidate-digest-mismatch",
      );
    }
  });

  it("rejects a changed protected baseline checksum", async () => {
    const exactRequest = extensionRequest();
    const context = exactRequest.extensionContext;
    if (context === undefined) throw new TypeError("Missing test context.");
    const changedBaseline = terraformValidationRequestV1Schema.parse({
      ...exactRequest,
      extensionContext: {
        ...context,
        protectedDeterministicFiles: context.protectedDeterministicFiles.map(
          (file) => ({
            ...file,
            checksum: sha256("changed-protected-file"),
          }),
        ),
      },
    });
    const executor = new FakeExecutor();
    const result = await runner(executor).run(changedBaseline);

    expect(result.state).toBe("failed");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "terraform.validation.extension-baseline-mismatch",
    );
    expect(executor.sessions).toHaveLength(0);
  });

  it("rejects a baseline artifact digest that does not hash the protected deterministic subset", async () => {
    const exactRequest = extensionRequest();
    const context = exactRequest.extensionContext;
    if (context === undefined) throw new TypeError("Missing test context.");
    const changedBaseline = terraformValidationRequestV1Schema.parse({
      ...exactRequest,
      extensionContext: {
        ...context,
        baseline: {
          ...context.baseline,
          artifactDigest: sha256("wrong-baseline-tree"),
        },
      },
    });
    const executor = new FakeExecutor();
    const result = await runner(executor).run(changedBaseline);

    expect(result.state).toBe("failed");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "terraform.validation.extension-baseline-provenance-mismatch",
    );
    expect(executor.sessions).toHaveLength(0);
  });

  it("rejects a candidate that exceeds the exact extension-slot resource maximum", async () => {
    const executor = new FakeExecutor();
    const result = await runner(executor).run(
      extensionRequest({
        candidateContent: `${validExtensionContent}\nresource "aws_s3_bucket" "second" {\n  bucket = "cloudmarkup-extension-second"\n}\n`,
        maximumResourceCount: 1,
      }),
    );

    expect(result.state).toBe("failed");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "terraform.validation.extension-resource-count-exceeded",
    );
    expect(executor.sessions).toHaveLength(0);
  });
});
