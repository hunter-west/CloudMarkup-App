import type { SolutionExportArtifactV1 } from "@cloudmarkup/solution-export";
import type { GitLabRepositoryAdapter } from "../adapters/gitlab-repository.js";
import { ApplicationError } from "./errors.js";
import {
  prepareGitLabArtifactReview,
  verifyGitLabArtifactCommitStructure,
  verifyGitLabArtifactFileBatch,
  type GitLabArtifactReview,
  type GitLabExportedFile,
} from "./gitlab-artifact-review.js";
import {
  gitLabExportApprovalDigest,
  gitLabExportDescriptorSchema,
  gitLabExportRecordSchema,
  type GitLabExportDescriptor,
  type GitLabExportRecord,
} from "./gitlab-export-state.js";

export interface GitLabExportReviewStore {
  create(descriptor: GitLabExportDescriptor): Promise<GitLabExportRecord>;
  get(reviewId: string): Promise<GitLabExportRecord>;
  claimCommit(
    id: string,
    version: number,
    digest: string,
    acknowledgedAutomation: boolean,
  ): Promise<GitLabExportRecord>;
  beginVerification(
    id: string,
    version: number,
    digest: string,
    commitSha: string,
  ): Promise<GitLabExportRecord>;
  recordVerifiedFiles(
    id: string,
    version: number,
    digest: string,
    verifiedFiles: number,
  ): Promise<GitLabExportRecord>;
  claimMergeRequest(
    id: string,
    version: number,
    digest: string,
  ): Promise<GitLabExportRecord>;
  complete(
    id: string,
    version: number,
    digest: string,
    mergeRequest: NonNullable<GitLabExportRecord["mergeRequest"]>,
  ): Promise<GitLabExportRecord>;
}
export type GitLabExportRepository = Pick<
  GitLabRepositoryAdapter,
  | "readProject"
  | "readBranch"
  | "readCommit"
  | "readTree"
  | "readFile"
  | "createExportCommit"
  | "createMergeRequest"
  | "findMergeRequest"
>;
export interface GitLabExportDestination {
  readonly connectionId: string;
  readonly providerProjectId: number;
  readonly selectionVersion: number;
  readonly artifactId: string;
  readonly destinationFolder: string;
}
export interface GitLabExportWorkflowDependencies {
  /** Verified request identity; never constructed from request body ownership fields. */
  readonly scope: Pick<
    GitLabExportDescriptor,
    "organizationId" | "projectId" | "principalId" | "applicationId"
  >;
  readonly store: GitLabExportReviewStore;
  readonly newReviewId: () => string;
  /** Current session, canonical project, role, selected version and evaluated commercial policy. */
  readonly assertAuthorized: (
    destination: GitLabExportDestination,
  ) => Promise<void>;
  readonly readArtifact: (
    artifactId: string,
  ) => Promise<SolutionExportArtifactV1>;
  readonly assertArtifactAvailable: (
    artifactId: string,
    zipDigest: string,
  ) => Promise<void>;
  /** Must call admission before and after each provider request and bound the entire step's deadline. */
  readonly withRepository: <T>(
    connectionId: string,
    admission: () => Promise<void>,
    work: (repository: GitLabExportRepository) => Promise<T>,
  ) => Promise<T>;
}
function changed(): never {
  throw new ApplicationError(
    "conflict",
    "The reviewed GitLab export changed. Reload its status or create a new review.",
  );
}
function denied(): never {
  throw new ApplicationError(
    "access_denied",
    "The selected GitLab project is not currently eligible for export.",
  );
}

