import { randomUUID } from "node:crypto";
import {
  solutionExportStagesForTargetProfile,
  solutionExportJobV1Schema,
} from "@cloudmarkup/api-contract";
import {
  applyAsyncJobLifecycleCommandV1,
  hashCanonicalValue,
} from "@cloudmarkup/domain";
import {
  createJobAuditOutboxEntryV1,
  JobService,
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  SequentialJobIdGenerator,
  type CreateJobCommandV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobAttemptIdSchema,
  asyncJobTrustedContextV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
  type AsyncJobRecordV1,
} from "@cloudmarkup/schemas";
import {
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
} from "@cloudmarkup/solution-export-workflow";
import { workflowFixture } from "@cloudmarkup/solution-export-workflow/testing";
import {
  DEFAULT_SOLUTION_EXPORT_DIAGRAM_OPTIONS,
  solutionExportPrimaryInputDigest,
  type StoredSolutionExportJob,
} from "../../application/solution-exports.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import { solutionExportRootAdmissionCommand } from "../../application/solution-export-root-admission.js";
import { permissionsForRole } from "../../application/authorization.js";
import type {
  AuthorizedOrganizationScope,
  ObjectPurpose,
  StoredObjectReference,
} from "../../application/persistence.js";
import { exportPrincipal } from "./solution-export-artifact-test-helpers.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import {
  PostgresAsyncJobRepository,
  type AsyncJobPersistenceObjectPort,
} from "./async-job-repository.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunSha,
} from "./solution-export-run-codec.js";
import {
  PostgresSolutionExportRunRepository,
  type PreparedSolutionExportRun,
} from "./solution-export-run-repository.js";
import { sql, type SqlDatabase } from "./sql.js";

export const exportRunId = (kind: string): string =>
  `${kind}_${randomUUID().replaceAll("-", "")}`;

/** Synthetic immutable compiler fixture; no provider, source content or credentials. */
export function exportRunFixture(
  target: "terraform" | "cloudformation" = "terraform",
  source: ReturnType<typeof workflowFixture> = workflowFixture(
    "infrastructure-only",
    target,
  ),
): {
  readonly source: ReturnType<typeof workflowFixture>;
  readonly principal: ReturnType<typeof exportPrincipal>;
  readonly record: StoredSolutionExportJob;
  readonly idempotencyKeyDigest: ReturnType<typeof hashCanonicalValue>;
  readonly binding: ReturnType<
    typeof createSolutionExportRunInsertionBindingV1
  >;
} {
  const principal = {
    ...exportPrincipal(),
    principalId: exportRunId("principal"),
  };
  const organizationId = exportRunId("org");
  const projectId = exportRunId("project");
  const manifestRecordId = exportRunId("record");
  const now = new Date(Date.now() - 10_000).toISOString();
  const request = solutionExportWorkflowRequestV1Schema.parse({
    ...source.request,
    sources: {
      ...source.request.sources,
      architectureDocument: {
        ...source.request.sources.architectureDocument,
        objectId: exportRunId("object"),
      },
      solutionRevision: {
        ...source.request.sources.solutionRevision,
        objectId: exportRunId("object"),
      },
      workloadBehavior: {
        ...source.request.sources.workloadBehavior,
        objectId: exportRunId("object"),
      },
    },
    environment: { environmentType: "development" },
    subject: { ...source.request.subject, manifestRecordId },
    targetProfileId:
      target === "terraform"
        ? "cloudmarkup.export.terraform-nodejs24-v1"
        : "cloudmarkup.export.cloudformation-nodejs24-v1",
  });
  const submission = {
    createdByPrincipalId: principal.principalId,
    entitlementDecisionReference: "entitlement.synthetic",
    jobId: exportRunId("solutionexport"),
    organizationId,
    projectId,
    primaryInputDigest: solutionExportPrimaryInputDigest({
      organizationId,
      projectId,
      request,
    }),
    request,
    requestDigest: solutionExportWorkflowRequestDigest(request),
  };
  const record: StoredSolutionExportJob = {
    createdByPrincipalId: principal.principalId,
    organizationId,
    primaryInputDigest: submission.primaryInputDigest,
    requestIntentDigest: `sha256:${exportRunSha(
      exportRunBytes({
        projectId,
        manifestRecordId,
        target: request.targetProfileId,
      }),
    )}`,
    targetProfileId: request.targetProfileId,
    workflowSubmission: submission,
    job: solutionExportJobV1Schema.parse({
      cancellation: { state: "none" },
      contractVersion: 1,
      createdAt: now,
      diagnostics: [],
      evidence: [],
      generationCoverage:
        source.generationRequest.solutionRevision.generationCoverage,
      id: submission.jobId,
      pollAfterMilliseconds: 1000,
      progress: {
        completedStages: 1,
        currentStage: "compilation",
        message: "The export is queued for deterministic generation.",
        totalStages: 8,
      },
      projectId,
      requestDigest: submission.requestDigest,
      runSequence: 1,
      solutionRevision: {
        manifestDigest: request.subject.manifestDigest,
        manifestRecordId,
        solutionRevisionId: request.subject.solutionRevisionId,
      },
      stages: solutionExportStagesForTargetProfile(request.targetProfileId).map(
        (stage) => ({
          stage,
          status: stage === "authorization" ? "succeeded" : "pending",
          ...(stage === "authorization"
            ? { startedAt: now, completedAt: now }
            : {}),
        }),
      ),
      state: "queued",
      target: {
        diagram: DEFAULT_SOLUTION_EXPORT_DIAGRAM_OPTIONS,
        environment: request.environment,
        exportName: request.exportName,
        ...(request.applicationSource === undefined
          ? {}
          : { applicationSource: request.applicationSource }),
        profileId: request.targetProfileId,
        settingsDigest: request.targetSettings.digest,
      },
      updatedAt: now,
      warnings: [],
    }),
  };
  return {
    source,
    principal,
    record,
    idempotencyKeyDigest: hashCanonicalValue(exportRunId("request")),
    binding: createSolutionExportRunInsertionBindingV1(submission),
  };
}

