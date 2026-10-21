import { randomUUID } from "node:crypto";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { asyncJobTrustedOwnershipV1Schema } from "@cloudmarkup/schemas";
import type { SolutionExportWorkflowTargetSettingsV1 } from "@cloudmarkup/solution-export-workflow";
import { bindDiagramTargetSettings } from "./application/solution-exports.js";
import { unsupportedSolutionExportStage } from "./solution-export-execution-profile.js";
import type { ImmutableSolutionRevisionExportBinding } from "./application/solution-exports.js";
import type { ObjectStore } from "./application/persistence.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { SqsJobPublisherV1 } from "./adapters/sqs-job-publisher.js";
import { createPinnedSolutionExportCompilerExecutor } from "./adapters/pinned-export-compiler.js";
import {
  createDurableSolutionExportHandler,
  type DurableSolutionExportHandlerOptions,
} from "./solution-export-worker.js";
import { ApplicationError } from "./application/errors.js";
import { exportRunEqual } from "./adapters/persistence/solution-export-run-codec.js";
import { ProductionSolutionExportAudit } from "./production-solution-export-audit.js";
import type { ProductionSolutionExportEnvironment } from "./production-solution-export-environment.js";
import type { ProductionSolutionExportMutationHost } from "./production-solution-export-mutations.js";

export interface AdmittedProductionSolutionExportProfile {
  readonly targetSettings: SolutionExportWorkflowTargetSettingsV1;
  readonly diagram: DurableSolutionExportHandlerOptions["diagram"];
}
export function assertProductionInfrastructureBinding(
  binding: ImmutableSolutionRevisionExportBinding,
): void {
  if (
    !Object.is(binding.applicationCodeRequired, false) &&
    !Object.is(binding.infrastructureOnlyDeliverySupported, true)
  )
    throw new ApplicationError(
      "service_unavailable",
      "Hosted exports support infrastructure-only delivery of eligible saved revisions.",
    );
}
export function selectProductionApplicationDelivery(
  binding: ImmutableSolutionRevisionExportBinding,
  applicationSource: Parameters<
    NonNullable<
      ProductionSolutionExportMutationHost["selectApplicationDelivery"]
    >
  >[1],
): "infrastructure-only-v1" | undefined {
  assertProductionInfrastructureBinding(binding);
  if (!binding.applicationCodeRequired) return undefined;
  if (applicationSource !== undefined)
    throw new ApplicationError(
      "invalid_request",
      "Export this saved pattern as infrastructure without selecting AI application source.",
    );
  return "infrastructure-only-v1";
}
export function assertProductionSolutionExportRequest(
  request: Parameters<
    NonNullable<DurableSolutionExportHandlerOptions["assertRequestHostBinding"]>
  >[0],
  settings: SolutionExportWorkflowTargetSettingsV1,
): void {
  if (
    request.targetProfileId !==
      "cloudmarkup.export.cloudformation-nodejs24-v1" ||
    request.sources.applicationBuildInputs !== undefined ||
    !exportRunEqual(
      bindDiagramTargetSettings(settings, request.diagram),
      request.targetSettings,
    )
  )
    unsupportedSolutionExportStage("compile-infrastructure");
}
export function createProductionSolutionExportHost(options: {
  readonly config: ProductionSolutionExportEnvironment;
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly admitted: AdmittedProductionSolutionExportProfile;
  readonly ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly principalId: string;
  readonly client?: SQSClient;
  readonly clock?: () => Date;
}): ProductionSolutionExportMutationHost {
  const config = structuredClone(options.config);
  if (
    options.admitted.targetSettings.target !== "cloudformation" ||
    options.admitted.targetSettings.digest !== config.targetSettingsDigest
  )
    throw new ApplicationError(
      "service_unavailable",
      "The hosted export settings are unavailable.",
    );
  const ownership = Object.freeze(structuredClone(options.ownership));
  const clock = options.clock ?? (() => new Date());
  const handler = createDurableSolutionExportHandler({
    executionProfile: "cloudformation-infrastructure-only",
    database: options.database,
    objectStore: options.objectStore,
    compiler: {
      executor: createPinnedSolutionExportCompilerExecutor(config.compiler),
    },
    diagram: options.admitted.diagram,
    assertRequestHostBinding: (request) => {
      assertProductionSolutionExportRequest(
        request,
        options.admitted.targetSettings,
      );
    },
    clock: { now: clock },
  });
  const assertCurrentHostReady: ProductionSolutionExportMutationHost["assertCurrentHostReady"] =
    (principal, selectedOwnership) => {
      if (
        !config.enabled ||
        principal.principalId !== options.principalId ||
        !exportRunEqual(ownership, selectedOwnership)
      )
        return Promise.reject(
          new ApplicationError(
            "service_unavailable",
            "Hosted CloudFormation exports are currently unavailable.",
          ),
        );
      return Promise.resolve();
    };
  return {
    selectApplicationDelivery: selectProductionApplicationDelivery,
    targetSettings: options.admitted.targetSettings,
    handlers: { get: (family) => (family === handler.family ? handler : null) },
    ids: { nextId: (kind) => kind + "." + randomUUID() },
    audit: new ProductionSolutionExportAudit(options.database, ownership),
    publisher: new SqsJobPublisherV1({
      target: config.queue,
      ownership: asyncJobTrustedOwnershipV1Schema.parse(ownership),
      ...(options.client === undefined ? {} : { client: options.client }),
      now: clock,
    }),
    assertCurrentHostReady,
    assertImmutableBindingSupported: (binding) => {
      assertProductionInfrastructureBinding(binding);
      const stages = options.admitted.targetSettings.stageDescriptors;
      if (
        binding.selectedTools === undefined ||
        !exportRunEqual(binding.selectedTools, {
          compiler: { state: "pinned", tool: stages.compiler.adapter },
          diagramRenderer: {
            state: "pinned",
            tool: stages.diagramRenderer.adapter,
          },
        })
      )
        throw new ApplicationError(
          "unsupported_version",
          "Save a new revision before exporting with the current tools.",
          {
            fieldIssues: [
              {
                code: "solution-export.revision-tools-unavailable.v1",
                path: ["solutionRevisionId"],
                message:
                  "This saved revision does not use the current export tools. Save a new revision and try again.",
              },
            ],
          },
        );
    },
    entitlementForSelection: (selection) => ({
      evaluate: (input) => {
        const selected = selection.initialRecord;
        if (
          input.family !== "solution-export-orchestration" ||
          input.jobId !== selected.job.id ||
          input.context.actor.kind !== "principal" ||
          input.context.actor.actorId !== options.principalId ||
          selection.createdByPrincipalId !== options.principalId ||
          !exportRunEqual(input.context.ownership, ownership) ||
          selection.organizationId !== ownership.organizationId ||
          selection.projectId !== ownership.projectId ||
          selected.workflowSubmission.request.targetSettings.target !==
            "cloudformation" ||
          selected.workflowSubmission.request.sources.applicationBuildInputs !==
            undefined
        )
          return Promise.reject(
            new ApplicationError(
              "service_unavailable",
              "The immutable hosted export selection is unavailable.",
            ),
          );
        assertProductionSolutionExportRequest(
          selected.workflowSubmission.request,
          options.admitted.targetSettings,
        );
        // Current plan, expensive-operation switches and the exact decision are
        // re-evaluated by the request authority before this stage admission.
        return Promise.resolve({
          allowed: true,
          decisionReference:
            selected.workflowSubmission.entitlementDecisionReference,
        });
      },
    }),
  };
}
