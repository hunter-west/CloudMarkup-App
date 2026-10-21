import { createHash, timingSafeEqual } from "node:crypto";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import { z } from "zod";
import type { PrincipalContext } from "../../application/ports.js";
import type { ProjectEditingLeaseProof } from "../../application/project-editing-leases.js";
import type { AiIntentPreviewBindingV1 } from "../../application/ai-intent-preview-journal.js";
import {
  aiPreviewTokenSchema,
  previewAssert,
  previewChecked,
} from "./ai-intent-preview-codec.js";
import {
  workflowIdSchema,
  workflowInstantSchema,
} from "./model-commercial-workflow-codec.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

/** Host-only input. Authentication middleware supplies PrincipalContext. The
 * browser can supply the tab proof, never the principal or tenant authority. */
export interface AiIntentPreviewRequestAuthorityV1 {
  readonly principal: PrincipalContext;
  readonly baseline: {
    readonly draftEtag: string;
    readonly editingLeaseId: string;
  };
  readonly editingProof: ProjectEditingLeaseProof;
}

const leaseIdSchema = z
  .string()
  .regex(
    /^projectlease_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u,
  );
const principalSchema = z
  .object({
    principalId: workflowIdSchema,
    sessionId: z.string().min(1).max(256),
    correlationId: workflowIdSchema,
    authenticatedAt: workflowInstantSchema,
    expiresAt: workflowInstantSchema,
    // Hosted preview persistence accepts the reviewed Cognito middleware only.
    authenticationSource: z.literal("cognito"),
  })
  .strict();
const editingProofSchema = z
  .object({
    leaseId: leaseIdSchema,
    token: aiPreviewTokenSchema,
  })
  .strict();
const baselineSchema = z
  .object({
    draftEtag: z
      .string()
      .regex(/^"draft:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}:v[1-9][0-9]{0,15}"$/u),
    editingLeaseId: leaseIdSchema,
  })
  .strict();

function plainRecords(value: unknown, depth = 0): void {
  if (value === null || typeof value !== "object") return;
  previewAssert(depth < 5 && Object.getPrototypeOf(value) === Object.prototype);
  for (const key of Reflect.ownKeys(value)) {
    previewAssert(typeof key === "string");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    previewAssert(
      descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true,
    );
    plainRecords(descriptor.value, depth + 1);
  }
}
export function parsePreviewPrincipal(value: unknown): PrincipalContext {
  return previewChecked(() => {
    plainRecords(value);
    const parsed = principalSchema.parse(value);
    previewAssert(
      Date.parse(parsed.authenticatedAt) < Date.parse(parsed.expiresAt),
    );
    return parsed;
  });
}
export function parsePreviewEditingProof(
  value: unknown,
): ProjectEditingLeaseProof {
  return previewChecked(() => {
    plainRecords(value);
    return editingProofSchema.parse(value);
  });
}
export function parsePreviewRequestAuthority(
  value: unknown,
): AiIntentPreviewRequestAuthorityV1 {
  return previewChecked(() => {
    plainRecords(value);
    const parsed = z
      .object({
        principal: principalSchema,
        baseline: baselineSchema,
        editingProof: editingProofSchema,
      })
      .strict()
      .parse(value);
    previewAssert(
      parsed.baseline.editingLeaseId === parsed.editingProof.leaseId &&
        Date.parse(parsed.principal.authenticatedAt) <
          Date.parse(parsed.principal.expiresAt),
    );
    return parsed;
  });
}
export const previewAuthorityHash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
export function previewHashMatches(expected: unknown, actual: string): boolean {
  return (
    typeof expected === "string" &&
    /^[0-9a-f]{64}$/u.test(expected) &&
    /^[0-9a-f]{64}$/u.test(actual) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"))
  );
}
function text(row: SqlRow, key: string): string {
  const value = row[key];
  previewAssert(typeof value === "string");
  return value;
}
interface Scope {
  readonly organizationId: string;
  readonly projectId?: string | undefined;
  readonly userId: string;
}
interface CurrentAuthority {
  readonly draftId: string;
  readonly version: string;
  readonly contentSha256: string;
  readonly expiresAt: string;
}

/** Acquire these locks BEFORE workflow/preview locks. No network or content I/O
 * belongs in this transaction. Usage/accounting recovery does not use this guard. */
