import {
  terraformValidationResultV1Schema,
  type TerraformValidationRequestV1,
  type TerraformValidationResultV1,
  type TerraformValidationRunner,
} from "@cloudmarkup/terraform-validation-runner";
import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import { projectGoCompilationResultToSolutionExportInfrastructure } from "./compiler-projection.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import type { SolutionExportWorkflowStageDescriptorsV1 } from "./contracts.js";
import {
  createSolutionExportTerraformValidationPort,
  terraformValidationRequestFromWorkflowInput,
} from "./terraform-validation-runner-adapter.js";
import { validationResult, workflowFixture } from "./workflow.test-support.js";

function validationPortFixture() {
  const fixture = workflowFixture();
  if (fixture.request.targetSettings.target !== "terraform") {
    throw new TypeError("Expected Terraform workflow fixture.");
  }
  const infrastructure =
    projectGoCompilationResultToSolutionExportInfrastructure(
      fixture.compilation,
    );
  const approvedSettings =
    fixture.request.targetSettings.stageDescriptors.terraformValidation;
  return {
    approvedSettings,
    fixture,
    input: {
      infrastructure,
      request: fixture.request,
      settings: approvedSettings,
      signal: new AbortController().signal,
      sources: {
        architectureDocument: fixture.generationRequest.architectureDocument,
        solutionRevision: fixture.generationRequest.solutionRevision,
        workloadBehavior: fixture.generationRequest.workloadBehavior,
      },
    },
  };
}

