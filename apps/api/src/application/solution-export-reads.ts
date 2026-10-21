import {
  solutionExportArtifactDiffV1Schema,
  solutionExportDownloadGrantV1Schema,
  solutionExportFilePreviewV1Schema,
  solutionExportJobV1Schema,
  type SolutionExportArtifactDiffV1,
  type SolutionExportArtifactV1,
  type SolutionExportDownloadGrantV1,
  type SolutionExportFilePreviewV1,
  type SolutionExportJobV1,
} from "@cloudmarkup/api-contract";
import type { OrganizationPermission } from "./authorization.js";
import { ApplicationError } from "./errors.js";
import type { PrincipalContext } from "./ports.js";
import type {
  SolutionExportAccessControl,
  SolutionExportApplication,
  SolutionExportDownloadPayload,
  SolutionExportRepository,
  StoredSolutionExportArtifact,
  StoredSolutionExportJob,
} from "./solution-exports.js";
import {
  artifactAt,
  byteDigest,
  canonicalJson,
  compareCodeUnits,
  digest,
  expiredAvailability,
  fileSnapshot,
  notFound,
  previewUtf8,
  publicId,
} from "./solution-export-read-projections.js";

export type SolutionExportReadApplication = Pick<
  SolutionExportApplication,
  | "getJob"
  | "getArtifact"
  | "getFilePreview"
  | "getArtifactDiff"
  | "createDownloadGrant"
  | "download"
>;
export type SolutionExportReadRepository = Pick<
  SolutionExportRepository,
  "getJob" | "getArtifact" | "getDownloadGrant" | "reserveDownloadGrant"
>;
const DOWNLOAD_GRANT_TTL_MS = 5 * 60 * 1_000;

/** Existing authorized reads, independent of job admission, mutation and queue ports. */
export class DefaultSolutionExportReadApplication implements SolutionExportReadApplication {
  readonly #access: SolutionExportAccessControl;
  readonly #clock: () => Date;
  readonly #repository: SolutionExportReadRepository;
  readonly #maximumDownloadBytes: number | undefined;
  constructor(input: {
    readonly access: SolutionExportAccessControl;
    readonly clock?: () => Date;
    readonly repository: SolutionExportReadRepository;
    /** Optional host transport ceiling; never changes retained artifact validity. */
    readonly maximumDownloadBytes?: number;
  }) {
    this.#access = input.access;
    this.#clock = input.clock ?? (() => new Date());
    this.#repository = input.repository;
    if (
      input.maximumDownloadBytes !== undefined &&
      (!Number.isSafeInteger(input.maximumDownloadBytes) ||
        input.maximumDownloadBytes < 1)
    ) {
      throw new TypeError("Invalid export download transport limit.");
    }
    this.#maximumDownloadBytes = input.maximumDownloadBytes;
  }

  #assertDownloadTransport(artifact: StoredSolutionExportArtifact): void {
    if (
      this.#maximumDownloadBytes !== undefined &&
      (artifact.artifact.sizeBytes > this.#maximumDownloadBytes ||
        artifact.zipBytes.byteLength > this.#maximumDownloadBytes)
    ) {
      throw new ApplicationError(
        "service_unavailable",
        "This archive requires streaming, which is not yet available. You can still review its files and metadata; creating a new download link will not resolve this limit.",
        {
          fieldIssues: [
            {
              code: "solution-export.download-streaming-required.v1",
              path: ["artifact", "download"],
              message:
                "This archive requires the unavailable streaming download transport; new download links cannot resolve this limit.",
            },
          ],
        },
      );
    }
  }

  async getJob(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
  ): Promise<SolutionExportJobV1> {
    const record = await this.authorizedJob(
      principal,
      projectId,
      jobId,
      "artifacts.read",
    );
    return this.jobAt(record);
  }

