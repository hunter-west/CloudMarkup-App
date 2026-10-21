import { randomBytes, randomUUID } from "node:crypto";
import type { ModelCommercialInvocationContextV1 } from "@cloudmarkup/model-gateway";
import { expect } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import type { AiIntentPreviewDeliveryProofV1 } from "../../application/ai-intent-preview-journal.js";
import { acknowledgeExistingAiIntentPreview } from "./ai-intent-preview-acknowledgement.js";
import type { AiIntentPreviewRequestAuthorityV1 } from "./ai-intent-preview-request-authority.js";
import { aiPreviewFixture } from "./ai-intent-preview-test-helpers.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { PostgresModelCommercialWorkflowStore } from "./model-commercial-workflow-store.js";
import { commercialHarness } from "./model-commercial-workflow-test-helpers.js";
import { PostgresIntentRuntimeHostEvidence } from "./model-runtime-host-evidence.js";
import { PostgresProjectEditingLeases } from "./project-editing-leases.js";
import { sql, type SqlDatabase } from "./sql.js";

interface PreviewAuthorityTestScope {
  organizationId: string;
  projectId: string;
  userId: string;
  jobId: string;
}
export interface PreviewAuthorityFixture {
  readonly preview: ReturnType<typeof aiPreviewFixture> & {
    scope: PreviewAuthorityTestScope;
  };
  readonly commercial: ReturnType<typeof commercialHarness>;
  readonly authority: AiIntentPreviewRequestAuthorityV1;
  readonly journal: PostgresAiIntentPreviewJournal;
  readonly leases: PostgresProjectEditingLeases;
  readonly errors: unknown[];
  readonly invocations: number;
  delivery(
    callback: ModelCommercialInvocationContextV1,
  ): Promise<AiIntentPreviewDeliveryProofV1>;
  disconnect(): Promise<AiIntentPreviewDeliveryProofV1>;
  ack(
    proof: AiIntentPreviewDeliveryProofV1,
    overrides?: Partial<
      Parameters<typeof acknowledgeExistingAiIntentPreview>[0]
    >,
  ): Promise<void>;
  advanceDraft(publish: boolean): Promise<void>;
}

/** Test-only component fixture: real SQL/workflow/journal/editing lease, explicit
 * synthetic commercial decisions and model output. No model or object I/O. */