function failureCode(error: unknown): string | undefined {
  return error instanceof SolutionExportWorkflowFailureError
    ? error.failure.code
    : undefined;
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

function boundValidationResult(
  request: TerraformValidationRequestV1,
  settings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"],
  options: {
    readonly commandSummaries?: TerraformValidationResultV1["commandSummaries"];
    readonly diagnostics?: TerraformValidationResultV1["diagnostics"];
    readonly state?: TerraformValidationResultV1["state"];
  } = {},
): TerraformValidationResultV1 {
  const commandSummaries = options.commandSummaries ?? [];
  const diagnostics = options.diagnostics ?? [];
  const state = options.state ?? "passed";
  const report = { commandSummaries, diagnostics };
  const reportBytes = new TextEncoder().encode(serializeCanonicalJson(report));
  const reportDigest = sha256Digest(reportBytes);
  const common = {
    contractVersion: 1 as const,
    environment: request.environment,
    layer: "generated" as const,
    level: {
      kind: "deterministic-target-compilation" as const,
      rank: 3 as const,
    },
    models: [],
    solutionRevisionId: request.solutionRevisionId,
    staleness: { assessedAt: request.assessedAt, state: "current" as const },
  };
  const compilation = evidenceRecordV1Schema.parse({
    ...common,
    artifacts: [
      {
        digest: request.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.terraform-artifact+json",
        sizeBytes: request.files.reduce(
          (sum, file) =>
            sum + new TextEncoder().encode(file.content).byteLength,
          0,
        ),
      },
    ],
    checks: [
      {
        artifactDigests: [request.artifactDigest],
        checkId:
          "cloudmarkup.evidence.deterministic-infrastructure-compilation",
        generationCoverageRequirement:
          "deterministic-infrastructure-compilation",
        issueIds: [],
        status: "passed",
        summary:
          "The exact Terraform artifact is bound to the approved deterministic compiler output.",
      },
    ],
    id: `evidence_iac_compilation_${request.artifactDigest.slice(7, 31)}`,
    provenance: {
      actor: { kind: "deterministic-tool", tool: request.compiler },
      createdAt: request.assessedAt,
      inputDigests: [request.solutionRevisionDigest, request.artifactDigest],
    },
    tools: [request.compiler],
  });
  const validationPassed = state === "passed";
  const staticValidation = evidenceRecordV1Schema.parse({
    ...common,
    artifacts: [
      {
        digest: reportDigest,
        mediaType: "application/json",
        sizeBytes: reportBytes.byteLength,
      },
    ],
    checks: [
      {
        artifactDigests: [request.artifactDigest, reportDigest],
        checkId: "cloudmarkup.evidence.terraform-static-validation",
        issueIds: [
          ...new Set(
            diagnostics
              .filter(({ severity }) => severity !== "info")
              .map(({ code }) => code),
          ),
        ].sort(),
        ...(validationPassed
          ? {}
          : {
              redactedFailure:
                state === "cancelled"
                  ? "Static validation was cancelled."
                  : "One or more bounded static validation checks did not pass.",
            }),
        status: validationPassed
          ? "passed"
          : state === "error" || state === "cancelled"
            ? "error"
            : "failed",
        summary: validationPassed
          ? "Offline Terraform formatting, initialization, validation, and approved policy checks passed."
          : "Offline Terraform static validation did not pass.",
      },
    ],
    id: `evidence_terraform_static_${reportDigest.slice(7, 31)}`,
    provenance: {
      actor: { kind: "deterministic-tool", tool: settings.adapter },
      createdAt: request.assessedAt,
      inputDigests: [
        request.solutionRevisionDigest,
        request.artifactDigest,
        sha256Digest(serializeCanonicalJson(request)),
        settings.policyDigest,
      ].sort(),
    },
    tools: [settings.adapter],
  });
  return terraformValidationResultV1Schema.parse({
    commandSummaries,
    contractVersion: 1,
    diagnostics,
    evidenceRecords: [compilation, staticValidation],
    reportDigest,
    state,
  });
}
describe("Terraform validation runner workflow adapter", () => {
  it("projects exact Terraform files, revision bindings, environment, and signal", async () => {
    const fixture = validationPortFixture();
    const request = terraformValidationRequestFromWorkflowInput(
      fixture.input,
      fixture.approvedSettings,
    );
    const expectedResult = boundValidationResult(
      request,
      fixture.approvedSettings,
    );
    let captured:
      | {
          input: unknown;
          signal: AbortSignal | undefined;
        }
      | undefined;
    const runner: TerraformValidationRunner = {
      run(input, options) {
        captured = { input, signal: options?.signal };
        return Promise.resolve(expectedResult);
      },
    };
    const port = createSolutionExportTerraformValidationPort({
      approvedSettings: fixture.approvedSettings,
      runner,
    });

    await expect(port.validate(fixture.input)).resolves.toEqual(expectedResult);
    expect(captured?.input).toEqual(request);
    expect(captured?.signal).toBe(fixture.input.signal);
    expect(request).toMatchObject({
      artifactDigest: fixture.input.infrastructure.artifactDigest,
      assessedAt: fixture.fixture.generationRequest.solutionRevision.createdAt,
      compiler: fixture.input.infrastructure.compiler,
      environment: fixture.fixture.request.environment,
      solutionRevisionId: fixture.fixture.request.subject.solutionRevisionId,
    });
    expect(request.solutionRevisionDigest).toBe(
      sha256Digest(
        serializeCanonicalJson(
          fixture.fixture.generationRequest.solutionRevision,
        ),
      ),
    );
    expect(request.files.length).toBeGreaterThan(0);
    expect(
      request.files.every(
        ({ path }) =>
          path.startsWith("infrastructure/") && path.endsWith(".tf"),
      ),
    ).toBe(true);
  });
  it("rejects coherent passing Evidence substituted from another request or report", async () => {
    const fixture = validationPortFixture();
    const request = terraformValidationRequestFromWorkflowInput(
      fixture.input,
      fixture.approvedSettings,
    );
    const current = boundValidationResult(request, fixture.approvedSettings);
    const foreignReport = boundValidationResult(
      request,
      fixture.approvedSettings,
      {
        commandSummaries: [
          {
            executable: "terraform",
            outputBytes: 0,
            state: "passed",
            step: "fmt",
          },
        ],
      },
    );
    const cases: readonly {
      readonly label: string;
      readonly result: TerraformValidationResultV1;
    }[] = [
      {
        label: "Terraform artifact",
        result: boundValidationResult(
          { ...request, artifactDigest: sha256Digest("foreign-artifact") },
          fixture.approvedSettings,
        ),
      },
      {
        label: "Solution Revision content",
        result: boundValidationResult(
          {
            ...request,
            solutionRevisionDigest: sha256Digest("foreign-revision-content"),
          },
          fixture.approvedSettings,
        ),
      },
      {
        label: "Terraform request file provenance",
        result: boundValidationResult(
          {
            ...request,
            files: request.files.map((file, index) =>
              index === 0
                ? {
                    ...file,
                    references: {
                      ...file.references,
                      nodeIds: ["node_foreign_request"],
                    },
                  }
                : file,
            ),
          },
          fixture.approvedSettings,
        ),
      },
      {
        label: "validation policy",
        result: boundValidationResult(request, {
          ...fixture.approvedSettings,
          policyDigest: sha256Digest("foreign-validation-policy"),
        }),
      },
      {
        label: "validation runner",
        result: boundValidationResult(request, {
          ...fixture.approvedSettings,
          adapter: {
            ...fixture.approvedSettings.adapter,
            digest: sha256Digest("foreign-validation-runner"),
          },
        }),
      },
      {
        label: "static-validation report Evidence",
        result: terraformValidationResultV1Schema.parse({
          ...current,
          evidenceRecords: [
            current.evidenceRecords[0],
            foreignReport.evidenceRecords[1],
          ],
        }),
      },
      {
        label: "report digest",
        result: terraformValidationResultV1Schema.parse({
          ...current,
          reportDigest: sha256Digest("forged-report-digest"),
        }),
      },
    ];

    for (const candidate of cases) {
      const port = createSolutionExportTerraformValidationPort({
        approvedSettings: fixture.approvedSettings,
        runner: { run: () => Promise.resolve(candidate.result) },
      });
      const error = await rejectedValue(port.validate(fixture.input));
      expect(failureCode(error), candidate.label).toBe(
        "cloudmarkup.export.validation-result-binding-invalid",
      );
    }
  });

  it("fails before invoking the runner when approved settings do not match", async () => {
    const fixture = validationPortFixture();
    let calls = 0;
    const port = createSolutionExportTerraformValidationPort({
      approvedSettings: fixture.approvedSettings,
      runner: {
        run() {
          calls += 1;
          return Promise.resolve(validationResult(fixture.fixture));
        },
      },
    });

    const error = await rejectedValue(
      port.validate({
        ...fixture.input,
        settings: {
          ...fixture.input.settings,
          policyDigest: sha256Digest("forged-validation-policy"),
        },
      }),
    );

    expect(failureCode(error)).toBe(
      "cloudmarkup.export.validation-input-binding-invalid",
    );
    expect(calls).toBe(0);
  });

  it("propagates the same live AbortSignal through an active runner", async () => {
    const fixture = validationPortFixture();
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const runner: TerraformValidationRunner = {
      run(_input, options) {
        observedSignal = options?.signal;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("runner canceled");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    };
    const port = createSolutionExportTerraformValidationPort({
      approvedSettings: fixture.approvedSettings,
      runner,
    });

    const pending = port.validate({
      ...fixture.input,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(observedSignal).toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
  });
});