  async getArtifact(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<SolutionExportArtifactV1> {
    const record = await this.#authorizedArtifact(
      principal,
      projectId,
      artifactId,
    );
    return artifactAt(record, this.#clock());
  }

  async getFilePreview(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    fileId: string,
  ): Promise<SolutionExportFilePreviewV1> {
    const record = await this.#authorizedArtifact(
      principal,
      projectId,
      artifactId,
    );
    const file = record.artifact.files.find(({ id }) => id === fileId);
    const bytes = record.fileContents.get(fileId);
    if (file === undefined || bytes === undefined || !file.previewAvailable) {
      throw notFound();
    }
    if (
      bytes.byteLength !== file.sizeBytes ||
      byteDigest(bytes) !== file.checksum
    ) {
      throw notFound();
    }
    const preview = previewUtf8(bytes);
    return solutionExportFilePreviewV1Schema.parse({
      artifactId,
      checksum: file.checksum,
      content: preview.content,
      contractVersion: 1,
      fileId,
      mediaType: file.mediaType,
      path: file.path,
      sizeBytes: file.sizeBytes,
      truncated: preview.truncated,
    });
  }

  async getArtifactDiff(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<SolutionExportArtifactDiffV1> {
    const current = await this.#authorizedArtifact(
      principal,
      projectId,
      artifactId,
    );
    const previousId = current.artifact.previousArtifactId;
    if (previousId === undefined) {
      return solutionExportArtifactDiffV1Schema.parse({
        artifactId,
        contractVersion: 1,
        files: [],
        state: "unavailable",
      });
    }
    const previous = await this.#repository.getArtifact({
      artifactId: previousId,
      organizationId: current.organizationId,
      projectId,
    });
    if (previous === null) {
      return solutionExportArtifactDiffV1Schema.parse({
        artifactId,
        contractVersion: 1,
        files: [],
        state: "unavailable",
      });
    }
    const before = new Map(
      previous.artifact.files.map((file) => [file.path, file]),
    );
    const after = new Map(
      current.artifact.files.map((file) => [file.path, file]),
    );
    const paths = [...new Set([...before.keys(), ...after.keys()])].sort(
      compareCodeUnits,
    );
    const files = paths.map((path) => {
      const left = before.get(path);
      const right = after.get(path);
      if (left === undefined && right !== undefined) {
        return {
          after: fileSnapshot(right),
          change: "added" as const,
          path,
          semanticChange: "added" as const,
        };
      }
      if (left !== undefined && right === undefined) {
        return {
          before: fileSnapshot(left),
          change: "removed" as const,
          path,
          semanticChange: "removed" as const,
        };
      }
      if (left === undefined || right === undefined) {
        throw new Error("Unreachable diff state.");
      }
      const beforeSnapshot = fileSnapshot(left);
      const afterSnapshot = fileSnapshot(right);
      const changed =
        canonicalJson(beforeSnapshot) !== canonicalJson(afterSnapshot);
      const metadataMatches =
        left.mediaType === right.mediaType &&
        left.ownership === right.ownership;
      const formattingOnly =
        left.checksum !== right.checksum &&
        left.semanticChecksum === right.semanticChecksum &&
        metadataMatches;
      return {
        after: afterSnapshot,
        before: beforeSnapshot,
        change: changed ? ("modified" as const) : ("unchanged" as const),
        path,
        semanticChange: !changed
          ? ("unchanged" as const)
          : formattingOnly
            ? ("formatting-only" as const)
            : ("changed" as const),
      };
    });
    return solutionExportArtifactDiffV1Schema.parse({
      artifactId,
      contractVersion: 1,
      files,
      previousArtifactId: previousId,
      state: "available",
    });
  }

  async createDownloadGrant(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    idempotencyKey: string,
  ): Promise<SolutionExportDownloadGrantV1> {
    const artifact = await this.#authorizedArtifact(
      principal,
      projectId,
      artifactId,
    );
    const publicArtifact = artifactAt(artifact, this.#clock());
    if (publicArtifact.downloadAvailability.state !== "available") {
      throw new ApplicationError(
        "access_denied",
        "This artifact is not available for download.",
      );
    }
    const idempotencyKeyDigest = digest(idempotencyKey);
    this.#assertDownloadTransport(artifact);
    const fingerprint = digest({
      artifactId,
      idempotencyKeyDigest,
      principalId: principal.principalId,
      projectId,
    });
    const grantId = publicId("downloadgrant", fingerprint);
    const expiresAt = new Date(
      Math.min(
        this.#clock().getTime() + DOWNLOAD_GRANT_TTL_MS,
        Date.parse(publicArtifact.downloadAvailability.expiresAt),
      ),
    ).toISOString();
    const grant = solutionExportDownloadGrantV1Schema.parse({
      artifactId,
      contractVersion: 1,
      digest: publicArtifact.digest,
      expiresAt,
      fileName: publicArtifact.archiveFileName,
      id: grantId,
      mediaType: "application/zip",
      sizeBytes: publicArtifact.sizeBytes,
      url: `/v1/projects/${projectId}/solution-export-artifacts/${artifactId}/download-grants/${grantId}/content`,
    });
    const reserved = await this.#repository.reserveDownloadGrant({
      artifact,
      grant: {
        artifactId,
        grant,
        organizationId: artifact.organizationId,
        principalId: principal.principalId,
        projectId,
      },
      idempotencyKeyDigest,
    });
    return reserved.grant;
  }

  async download(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
    grantId: string,
  ): Promise<SolutionExportDownloadPayload> {
    const artifact = await this.#authorizedArtifact(
      principal,
      projectId,
      artifactId,
    );
    const publicArtifact = artifactAt(artifact, this.#clock());
    if (publicArtifact.downloadAvailability.state !== "available") {
      throw notFound();
    }
    this.#assertDownloadTransport(artifact);
    const grant = await this.#repository.getDownloadGrant({
      artifactId,
      grantId,
      organizationId: artifact.organizationId,
      principalId: principal.principalId,
      projectId,
    });
    if (
      grant === null ||
      grant.revokedAt !== undefined ||
      Date.parse(grant.grant.expiresAt) <= this.#clock().getTime()
    ) {
      throw notFound();
    }
    const bytes = new Uint8Array(artifact.zipBytes);
    const workflowPackage = artifact.workflowPackage;
    if (
      grant.grant.artifactId !== publicArtifact.id ||
      grant.grant.digest !== publicArtifact.digest ||
      grant.grant.fileName !== publicArtifact.archiveFileName ||
      grant.grant.sizeBytes !== publicArtifact.sizeBytes ||
      workflowPackage.artifactId !== publicArtifact.id ||
      workflowPackage.availability.state !== "available" ||
      workflowPackage.object.digest !== publicArtifact.digest ||
      workflowPackage.object.mediaType !== "application/zip" ||
      workflowPackage.object.sizeBytes !== publicArtifact.sizeBytes ||
      bytes.byteLength !== publicArtifact.sizeBytes ||
      byteDigest(bytes) !== publicArtifact.digest
    ) {
      throw notFound();
    }
    return {
      bytes,
      digest: publicArtifact.digest,
      fileName: publicArtifact.archiveFileName,
      mediaType: "application/zip",
    };
  }

  protected async authorizedJob(
    principal: PrincipalContext,
    projectId: string,
    jobId: string,
    permission: OrganizationPermission,
  ): Promise<StoredSolutionExportJob> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      permission,
    );
    const record = await this.#repository.getJob({
      jobId,
      organizationId: authorized.organizationId,
      projectId,
    });
    if (record === null) {
      throw notFound();
    }
    return record;
  }

  async #authorizedArtifact(
    principal: PrincipalContext,
    projectId: string,
    artifactId: string,
  ): Promise<StoredSolutionExportArtifact> {
    const authorized = await this.#access.authorizeProject(
      principal,
      projectId,
      "artifacts.read",
    );
    const record = await this.#repository.getArtifact({
      artifactId,
      organizationId: authorized.organizationId,
      projectId,
    });
    if (record === null) {
      throw notFound();
    }
    const job = await this.#repository.getJob({
      jobId: record.artifact.jobId,
      organizationId: authorized.organizationId,
      projectId,
    });
    if (
      job?.job.state !== "succeeded" ||
      job.job.artifact?.artifactId !== record.artifact.id ||
      job.job.artifact.digest !== record.artifact.digest ||
      job.job.artifact.manifestDigest !== record.artifact.manifestDigest
    ) {
      throw notFound();
    }
    return record;
  }

  protected jobAt(record: StoredSolutionExportJob): SolutionExportJobV1 {
    const artifactReference = record.job.artifact;
    if (artifactReference === undefined) {
      return record.job;
    }
    return solutionExportJobV1Schema.parse({
      ...record.job,
      artifact: {
        ...artifactReference,
        downloadAvailability: expiredAvailability(
          artifactReference.downloadAvailability,
          this.#clock(),
        ),
      },
    });
  }
}
