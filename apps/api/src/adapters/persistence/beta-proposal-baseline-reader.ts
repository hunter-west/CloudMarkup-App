import {
  architectureDocumentV3Schema,
  asyncJobDraftSubjectV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import type { ObjectStore } from "../../application/persistence.js";
import type { BetaProposalBaselineReaderV1 } from "../../application/beta-infrastructure.js";
import { ApplicationError } from "../../application/errors.js";
import {
  SolutionExportProducerObjects,
  type SolutionExportObjectAuthority,
} from "./solution-export-producer-objects.js";
import { exportRunText } from "./solution-export-run-codec.js";
import { sql } from "./sql.js";

/** The caller supplies a live request/job authority, never a payload-derived
 * principal. Every metadata/object boundary repeats that authority's checks. */
export function createBetaProposalBaselineReader(options: {
  authority: SolutionExportObjectAuthority;
  objectStore: ObjectStore;
  assertCurrent?: () => Promise<void>;
}): BetaProposalBaselineReaderV1 {
  return async (input) => {
    const ownership = asyncJobTrustedOwnershipV1Schema.parse(input.ownership);
    const subject = asyncJobDraftSubjectV1Schema.parse(input.subject);
    const { authority } = options;
    const unavailable = () => {
      throw new ApplicationError(
        "precondition_failed",
        "The exact authorized saved proposal baseline is unavailable.",
      );
    };
    if (
      authority.permission !== "projects.mutate" ||
      ownership.organizationId !== authority.ownership.organizationId ||
      ownership.projectId !== authority.ownership.projectId ||
      subject.etag !==
        `"draft:${subject.draftId}:v${String(subject.draftVersion)}"`
    )
      unavailable();
    const readCurrent = async () => {
      await options.assertCurrent?.();
      const scope = await authority.scope();
      if (
        scope.organizationId !== ownership.organizationId ||
        !scope.capabilities.includes("projects.mutate")
      )
        unavailable();
      const rows = await authority.query(
        sql(
          `SELECT d.draft_id,d.draft_version::text,d.content_sha256,d.document_object_id
        FROM projects p JOIN architecture_drafts d
          ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id
        WHERE p.organization_id=$1 AND p.project_id=$2 AND p.lifecycle_status='active'
          AND d.draft_id=$3 AND d.draft_version=$4 AND d.content_sha256=$5
          AND d.pending_draft_version IS NULL AND d.pending_document_object_id IS NULL
        FOR SHARE OF p,d`,
          [
            ownership.organizationId,
            authority.ownership.projectId,
            subject.draftId,
            subject.draftVersion,
            subject.contentDigest.slice(7),
          ],
        ),
      );
      const row = rows.rows[0];
      if (
        rows.rows.length !== 1 ||
        row?.["draft_id"] !== subject.draftId ||
        String(row["draft_version"]) !== String(subject.draftVersion) ||
        row["content_sha256"] !== subject.contentDigest.slice(7)
      )
        unavailable();
      return exportRunText(row?.["document_object_id"]);
    };
    const objectId = await readCurrent();
    const objects = new SolutionExportProducerObjects(
      authority,
      options.objectStore,
    );
    const stored = await objects.metadata(objectId);
    if (
      stored?.state !== "published" ||
      stored.reference.purpose !== "architecture-draft" ||
      stored.reference.owner.organizationId !== ownership.organizationId ||
      stored.reference.owner.projectId !== ownership.projectId ||
      stored.reference.contentSha256 !== subject.contentDigest.slice(7)
    )
      unavailable();
    if (!stored) return unavailable();
    const document = architectureDocumentV3Schema.parse(
      JSON.parse(
        Buffer.from(await objects.read(stored.reference)).toString("utf8"),
      ),
    );
    if (
      digestCanonicalValue(document) !== subject.contentDigest ||
      (await readCurrent()) !== objectId
    )
      unavailable();
    return document;
  };
}
