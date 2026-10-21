import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { localSolutionExportService } from "@cloudmarkup/solution-export";

import { architectureCliRepositoryProfileV1Schema } from "./contracts.js";
import {
  architectureCliEventFixtureArtifact,
  architectureCliEventFixtureSnapshot,
  architectureCliGeneratedEventCases,
  architectureCliGeneratedEventFixtureArtifact,
  architectureCliGeneratedEventInfrastructureProjection,
  architectureCliGeneratedEventFixtureSnapshot,
  type ArchitectureCliGeneratedEventCase,
} from "./event-test-fixtures.js";
import { runArchitectureCliExecutable } from "./executable.js";
import {
  loadArchitectureRepository,
  repositorySourceInputs,
} from "./repository.js";
import type { ArchitectureCliPipelineV1 } from "./service.js";
import { writeArchitectureCliFixtureRepository } from "./test-fixtures.js";
import { assertCloudMarkupWorkflowTemplate } from "./workflow-policy.js";

const profile = architectureCliRepositoryProfileV1Schema.parse({
  cli: {
    digest: `sha256:${"8".repeat(64)}`,
    id: "cloudmarkup.architecture-cli",
    version: "1.0.0",
  },
  contractVersion: 1,
  kind: "cloudmarkup.repository-verification-profile",
  paths: {
    lock: "cloudmarkup/cloudmarkup.lock.json",
    manifest: "cloudmarkup/cloudmarkup.manifest.json",
    solutionRevision: "cloudmarkup/solution.json",
  },
  pipelineProfile: {
    digest: `sha256:${"9".repeat(64)}`,
    id: "cloudmarkup.pipeline.aws-notes-v1",
    version: "1.0.0",
  },
}).pipelineProfile;

function eventPipeline(): ArchitectureCliPipelineV1 {
  const ready = () => ({
    artifact: architectureCliEventFixtureArtifact(),
    diagnostics: [],
    evidence: { current: 5, failed: 0, stale: 0, unavailableLevels: [] },
    semanticSnapshot: architectureCliEventFixtureSnapshot(),
    state: "ready" as const,
  });
  return {
    inspect: () => Promise.resolve(ready()),
    run: () => Promise.resolve(ready()),
  };
}

function generatedEventPipeline(
  eventCase: ArchitectureCliGeneratedEventCase = "sqs-consumer-dlq",
  artifact = architectureCliGeneratedEventFixtureArtifact(eventCase),
  semanticSnapshot = architectureCliGeneratedEventFixtureSnapshot(eventCase),
): ArchitectureCliPipelineV1 {
  const ready = () => ({
    artifact,
    diagnostics: [],
    evidence: { current: 5, failed: 0, stale: 0, unavailableLevels: [] },
    semanticSnapshot,
    state: "ready" as const,
  });
  return {
    inspect: () => Promise.resolve(ready()),
    run: () => Promise.resolve(ready()),
  };
}

const compilerResourceMarkers: Record<
  Exclude<ArchitectureCliGeneratedEventCase, "sqs-consumer-dlq">,
  readonly string[]
> = {
  "s3-image-metadata": [
    'resource "aws_s3_bucket" "uploads"',
    'resource "aws_s3_bucket_notification" "uploads"',
    'resource "aws_dynamodb_table" "image_metadata"',
  ],
  "sns-fanout-multi": [
    'resource "aws_sns_topic" "fanout"',
    'resource "aws_sns_topic_subscription" "primary_subscription"',
    'resource "aws_sns_topic_subscription" "secondary_subscription"',
  ],
  "eventbridge-scheduled": [
    'resource "aws_cloudwatch_event_rule" "hourly"',
    'resource "aws_cloudwatch_event_target" "scheduled_target"',
  ],
  "eventbridge-target": [
    'resource "aws_cloudwatch_event_rule" "hourly"',
    'resource "aws_cloudwatch_event_target" "scheduled_target"',
  ],
  "step-functions-task": [
    'resource "aws_sfn_state_machine" "image_workflow"',
    'resource "aws_cloudwatch_log_group" "image_workflow_logs"',
  ],
};

async function execute(
  root: string,
  command: "validate" | "generate" | "verify" | "diff" | "test",
  pipeline: ArchitectureCliPipelineV1 = eventPipeline(),
) {
  let stdout = "";
  const exitCode = await runArchitectureCliExecutable({
    args: [command, "--root", root, "--format", "json"],
    registrations: [{ ...profile, pipeline }],
    stderr: { write: () => undefined },
    stdout: { write: (value) => (stdout += value) },
  });
  return { exitCode, output: JSON.parse(stdout) as Record<string, unknown> };
}

