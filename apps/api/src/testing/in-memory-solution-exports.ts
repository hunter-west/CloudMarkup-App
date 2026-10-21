import { createHash } from "node:crypto";

import {
  solutionExportArtifactV1Schema,
  solutionExportDownloadGrantV1Schema,
  solutionExportJobV1Schema,
} from "@cloudmarkup/api-contract";
import { verifySolutionExportArtifact } from "@cloudmarkup/solution-export";
import type { SolutionExportWorkflowTargetSettingsV1 } from "@cloudmarkup/solution-export-workflow";
import { TEST_TARGET_SETTINGS } from "@cloudmarkup/solution-export-workflow/testing";

import {
  requireOrganizationPermission,
  type OrganizationRole,
} from "../application/authorization.js";
import { ApplicationError } from "../application/errors.js";
import { createSolutionExportRunInsertionBindingV1 } from "../application/solution-export-persistence-binding.js";
import type { PrincipalContext } from "../application/ports.js";
import {
  publicationCancellationAcknowledged,
  publicationIntegrityFailure,
  SolutionExportPublicationError,
  type ImmutableSolutionRevisionExportBinding,
  type SolutionExportAccessControl,
  type SolutionExportAuthorizedProject,
  type SolutionExportRepository,
  type SolutionExportRevisionRepository,
  type SolutionExportTargetPolicy,
  type SolutionExportWorkflowPort,
  type SolutionExportWorkflowEnqueueV1,
  type SolutionExportWorkflowResultStore,
  type StoredSolutionExportArtifact,
  type StoredSolutionExportDownloadGrant,
  type StoredSolutionExportJob,
} from "../application/solution-exports.js";

interface InMemoryMembership {
  readonly organizationId: string;
  readonly principalId: string;
  readonly role: OrganizationRole;
  readonly status: "active" | "suspended" | "deleted";
}

interface InMemoryProject {
  readonly organizationId: string;
  readonly projectId: string;
}

interface InMemoryEntitlement {
  readonly decisionReference: string;
  readonly enabled: boolean;
  readonly organizationId: string;
  readonly targetProfileId: string;
  readonly targetSettings?: SolutionExportWorkflowTargetSettingsV1;
}

interface InMemoryEnvironment {
  readonly environmentId: string;
  readonly environmentType: "development" | "test" | "staging" | "production";
  readonly projectId: string;
}

export interface InMemorySolutionExportSeed {
  readonly artifacts?: readonly StoredSolutionExportArtifact[];
  readonly downloadGrants?: readonly StoredSolutionExportDownloadGrant[];
  readonly entitlements: readonly InMemoryEntitlement[];
  readonly environments?: readonly InMemoryEnvironment[];
  readonly jobs?: readonly StoredSolutionExportJob[];
  readonly memberships: readonly InMemoryMembership[];
  readonly principals: readonly string[];
  readonly projects: readonly InMemoryProject[];
  readonly revisions: readonly ImmutableSolutionRevisionExportBinding[];
}