export async function createPreviewAuthorityFixture(
  database: SqlDatabase,
  scope: PreviewAuthorityTestScope,
  authenticationMilliseconds = 300000,
  publishedDraft?: { readonly draftId: string; readonly version: number },
): Promise<PreviewAuthorityFixture> {
  const draftId = publishedDraft?.draftId ?? `draft_${randomUUID()}`;
  const objectId = `object_${randomUUID()}`;
  const contentSha256 = "a".repeat(64);
  // Existing saved project metadata only. Synthetic bodies never enter SQL.
  if (publishedDraft === undefined)
    await database.transaction(async (tx) => {
      await tx.query(
        sql(
          `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,published_at)
      VALUES($1,$2,$3,'memory','architecture-draft',$4,'1',$5,2,'application/json','published',$6,clock_timestamp())`,
          [
            objectId,
            scope.organizationId,
            scope.projectId,
            `synthetic/${objectId}`,
            contentSha256,
            scope.userId,
          ],
        ),
      );
      await tx.query(
        sql(
          `INSERT INTO architecture_drafts(draft_id,organization_id,project_id,draft_version,document_schema_version,document_object_id,content_sha256,semantic_sha256,visual_sha256,updated_by_principal_id)
      VALUES($1,$2,$3,1,3,$4,$5,$5,$5,$6)`,
          [
            draftId,
            scope.organizationId,
            scope.projectId,
            objectId,
            contentSha256,
            scope.userId,
          ],
        ),
      );
      await tx.query(
        sql(
          "UPDATE projects SET current_draft_id=$3 WHERE organization_id=$1 AND project_id=$2",
          [scope.organizationId, scope.projectId, draftId],
        ),
      );
    });
  if (publishedDraft !== undefined) {
    const existing = await database.query(
      sql(
        `SELECT 1 FROM projects p JOIN architecture_drafts d ON d.organization_id=p.organization_id AND d.project_id=p.project_id AND d.draft_id=p.current_draft_id JOIN stored_objects o ON o.organization_id=d.organization_id AND o.project_id=d.project_id AND o.object_id=d.document_object_id AND o.lifecycle_state='published' WHERE p.organization_id=$1 AND p.project_id=$2 AND d.draft_id=$3 AND d.draft_version=$4 AND d.pending_draft_version IS NULL`,
        [
          scope.organizationId,
          scope.projectId,
          publishedDraft.draftId,
          publishedDraft.version,
        ],
      ),
    );
    if (existing.rowCount !== 1)
      throw Error("Missing exact published synthetic draft.");
  }
  const principal: PrincipalContext = {
    principalId: scope.userId,
    sessionId: `session_${randomUUID()}`,
    correlationId: `correlation_${randomUUID()}`,
    // Synthetic descriptor for the Cognito-only hosted persistence boundary.
    authenticationSource: "cognito",
    authenticatedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + authenticationMilliseconds).toISOString(),
  };
  const leases = new PostgresProjectEditingLeases(database);
  const token = randomBytes(32).toString("base64url");
  const acquired = await leases.acquire(principal, scope.projectId, { token });
  if (acquired.state !== "owned")
    throw new Error("Missing synthetic editing lease.");
  const authority: AiIntentPreviewRequestAuthorityV1 = {
    principal,
    baseline: {
      draftEtag: `"draft:${draftId}:v${String(publishedDraft?.version ?? 1)}"`,
      editingLeaseId: acquired.leaseId,
    },
    editingProof: { leaseId: acquired.leaseId, token },
  };
  const preview = {
    ...aiPreviewFixture(scope, new Date().toISOString()),
    scope,
  };
  const errors: unknown[] = [];
  const observed: SqlDatabase = {
    query: database.query.bind(database),
    close: () => Promise.resolve(),
    transaction: (work) =>
      database.transaction(async (tx) => {
        try {
          return await work(tx);
        } catch (error) {
          errors.push(error);
          throw error;
        }
      }),
  };
  const journal = new PostgresAiIntentPreviewJournal({
    database: observed,
    binding: preview.binding,
    requestAuthority: authority,
  });
  const workflows = new PostgresModelCommercialWorkflowStore({
    database,
    scope: preview.tenant,
  });
  const commercial = commercialHarness(
    workflows,
    preview.request,
    () => new Date().toISOString(),
    { route: preview.route, invocationRecovery: journal },
  );
  const evidence = new PostgresIntentRuntimeHostEvidence({ database, scope });
  let invocations = 0;
  async function delivery(callback: ModelCommercialInvocationContextV1) {
    await journal.prepare(callback);
    expect(await journal.claim(preview.claim)).toEqual({ kind: "claimed" });
    invocations += 1;
    await journal.record(preview.result.usage);
    await journal.complete(preview.claim, preview.result);
    await evidence.issueInput(preview.invocation);
    return journal.prepareDelivery(
      await evidence.issueOutput(preview.outputInput),
    );
  }
  return {
    preview,
    commercial,
    authority,
    journal,
    leases,
    errors,
    get invocations() {
      return invocations;
    },
    delivery,
    async disconnect() {
      let proof: AiIntentPreviewDeliveryProofV1 | undefined;
      await expect(
        commercial.coordinator.execute(preview.request, async (callback) => {
          proof = await delivery(callback);
          throw new Error("Synthetic lost memory-only request.");
        }),
      ).rejects.toMatchObject({ code: "dependency-failure" });
      expect(errors).toEqual([]);
      if (proof === undefined)
        throw new Error("Missing synthetic delivery proof.");
      return proof;
    },
    ack: (proof, overrides = {}) =>
      acknowledgeExistingAiIntentPreview({
        database,
        principal,
        projectId: scope.projectId,
        editingProof: authority.editingProof,
        proof,
        ...overrides,
      }),
    async advanceDraft(publish) {
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "SELECT 1 FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
            [scope.organizationId, scope.projectId],
          ),
        );
        await tx.query(
          sql(
            `UPDATE architecture_drafts SET pending_draft_version=draft_version+1,pending_document_schema_version=document_schema_version,
          pending_document_object_id=document_object_id,pending_content_sha256=content_sha256,pending_semantic_sha256=semantic_sha256,
          pending_visual_sha256=visual_sha256,pending_editing_lease_id=$3 WHERE organization_id=$1 AND project_id=$2`,
            [
              scope.organizationId,
              scope.projectId,
              authority.editingProof.leaseId,
            ],
          ),
        );
        if (publish)
          await tx.query(
            sql(
              `UPDATE architecture_drafts SET draft_version=pending_draft_version,
          pending_draft_version=NULL,pending_document_schema_version=NULL,pending_document_object_id=NULL,
          pending_content_sha256=NULL,pending_semantic_sha256=NULL,pending_visual_sha256=NULL,pending_editing_lease_id=NULL
          WHERE organization_id=$1 AND project_id=$2`,
              [scope.organizationId, scope.projectId],
            ),
          );
      });
    },
  };
}