/** Request-scoped workflow. Each advance performs at most one claimed external write; uncertain dispatches can only be read back. */
export class GitLabReviewedExportWorkflow {
  readonly #ports: GitLabExportWorkflowDependencies;
  constructor(ports: GitLabExportWorkflowDependencies) {
    this.#ports = Object.freeze({
      ...ports,
      scope: Object.freeze({ ...ports.scope }),
    });
  }
  #record(input: GitLabExportRecord): GitLabExportRecord {
    const record = gitLabExportRecordSchema.parse(input);
    const descriptor = record.descriptor;
    if (
      Object.entries(this.#ports.scope).some(
        ([key, value]) =>
          descriptor[key as keyof GitLabExportDescriptor] !== value,
      ) ||
      gitLabExportApprovalDigest(descriptor) !== record.approvalDigest
    )
      changed();
    return record;
  }
  async #admit(
    destination: GitLabExportDestination,
    artifact: SolutionExportArtifactV1,
  ): Promise<void> {
    await this.#ports.assertAuthorized(destination);
    await this.#ports.assertArtifactAvailable(
      destination.artifactId,
      artifact.zipDigest,
    );
  }
  async #project(repository: GitLabExportRepository, projectId: number) {
    const project = await repository.readProject(projectId);
    if (
      project.projectId !== projectId ||
      project.archived ||
      project.empty ||
      project.accessLevel < 30 ||
      project.defaultBranch === null
    )
      denied();
    return project;
  }
  async preview(input: GitLabExportDestination): Promise<{
    readonly record: GitLabExportRecord;
    readonly files: GitLabArtifactReview["files"];
  }> {
    const destination: GitLabExportDestination = {
      connectionId: input.connectionId,
      providerProjectId: input.providerProjectId,
      selectionVersion: input.selectionVersion,
      artifactId: input.artifactId,
      destinationFolder: input.destinationFolder,
    };
    await this.#ports.assertAuthorized(destination);
    const artifact = await this.#ports.readArtifact(destination.artifactId);
    const admission = () => this.#admit(destination, artifact);
    await admission();
    return this.#ports.withRepository(
      destination.connectionId,
      admission,
      async (repository) => {
        const project = await this.#project(
          repository,
          destination.providerProjectId,
        );
        const baseBranch = project.defaultBranch;
        if (baseBranch === null) denied();
        const base = await repository.readBranch(
          destination.providerProjectId,
          baseBranch,
        );
        if (!base) changed();
        const reviewId = this.#ports.newReviewId();
        const branch =
          "cloudmarkup/export-" + reviewId.slice("gitlabreview_".length);
        const candidate = prepareGitLabArtifactReview({
          artifact,
          baseTree: await repository.readTree(
            destination.providerProjectId,
            base.sha,
          ),
          baseCommitSha: base.sha,
          branch,
          destinationFolder: destination.destinationFolder,
        });
        const descriptor = gitLabExportDescriptorSchema.parse({
          schemaVersion: 1,
          ...this.#ports.scope,
          ...destination,
          reviewId,
          branch,
          baseBranch,
          baseCommitSha: base.sha,
          artifactManifestDigest: artifact.manifestDigest,
          artifactZipDigest: artifact.zipDigest,
          artifactReviewDigest: candidate.review.reviewDigest,
          expectedTreeSha: candidate.review.expectedTreeSha,
          fileCount: candidate.review.files.length,
        });
        await admission();
        return {
          record: this.#record(await this.#ports.store.create(descriptor)),
          files: candidate.review.files,
        };
      },
    );
  }
  async get(reviewId: string): Promise<GitLabExportRecord> {
    // The store independently verifies current tenant, project and session read authority, even after expiry/disconnect.
    const record = this.#record(await this.#ports.store.get(reviewId));
    if (record.descriptor.reviewId !== reviewId) changed();
    return record;
  }
  async advance(input: {
    readonly reviewId: string;
    readonly expectedVersion: number;
    readonly approvalDigest: string;
    readonly acknowledgedAutomation?: boolean;
  }): Promise<GitLabExportRecord> {
    const current = await this.get(input.reviewId);
    if (
      current.recordVersion !== input.expectedVersion ||
      current.approvalDigest !== input.approvalDigest
    )
      changed();
    if (current.state === "succeeded") return current;
    if (
      (current.state === "prepared" || current.state === "verified") &&
      current.expired
    )
      changed();
    if (current.state === "prepared" && input.acknowledgedAutomation !== true)
      throw new ApplicationError(
        "invalid_request",
        "Acknowledge possible repository automation before approving this export.",
      );
    const destination = current.descriptor;
    await this.#ports.assertAuthorized(destination);
    const artifact = await this.#ports.readArtifact(destination.artifactId);
    if (
      artifact.manifestDigest !== destination.artifactManifestDigest ||
      artifact.zipDigest !== destination.artifactZipDigest
    )
      changed();
    let dispatchVersion: number | undefined;
    const admission = async () => {
      await this.#admit(destination, artifact);
      if (dispatchVersion !== undefined) {
        const latest = await this.get(destination.reviewId);
        if (latest.expired || latest.recordVersion !== dispatchVersion)
          changed();
      }
    };
    await admission();
    const update = async (operation: Promise<GitLabExportRecord>) =>
      this.#record(await operation);
    const argumentsForUpdate = [
      destination.reviewId,
      current.recordVersion,
      current.approvalDigest,
    ] as const;
    return this.#ports.withRepository(
      destination.connectionId,
      admission,
      async (repository) => {
        const project = await this.#project(
          repository,
          destination.providerProjectId,
        );
        if (current.state === "merge-request-dispatched") {
          if (current.commitSha === null) changed();
          const receipt = await repository.findMergeRequest({
            projectId: destination.providerProjectId,
            branch: destination.branch,
            baseBranch: destination.baseBranch,
            expectedHeadSha: current.commitSha,
          });
          await admission();
          return receipt === null
            ? current
            : update(
                this.#ports.store.complete(...argumentsForUpdate, receipt),
              );
        }
        const candidate = prepareGitLabArtifactReview({
          artifact,
          baseTree: await repository.readTree(
            destination.providerProjectId,
            destination.baseCommitSha,
          ),
          baseCommitSha: destination.baseCommitSha,
          branch: destination.branch,
          destinationFolder: destination.destinationFolder,
        });
        if (
          candidate.review.reviewDigest !== destination.artifactReviewDigest ||
          candidate.review.expectedTreeSha !== destination.expectedTreeSha ||
          candidate.review.files.length !== destination.fileCount
        )
          changed();
        const requireUnchangedBase = async () => {
          if (project.defaultBranch !== destination.baseBranch) changed();
          const base = await repository.readBranch(
            destination.providerProjectId,
            destination.baseBranch,
          );
          if (base?.sha !== destination.baseCommitSha) changed();
        };
        if (current.state === "prepared") {
          await requireUnchangedBase();
          await admission();
          const claimed = this.#record(
            await this.#ports.store.claimCommit(...argumentsForUpdate, true),
          );
          dispatchVersion = claimed.recordVersion;
          // Even a known rejection leaves a dispatched record. No caller can replay this POST.
          await repository.createExportCommit({
            projectId: destination.providerProjectId,
            baseSha: destination.baseCommitSha,
            branch: destination.branch,
            changes: candidate.changes,
          });
          return claimed;
        }
        const head = await repository.readBranch(
          destination.providerProjectId,
          destination.branch,
        );
        if (head === null && current.state === "commit-dispatched")
          return current;
        if (
          head === null ||
          head.protected ||
          (current.commitSha !== null && current.commitSha !== head.sha)
        )
          changed();
        if (current.state === "verifying") {
          const approvedFiles = candidate.review.files.slice(
            current.verifiedFiles,
            current.verifiedFiles + 16,
          );
          const files: GitLabExportedFile[] = [];
          // Drain each bounded wave before leaving the token scope, including failures.
          for (let offset = 0; offset < approvedFiles.length; offset += 4) {
            const wave = await Promise.allSettled(
              approvedFiles.slice(offset, offset + 4).map(async (file) => ({
                path: file.path,
                ...(await repository.readFile({
                  projectId: destination.providerProjectId,
                  commitSha: head.sha,
                  path: file.path,
                  expectedBlobSha: file.blobSha,
                })),
              })),
            );
            for (const result of wave) {
              if (result.status === "rejected") throw result.reason;
              files.push(result.value);
            }
          }
          verifyGitLabArtifactFileBatch({
            review: candidate.review,
            offset: current.verifiedFiles,
            files,
          });
          const after = await repository.readBranch(
            destination.providerProjectId,
            destination.branch,
          );
          if (after?.sha !== head.sha || after.protected) changed();
          await admission();
          return update(
            this.#ports.store.recordVerifiedFiles(
              ...argumentsForUpdate,
              current.verifiedFiles + files.length,
            ),
          );
        }
        const results = await Promise.allSettled([
          repository.readCommit(destination.providerProjectId, head.sha),
          repository.readTree(destination.providerProjectId, head.sha),
        ]);
        const commit = results[0],
          tree = results[1];
        if (commit.status === "rejected") throw commit.reason;
        if (tree.status === "rejected") throw tree.reason;
        verifyGitLabArtifactCommitStructure({
          review: candidate.review,
          commit: commit.value,
          tree: tree.value,
          branchHeadSha: head.sha,
        });
        const after = await repository.readBranch(
          destination.providerProjectId,
          destination.branch,
        );
        if (after?.sha !== head.sha || after.protected) changed();
        await admission();
        if (current.state === "commit-dispatched")
          return update(
            this.#ports.store.beginVerification(
              ...argumentsForUpdate,
              head.sha,
            ),
          );
        if (current.state !== "verified") changed();
        await requireUnchangedBase();
        const claimed = this.#record(
          await this.#ports.store.claimMergeRequest(...argumentsForUpdate),
        );
        dispatchVersion = claimed.recordVersion;
        await repository.createMergeRequest({
          projectId: destination.providerProjectId,
          branch: destination.branch,
          baseBranch: destination.baseBranch,
          expectedHeadSha: head.sha,
        });
        return claimed;
      },
    );
  }
}
