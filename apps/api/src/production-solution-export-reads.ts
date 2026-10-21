import type { ObjectStore } from "./application/persistence.js";
import type { PrincipalContext } from "./application/ports.js";
import { ApplicationError } from "./application/errors.js";
import type { ProductionIdentityApplication } from "./application/production-identity-application.js";
import {
  DefaultSolutionExportReadApplication,
  type SolutionExportReadApplication,
  type SolutionExportReadRepository,
} from "./application/solution-export-reads.js";
import { PostgresSolutionExportDownloadRepository } from "./adapters/persistence/solution-export-download-repository.js";
import { PostgresSolutionExportRunRepository } from "./adapters/persistence/solution-export-run-repository.js";
import { SolutionExportRequestAuthority } from "./adapters/persistence/solution-export-authority.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import type { StoredSolutionExportDownloadGrant } from "./application/solution-exports.js";

/** Leaves room for base64 and the REST-v1 envelope within Lambda's 6 MiB response. */
export { BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES } from "./solution-export-limits.js";
import { BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES } from "./solution-export-limits.js";

/** Real request-bound reads only. Does not admit, enqueue, execute or cancel exports. */
export function createProductionSolutionExportReads(options: {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
  readonly identity: Pick<
    ProductionIdentityApplication,
    "organizationForProject"
  >;
  readonly clock?: () => Date;
}): SolutionExportReadApplication {
  const clock = options.clock ?? (() => new Date());
  async function read<T>(
    suppliedPrincipal: PrincipalContext,
    projectId: string,
    work: (
      application: SolutionExportReadApplication,
      principal: PrincipalContext,
    ) => Promise<T>,
    requiresRetainedContent = false,
  ): Promise<T> {
    // The tenant is resolved from the verified actor; every subsequent SQL/object
    // boundary rechecks exact current membership, role, lifecycle and expiry.
    const principal = Object.freeze(structuredClone(suppliedPrincipal));
    try {
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
        "artifacts.read",
        clock,
      );
      await authority.scope();
      const downloads = new PostgresSolutionExportDownloadRepository(
        options.database,
        options.objectStore,
        principal,
        ownership,
      );
      const runs = new PostgresSolutionExportRunRepository({
        database: options.database,
        objectStore: options.objectStore,
        principal,
        clock,
      });
      const expiries: number[] = [];
      let verifiedGrant: StoredSolutionExportDownloadGrant | undefined;
      function retainExpiry(expiresAt: string): void {
        const value = Date.parse(expiresAt);
        if (!Number.isFinite(value))
          throw new ApplicationError(
            "service_unavailable",
            "The retained solution export is temporarily unavailable.",
          );
        expiries.push(value);
      }
      const repository: SolutionExportReadRepository = {
        getArtifact: async (input) => {
          const record = await downloads.getArtifact(input);
          if (record?.artifact.downloadAvailability.state === "available")
            retainExpiry(record.artifact.downloadAvailability.expiresAt);
          return record;
        },
        getDownloadGrant: async (input) => {
          const record = await downloads.getDownloadGrant(input);
          if (record !== null) {
            retainExpiry(record.grant.expiresAt);
            verifiedGrant = record;
          }
          return record;
        },
        reserveDownloadGrant: async (input) => {
          const record = await downloads.reserveDownloadGrant(input);
          retainExpiry(record.grant.expiresAt);
          verifiedGrant = record;
          return record;
        },
        getJob: async (input) => (await runs.getJob(input))?.record ?? null,
      };
      const application = new DefaultSolutionExportReadApplication({
        clock,
        repository,
        maximumDownloadBytes: BUFFERED_SOLUTION_EXPORT_DOWNLOAD_BYTES,
        access: {
          async authorizeProject(actor, selectedProjectId, permission) {
            if (
              actor !== principal ||
              selectedProjectId !== projectId ||
              permission !== "artifacts.read"
            )
              throw new ApplicationError(
                "not_found",
                "The requested resource is unavailable.",
              );
            await authority.scope();
            return ownership;
          },
        },
      });
      const result = await work(application, principal);
      await authority.scope();
      if (verifiedGrant !== undefined) {
        // The final durable boundary includes grant revocation as well as the
        // current principal/project and immutable artifact inspection.
        const current = await downloads.getDownloadGrant({
          ...ownership,
          principalId: principal.principalId,
          artifactId: verifiedGrant.artifactId,
          grantId: verifiedGrant.grant.id,
        });
        if (
          current === null ||
          serializeCanonicalJson(current) !==
            serializeCanonicalJson(verifiedGrant)
        )
          throw new ApplicationError(
            "not_found",
            "The requested resource is unavailable.",
          );
      }
      // Reauthorization itself awaits SQL. Do not release content or a link if
      // its verified retention/grant deadline passed during that final wait.
      const returnedAt = clock().getTime();
      if (
        requiresRetainedContent &&
        (!Number.isFinite(returnedAt) ||
          expiries.length === 0 ||
          expiries.some((expiry) => expiry <= returnedAt))
      )
        throw new ApplicationError(
          "not_found",
          "The requested resource is unavailable.",
        );
      return result;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "The retained solution export is temporarily unavailable.",
      );
    }
  }
  return {
    getJob: (principal, projectId, jobId) =>
      read(principal, projectId, (application, actor) =>
        application.getJob(actor, projectId, jobId),
      ),
    getArtifact: (principal, projectId, artifactId) =>
      read(principal, projectId, (application, actor) =>
        application.getArtifact(actor, projectId, artifactId),
      ),
    getFilePreview: (principal, projectId, artifactId, fileId) =>
      read(
        principal,
        projectId,
        (application, actor) =>
          application.getFilePreview(actor, projectId, artifactId, fileId),
        true,
      ),
    getArtifactDiff: (principal, projectId, artifactId) =>
      read(
        principal,
        projectId,
        (application, actor) =>
          application.getArtifactDiff(actor, projectId, artifactId),
        true,
      ),
    createDownloadGrant: (principal, projectId, artifactId, idempotencyKey) =>
      read(
        principal,
        projectId,
        (application, actor) =>
          application.createDownloadGrant(
            actor,
            projectId,
            artifactId,
            idempotencyKey,
          ),
        true,
      ),
    download: (principal, projectId, artifactId, grantId) =>
      read(
        principal,
        projectId,
        (application, actor) =>
          application.download(actor, projectId, artifactId, grantId),
        true,
      ),
  };
}
