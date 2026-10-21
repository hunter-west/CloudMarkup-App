import type { PrincipalContext } from "../../application/ports.js";
import type { ProjectEditingLeaseProof } from "../../application/project-editing-leases.js";
import {
  AiIntentPreviewError,
  type AiIntentPreviewDeliveryProofV1,
} from "../../application/ai-intent-preview-journal.js";
import {
  aiPreviewProofSchema,
  parsePreviewBinding,
  previewAssert,
  previewReadJson,
} from "./ai-intent-preview-codec.js";
import {
  parsePreviewEditingProof,
  parsePreviewPrincipal,
  parsePreviewRequestAuthority,
  PreviewRequestAuthority,
} from "./ai-intent-preview-request-authority.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { workflowIdSchema } from "./model-commercial-workflow-codec.js";
import { sql, type SqlDatabase } from "./sql.js";

/** Fresh authenticated request, not a public wire contract. Derives original
 * tenant/baseline from immutable metadata. No runtime/provider/accounting port,
 * content body or creation method is available to this recovery path. */
export async function acknowledgeExistingAiIntentPreview(input: {
  readonly database: SqlDatabase;
  readonly principal: PrincipalContext;
  readonly projectId: string;
  readonly editingProof: ProjectEditingLeaseProof;
  readonly proof: AiIntentPreviewDeliveryProofV1;
}): Promise<void> {
  try {
    const principal = parsePreviewPrincipal(input.principal);
    const projectId = workflowIdSchema.parse(input.projectId);
    const editingProof = parsePreviewEditingProof(input.editingProof);
    const proof = aiPreviewProofSchema.parse(input.proof);
    const existing = await input.database.transaction(async (tx) => {
      // Resolve ownership from the verified actor, not an organization supplied
      // by the caller. Project-first locking agrees with lease/save and ACK.
      const authorized = await tx.query(
        sql(
          `SELECT p.organization_id FROM projects p
        JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
        JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'
        JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'
        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
        WHERE p.project_id=$2 AND p.lifecycle_status='active'
          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          AND $3::timestamptz>clock_timestamp() AND $4::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'
        FOR UPDATE OF p FOR SHARE OF o,m,actor,r`,
          [
            principal.principalId,
            projectId,
            principal.expiresAt,
            principal.authenticatedAt,
          ],
        ),
      );
      const organizationId = authorized.rows[0]?.["organization_id"];
      previewAssert(
        authorized.rowCount === 1 && typeof organizationId === "string",
      );
      const found = await tx.query(
        sql(
          `SELECT p.binding,a.draft_id,a.draft_version::text,a.lease_id
        FROM ai_intent_previews p JOIN ai_intent_preview_authorities a
          ON a.organization_id=p.organization_id AND a.project_id=p.project_id
          AND a.principal_id=p.principal_id AND a.invocation_id=p.invocation_id AND a.binding_sha256=p.binding_sha256
        WHERE p.organization_id=$1 AND p.project_id=$2 AND p.principal_id=$3 AND p.invocation_id=$4`,
          [
            organizationId,
            projectId,
            principal.principalId,
            proof.invocationId,
          ],
        ),
      );
      const row = found.rows[0];
      previewAssert(found.rowCount === 1 && row !== undefined);
      const binding = parsePreviewBinding(previewReadJson(row["binding"]));
      previewAssert(
        binding.scope.organizationId === organizationId &&
          binding.scope.projectId === projectId &&
          binding.scope.userId === principal.principalId,
      );
      previewAssert(
        typeof row["draft_id"] === "string" &&
          typeof row["draft_version"] === "string" &&
          typeof row["lease_id"] === "string",
      );
      const requestAuthority = parsePreviewRequestAuthority({
        principal,
        editingProof,
        baseline: {
          draftEtag: `"draft:${row["draft_id"]}:v${row["draft_version"]}"`,
          editingLeaseId: row["lease_id"],
        },
      });
      await new PreviewRequestAuthority(requestAuthority).assertCurrent(
        tx,
        binding.scope,
        binding,
      );
      return { binding, requestAuthority };
    });
    // No lock survives across transactions. The journal reacquires all current
    // authority, immutable binding, delivery proof and database-clock checks.
    await new PostgresAiIntentPreviewJournal({
      database: input.database,
      ...existing,
    }).acknowledge(proof);
  } catch {
    throw new AiIntentPreviewError();
  }
}