describe("AWS event-driven architecture-as-code repository fixture", () => {
  it("validates, generates, tests, verifies, and diffs a complete generated event handler", async () => {
    const artifact = architectureCliGeneratedEventFixtureArtifact();
    const infrastructure =
      architectureCliGeneratedEventInfrastructureProjection();
    expect(infrastructure.resources.length).toBeGreaterThan(0);
    expect(infrastructure.policyArtifacts.length).toBeGreaterThan(0);
    expect(infrastructure.applicationArtifacts).toEqual([
      expect.objectContaining({
        artifactReadiness: "application-artifact-evidence-incomplete",
        workloadId: "workload_event_sqs_consumer_dlq",
      }),
    ]);
    const root = await writeArchitectureCliFixtureRepository(artifact);
    const semanticSnapshot = architectureCliGeneratedEventFixtureSnapshot();
    expect(semanticSnapshot.readiness).toEqual({ reasons: [], state: "ready" });
    expect(semanticSnapshot.coverage).toMatchObject({
      missingRequirements: [
        "application-build-and-tests",
        "application-security-checks",
      ],
      state: "starter-application",
    });

    try {
      expect(localSolutionExportService.verify(artifact)).toEqual([]);
      const buildEvidenceFile = artifact.files.find(({ path }) =>
        path.endsWith("/application-build-evidence.json"),
      );
      const packagedBuildEvidence =
        buildEvidenceFile === undefined
          ? undefined
          : (JSON.parse(new TextDecoder().decode(buildEvidenceFile.bytes)) as {
              readonly checks?: readonly unknown[];
            });
      expect(packagedBuildEvidence?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            generationCoverageRequirement: "application-build-and-tests",
            status: "passed",
          }),
          expect.objectContaining({
            generationCoverageRequirement: "application-security-checks",
            status: "passed",
          }),
        ]),
      );
      for (const command of [
        "validate",
        "generate",
        "test",
        "verify",
        "diff",
      ] as const) {
        const result = await execute(root, command, generatedEventPipeline());
        expect(result, JSON.stringify(result.output)).toMatchObject({
          exitCode: 0,
          output: { command, state: "succeeded" },
        });
      }

      const repository = await loadArchitectureRepository(root);
      const source = repositorySourceInputs(repository);
      expect(source.documents.architectureDocument.catalog).toEqual(
        artifact.manifest.tools.catalog,
      );
      const workload =
        source.documents.architectureDocument.workloadBehavior.workloads.find(
          ({ id }) => id === "workload_event_sqs_consumer_dlq",
        );
      expect(workload?.implementation).toMatchObject({
        mode: "complete-supported-pattern",
        sourceOwnership: "cloudmarkup",
      });
      expect(workload?.implementationRequirements).toEqual([]);

      const paths = artifact.files.map(({ path }) => path);
      expect(paths).toEqual(
        expect.arrayContaining([
          "application/artifacts/workload_event_sqs_consumer_dlq/artifact-manifest.json",
          "application/artifacts/workload_event_sqs_consumer_dlq/function.zip",
          "application/evidence/workload_event_sqs_consumer_dlq/application-build-evidence.json",
          "application/evidence/workload_event_sqs_consumer_dlq/sbom.cdx.json",
          "application/package.json",
          "application/test-specifications/event_sqs_consumer_dlq.smoke.json",
          "cloudmarkup/contracts/application-build-contracts.json",
          "infrastructure/compute.tf",
          "infrastructure/eventing.tf",
          "infrastructure/security.tf",
          "infrastructure/variables.tf",
        ]),
      );
      expect(
        paths.some((path) => path.endsWith("/event_sqs_consumer_dlq/index.ts")),
      ).toBe(true);
      expect(
        paths.some((path) =>
          path.endsWith("/tests/fixtures/event_sqs_consumer_dlq.json"),
        ),
      ).toBe(true);
      expect(paths.filter((path) => path.endsWith(".test.ts")).length).toBe(2);
      expect(
        paths.includes("cloudmarkup/contracts/event-contracts.pending.json"),
      ).toBe(false);

      const compute = await readFile(
        join(root, "infrastructure", "compute.tf"),
        "utf8",
      );
      const variables = await readFile(
        join(root, "infrastructure", "variables.tf"),
        "utf8",
      );
      const eventing = await readFile(
        join(root, "infrastructure", "eventing.tf"),
        "utf8",
      );
      const security = await readFile(
        join(root, "infrastructure", "security.tf"),
        "utf8",
      );
      expect(compute).toContain(
        "filebase64sha256(var.event_sqs_consumer_dlq_artifact_path)",
      );
      expect(variables).toContain(
        'default     = "../application/artifacts/workload_event_sqs_consumer_dlq/function.zip"',
      );
      expect(eventing).toContain('["ReportBatchItemFailures"]');
      expect(eventing).toContain(
        "aws_sqs_queue.event_sqs_consumer_dlq_dead_letter.arn",
      );
      expect(security).toMatch(
        /resources\s*=\s*\[aws_sqs_queue\.event_sqs_consumer_dlq_queue\.arn\]/u,
      );
      expect([compute, variables, eventing, security].join("\n")).not.toContain(
        "depends_on",
      );
      expect(security).not.toMatch(/resources\s*=\s*\[\s*"\*"\s*\]/u);

      const buildEvidence = JSON.parse(
        await readFile(
          join(
            root,
            "application",
            "evidence",
            "workload_event_sqs_consumer_dlq",
            "application-build-evidence.json",
          ),
          "utf8",
        ),
      ) as { checks: readonly { status: string }[] };
      expect(
        buildEvidence.checks.every(({ status }) => status === "passed"),
      ).toBe(true);
      const text = artifact.files
        .filter(({ mediaType }) => mediaType !== "application/zip")
        .map(({ bytes }) => new TextDecoder().decode(bytes))
        .join("\n");
      expect(text).not.toMatch(/Prompt 45A|pending-prompt-45a/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("exercises the other five curated generated-event repositories through the same CLI surface", async () => {
    for (const eventCase of architectureCliGeneratedEventCases) {
      if (eventCase === "sqs-consumer-dlq") {
        continue;
      }
      const expectedWorkloads = eventCase === "sns-fanout-multi" ? 2 : 1;
      const artifact = architectureCliGeneratedEventFixtureArtifact(eventCase);
      const infrastructure =
        architectureCliGeneratedEventInfrastructureProjection(eventCase);
      const semanticSnapshot =
        architectureCliGeneratedEventFixtureSnapshot(eventCase);
      const pipeline = generatedEventPipeline(
        eventCase,
        artifact,
        semanticSnapshot,
      );
      const root = await writeArchitectureCliFixtureRepository(artifact);

      try {
        expect(localSolutionExportService.verify(artifact), eventCase).toEqual(
          [],
        );
        expect(semanticSnapshot.events).toHaveLength(expectedWorkloads);
        expect(semanticSnapshot.handlers).toHaveLength(expectedWorkloads);
        expect(semanticSnapshot.contracts).toHaveLength(expectedWorkloads);
        expect(infrastructure.resources.length, eventCase).toBeGreaterThan(0);
        expect(
          infrastructure.policyArtifacts.length,
          eventCase,
        ).toBeGreaterThan(0);
        expect(infrastructure.applicationArtifacts, eventCase).toHaveLength(
          expectedWorkloads,
        );
        expect(
          infrastructure.applicationArtifacts.every(
            ({ artifactReadiness }) =>
              artifactReadiness === "application-artifact-evidence-incomplete",
          ),
          eventCase,
        ).toBe(true);

        for (const command of [
          "validate",
          "generate",
          "test",
          "verify",
          "diff",
        ] as const) {
          const result = await execute(root, command, pipeline);
          expect(
            result,
            eventCase + ":" + JSON.stringify(result.output),
          ).toMatchObject({
            exitCode: 0,
            output: { command, state: "succeeded" },
          });
        }

        const repository = await loadArchitectureRepository(root);
        const source = repositorySourceInputs(repository);
        const workloads =
          source.documents.architectureDocument.workloadBehavior.workloads;
        expect(workloads, eventCase).toHaveLength(expectedWorkloads);
        expect(
          workloads.every(
            ({ implementation, implementationRequirements }) =>
              implementation.mode === "complete-supported-pattern" &&
              implementationRequirements.length === 0,
          ),
          eventCase,
        ).toBe(true);

        const paths = artifact.files.map(({ path }) => path);
        expect(
          paths.filter((path) => path.endsWith("/function.zip")),
          eventCase,
        ).toHaveLength(expectedWorkloads);
        expect(
          paths.filter((path) =>
            path.endsWith("/application-build-evidence.json"),
          ),
          eventCase,
        ).toHaveLength(expectedWorkloads);
        expect(
          paths.filter((path) => path.endsWith("/index.ts")),
          eventCase,
        ).toHaveLength(expectedWorkloads);
        expect(
          paths.filter((path) => path.endsWith(".smoke.json")),
          eventCase,
        ).toHaveLength(expectedWorkloads);

        const compute = await readFile(
          join(root, "infrastructure", "compute.tf"),
          "utf8",
        );
        const data = await readFile(
          join(root, "infrastructure", "data.tf"),
          "utf8",
        );
        const eventing = await readFile(
          join(root, "infrastructure", "eventing.tf"),
          "utf8",
        );
        const identity = await readFile(
          join(root, "infrastructure", "identity.tf"),
          "utf8",
        );
        const observability = await readFile(
          join(root, "infrastructure", "observability.tf"),
          "utf8",
        );
        const security = await readFile(
          join(root, "infrastructure", "security.tf"),
          "utf8",
        );
        const variables = await readFile(
          join(root, "infrastructure", "variables.tf"),
          "utf8",
        );
        const terraform = [
          compute,
          data,
          eventing,
          identity,
          observability,
          security,
          variables,
        ].join("\n");
        for (const marker of compilerResourceMarkers[eventCase]) {
          expect(terraform, eventCase).toContain(marker);
        }
        expect(security, eventCase).toMatch(
          /(?:aws_iam_role_policy|aws_lambda_permission|aws_iam_policy_document)/u,
        );
        expect(security, eventCase).not.toMatch(
          /resources\s*=\s*\[\s*"\*"\s*\]/u,
        );
        expect(terraform, eventCase).not.toContain("depends_on");
        for (const workload of workloads) {
          expect(terraform, eventCase).toContain(
            "../application/artifacts/" + workload.id + "/function.zip",
          );
        }

        if (eventCase === "step-functions-task") {
          const trigger = source.documents.architectureDocument.edges.find(
            ({ semantic }) =>
              semantic.relationshipType ===
              "aws.stepfunctions.state-machine-invokes-lambda",
          );
          expect(trigger?.semantic.configuration.values).toEqual({
            maximumAttempts: { kind: "integer", value: 3 },
            retryMode: { kind: "string", value: "BOUNDED_EXPONENTIAL" },
            taskTimeoutSeconds: { kind: "integer", value: 60 },
          });
          expect(terraform).toMatch(/MaxAttempts\s*=\s*2(?:\r?\n|$)/u);
          expect(terraform).not.toMatch(/MaxAttempts\s*=\s*3(?:\r?\n|$)/u);
        }
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  }, 90_000);
  it("preserves the historical 0.12 pending-handler repository as a regression", async () => {
    const artifact = architectureCliEventFixtureArtifact();
    const root = await writeArchitectureCliFixtureRepository(artifact);
    try {
      expect(localSolutionExportService.verify(artifact)).toEqual([]);
      for (const command of [
        "validate",
        "generate",
        "test",
        "verify",
        "diff",
      ] as const) {
        const result = await execute(root, command);
        expect(result, JSON.stringify(result.output)).toMatchObject({
          exitCode: 0,
          output: { command, state: "succeeded" },
        });
      }

      const repository = await loadArchitectureRepository(root);
      const source = repositorySourceInputs(repository);
      expect(source.documents.architectureDocument.catalog.version).toBe(
        "0.12.0",
      );
      expect(
        source.documents.architectureDocument.nodes.map(
          ({ semantic }) => semantic.serviceType,
        ),
      ).toEqual(
        expect.arrayContaining([
          "aws.sqs.queue",
          "aws.lambda.function",
          "aws.iam.role",
        ]),
      );
      const eventRequirement =
        source.documents.architectureDocument.workloadBehavior.workloads.find(
          ({ id }) => id === "workload_event_consumer",
        )?.implementationRequirements[0];
      expect(eventRequirement?.implementationRequirementId).toBe(
        "implementation_event_handler_prompt_45a",
      );
      expect(eventRequirement?.summary).toContain("Prompt 45A");

      const terraform = await readFile(
        join(root, "infrastructure", "eventing.tf"),
        "utf8",
      );
      const pendingContracts = await readFile(
        join(root, "cloudmarkup", "contracts", "event-contracts.pending.json"),
        "utf8",
      );
      const snapshot = await readFile(
        join(root, "cloudmarkup", "repository-snapshot.json"),
        "utf8",
      );
      const planDiff = await readFile(
        join(root, "evidence", "sanitized-plan-diff.json"),
        "utf8",
      );
      expect(terraform).toContain(
        'resource "aws_lambda_event_source_mapping" "work"',
      );
      expect(terraform).not.toContain("depends_on");
      expect(terraform).not.toContain('Resource = "*"');
      expect(pendingContracts).toContain("pending-prompt-45a");
      expect(
        (JSON.parse(snapshot) as { deployed: unknown[] }).deployed,
      ).toEqual([]);
      expect(
        (JSON.parse(planDiff) as { credentials: boolean }).credentials,
      ).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses a bounded no-credential PR workflow for event IaC and contracts", async () => {
    const source = await readFile(
      new URL(
        "./fixtures/aws-eventing/.github/workflows/cloudmarkup-validate.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(() => {
      assertCloudMarkupWorkflowTemplate(source);
    }).not.toThrow();
    expect(source).toContain("cloudmarkup validate --format json");
    expect(source).toContain("cloudmarkup verify --format json");
    expect(source).toContain("cloudmarkup test --format json");
    expect(source).toMatch(/cloudmarkup\s+diff --format json/u);
    expect(source).toContain("event-driven IaC, contracts");
    expect(source).not.toMatch(
      /(?:id-token:\s*write|secrets\.|AWS_|terraform\s+(?:plan|apply|destroy)|pull_request_target)/u,
    );
  });
});