interface IdempotencyReservation {
  readonly fingerprint: string;
  readonly resultId: string;
}

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function notFound(): ApplicationError {
  return new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

export function createInMemoryApprovedTargetSettings(): SolutionExportWorkflowTargetSettingsV1 {
  return structuredClone(TEST_TARGET_SETTINGS);
}

function artifactRecordClone(
  record: StoredSolutionExportArtifact,
): StoredSolutionExportArtifact {
  return {
    ...record,
    artifact: clone(record.artifact),
    fileContents: new Map(
      [...record.fileContents].map(([id, bytes]) => [
        id,
        new Uint8Array(bytes),
      ]),
    ),
    verifiedArtifact: clone(record.verifiedArtifact),
    zipBytes: new Uint8Array(record.zipBytes),
    workflowPackage: clone(record.workflowPackage),
  };
}

export class InMemorySolutionExportStore
  implements
    SolutionExportAccessControl,
    SolutionExportRepository,
    SolutionExportRevisionRepository,
    SolutionExportTargetPolicy,
    SolutionExportWorkflowResultStore
{
  readonly #artifacts = new Map<string, StoredSolutionExportArtifact>();
  readonly #cancellationIdempotency = new Map<string, IdempotencyReservation>();
  readonly #downloadGrantIdempotency = new Map<
    string,
    IdempotencyReservation
  >();
  readonly #downloadGrants = new Map<
    string,
    StoredSolutionExportDownloadGrant
  >();
  readonly #entitlements: readonly InMemoryEntitlement[];
  readonly #environments: readonly InMemoryEnvironment[];
  readonly #jobFingerprints = new Map<string, string>();
  readonly #jobIdempotency = new Map<string, IdempotencyReservation>();
  readonly #jobs = new Map<string, StoredSolutionExportJob>();
  readonly #memberships: readonly InMemoryMembership[];
  readonly #principals: ReadonlySet<string>;
  readonly #projects = new Map<string, InMemoryProject>();
  readonly #revisions = new Map<
    string,
    ImmutableSolutionRevisionExportBinding
  >();
  #failNextSaveJob = false;

  constructor(seed: InMemorySolutionExportSeed) {
    this.#principals = new Set(seed.principals);
    this.#memberships = clone(seed.memberships);
    this.#entitlements = clone(seed.entitlements);
    this.#environments = clone(seed.environments ?? []);
    for (const project of seed.projects) {
      this.#projects.set(project.projectId, clone(project));
    }
    for (const revision of seed.revisions) {
      this.#revisions.set(
        `${revision.organizationId}:${revision.projectId}:${revision.solutionRevisionId}`,
        clone(revision),
      );
    }
    for (const job of seed.jobs ?? []) {
      const parsed: StoredSolutionExportJob = {
        ...clone(job),
        job: solutionExportJobV1Schema.parse(clone(job.job)),
      };
      this.#jobs.set(parsed.job.id, parsed);
      this.#jobFingerprints.set(
        `${parsed.organizationId}:${parsed.job.projectId}:${parsed.primaryInputDigest}`,
        parsed.job.id,
      );
    }
    for (const artifact of seed.artifacts ?? []) {
      const parsed = artifactRecordClone({
        ...artifact,
        artifact: solutionExportArtifactV1Schema.parse(artifact.artifact),
      });
      this.#artifacts.set(parsed.artifact.id, parsed);
    }
    for (const grant of seed.downloadGrants ?? []) {
      const parsed = {
        ...clone(grant),
        grant: solutionExportDownloadGrantV1Schema.parse(clone(grant.grant)),
      };
      this.#downloadGrants.set(parsed.grant.id, parsed);
    }
  }

  authorizeProject(
    principal: PrincipalContext,
    projectId: string,
    permission: Parameters<typeof requireOrganizationPermission>[1],
  ): Promise<SolutionExportAuthorizedProject> {
    if (!this.#principals.has(principal.principalId)) {
      throw new ApplicationError(
        "authentication_required",
        "Authentication is required.",
      );
    }
    const project = this.#projects.get(projectId);
    if (project === undefined) {
      throw notFound();
    }
    const membership = this.#memberships.find(
      (candidate) =>
        candidate.organizationId === project.organizationId &&
        candidate.principalId === principal.principalId &&
        candidate.status === "active",
    );
    if (membership === undefined) {
      throw notFound();
    }
    requireOrganizationPermission(membership.role, permission);
    return Promise.resolve(clone(project));
  }

  getImmutableBinding(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly solutionRevisionId: string;
  }): Promise<ImmutableSolutionRevisionExportBinding | null> {
    const value = this.#revisions.get(
      `${input.organizationId}:${input.projectId}:${input.solutionRevisionId}`,
    );
    return Promise.resolve(value === undefined ? null : clone(value));
  }

  evaluate(input: Parameters<SolutionExportTargetPolicy["evaluate"]>[0]) {
    if (input.environment.environmentId !== undefined) {
      const approved = this.#environments.find(
        (environment) =>
          environment.environmentId === input.environment.environmentId &&
          environment.projectId === input.binding.projectId &&
          environment.environmentType === input.environment.environmentType,
      );
      if (approved === undefined) {
        throw new ApplicationError(
          "invalid_request",
          "The selected environment is not approved for this project.",
        );
      }
    }
    const entitlement = this.#entitlements.find(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.targetProfileId === input.targetProfileId,
    );
    if (entitlement?.enabled !== true) {
      throw new ApplicationError(
        "access_denied",
        "This export profile is not available for the current account.",
      );
    }
    return Promise.resolve({
      entitlementDecisionReference: entitlement.decisionReference,
      targetSettings:
        entitlement.targetSettings ?? createInMemoryApprovedTargetSettings(),
    });
  }

  #hasSucceededOwner(record: StoredSolutionExportArtifact): boolean {
    const owner = this.#jobs.get(record.artifact.jobId);
    const reference = owner?.job.artifact;
    return (
      owner !== undefined &&
      reference !== undefined &&
      owner.organizationId === record.organizationId &&
      owner.job.projectId === record.artifact.projectId &&
      owner.job.state === "succeeded" &&
      reference.artifactId === record.artifact.id &&
      reference.digest === record.artifact.digest &&
      reference.manifestDigest === record.artifact.manifestDigest &&
      reference.fileCount === record.artifact.fileCount &&
      reference.sizeBytes === record.artifact.sizeBytes &&
      sameJson(
        reference.downloadAvailability,
        record.artifact.downloadAvailability,
      ) &&
      owner.job.solutionRevision.solutionRevisionId ===
        record.artifact.solutionRevisionId &&
      owner.job.previousArtifactId === record.artifact.previousArtifactId &&
      sameJson(owner.job.target.environment, record.targetEnvironment) &&
      owner.job.target.profileId === record.targetProfileId &&
      owner.job.target.settingsDigest === record.targetSettingsDigest &&
      record.workflowPackage.artifactId === record.artifact.id &&
      record.workflowPackage.object.digest === record.artifact.digest &&
      record.workflowPackage.object.sizeBytes === record.artifact.sizeBytes
    );
  }

  findLatestArtifact(input: {
    readonly environment: StoredSolutionExportArtifact["targetEnvironment"];
    readonly organizationId: string;
    readonly projectId: string;
    readonly targetProfileId: string;
    readonly targetSettingsDigest: StoredSolutionExportArtifact["targetSettingsDigest"];
  }): Promise<StoredSolutionExportArtifact | null> {
    const candidates = [...this.#artifacts.values()]
      .filter(
        (record) =>
          this.#hasSucceededOwner(record) &&
          record.organizationId === input.organizationId &&
          record.artifact.projectId === input.projectId &&
          record.targetEnvironment.environmentType ===
            input.environment.environmentType &&
          record.targetEnvironment.environmentId ===
            input.environment.environmentId &&
          record.targetProfileId === input.targetProfileId &&
          record.targetSettingsDigest === input.targetSettingsDigest,
      )
      .sort((left, right) => {
        const time = right.artifact.createdAt.localeCompare(
          left.artifact.createdAt,
        );
        return time === 0
          ? right.artifact.id.localeCompare(left.artifact.id)
          : time;
      });
    return Promise.resolve(
      candidates[0] === undefined ? null : artifactRecordClone(candidates[0]),
    );
  }

  getJob(input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredSolutionExportJob | null> {
    const record = this.#jobs.get(input.jobId);
    if (
      record?.organizationId !== input.organizationId ||
      record.job.projectId !== input.projectId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(clone(record));
  }

  reserveCancellation(input: {
    readonly idempotencyKeyDigest: `sha256:${string}`;
    readonly job: StoredSolutionExportJob;
    readonly principalId: string;
  }): Promise<void> {
    const scope = `${input.job.organizationId}:${input.principalId}:solution-export-jobs.cancel:${input.idempotencyKeyDigest}`;
    const fingerprint = input.job.job.id;
    const reservation = this.#cancellationIdempotency.get(scope);
    if (reservation !== undefined) {
      if (reservation.fingerprint !== fingerprint) {
        throw new ApplicationError(
          "idempotency_key_reused",
          "The Idempotency-Key was already used for a different request.",
        );
      }
      return Promise.resolve();
    }
    this.#cancellationIdempotency.set(scope, {
      fingerprint,
      resultId: input.job.job.id,
    });
    return Promise.resolve();
  }

  #canReusePrimaryJob(
    record: StoredSolutionExportJob,
    nextCreatedAt: string,
  ): boolean {
    if (
      ["queued", "running", "cancellation-requested"].includes(record.job.state)
    ) {
      return true;
    }
    if (record.job.state !== "succeeded" || record.job.artifact === undefined) {
      return false;
    }
    const artifact = this.#artifacts.get(record.job.artifact.artifactId);
    const availability = artifact?.artifact.downloadAvailability;
    return (
      artifact !== undefined &&
      this.#hasSucceededOwner(artifact) &&
      availability?.state === "available" &&
      Date.parse(availability.expiresAt) > Date.parse(nextCreatedAt)
    );
  }

  #versionedRecord(
    candidate: StoredSolutionExportJob,
    preceding: StoredSolutionExportJob,
  ): StoredSolutionExportJob {
    const runSequence = preceding.job.runSequence + 1;
    const jobId = `${candidate.job.id}_r${String(runSequence)}`;
    return {
      ...clone(candidate),
      job: solutionExportJobV1Schema.parse({
        ...candidate.job,
        id: jobId,
        rerunOfJobId: preceding.job.id,
        runSequence,
      }),
      workflowSubmission: {
        ...clone(candidate.workflowSubmission),
        jobId,
      },
    };
  }

  reserveJob(input: {
    readonly idempotencyKeyDigest: `sha256:${string}`;
    readonly record: StoredSolutionExportJob;
  }): Promise<{
    readonly created: boolean;
    readonly record: StoredSolutionExportJob;
  }> {
    const idempotencyScope = `${input.record.organizationId}:${input.record.createdByPrincipalId}:solution-export-jobs.create:${input.idempotencyKeyDigest}`;
    const existingReservation = this.#jobIdempotency.get(idempotencyScope);
    if (existingReservation !== undefined) {
      if (
        existingReservation.fingerprint !== input.record.requestIntentDigest
      ) {
        throw new ApplicationError(
          "idempotency_key_reused",
          "The Idempotency-Key was already used for a different request.",
        );
      }
      const existing = this.#jobs.get(existingReservation.resultId);
      if (existing === undefined) {
        throw new Error("In-memory idempotency record is corrupt.");
      }
      return Promise.resolve({ created: false, record: clone(existing) });
    }

    const fingerprintScope = `${input.record.organizationId}:${input.record.job.projectId}:${input.record.primaryInputDigest}`;
    const duplicateId = this.#jobFingerprints.get(fingerprintScope);
    let candidate = input.record;
    if (duplicateId !== undefined) {
      const duplicate = this.#jobs.get(duplicateId);
      if (duplicate === undefined) {
        throw new Error("In-memory fingerprint record is corrupt.");
      }
      if (this.#canReusePrimaryJob(duplicate, input.record.job.createdAt)) {
        this.#jobIdempotency.set(idempotencyScope, {
          fingerprint: input.record.requestIntentDigest,
          resultId: duplicateId,
        });
        return Promise.resolve({ created: false, record: clone(duplicate) });
      }
      candidate = this.#versionedRecord(input.record, duplicate);
    }

    const idCollision = this.#jobs.get(candidate.job.id);
    if (
      idCollision !== undefined &&
      idCollision.primaryInputDigest !== candidate.primaryInputDigest
    ) {
      throw new ApplicationError(
        "conflict",
        "A deterministic export identifier collision was detected.",
      );
    }
    const parsed = {
      ...clone(candidate),
      job: solutionExportJobV1Schema.parse(clone(candidate.job)),
    };
    this.#jobs.set(parsed.job.id, parsed);
    this.#jobFingerprints.set(fingerprintScope, parsed.job.id);
    this.#jobIdempotency.set(idempotencyScope, {
      fingerprint: parsed.requestIntentDigest,
      resultId: parsed.job.id,
    });
    return Promise.resolve({ created: true, record: clone(parsed) });
  }

  async compareAndSaveJob(input: {
    readonly expected: {
      readonly state: StoredSolutionExportJob["job"]["state"];
      readonly updatedAt: string;
    };
    readonly record: StoredSolutionExportJob;
  }): Promise<boolean> {
    const current = this.#jobs.get(input.record.job.id);
    if (
      current?.job.state !== input.expected.state ||
      current.job.updatedAt !== input.expected.updatedAt
    ) {
      return false;
    }
    await this.saveJob(input.record);
    return true;
  }

  saveJob(record: StoredSolutionExportJob): Promise<void> {
    if (this.#failNextSaveJob) {
      this.#failNextSaveJob = false;
      return Promise.reject(
        new Error("Injected solution export job persistence failure."),
      );
    }
    const current = this.#jobs.get(record.job.id);
    if (current === undefined) {
      throw notFound();
    }
    const immutableCurrent = {
      createdAt: current.job.createdAt,
      primaryInputDigest: current.primaryInputDigest,
      id: current.job.id,
      organizationId: current.organizationId,
      rerunOfJobId: current.job.rerunOfJobId,
      runSequence: current.job.runSequence,
      previousArtifactId: current.job.previousArtifactId,
      projectId: current.job.projectId,
      requestDigest: current.job.requestDigest,
      requestIntentDigest: current.requestIntentDigest,
      solutionRevision: current.job.solutionRevision,
      target: current.job.target,
    };
    const immutableNext = {
      createdAt: record.job.createdAt,
      primaryInputDigest: record.primaryInputDigest,
      id: record.job.id,
      organizationId: record.organizationId,
      rerunOfJobId: record.job.rerunOfJobId,
      runSequence: record.job.runSequence,
      previousArtifactId: record.job.previousArtifactId,
      projectId: record.job.projectId,
      requestDigest: record.job.requestDigest,
      requestIntentDigest: record.requestIntentDigest,
      solutionRevision: record.job.solutionRevision,
      target: record.job.target,
    };
    if (!sameJson(immutableCurrent, immutableNext)) {
      throw new ApplicationError(
        "conflict",
        "The immutable export binding cannot change.",
      );
    }
    const allowedTransitions: Readonly<
      Record<
        StoredSolutionExportJob["job"]["state"],
        readonly StoredSolutionExportJob["job"]["state"][]
      >
    > = {
      canceled: ["canceled"],
      "cancellation-requested": ["cancellation-requested", "canceled"],
      failed: ["failed"],
      queued: [
        "queued",
        "running",
        "cancellation-requested",
        "succeeded",
        "failed",
        "canceled",
      ],
      running: [
        "running",
        "cancellation-requested",
        "succeeded",
        "failed",
        "canceled",
      ],
      succeeded: ["succeeded"],
    };
    if (
      !allowedTransitions[current.job.state].includes(record.job.state) ||
      Date.parse(record.job.updatedAt) < Date.parse(current.job.updatedAt) ||
      (current.job.cancellation.state === "requested" &&
        record.job.cancellation.state === "none") ||
      (current.job.cancellation.requestedAt !== undefined &&
        record.job.cancellation.requestedAt !==
          current.job.cancellation.requestedAt)
    ) {
      throw new ApplicationError(
        "conflict",
        "The export job state cannot regress or discard cancellation authority.",
      );
    }
    if (["succeeded", "failed", "canceled"].includes(current.job.state)) {
      if (!sameJson(current, record)) {
        throw new ApplicationError(
          "conflict",
          "A terminal export job is immutable.",
        );
      }
      return Promise.resolve();
    }
    this.#jobs.set(record.job.id, {
      ...clone(record),
      job: solutionExportJobV1Schema.parse(clone(record.job)),
    });
    return Promise.resolve();
  }

  getArtifact(input: {
    readonly artifactId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredSolutionExportArtifact | null> {
    const record = this.#artifacts.get(input.artifactId);
    if (
      record?.organizationId !== input.organizationId ||
      record.artifact.projectId !== input.projectId ||
      !this.#hasSucceededOwner(record)
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(artifactRecordClone(record));
  }

  async publishArtifact(input: {
    readonly artifact: StoredSolutionExportArtifact;
    readonly job: StoredSolutionExportJob;
  }): Promise<void> {
    const current = this.#jobs.get(input.job.job.id);
    if (current === undefined) {
      throw notFound();
    }
    if (current.job.state === "cancellation-requested") {
      throw new SolutionExportPublicationError("canceled");
    }
    if (
      input.job.job.state !== "succeeded" ||
      input.job.job.artifact?.artifactId !== input.artifact.artifact.id ||
      input.artifact.artifact.jobId !== input.job.job.id ||
      input.artifact.artifact.projectId !== input.job.job.projectId ||
      input.artifact.artifact.solutionRevisionId !==
        input.job.job.solutionRevision.solutionRevisionId ||
      input.artifact.organizationId !== input.job.organizationId ||
      !sameJson(
        input.artifact.targetEnvironment,
        input.job.job.target.environment,
      ) ||
      input.artifact.targetProfileId !== input.job.job.target.profileId ||
      input.artifact.targetSettingsDigest !==
        input.job.job.target.settingsDigest ||
      input.artifact.artifact.previousArtifactId !==
        input.job.job.previousArtifactId
    ) {
      throw new SolutionExportPublicationError("permanent");
    }
    const verifiedArtifact = input.artifact.verifiedArtifact;
    const request = input.job.workflowSubmission.request;
    const verifiedByPath = new Map(
      verifiedArtifact.files.map((file) => [file.path, file] as const),
    );
    const publicInventoryValid =
      verifiedArtifact.files.length === input.artifact.artifact.files.length &&
      input.artifact.artifact.files.every((file) => {
        const verifiedFile = verifiedByPath.get(file.path);
        if (
          verifiedFile?.checksum !== file.checksum ||
          verifiedFile.mediaType !== file.mediaType ||
          verifiedFile.ownership !== file.ownership ||
          verifiedFile.semanticChecksum !== file.semanticChecksum ||
          verifiedFile.bytes.byteLength !== file.sizeBytes
        ) {
          return false;
        }
        if (!file.previewAvailable) {
          return true;
        }
        const previewBytes = input.artifact.fileContents.get(file.id);
        return (
          previewBytes !== undefined &&
          sameBytes(previewBytes, verifiedFile.bytes)
        );
      });
    let verificationPassed = false;
    try {
      verificationPassed =
        verifySolutionExportArtifact(verifiedArtifact).length === 0;
    } catch {
      verificationPassed = false;
    }
    const manifestBindingValid =
      verifiedArtifact.manifest.solutionRevision.id ===
        input.job.job.solutionRevision.solutionRevisionId &&
      verifiedArtifact.manifest.solutionRevision.digest ===
        input.job.job.solutionRevision.manifestDigest &&
      verifiedArtifact.manifest.generationCoverage.revision
        .solutionRevisionId ===
        input.job.job.solutionRevision.solutionRevisionId &&
      sameJson(
        verifiedArtifact.manifest.generationCoverage.revision,
        input.job.job.generationCoverage,
      ) &&
      verifiedArtifact.manifest.package.displayName === request.exportName &&
      sameJson(
        verifiedArtifact.manifest.limits,
        request.targetSettings.limits,
      ) &&
      sameJson(
        verifiedArtifact.manifest.tools.policyPacks,
        request.targetSettings.policyPacks,
      ) &&
      sameJson(
        verifiedArtifact.manifest.tools.renderer,
        request.targetSettings.renderer,
      );
    const archiveBytes = input.artifact.zipBytes;
    const workflowPackage = input.artifact.workflowPackage;
    if (
      !verificationPassed ||
      !manifestBindingValid ||
      !publicInventoryValid ||
      verifiedArtifact.archiveFileName !==
        input.artifact.artifact.archiveFileName ||
      verifiedArtifact.manifestDigest !==
        input.artifact.artifact.manifestDigest ||
      verifiedArtifact.zipDigest !== input.artifact.artifact.digest ||
      verifiedArtifact.zipBytes.byteLength !==
        input.artifact.artifact.sizeBytes ||
      !sameBytes(verifiedArtifact.zipBytes, archiveBytes) ||
      archiveBytes.byteLength !== input.artifact.artifact.sizeBytes ||
      solutionExportBytesDigest(archiveBytes) !==
        input.artifact.artifact.digest ||
      workflowPackage.artifactId !== input.artifact.artifact.id ||
      workflowPackage.availability.state !== "available" ||
      workflowPackage.object.digest !== input.artifact.artifact.digest ||
      workflowPackage.object.mediaType !== "application/zip" ||
      workflowPackage.object.sizeBytes !== input.artifact.artifact.sizeBytes ||
      workflowPackage.object.purpose !== "export-package"
    ) {
      throw new SolutionExportPublicationError("permanent");
    }
    let parsedArtifact: StoredSolutionExportArtifact;
    try {
      parsedArtifact = artifactRecordClone({
        ...input.artifact,
        artifact: solutionExportArtifactV1Schema.parse(input.artifact.artifact),
      });
    } catch {
      throw new SolutionExportPublicationError("permanent");
    }
    await this.saveJob(input.job);
    this.#artifacts.set(parsedArtifact.artifact.id, parsedArtifact);
  }

  async publishFailure(job: StoredSolutionExportJob): Promise<void> {
    if (job.job.state !== "failed" && job.job.state !== "canceled") {
      throw new ApplicationError(
        "conflict",
        "A workflow failure result must be terminal.",
      );
    }
    const current = this.#jobs.get(job.job.id);
    if (current === undefined) {
      throw notFound();
    }
    if (
      current.job.state === "cancellation-requested" &&
      job.job.state === "failed"
    ) {
      await this.saveJob(
        publicationCancellationAcknowledged({
          ...job,
          job: { ...job.job, cancellation: current.job.cancellation },
        }),
      );
      return;
    }
    await this.saveJob(job);
  }

  reserveDownloadGrant(input: {
    readonly artifact: StoredSolutionExportArtifact;
    readonly grant: StoredSolutionExportDownloadGrant;
    readonly idempotencyKeyDigest: `sha256:${string}`;
  }): Promise<StoredSolutionExportDownloadGrant> {
    const scope = `${input.grant.organizationId}:${input.grant.principalId}:solution-export-download-grants.create:${input.idempotencyKeyDigest}`;
    const fingerprint = input.grant.artifactId;
    const reservation = this.#downloadGrantIdempotency.get(scope);
    if (reservation !== undefined) {
      if (reservation.fingerprint !== fingerprint) {
        throw new ApplicationError(
          "idempotency_key_reused",
          "The Idempotency-Key was already used for a different request.",
        );
      }
      const existing = this.#downloadGrants.get(reservation.resultId);
      if (existing === undefined) {
        throw new Error("In-memory download reservation is corrupt.");
      }
      return Promise.resolve(clone(existing));
    }
    const collision = this.#downloadGrants.get(input.grant.grant.id);
    if (
      collision !== undefined &&
      (collision.artifactId !== input.grant.artifactId ||
        collision.principalId !== input.grant.principalId)
    ) {
      throw new ApplicationError(
        "conflict",
        "A deterministic download-grant identifier collision was detected.",
      );
    }
    const parsed = {
      ...clone(input.grant),
      grant: solutionExportDownloadGrantV1Schema.parse(input.grant.grant),
    };
    this.#downloadGrants.set(parsed.grant.id, parsed);
    this.#downloadGrantIdempotency.set(scope, {
      fingerprint,
      resultId: parsed.grant.id,
    });
    return Promise.resolve(clone(parsed));
  }

  getDownloadGrant(input: {
    readonly artifactId: string;
    readonly grantId: string;
    readonly organizationId: string;
    readonly principalId: string;
    readonly projectId: string;
  }): Promise<StoredSolutionExportDownloadGrant | null> {
    const grant = this.#downloadGrants.get(input.grantId);
    if (
      grant?.artifactId !== input.artifactId ||
      grant.organizationId !== input.organizationId ||
      grant.principalId !== input.principalId ||
      grant.projectId !== input.projectId
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(clone(grant));
  }

  corruptArtifactOwnerForTest(artifactId: string): void {
    const artifact = this.#artifacts.get(artifactId);
    const owner =
      artifact === undefined
        ? undefined
        : this.#jobs.get(artifact.artifact.jobId);
    if (owner === undefined) {
      throw new Error("Cannot corrupt a missing artifact owner.");
    }
    this.#jobs.set(owner.job.id, {
      ...clone(owner),
      job: {
        ...clone(owner.job),
        artifact: undefined,
        state: "failed",
      },
    });
  }

  corruptArchiveForTest(artifactId: string, bytes: Uint8Array): void {
    const record = this.#artifacts.get(artifactId);
    if (record === undefined) {
      throw new Error("Cannot corrupt a missing test artifact.");
    }
    this.#artifacts.set(artifactId, {
      ...artifactRecordClone(record),
      zipBytes: new Uint8Array(bytes),
    });
  }

  corruptDownloadGrantDigestForTest(
    grantId: string,
    digest: `sha256:${string}`,
  ): void {
    const record = this.#downloadGrants.get(grantId);
    if (record === undefined) {
      throw new Error("Cannot corrupt a missing test grant.");
    }
    this.#downloadGrants.set(grantId, {
      ...clone(record),
      grant: { ...record.grant, digest },
    });
  }

  failNextSaveJobForTest(): void {
    this.#failNextSaveJob = true;
  }

  storedCounts(): { readonly artifacts: number; readonly jobs: number } {
    return {
      artifacts: this.#artifacts.size,
      jobs: this.#jobs.size,
    };
  }
}

