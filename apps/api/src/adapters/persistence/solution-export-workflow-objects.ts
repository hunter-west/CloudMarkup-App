import { cloudFormationValidationResultV1Schema } from "@cloudmarkup/solution-export-workflow";
import { applicationBuildResultV1Schema } from "@cloudmarkup/application-build-runner";
import {
  asyncJobEvidenceReferenceV1Schema,
  evidenceRecordV1Schema,
  type AsyncJobEvidenceReferenceV1,
} from "@cloudmarkup/schemas";
import { verifySolutionExportArtifact } from "@cloudmarkup/solution-export/retained-artifact";
import {
  solutionExportApplicationBuildBatchResultV1Schema,
  solutionExportWorkflowCheckpointV1Schema,
  solutionExportWorkflowPersistedOutputV1Schema,
  solutionExportWorkflowReadModelV1Schema,
  solutionExportWorkflowStageReportV1Schema,
  type SolutionExportWorkflowObjectPort,
  type SolutionExportWorkflowRequestV1,
  type SolutionExportWorkflowTrustedScopeV1,
} from "@cloudmarkup/solution-export-workflow/contracts";
import { terraformValidationResultV1Schema } from "@cloudmarkup/terraform-validation-runner";
import type { StoredSolutionExportJob } from "../../application/solution-exports.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import {
  exportRunBytes,
  exportRunEqual,
  exportRunSha,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import {
  SolutionExportWorkflowStorage,
  exportJobObject,
} from "./solution-export-workflow-storage.js";
import {
  parseSolutionExportTerminalReceipt,
  type SolutionExportTerminalReceipt,
} from "./solution-export-terminal-codec.js";
import type { SolutionExportExecutionIdentity } from "./solution-export-worker-authority.js";
import type { SolutionRecordRepository } from "../../application/solution-record-persistence.js";
import { sql } from "./sql.js";

