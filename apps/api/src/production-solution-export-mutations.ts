import { requireOperationFundingSource } from "./application/operation-funding.js";
import {
  createSolutionExportJobV1Schema,
  idempotencyKeySchema,
  solutionExportTargetProfileIdV1Schema,
} from "@cloudmarkup/api-contract";
import {
  selectJobPublicationTransportV1,
  type JobAuditPort,
  type JobEntitlementPort,
  type JobHandlerRegistry,
  type JobIdGenerator,
  type JobPublicationTransportV1,
} from "@cloudmarkup/job-framework";
import type { SolutionExportWorkflowTargetSettingsV1 } from "@cloudmarkup/solution-export-workflow";
import type { ObjectStore } from "./application/persistence.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "./application/ports.js";
import type { ProductionIdentityApplication } from "./application/production-identity-application.js";
import { ApplicationError } from "./application/errors.js";
import {
  DefaultSolutionExportApplication,
  type SolutionExportApplication,
  type StoredSolutionExportJob,
  type ImmutableSolutionRevisionExportBinding,
  type SolutionExportWorkflowRequestV1,
  type SolutionExportTargetPolicy,
} from "./application/solution-exports.js";
import { SolutionExportRequestAuthority } from "./adapters/persistence/solution-export-authority.js";
import { SolutionExportProducerObjects } from "./adapters/persistence/solution-export-producer-objects.js";
import { PostgresSolutionExportRevisionRepository } from "./adapters/persistence/solution-export-revision-repository.js";
import { DurableSolutionExportProducer } from "./adapters/persistence/solution-export-producer.js";
import { PostgresSolutionExportAdmission } from "./adapters/persistence/solution-export-admission.js";
import { PostgresSolutionExportCancellation } from "./adapters/persistence/solution-export-cancellation.js";
import type { ExportAdmissionSelectionV1 } from "./adapters/persistence/solution-export-admission-codec.js";
import {
  PostgresSolutionExportTargetPolicy,
  type ExportInactiveSubscriptionPolicy,
} from "./adapters/persistence/solution-export-target-policy.js";
import { exportRunEqual } from "./adapters/persistence/solution-export-run-codec.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";

type DirectTargetPolicyFactory = (input: {
  readonly authority: SolutionExportRequestAuthority;
  readonly targetSettings: SolutionExportWorkflowTargetSettingsV1;
}) => SolutionExportTargetPolicy;
type ExportMutationFunding =
  | {
      readonly fundingSource?: "hosted-credits";
      readonly createDirectTargetPolicy?: never;
    }
  | {
      readonly fundingSource: "provider-direct";
      readonly createDirectTargetPolicy: DirectTargetPolicyFactory;
    };
export type ProductionSolutionExportMutationHost = JobPublicationTransportV1 &
  ExportMutationFunding & {
    readonly handlers: JobHandlerRegistry;
    readonly ids: JobIdGenerator;
    readonly audit: JobAuditPort;
    readonly targetSettings: SolutionExportWorkflowTargetSettingsV1;
    readonly localRestrictedInsert?: boolean;
    readonly inactiveSubscriptionAccessPolicy?: ExportInactiveSubscriptionPolicy;
    assertImmutableBindingSupported?(
      binding: ImmutableSolutionRevisionExportBinding,
    ): void;
    selectApplicationDelivery?(
      binding: ImmutableSolutionRevisionExportBinding,
      applicationSource: SolutionExportWorkflowRequestV1["applicationSource"],
    ): SolutionExportWorkflowRequestV1["applicationDelivery"];
    /** Actual configured executor/pricing/reservation availability; absence fails before admission writes. */
    assertCurrentHostReady(
      principal: PrincipalContext,
      ownership: {
        readonly organizationId: string;
        readonly projectId: string;
      },
    ): Promise<void>;
    /** Real required stage-admission gate bound to the already-persisted original selection. */
    entitlementForSelection(
      selection: ExportAdmissionSelectionV1,
    ): JobEntitlementPort;
  };
type Mutations = Pick<SolutionExportApplication, "createJob" | "cancelJob">;
function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "Immutable export creation is unavailable until its real queue, worker and commercial execution host are configured.",
  );
}