export type InMemorySolutionExportProcessor = (
  request: SolutionExportWorkflowEnqueueV1,
) =>
  | Promise<
      | {
          readonly artifact: StoredSolutionExportArtifact;
          readonly job: StoredSolutionExportJob;
          readonly state: "succeeded";
        }
      | { readonly job: StoredSolutionExportJob; readonly state: "failed" }
    >
  | {
      readonly artifact: StoredSolutionExportArtifact;
      readonly job: StoredSolutionExportJob;
      readonly state: "succeeded";
    }
  | { readonly job: StoredSolutionExportJob; readonly state: "failed" };

/** Deterministic local worker adapter used without cloud credentials/network. */
export class InMemorySolutionExportWorkflow implements SolutionExportWorkflowPort {
  readonly #cancellations = new Set<string>();
  #failNextCancellation = false;
  #failNextEnqueue = false;
  readonly #enqueuedJobIds = new Set<string>();
  readonly #processor: InMemorySolutionExportProcessor;
  readonly #queue: SolutionExportWorkflowEnqueueV1[] = [];
  readonly #results: SolutionExportWorkflowResultStore;

  constructor(input: {
    readonly processor: InMemorySolutionExportProcessor;
    readonly results: SolutionExportWorkflowResultStore;
  }) {
    this.#processor = input.processor;
    this.#results = input.results;
  }