/** Only object bodies use memory. Admission claims, immutable lineage, job lifecycle,
 * snapshots, audits, foreign keys and every journal operation use real PostgreSQL. */
export async function persistedExportRunFixture(
  database: SqlDatabase,
  target: "terraform" | "cloudformation" = "terraform",
  source?: ReturnType<typeof workflowFixture>,
): Promise<
  ReturnType<typeof exportRunFixture> & {
    readonly database: SqlDatabase;
    readonly objects: InMemoryObjectStore;
    readonly scope: AuthorizedOrganizationScope;
    readonly membershipId: string;
    readonly prepared: PreparedSolutionExportRun;
    readonly selector: {
      readonly organizationId: string;
      readonly projectId: string;
      readonly jobId: string;
    };
    readonly createRoot: (
      expiresAt?: string,
      limits?: CreateJobCommandV1["limits"],
    ) => Promise<AsyncJobRecordV1>;
    readonly startRoot: () => Promise<AsyncJobRecordV1>;
    readonly cancelRoot: () => Promise<AsyncJobRecordV1>;
    readonly at: (seconds: number) => string;
    readonly checkpoint: (
      next: StoredSolutionExportJob,
    ) => Promise<PreparedSolutionExportRun>;
    readonly publish: (
      value: unknown,
      purpose: ObjectPurpose,
      objectId?: string,
    ) => Promise<StoredObjectReference>;
    readonly repository: PostgresSolutionExportRunRepository;
  }