/** Request authority is resolved before a production transport is bound to its tenant. */
export function createProductionSolutionExportMutations(options: {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly identity: Pick<
    ProductionIdentityApplication,
    "organizationForProject"
  >;
  readonly revisions: Pick<CloudMarkupApplication, "getSolutionRevision">;
  readonly host?:
    | ProductionSolutionExportMutationHost
    | ((input: {
        readonly principal: PrincipalContext;
        readonly ownership: {
          readonly organizationId: string;
          readonly projectId: string;
        };
      }) => Promise<ProductionSolutionExportMutationHost>);
  readonly clock?: () => Date;
}): Mutations {
  const clock = options.clock ?? (() => new Date());
  async function request<T>(
    supplied: PrincipalContext,
    projectId: string,
    creating: boolean,
    work: (application: Mutations, principal: PrincipalContext) => Promise<T>,
  ): Promise<T> {
    const principal = Object.freeze(structuredClone(supplied));
    const configuredHost = options.host;
    if (configuredHost === undefined) unavailable();
    try {
      if (typeof configuredHost !== "function") {
        selectJobPublicationTransportV1(configuredHost);
        const declared = configuredHost.handlers.get(
          "solution-export-orchestration",
        );
        if (
          declared?.family !== "solution-export-orchestration" ||
          typeof declared.execute !== "function"
        )
          unavailable();
      }
      const organizationId = await options.identity.organizationForProject(
        principal,
        projectId,
      );
      if (organizationId === null)
        throw new ApplicationError(
          "not_found",
          "The requested resource is unavailable.",
        );
      const ownership = Object.freeze({ organizationId, projectId });
      const authority = new SolutionExportRequestAuthority(
        options.database,
        principal,
        ownership,
        "exports.run",
        clock,
      );
      await authority.scope();
      const host =
        typeof configuredHost === "function"
          ? await configuredHost({ principal, ownership })
          : configuredHost;
      const transport = selectJobPublicationTransportV1(host);
      const fundingSource = requireOperationFundingSource(host.fundingSource);
      const rawFactory: unknown = host.createDirectTargetPolicy;
      if (
        fundingSource === "provider-direct"
          ? typeof rawFactory !== "function"
          : rawFactory !== undefined
      )
        unavailable();
      const directFactory =
        typeof rawFactory === "function"
          ? (rawFactory as DirectTargetPolicyFactory)
          : undefined;
      const handler = host.handlers.get("solution-export-orchestration");
      if (
        handler?.family !== "solution-export-orchestration" ||
        typeof handler.execute !== "function" ||
        typeof host.entitlementForSelection !== "function" ||
        typeof host.assertCurrentHostReady !== "function"
      )
        unavailable();
      // A configured host becoming unavailable must not prevent canceling its existing work.
      if (creating) await host.assertCurrentHostReady(principal, ownership);
      await authority.scope();
      const objects = new SolutionExportProducerObjects(
        authority,
        options.objectStore,
      );
      const revisions = new PostgresSolutionExportRevisionRepository(
        objects,
        options.revisions.getSolutionRevision.bind(options.revisions),
      );
      const policy =
        directFactory !== undefined
          ? directFactory({
              authority,
              targetSettings: host.targetSettings,
            })
          : new PostgresSolutionExportTargetPolicy(
              authority,
              host.targetSettings,
              host.inactiveSubscriptionAccessPolicy,
            );
      if (typeof policy.evaluate !== "function") unavailable();
      let executingSelection: ExportAdmissionSelectionV1 | undefined;
      const producer = new DurableSolutionExportProducer({
        ...(host.localRestrictedInsert === true
          ? { localRestrictedInsert: true }
          : {}),
        ...(host.fundingSource === undefined
          ? {}
          : { fundingSource: host.fundingSource }),
        database: options.database,
        objectStore: options.objectStore,
        principal,
        ownership,
        revisions,
        ...transport,
        ids: host.ids,
        audit: host.audit,
        clock,
        entitlement: {
          evaluate: async (input) => {
            const selection = executingSelection;
            if (
              input.jobId !== selection?.initialRecord.job.id ||
              input.context.actor.kind !== "principal" ||
              input.context.actor.actorId !== principal.principalId ||
              !exportRunEqual(input.context.ownership, ownership)
            )
              unavailable();
            const selected = selection.initialRecord;
            const binding = await revisions.getImmutableBinding({
              ...ownership,
              solutionRevisionId:
                selected.job.solutionRevision.solutionRevisionId,
            });
            if (
              binding?.manifestDigest !==
                selected.job.solutionRevision.manifestDigest ||
              !exportRunEqual(
                binding.workflowSources,
                selected.workflowSubmission.request.sources,
              )
            )
              unavailable();
            host.assertImmutableBindingSupported?.(binding);
            const applicationDelivery = host.selectApplicationDelivery?.(
              binding,
              selected.workflowSubmission.request.applicationSource,
            );
            if (
              applicationDelivery !==
              selected.workflowSubmission.request.applicationDelivery
            )
              unavailable();
            let currentReference: string;
            try {
              currentReference = (
                await policy.evaluate({
                  binding,
                  environment: selected.job.target.environment,
                  organizationId,
                  principal,
                  targetProfileId: solutionExportTargetProfileIdV1Schema.parse(
                    selected.targetProfileId,
                  ),
                  ...(applicationDelivery === undefined
                    ? {}
                    : { applicationDelivery }),
                })
              ).entitlementDecisionReference;
            } catch (error) {
              if (
                error instanceof ApplicationError &&
                (error.code === "access_denied" ||
                  error.code === "service_unavailable")
              )
                return {
                  allowed: false,
                  decisionReference: "export-denial.commercial-unavailable",
                  denialCode: "job.export-commercial-unavailable",
                  publicMessage: "job-not-supported",
                };
              throw error;
            }
            if (
              currentReference !==
              selected.workflowSubmission.entitlementDecisionReference
            )
              return {
                allowed: false,
                decisionReference: "export-denial.commercial-changed",
                denialCode: "job.export-commercial-changed",
                publicMessage: "job-not-supported",
              };
            await host.assertCurrentHostReady(principal, ownership);
            const decision = await host
              .entitlementForSelection(structuredClone(selection))
              .evaluate(input);
            await authority.scope();
            if (
              decision.allowed &&
              decision.decisionReference !== currentReference
            )
              unavailable();
            return decision;
          },
        },
      });
      const admission = new PostgresSolutionExportAdmission(producer);
      const cancellation = new PostgresSolutionExportCancellation(producer);
      const resume = async (
        selection: ExportAdmissionSelectionV1,
      ): Promise<StoredSolutionExportJob> => {
        executingSelection = selection;
        try {
          return await admission.resume(selection);
        } finally {
          executingSelection = undefined;
        }
      };
      const downloads = admission.downloads;
      const application = new DefaultSolutionExportApplication({
        clock,
        revisions,
        targetPolicy: {
          evaluate: async (input) => {
            host.assertImmutableBindingSupported?.(input.binding);
            const applicationDelivery = host.selectApplicationDelivery?.(
              input.binding,
              input.applicationSource,
            );
            const result = await policy.evaluate({
              ...input,
              ...(applicationDelivery === undefined
                ? {}
                : { applicationDelivery }),
            });
            return {
              ...result,
              ...(applicationDelivery === undefined
                ? {}
                : { applicationDelivery }),
            };
          },
        },
        access: {
          authorizeProject: async (actor, selectedProject, permission) => {
            if (
              actor !== principal ||
              selectedProject !== projectId ||
              permission !== "exports.run"
            )
              unavailable();
            await authority.scope();
            return ownership;
          },
        },
        repository: {
          findLatestArtifact: (input) => downloads.findLatestArtifact(input),
          getArtifact: (input) => downloads.getArtifact(input),
          getDownloadGrant: (input) => downloads.getDownloadGrant(input),
          reserveDownloadGrant: (input) =>
            downloads.reserveDownloadGrant(input),
          getJob: async (input) =>
            (await producer.runs.getJob(input))?.record ?? null,
        },
        durableAdmission: {
          contractVersion: 1,
          findReplay: async (input) => {
            const selection = await admission.findSelection(input);
            return selection === null ? null : resume(selection);
          },
          admit: async (input) => resume(await admission.select(input)),
          cancel: (input) => cancellation.cancel(input),
        },
      });
      const result = await work(application, principal);
      await authority.scope();
      return result;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      return unavailable();
    }
  }
  return {
    createJob: (principal, projectId, input, key) =>
      request(principal, projectId, true, (application, actor) =>
        application.createJob(
          actor,
          projectId,
          createSolutionExportJobV1Schema.parse(input),
          idempotencyKeySchema.parse(key),
        ),
      ),
    cancelJob: (principal, projectId, jobId, key) =>
      request(principal, projectId, false, (application, actor) =>
        application.cancelJob(
          actor,
          projectId,
          jobId,
          idempotencyKeySchema.parse(key),
        ),
      ),
  };
}