export class PreviewRequestAuthority {
  readonly #value: AiIntentPreviewRequestAuthorityV1;
  constructor(value: AiIntentPreviewRequestAuthorityV1) {
    this.#value = parsePreviewRequestAuthority(value);
  }
  get value(): AiIntentPreviewRequestAuthorityV1 {
    return structuredClone(this.#value);
  }
  async assertCurrent(
    tx: SqlExecutor,
    scope: Scope,
    binding?: AiIntentPreviewBindingV1,
  ): Promise<CurrentAuthority> {
    const { principal, baseline, editingProof } = this.#value;
    previewAssert(
      principal.principalId === scope.userId && scope.projectId !== undefined,
    );
    const project = await tx.query(
      sql(
        `SELECT p.current_draft_id FROM projects p
      JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
      JOIN principals actor ON actor.principal_id=$3 AND actor.lifecycle_status='active'
      JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=actor.principal_id AND m.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE p.organization_id=$1 AND p.project_id=$2 AND p.lifecycle_status='active'
        AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
        AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      FOR UPDATE OF p FOR SHARE OF o,actor,m,r`,
        [scope.organizationId, scope.projectId, principal.principalId],
      ),
    );
    const projectRow = project.rows[0];
    previewAssert(project.rowCount === 1 && projectRow !== undefined);
    const lease = await tx.query(
      sql(
        `SELECT lease_id,principal_id,session_id,token_sha256,
      to_char(LEAST(expires_at,authentication_expires_at,$3::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expiry_iso
      FROM project_editing_leases WHERE organization_id=$1 AND project_id=$2
        AND released_at IS NULL AND expires_at>clock_timestamp() AND authentication_expires_at>clock_timestamp()
      FOR SHARE`,
        [scope.organizationId, scope.projectId, principal.expiresAt],
      ),
    );
    const leaseRow = lease.rows[0];
    previewAssert(lease.rowCount === 1 && leaseRow !== undefined);
    previewAssert(
      leaseRow["lease_id"] === editingProof.leaseId &&
        leaseRow["principal_id"] === principal.principalId &&
        leaseRow["session_id"] === principal.sessionId &&
        previewHashMatches(
          leaseRow["token_sha256"],
          previewAuthorityHash(editingProof.token),
        ),
    );
    const draft = await tx.query(
      sql(
        `SELECT d.draft_id,d.draft_version::text,d.content_sha256
      FROM architecture_drafts d JOIN stored_objects o ON o.organization_id=d.organization_id AND o.project_id=d.project_id AND o.object_id=d.document_object_id
      WHERE d.organization_id=$1 AND d.project_id=$2 AND d.draft_id=$3 AND d.pending_document_object_id IS NULL
        AND o.lifecycle_state='published' AND o.content_sha256=d.content_sha256 AND o.object_purpose='architecture-draft'
      FOR SHARE OF d,o`,
        [
          scope.organizationId,
          scope.projectId,
          text(projectRow, "current_draft_id"),
        ],
      ),
    );
    const row = draft.rows[0];
    previewAssert(draft.rowCount === 1 && row !== undefined);
    const draftId = text(row, "draft_id"),
      version = text(row, "draft_version");
    previewAssert(baseline.draftEtag === `"draft:${draftId}:v${version}"`);
    let originalExpiry = principal.expiresAt;
    if (binding !== undefined) {
      const issued = await tx.query(
        sql(
          `SELECT binding_sha256,draft_id,draft_version::text,content_sha256,lease_id,session_sha256,
        to_char(authentication_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS authentication_expiry_iso
        FROM ai_intent_preview_authorities WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 FOR SHARE`,
          [
            scope.organizationId,
            scope.projectId,
            principal.principalId,
            binding.invocationId,
          ],
        ),
      );
      const receipt = issued.rows[0];
      previewAssert(issued.rowCount === 1 && receipt !== undefined);
      previewAssert(
        receipt["binding_sha256"] === digestStructuredValue(binding).slice(7) &&
          receipt["draft_id"] === draftId &&
          receipt["draft_version"] === version &&
          receipt["content_sha256"] === row["content_sha256"] &&
          receipt["lease_id"] === editingProof.leaseId &&
          previewHashMatches(
            receipt["session_sha256"],
            previewAuthorityHash(principal.sessionId),
          ),
      );
      originalExpiry = text(receipt, "authentication_expiry_iso");
    }
    // Recheck after all awaited locks. A refreshed bearer cannot extend the
    // immutable original authentication ceiling; a renewal cannot change epoch.
    const current = await tx.query(
      sql(
        `SELECT to_char(LEAST($1::timestamptz,$3::timestamptz,$4::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expiry_iso
      WHERE LEAST($1::timestamptz,$3::timestamptz,$4::timestamptz)>clock_timestamp()
        AND $2::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'`,
        [
          principal.expiresAt,
          principal.authenticatedAt,
          originalExpiry,
          text(leaseRow, "expiry_iso"),
        ],
      ),
    );
    const stamp = current.rows[0];
    previewAssert(current.rowCount === 1 && stamp !== undefined);
    return {
      draftId,
      version,
      contentSha256: text(row, "content_sha256"),
      expiresAt: text(stamp, "expiry_iso"),
    };
  }
  async issue(
    tx: SqlExecutor,
    binding: AiIntentPreviewBindingV1,
  ): Promise<void> {
    const draft = await this.assertCurrent(tx, binding.scope);
    const { principal, editingProof } = this.#value;
    const existing = await tx.query(
      sql(
        "SELECT 1 FROM ai_intent_preview_authorities WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4",
        [
          binding.scope.organizationId,
          binding.scope.projectId ?? null,
          principal.principalId,
          binding.invocationId,
        ],
      ),
    );
    if (existing.rowCount === 0) {
      await tx.query(
        sql(
          `INSERT INTO ai_intent_preview_authorities
        (organization_id,project_id,principal_id,invocation_id,binding_sha256,draft_id,draft_version,content_sha256,lease_id,session_sha256,authentication_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9,$10,$11::timestamptz)`,
          [
            binding.scope.organizationId,
            binding.scope.projectId ?? null,
            principal.principalId,
            binding.invocationId,
            digestStructuredValue(binding).slice(7),
            draft.draftId,
            draft.version,
            draft.contentSha256,
            editingProof.leaseId,
            previewAuthorityHash(principal.sessionId),
            principal.expiresAt,
          ],
        ),
      );
    }
    await this.assertCurrent(tx, binding.scope, binding);
  }
}