> {
  const data = exportRunFixture(target, source);
  const { principal, record, binding } = data;
  const { organizationId } = record;
  const projectId = record.job.projectId;
  const membershipId = exportRunId("membership");
  const scope = {
    capabilities: permissionsForRole("owner"),
    correlationId: principal.correlationId,
    membershipId,
    organizationId,
    principalId: principal.principalId,
    roleKey: "owner",
    sessionId: principal.sessionId,
  };
  const objects = new InMemoryObjectStore();
  const references = new Map<string, StoredObjectReference>();
  await database.transaction(async (tx) => {
    await tx.query(
      sql(
        "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic export journal')",
        [principal.principalId],
      ),
    );
    await tx.query(
      sql(
        "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic export journal',$2)",
        [organizationId, exportRunId("slug").replaceAll("_", "-")],
      ),
    );
    await tx.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT $1,role,'authorization-v2',role='owner',cloudmarkup_authorization_v2_permissions(role) FROM unnest(ARRAY['owner','administrator','editor','viewer']) role",
        [organizationId],
      ),
    );
    await tx.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        [membershipId, organizationId, principal.principalId],
      ),
    );
    await tx.query(
      sql(
        "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic export journal',$3)",
        [projectId, organizationId, principal.principalId],
      ),
    );
  });
  async function publishBytes(
    body: Uint8Array,
    purpose: ObjectPurpose,
    objectId = exportRunId("object"),
  ) {
    const existing = references.get(objectId);
    if (existing !== undefined) {
      if (
        existing.contentSha256 !== exportRunSha(body) ||
        existing.purpose !== purpose
      )
        throw new Error("Synthetic object identity mismatch.");
      return existing;
    }
    const reference = await objects.stage(scope, {
      contentSha256: exportRunSha(body),
      mediaType: "application/json",
      objectId,
      open: async function* () {
        yield await Promise.resolve(body);
      },
      owner: { organizationId, projectId },
      purpose,
      sizeBytes: body.length,
    });
    await objects.publish(scope, reference);
    await database.query(
      sql(
        `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,published_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published',$12,CURRENT_TIMESTAMP)`,
        [
          reference.objectId,
          organizationId,
          projectId,
          reference.storageProvider,
          reference.purpose,
          reference.storageKey,
          reference.objectVersion,
          reference.entityTag ?? null,
          reference.contentSha256,
          reference.sizeBytes,
          reference.mediaType,
          principal.principalId,
        ],
      ),
    );
    references.set(objectId, reference);
    return reference;
  }
  async function publish(
    value: unknown,
    purpose: ObjectPurpose,
    objectId?: string,
  ) {
    return publishBytes(exportRunBytes(value), purpose, objectId);
  }
  const document = await publish(
    data.source.generationRequest.architectureDocument,
    "architecture-revision",
    record.workflowSubmission.request.sources.architectureDocument.objectId,
  );
  const draftId = exportRunId("draft");
  const revisionId = exportRunId("revision");
  await database.query(
    sql(
      `INSERT INTO architecture_drafts(draft_id,organization_id,project_id,draft_version,document_schema_version,document_object_id,content_sha256,semantic_sha256,visual_sha256,updated_by_principal_id)
    VALUES($1,$2,$3,1,3,$4,$5,$5,$5,$6)`,
      [
        draftId,
        organizationId,
        projectId,
        document.objectId,
        document.contentSha256,
        principal.principalId,
      ],
    ),
  );
  await database.query(
    sql(
      `INSERT INTO validation_runs(validation_run_id,organization_id,project_id,input_kind,draft_id,draft_version,environment,target,lifecycle_status,created_by_principal_id)
    VALUES($1,$2,$3,'draft',$4,1,'development','revision','succeeded',$5)`,
      [revisionId, organizationId, projectId, draftId, principal.principalId],
    ),
  );
  await database.query(
    sql(
      `INSERT INTO architecture_revisions(revision_id,organization_id,project_id,document_object_id,content_sha256,semantic_sha256,visual_sha256,graph_schema_version,workload_behavior_version,catalog_id,catalog_version,catalog_sha256,source_draft_id,source_draft_version,validation_run_id,created_by_principal_id,revision_name,revision_number,compiler_input_contract_version,minimum_compiler_version)
    VALUES($1,$2,$3,$4,$5,$5,$5,3,1,'catalog.synthetic','1.0.0',$5,$6,1,$1,$7,'Synthetic revision',1,1,'1.0.0')`,
      [
        revisionId,
        organizationId,
        projectId,
        document.objectId,
        document.contentSha256,
        draftId,
        principal.principalId,
      ],
    ),
  );
  const manifest = await publish(
    data.source.generationRequest.solutionRevision,
    "solution-revision-manifest",
    record.workflowSubmission.request.sources.solutionRevision.objectId,
  );
  await database.query(
    sql(
      `INSERT INTO solution_records(solution_record_id,organization_id,project_id,record_kind,subject_id,contract_version,content_object_id,content_sha256,architecture_revision_id,created_by_principal_id)
    VALUES($1,$2,$3,'solution-revision-manifest',$4,1,$5,$6,$7,$8)`,
      [
        record.job.solutionRevision.manifestRecordId,
        organizationId,
        projectId,
        record.job.solutionRevision.solutionRevisionId,
        manifest.objectId,
        manifest.contentSha256,
        revisionId,
        principal.principalId,
      ],
    ),
  );
  const orchestrationInput = await publish(
    binding.orchestrationInput,
    "input-payload",
    binding.orchestrationInputObjectId,
  );
  const workflowRequest = await publish(
    binding.workflowRequest,
    "input-payload",
    binding.workflowRequestObjectId,
  );
  const prepared: PreparedSolutionExportRun = {
    record,
    idempotencyKeyDigest: data.idempotencyKeyDigest,
    snapshot: await publish(record, "checkpoint-state"),
    workflowRequest,
    orchestrationInput,
  };
  const ownership = asyncJobTrustedOwnershipV1Schema.parse({
    organizationId,
    projectId,
  });
  const jobObjects: AsyncJobPersistenceObjectPort = {
    async put(input) {
      if (
        !exportRunEqual(input.ownership, ownership) ||
        input.digest !== `sha256:${exportRunSha(input.bytes)}`
      )
        throw new Error("Synthetic job object authority mismatch.");
      const reference = await publishBytes(
        input.bytes,
        input.kind === "input" ? "input-payload" : "report",
        input.kind === "input" ? binding.orchestrationInputObjectId : undefined,
      );
      return {
        objectId: reference.objectId,
        digest: input.digest,
        sizeBytes: reference.sizeBytes,
      };
    },
    async get(input) {
      const reference = references.get(input.objectId);
      if (
        !exportRunEqual(input.ownership, ownership) ||
        reference === undefined ||
        input.digest !== `sha256:${reference.contentSha256}` ||
        input.sizeBytes !== reference.sizeBytes
      )
        throw new Error("Synthetic job object authority mismatch.");
      const stream = await objects.open(scope, reference);
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      return new Uint8Array(Buffer.concat(chunks));
    },
  };
  const jobs = new PostgresAsyncJobRepository({
    database,
    objects: jobObjects,
    ownership,
  });
  const context = asyncJobTrustedContextV1Schema.parse({
    actor: { kind: "principal", actorId: principal.principalId },
    correlationId: principal.correlationId,
    ownership,
  });
  const at = (seconds: number) =>
    new Date(Date.parse(record.job.createdAt) + seconds * 1000).toISOString();
  let root: AsyncJobRecordV1 | undefined;
  async function createRoot(
    expiresAt = at(3600),
    limits?: CreateJobCommandV1["limits"],
  ) {
    const service = new JobService({
      repository: jobs,
      clock: { now: () => new Date(at(0)) },
      queue: new InMemoryFifoJobQueue(new SequentialJobIdGenerator()),
      audit: new InMemoryJobAuditPort(),
      ids: new SequentialJobIdGenerator(),
      entitlement: {
        evaluate: () =>
          Promise.resolve({
            allowed: true,
            decisionReference:
              record.workflowSubmission.entitlementDecisionReference,
          }),
      },
    });
    const result = await service.create(context, {
      ...solutionExportRootAdmissionCommand(record, data.idempotencyKeyDigest),
      expiresAt,
      ...(limits === undefined ? {} : { limits }),
    });
    if (result.kind !== "created")
      throw new Error("Synthetic root requires real new admission.");
    root = result.job;
    return root;
  }
  async function startRoot() {
    if (root === undefined) throw new Error("Create the genuine root first.");
    const result = applyAsyncJobLifecycleCommandV1(root, {
      at: at(2),
      expectedInputDigest: root.inputDigest,
      expectedRecordVersion: root.recordVersion,
      attemptId: asyncJobAttemptIdSchema.parse(exportRunId("attempt")),
      dependencies: [],
      handler: {
        family: root.family,
        handlerId: namespacedIdentifierSchema.parse(
          "cloudmarkup.integration.handler",
        ),
        handlerVersion: "1.0.0",
        resumePolicy: "restart-from-input",
      },
      kind: "claim",
      leaseExpiresAt: at(300),
      workerId: asyncJobWorkerIdSchema.parse("worker.integration"),
    });
    if (result.transition === undefined)
      throw new Error("A real root transition is required.");
    root = await jobs.saveWithAudit(result.job, root.recordVersion, [
      createJobAuditOutboxEntryV1({
        actor: {
          kind: "worker",
          workerId: asyncJobWorkerIdSchema.parse("worker.integration"),
        },
        eventType: "attempt-claimed",
        occurredAt: at(2),
        record: result.job,
        transition: result.transition,
      }),
    ]);
    return root;
  }
  async function cancelRoot() {
    if (root === undefined) throw new Error("Create the genuine root first.");
    const result = applyAsyncJobLifecycleCommandV1(root, {
      at: at(3),
      expectedInputDigest: root.inputDigest,
      expectedRecordVersion: root.recordVersion,
      context,
      kind: "request-cancellation",
    });
    if (result.transition === undefined)
      throw new Error("A real root transition is required.");
    root = await jobs.saveWithAudit(result.job, root.recordVersion, [
      createJobAuditOutboxEntryV1({
        actor: context.actor,
        eventType: "cancellation-requested",
        occurredAt: at(3),
        record: result.job,
        transition: result.transition,
      }),
    ]);
    return root;
  }
  async function checkpoint(
    next: StoredSolutionExportJob,
  ): Promise<PreparedSolutionExportRun> {
    return {
      ...prepared,
      record: next,
      snapshot: await publish(next, "checkpoint-state"),
    };
  }
  return {
    ...data,
    database,
    objects,
    scope,
    membershipId,
    prepared,
    selector: { organizationId, projectId, jobId: record.job.id },
    createRoot,
    startRoot,
    cancelRoot,
    at,
    checkpoint,
    publish,
    repository: new PostgresSolutionExportRunRepository({
      database,
      objectStore: objects,
      principal,
    }),
  };
}

export function sourceDraftExportRunFixture() {
  return exportRunFixture(
    "cloudformation",
    workflowFixture(
      "infrastructure-only",
      "cloudformation",
      "ai-source-draft-v1",
    ),
  );
}
