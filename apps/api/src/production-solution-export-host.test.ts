import { solutionRevisionToolSelectionsV1Schema } from "./application/solution-revision-builder.js";
import { bindDiagramTargetSettings } from "./application/solution-exports.js";
import {
  solutionExportWorkflowTargetSettingsV1Schema,
  solutionExportWorkflowTargetSettingsProjectionV1Schema,
  solutionExportWorkflowTargetSettingsDigest,
} from "@cloudmarkup/solution-export-workflow";
import { beforeAll, describe, expect, it, vi } from "vitest";
import sqsEventTemplate from "@cloudmarkup/provider-aws/testing/sqs-event-template-v1.json" with { type: "json" };
import { supportsInfrastructureOnlyDelivery } from "@cloudmarkup/solution-export-workflow";
import { selectProductionApplicationDelivery } from "./production-solution-export-host.js";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  asyncJobIdSchema,
  asyncJobTrustedContextV1Schema,
} from "@cloudmarkup/schemas";
import { createNativeExportDiagramFixture } from "./solution-export-native-test-helpers.js";
import { exportRunFixture } from "./adapters/persistence/solution-export-run-test-helpers.js";
import { InMemoryObjectStore } from "./adapters/persistence/memory-object-store.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import type { ExportAdmissionSelectionV1 } from "./adapters/persistence/solution-export-admission-codec.js";
import {
  createProductionSolutionExportHost,
  assertProductionInfrastructureBinding,
  assertProductionSolutionExportRequest,
} from "./production-solution-export-host.js";
import {
  PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
  PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
  PRODUCTION_SOLUTION_EXPORT_PROFILE,
  type ProductionSolutionExportEnvironment,
} from "./production-solution-export-environment.js";
let diagram: Awaited<ReturnType<typeof createNativeExportDiagramFixture>>;
beforeAll(async () => {
  diagram = await createNativeExportDiagramFixture();
});
function fixture(enabled = true) {
  const f = exportRunFixture("cloudformation");
  const ownership = {
    organizationId: f.record.organizationId,
    projectId: f.record.job.projectId,
  };
  const config: ProductionSolutionExportEnvironment = {
    enabled,
    profile: PRODUCTION_SOLUTION_EXPORT_PROFILE,
    queue: {
      region: "us-east-1",
      queueArn:
        "arn:aws:sqs:us-east-1:123456789012:cloudmarkup-beta-solution-exports.fifo",
      queueUrl:
        "https://sqs.us-east-1.amazonaws.com/123456789012/cloudmarkup-beta-solution-exports.fifo",
    },
    accountId: "123456789012",
    databaseArn: "arn:aws:rds:us-east-1:123456789012:cluster:synthetic",
    databaseName: "cloudmarkup",
    databaseSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:synthetic",
    contentBucket: "cloudmarkup-beta-synthetic-content",
    documentPrefix: "documents",
    compiler: {
      executablePath: PRODUCTION_SOLUTION_EXPORT_COMPILER_PATH,
      executableSha256: "a".repeat(64),
    },
    iconBundlePath: PRODUCTION_SOLUTION_EXPORT_ICON_BUNDLE_PATH,
    iconBundleSha256: "b".repeat(64),
    targetSettingsDigest:
      f.record.workflowSubmission.request.targetSettings.digest,
  };
  const query = vi.fn(() =>
    Promise.reject(new Error("Host construction must not access SQL.")),
  );
  const database: SqlDatabase = {
    query,
    transaction: (work) => work(database),
    close: () => Promise.resolve(),
  };
  const client = new SQSClient({ region: "us-east-1", maxAttempts: 1 });
  const send = vi
    .spyOn(client, "send")
    .mockRejectedValue(new Error("No test publication is permitted."));
  const options = {
    config,
    database,
    objectStore: new InMemoryObjectStore(),
    admitted: {
      targetSettings: f.record.workflowSubmission.request.targetSettings,
      diagram,
    },
    ownership,
    principalId: f.principal.principalId,
    client,
  };
  const host = createProductionSolutionExportHost(options);
  const selection: ExportAdmissionSelectionV1 = {
    contractVersion: 1,
    ...ownership,
    createdByPrincipalId: f.principal.principalId,
    originalIdempotencyKeyDigest: f.idempotencyKeyDigest,
    admissionGeneration: 1,
    previousAdmission: null,
    initialRecord: f.record,
  };
  const entitlement = {
    context: asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "principal", actorId: f.principal.principalId },
      ownership,
      correlationId: f.principal.correlationId,
    }),
    family: "solution-export-orchestration" as const,
    idempotencyKeyDigest: f.idempotencyKeyDigest,
    jobId: asyncJobIdSchema.parse(f.record.job.id),
  };
  return {
    ...f,
    host,
    options,
    ownership,
    selection,
    entitlement,
    query,
    send,
  };
}
describe("request-owned hosted CloudFormation adapter", () => {
  it("registers the real restricted handler and preserves the exact commercial decision", async () => {
    const f = fixture();
    expect(
      f.host.handlers.get("solution-export-orchestration")?.handlerId,
    ).toBe("cloudmarkup.solution-export.workflow");
    await expect(
      f.host.assertCurrentHostReady(f.principal, f.ownership),
    ).resolves.toBeUndefined();
    await expect(
      f.host.entitlementForSelection(f.selection).evaluate(f.entitlement),
    ).resolves.toEqual({
      allowed: true,
      decisionReference:
        f.record.workflowSubmission.entitlementDecisionReference,
    });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("denies unavailable creation and another current principal or project", async () => {
    const f = fixture(false);
    await expect(
      f.host.assertCurrentHostReady(f.principal, f.ownership),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    const active = fixture();
    await expect(
      active.host.assertCurrentHostReady(
        { ...active.principal, principalId: "principal.other" },
        active.ownership,
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      active.host.assertCurrentHostReady(active.principal, {
        ...active.ownership,
        projectId: "project.other",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it("rejects an admission from another tenant before queue or SQL", async () => {
    const f = fixture();
    await expect(
      f.host
        .entitlementForSelection({
          ...f.selection,
          organizationId: "org.other",
        })
        .evaluate(f.entitlement),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("allows a reviewed diagram choice while rejecting a different valid compiler profile", () => {
    const f = fixture();
    const request = f.record.workflowSubmission.request;
    const changedDiagram = {
      ...request.diagram,
      theme: { background: "transparent" as const },
    };
    const diagramSettings = bindDiagramTargetSettings(
      f.options.admitted.targetSettings,
      changedDiagram,
    );
    expect(() => {
      assertProductionSolutionExportRequest(
        {
          ...request,
          diagram: changedDiagram,
          targetSettings: diagramSettings,
        },
        f.options.admitted.targetSettings,
      );
    }).not.toThrow();
    const { digest: previousDigest, ...projection } = request.targetSettings;
    expect(previousDigest).toBeDefined();
    const changed =
      solutionExportWorkflowTargetSettingsProjectionV1Schema.parse({
        ...projection,
        stageDescriptors: {
          ...projection.stageDescriptors,
          compiler: {
            ...projection.stageDescriptors.compiler,
            profileId: "cloudmarkup.compiler.unreviewed",
          },
        },
      });
    const settings = solutionExportWorkflowTargetSettingsV1Schema.parse({
      ...changed,
      digest: solutionExportWorkflowTargetSettingsDigest(changed),
    });
    expect(() => {
      assertProductionSolutionExportRequest(
        { ...request, targetSettings: settings },
        f.options.admitted.targetSettings,
      );
    }).toThrow();
  });
  it("rejects a changed host settings pin", () => {
    const f = fixture();
    expect(() =>
      createProductionSolutionExportHost({
        ...f.options,
        config: {
          ...f.options.config,
          targetSettingsDigest: "sha256:" + "c".repeat(64),
        },
      }),
    ).toThrow("settings");
  });
  it.each([
    "missing",
    "not-applicable",
    "compiler-version",
    "renderer-digest",
    "exact",
  ])(
    "requires frozen tools matching the admitted host before writes (%s)",
    (kind) => {
      const f = fixture();
      const stages = f.options.admitted.targetSettings.stageDescriptors;
      const tools = {
        compiler: { state: "pinned" as const, tool: stages.compiler.adapter },
        diagramRenderer: {
          state: "pinned" as const,
          tool: stages.diagramRenderer.adapter,
        },
      };
      const selected =
        kind === "not-applicable"
          ? {
              compiler: {
                state: "not-applicable",
                reason: "Historical revision",
              },
              diagramRenderer: {
                state: "not-applicable",
                reason: "Historical revision",
              },
            }
          : kind === "compiler-version"
            ? {
                ...tools,
                compiler: {
                  ...tools.compiler,
                  tool: { ...tools.compiler.tool, version: "99.0.0" },
                },
              }
            : kind === "renderer-digest"
              ? {
                  ...tools,
                  diagramRenderer: {
                    ...tools.diagramRenderer,
                    tool: {
                      ...tools.diagramRenderer.tool,
                      digest: "sha256:" + "f".repeat(64),
                    },
                  },
                }
              : tools;
      const binding = {
        ...f.ownership,
        solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
        manifestRecordId: f.record.job.solutionRevision.manifestRecordId,
        manifestDigest:
          f.record.workflowSubmission.request.subject.manifestDigest,
        generationCoverage: f.record.job.generationCoverage,
        workflowSources: f.record.workflowSubmission.request.sources,
        applicationCodeRequired: false,
        ...(kind === "missing"
          ? {}
          : {
              selectedTools:
                solutionRevisionToolSelectionsV1Schema.parse(selected),
            }),
      };
      const check = () => {
        f.host.assertImmutableBindingSupported?.(binding);
      };
      if (kind === "exact") expect(check).not.toThrow();
      else
        expect(check).toThrow(
          expect.objectContaining({
            code: "unsupported_version",
            status: 422,
            fieldIssues: [
              {
                code: "solution-export.revision-tools-unavailable.v1",
                path: ["solutionRevisionId"],
                message:
                  "This saved revision does not use the current export tools. Save a new revision and try again.",
              },
            ],
          }),
        );
      expect(f.query).not.toHaveBeenCalled();
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it("blocks saved revisions that require an application runner", () => {
    const f = fixture();
    const binding = {
      ...f.ownership,
      solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
      manifestRecordId: f.record.job.solutionRevision.manifestRecordId,
      manifestDigest:
        f.record.workflowSubmission.request.subject.manifestDigest,
      generationCoverage: f.record.job.generationCoverage,
      workflowSources: f.record.workflowSubmission.request.sources,
      applicationCodeRequired: false,
    };
    expect(() => {
      assertProductionInfrastructureBinding(binding);
    }).not.toThrow();
    expect(() => {
      assertProductionInfrastructureBinding({
        ...binding,
        applicationCodeRequired: true,
      });
    }).toThrow("infrastructure-only");
    const templateBinding = {
      ...binding,
      applicationCodeRequired: true,
      infrastructureOnlyDeliverySupported:
        supportsInfrastructureOnlyDelivery(sqsEventTemplate),
    };
    expect(
      selectProductionApplicationDelivery(templateBinding, undefined),
    ).toBe("infrastructure-only-v1");
    expect(
      selectProductionApplicationDelivery(binding, undefined),
    ).toBeUndefined();
    expect(() =>
      selectProductionApplicationDelivery(
        templateBinding,
        "ai-source-draft-v2",
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(f.query).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});
