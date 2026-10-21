import type { CleanupHistoryPort } from "../../application/project-cleanup-history.js";
import { ProjectDeletionCanonicalObjects } from "./project-deletion-canonical-objects.js";
import type { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import { solutionExportWorkflowByteLimit } from "./solution-export-workflow-storage.js";
import { verifiedObjectStream } from "./object-store-common.js";
import type { ObjectStore } from "../../application/persistence.js";
/** Used exclusively by the existing verified terminal projection algorithm. It
 * registers each exact canonical body before S3 I/O; it cannot execute workflow
 * builders or accept an HTTP payload. Ordinary fences remain permanently closed. */
export function deletionExportObjects(input: {
  authority: ProjectDeletionRecoveryAuthority;
  delegate: ObjectStore;
  jobId: string;
  jobRecordVersion: number;
  actorId: string;
  history?: CleanupHistoryPort;
}): ObjectStore {
  const { authority, delegate } = input;
  return {
    open: delegate.open.bind(delegate),
    head: delegate.head.bind(delegate),
    discardStaged: () =>
      Promise.reject(
        Error("Deletion terminal storage cannot discard content."),
      ),
    requestDeletion: () =>
      Promise.reject(Error("Only the sealed eraser may delete content.")),
    publish: () =>
      Promise.reject(
        Error("Deletion terminal publication must already be complete."),
      ),
    async stage(scope, value) {
      if (
        scope.organizationId !== authority.binding.organizationId ||
        scope.principalId !== input.actorId ||
        value.owner.organizationId !== authority.binding.organizationId ||
        value.owner.projectId !== authority.binding.projectId ||
        value.sizeBytes >
          solutionExportWorkflowByteLimit(value.purpose, value.mediaType)
      )
        throw Error("Deletion terminal body scope mismatch.");
      const chunks: Uint8Array[] = [];
      for await (const chunk of verifiedObjectStream(
        value.open(),
        value.sizeBytes,
        value.contentSha256,
      ))
        chunks.push(chunk.slice());
      const plan = {
        bytes: Uint8Array.from(Buffer.concat(chunks)),
        purpose: value.purpose,
        mediaType: value.mediaType,
        objectId: value.objectId,
        jobId: input.jobId,
        jobRecordVersion: input.jobRecordVersion,
        createdByPrincipalId: input.actorId,
      };
      return new ProjectDeletionCanonicalObjects(
        authority,
        delegate,
        [plan],
        input.history,
      ).publish(value.objectId);
    },
  };
}