/** One instance belongs to one leased attempt; no mutable process-global receipt authority. */
export class SolutionExportWorkflowObjects implements SolutionExportWorkflowObjectPort {
  readonly #evidence = new Map<string, AsyncJobEvidenceReferenceV1>();
  #retained: SolutionExportTerminalReceipt["retained"];
  readonly storage: SolutionExportWorkflowStorage;
  readonly execution: SolutionExportExecutionIdentity;
  readonly prepared: StoredSolutionExportJob;
  readonly evidenceRecords: SolutionRecordRepository;
  readonly #terminalStorage: SolutionExportWorkflowStorage;
  constructor(
    storage: SolutionExportWorkflowStorage,
    execution: SolutionExportExecutionIdentity,
    prepared: StoredSolutionExportJob,
    evidenceRecords: SolutionRecordRepository,
    terminalStorage: SolutionExportWorkflowStorage = storage,
  ) {
    this.storage = storage;
    this.execution = structuredClone(execution);
    this.prepared = structuredClone(prepared);
    this.evidenceRecords = evidenceRecords;
    this.#terminalStorage = terminalStorage;
  }
  #scope(scope: SolutionExportWorkflowTrustedScopeV1): void {
    if (
      scope.jobId !== this.execution.jobId ||
      !exportRunEqual(scope.ownership, this.storage.authority.ownership)
    )
      exportRunUnavailable();
  }
  #identity(kind: string, value: unknown): string {
    return this.storage.identity(kind, {
      jobId: this.execution.jobId,
      attemptId: this.execution.attemptId,
      value,
    });
  }
  async load(
    input: Parameters<SolutionExportWorkflowObjectPort["load"]>[0],
  ): Promise<Uint8Array> {
    this.#scope(input.scope);
    const reference = structuredClone(input.reference);
    const request = this.prepared.workflowSubmission.request;
    const expected = Object.entries(request.sources).find(
      ([, entry]) => entry?.objectId === reference.objectId,
    );
    const metadata = await this.storage.metadata(reference.objectId);
    const workflowRequest = exportRunBytes(request);
    const isRequest =
      reference.objectId ===
        createSolutionExportRunInsertionBindingV1(
          this.prepared.workflowSubmission,
        ).workflowRequestObjectId &&
      metadata?.reference.contentSha256 === exportRunSha(workflowRequest) &&
      reference.digest === `sha256:${exportRunSha(workflowRequest)}`;
    const previous = request.previousPackage?.object;
    const isPrevious =
      previous !== undefined && exportRunEqual(reference, previous);
    if (
      metadata?.state !== "published" ||
      reference.expiresAt !== undefined ||
      metadata.reference.contentSha256 !== reference.digest.slice(7) ||
      metadata.reference.sizeBytes !== reference.sizeBytes ||
      metadata.reference.mediaType !== reference.mediaType ||
      (!isRequest &&
        !isPrevious &&
        (expected === undefined || !exportRunEqual(expected[1], reference)))
    )
      exportRunUnavailable();
    const purpose = isRequest
      ? "input-payload"
      : isPrevious
        ? "export-package"
        : expected?.[0] === "architectureDocument"
          ? "architecture-revision"
          : expected?.[0] === "solutionRevision"
            ? "solution-revision-manifest"
            : "input-payload";
    if (metadata.reference.purpose !== purpose) exportRunUnavailable();
    return this.storage.read(metadata.reference);
  }
  async persistStageReport(
    input: Parameters<
      SolutionExportWorkflowObjectPort["persistStageReport"]
    >[0],
  ) {
    this.#scope(input.scope);
    const build = input.stage === "build-application";
    const targetSettings =
      this.prepared.workflowSubmission.request.targetSettings;
    let projection: unknown;
    let expectedEvidence: unknown;
    if (build) {
      const batch = solutionExportApplicationBuildBatchResultV1Schema.safeParse(
        input.report,
      );
      const parsed = batch.success
        ? batch.data
        : applicationBuildResultV1Schema.parse(input.report);
      const { reportDigest, ...body } = parsed;
      if (reportDigest !== input.digest) exportRunUnavailable();
      projection = body;
      expectedEvidence = batch.success
        ? batch.data.results.map((result) => result.evidence)
        : [
            (parsed as ReturnType<typeof applicationBuildResultV1Schema.parse>)
              .evidence,
          ];
    } else if (targetSettings.target === "cloudformation") {
      const parsed = cloudFormationValidationResultV1Schema.parse(input.report);
      if (
        parsed.reportDigest !== input.digest ||
        !exportRunEqual(
          parsed.validation.validator,
          targetSettings.stageDescriptors.cloudFormationValidation.adapter,
        )
      )
        exportRunUnavailable();
      projection = {
        diagnostics: parsed.diagnostics,
        target: parsed.target,
        validation: parsed.validation,
      };
      expectedEvidence = parsed.evidenceRecords;
    } else {
      const parsed = terraformValidationResultV1Schema.parse(input.report);
      if (parsed.reportDigest !== input.digest) exportRunUnavailable();
      projection = {
        commandSummaries: parsed.commandSummaries,
        diagnostics: parsed.diagnostics,
      };
      expectedEvidence = parsed.evidenceRecords;
    }
    if (
      `sha256:${exportRunSha(exportRunBytes(projection))}` !== input.digest ||
      !exportRunEqual(expectedEvidence, input.evidenceRecords)
    )
      exportRunUnavailable();
    const report = await this.storage.put(
      exportRunBytes(projection),
      build ? "build-output" : "validation-report",
      "application/json",
    );
    const references: AsyncJobEvidenceReferenceV1[] = [];
    for (const raw of input.evidenceRecords) {
      const record = evidenceRecordV1Schema.parse(raw);
      if (
        record.solutionRevisionId !==
          this.prepared.job.solutionRevision.solutionRevisionId ||
        !exportRunEqual(
          record.environment,
          this.prepared.job.target.environment,
        )
      )
        exportRunUnavailable();
      const object = await this.storage.put(
        exportRunBytes(record),
        "evidence",
        "application/json",
      );
      const recordId = this.storage.identity("canonical-evidence-record", {
        id: record.id,
        digest: object.contentSha256,
      });
      const exists = async () => {
        const found = await this.storage.authority.query(
          sql(
            `SELECT solution_record_id FROM solution_records
          WHERE organization_id=$1 AND project_id=$2 AND record_kind='evidence' AND subject_id=$3
            AND content_object_id=$4 AND content_sha256=$5 AND contract_version=1`,
            [
              this.execution.organizationId,
              this.execution.projectId,
              record.id,
              object.objectId,
              object.contentSha256,
            ],
          ),
        );
        if (found.rows.length > 1) exportRunUnavailable();
        return found.rows.length === 1;
      };
      if (!(await exists())) {
        try {
          await this.evidenceRecords.create(
            await this.storage.authority.scope(),
            {
              solutionRecordId: recordId,
              projectId: this.execution.projectId,
              recordKind: "evidence",
              subjectId: record.id,
              contractVersion: 1,
              contentSha256: object.contentSha256,
              idempotencyKey: recordId,
              requestSha256: exportRunSha(
                exportRunBytes({
                  recordId,
                  objectId: object.objectId,
                  digest: object.contentSha256,
                }),
              ),
            },
            object,
          );
        } catch (error) {
          if (!(await exists())) throw error;
        }
      }
      const reference = asyncJobEvidenceReferenceV1Schema.parse({
        environment: record.environment,
        evidenceId: record.id,
        solutionRevisionId: record.solutionRevisionId,
        record: exportJobObject(object),
      });
      const old = this.#evidence.get(record.id);
      if (old !== undefined && !exportRunEqual(old, reference))
        exportRunUnavailable();
      this.#evidence.set(record.id, reference);
      references.push(reference);
    }
    return solutionExportWorkflowStageReportV1Schema.parse({
      stage: input.stage,
      evidenceRecords: references,
      artifact: {
        artifactId: this.#identity("stage-artifact", {
          stage: input.stage,
          digest: input.digest,
        }),
        digest: input.digest,
        kind: build
          ? "application-build-report"
          : this.prepared.workflowSubmission.request.targetSettings.target ===
              "cloudformation"
            ? "cloudformation-validation-report"
            : "terraform-validation-report",
        mediaType: "application/json",
        object: exportJobObject(report),
        sizeBytes: report.sizeBytes,
      },
    });
  }
  async persistVerifiedOutput(
    input: Parameters<
      SolutionExportWorkflowObjectPort["persistVerifiedOutput"]
    >[0],
  ) {
    this.#scope(input.scope);
    const artifact = structuredClone(input.artifact);
    this.#request(input.request);
    if (
      verifySolutionExportArtifact(artifact).some(
        (diagnostic) => diagnostic.severity === "error",
      ) ||
      artifact.manifest.solutionRevision.id !==
        input.request.subject.solutionRevisionId ||
      artifact.manifest.solutionRevision.digest !==
        input.request.subject.manifestDigest ||
      input.diff.currentDigest !== artifact.zipDigest
    )
      exportRunUnavailable();
    const manifest = await this.storage.put(
      exportRunBytes(artifact.manifest),
      "artifact-manifest",
      "application/json",
    );
    const archive = await this.storage.put(
      artifact.zipBytes,
      "export-package",
      "application/zip",
    );
    const artifactId = `solutionartifact_${exportRunSha(
      exportRunBytes({
        organizationId: this.execution.organizationId,
        projectId: this.execution.projectId,
        jobId: this.execution.jobId,
        digest: artifact.zipDigest,
      }),
    ).slice(0, 48)}`;
    const object = exportJobObject(archive);
    this.#retained = {
      manifestObjectId: manifest.objectId,
      archiveObject: object,
      archiveFileName: artifact.archiveFileName,
      fileCount: artifact.files.length,
    };
    return solutionExportWorkflowPersistedOutputV1Schema.parse({
      contractVersion: 1,
      diff: input.diff,
      evidenceRecords: [...this.#evidence.values()].sort((left, right) =>
        left.evidenceId < right.evidenceId
          ? -1
          : left.evidenceId > right.evidenceId
            ? 1
            : 0,
      ),
      artifact: {
        archiveFileName: artifact.archiveFileName,
        artifactId,
        digest: artifact.zipDigest,
        kind: "export-package",
        manifestDigest: artifact.manifestDigest,
        mediaType: "application/zip",
        object,
        sizeBytes: archive.sizeBytes,
      },
      verifiedPackage: {
        artifactId,
        availability: { state: "available" },
        object,
      },
    });
  }
  #request(request: SolutionExportWorkflowRequestV1): void {
    if (!exportRunEqual(request, this.prepared.workflowSubmission.request))
      exportRunUnavailable();
  }
  async saveCheckpoint(
    input: Parameters<SolutionExportWorkflowObjectPort["saveCheckpoint"]>[0],
  ) {
    this.#scope(input.scope);
    const checkpoint = solutionExportWorkflowCheckpointV1Schema.parse(
      input.checkpoint,
    );
    const object = await this.storage.put(
      exportRunBytes(checkpoint),
      "checkpoint-state",
      "application/json",
    );
    return exportJobObject(object);
  }
  async saveReadModel(
    input: Parameters<SolutionExportWorkflowObjectPort["saveReadModel"]>[0],
  ): Promise<void> {
    this.#scope(input.scope);
    const model = solutionExportWorkflowReadModelV1Schema.parse(
      input.readModel,
    );
    if (
      model.jobId !== this.execution.jobId ||
      model.requestDigest !== this.prepared.workflowSubmission.requestDigest
    )
      exportRunUnavailable();
    await this.storage.put(
      exportRunBytes(model),
      "checkpoint-state",
      "application/json",
    );
  }
  async retainTerminal(
    result: SolutionExportTerminalReceipt["result"],
  ): Promise<SolutionExportTerminalReceipt> {
    const receipt = parseSolutionExportTerminalReceipt({
      contractVersion: 1,
      kind: "cloudmarkup.solution-export-terminal-receipt",
      execution: this.execution,
      prepared: this.prepared,
      result,
      ...(this.#retained === undefined ? {} : { retained: this.#retained }),
    });
    await this.#terminalStorage.put(
      exportRunBytes(receipt),
      "report",
      "application/json",
      this.#identity("terminal-receipt", null),
    );
    return receipt;
  }
}