  ensureEnqueued(request: SolutionExportWorkflowEnqueueV1): Promise<void> {
    createSolutionExportRunInsertionBindingV1(request);
    if (this.#failNextEnqueue) {
      this.#failNextEnqueue = false;
      return Promise.reject(new Error("Injected enqueue delivery failure."));
    }
    if (this.#enqueuedJobIds.has(request.jobId)) {
      return Promise.resolve();
    }
    this.#enqueuedJobIds.add(request.jobId);
    this.#queue.push(clone(request));
    return Promise.resolve();
  }

  requestCancellation(input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly requestedByPrincipalId: string;
  }): Promise<void> {
    if (this.#failNextCancellation) {
      this.#failNextCancellation = false;
      return Promise.reject(
        new Error("Injected cancellation delivery failure."),
      );
    }
    void input.organizationId;
    void input.projectId;
    void input.requestedByPrincipalId;
    this.#cancellations.add(input.jobId);
    return Promise.resolve();
  }

  async runNext(): Promise<boolean> {
    const request = this.#queue.shift();
    if (request === undefined) {
      return false;
    }
    try {
      const result = await this.#processor(clone(request));
      if (result.state === "succeeded") {
        try {
          await this.#results.publishArtifact({
            artifact: result.artifact,
            job: result.job,
          });
        } catch (error) {
          if (
            error instanceof SolutionExportPublicationError &&
            error.classification === "canceled"
          ) {
            await this.#results.publishFailure(
              publicationCancellationAcknowledged(result.job),
            );
            return true;
          }
          if (
            !(error instanceof SolutionExportPublicationError) ||
            error.classification !== "permanent"
          ) {
            throw error;
          }
          await this.#results.publishFailure(
            publicationIntegrityFailure(result.job),
          );
        }
      } else {
        await this.#results.publishFailure(result.job);
      }
    } catch (error) {
      this.#queue.unshift(request);
      throw error;
    }
    return true;
  }

  failNextEnqueueForTest(): void {
    this.#failNextEnqueue = true;
  }

  failNextCancellationForTest(): void {
    this.#failNextCancellation = true;
  }

  isCancellationRequested(jobId: string): boolean {
    return this.#cancellations.has(jobId);
  }

  queuedRequests(): readonly SolutionExportWorkflowEnqueueV1[] {
    return clone(this.#queue);
  }
}

export function solutionExportBytesDigest(
  bytes: Uint8Array,
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
