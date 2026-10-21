import { createHash } from "node:crypto";
import {
  acceptAiIntentPreviewV1Schema,
  acceptedIntentIdV1Schema,
  acceptedIntentV1Schema,
  aiIntentPreviewAcceptanceHeadersV1Schema,
  projectIdSchema,
  type AcceptedIntentV1,
} from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { inspectModelValueForSecretCandidatesV1 } from "@cloudmarkup/model-gateway";
import {
  digestCanonicalValue,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import type { AiIntentAcceptancePortV1 } from "../../application/ai-intent-acceptance.js";
import { AiIntentPreviewError } from "../../application/ai-intent-preview-journal.js";
import { ApplicationError } from "../../application/errors.js";
import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";
import {
  parsePreviewBinding,
  previewReadJson,
} from "./ai-intent-preview-codec.js";
import {
  parsePreviewPrincipal,
  PreviewRequestAuthority,
} from "./ai-intent-preview-request-authority.js";
import {
  assertObjectReference,
  referencesMatch,
  verifiedObjectStream,
} from "./object-store-common.js";
import { ObjectPublicationCoordinator } from "./publication.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function requireValue(value: boolean): asserts value {
  if (!value)
    throw new ApplicationError(
      "conflict",
      "The accepted requirements no longer match this request.",
    );
}
function text(row: SqlRow, key: string): string {
  const value = row[key];
  requireValue(typeof value === "string");
  return value;
}
function number(row: SqlRow, key: string): number {
  const value = Number(row[key]);
  requireValue(Number.isSafeInteger(value) && value > 0);
  return value;
}
const columns =
  "a.accepted_intent_id,a.organization_id,a.project_id,a.principal_id,a.invocation_id,a.content_object_id,a.intent_sha256,a.output_sha256,a.request_sha256,a.idempotency_key_sha256,a.source_draft_id,a.audit_event_id,a.source_draft_version::text AS draft_version_text,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS created_at_iso";

/** A closed accepted-content writer. No provider, accounting or graph command
 * port is present. Existing publication recovery handles an ambiguous commit;
 * only an already committed exact acceptance can recover after its lease ends. */
export class PostgresAiIntentAcceptance implements AiIntentAcceptancePortV1 {
  readonly #database: SqlDatabase;
  readonly #repository: CloudMarkupRepository;
  readonly #objects: ObjectStore;
  readonly #publication: ObjectPublicationCoordinator;
  constructor(options: {
    database: SqlDatabase;
    repository: CloudMarkupRepository;
    objectStore: ObjectStore;
  }) {
    this.#database = options.database;
    this.#repository = options.repository;
    this.#objects = options.objectStore;
    this.#publication = new ObjectPublicationCoordinator(
      options.repository,
      options.objectStore,
    );
  }
  async #scope(
    tx: SqlExecutor,
    principal: PrincipalContext,
    projectId: string,
    permission: "projects.mutate" | "projects.read",
  ): Promise<AuthorizedOrganizationScope> {
    const result = await tx.query(
      sql(
        `SELECT p.organization_id,m.membership_id,r.role_key,array_to_json(r.capabilities)::text AS capabilities_json
      FROM projects p JOIN organizations o ON o.organization_id=p.organization_id AND o.lifecycle_status='active'
      JOIN memberships m ON m.organization_id=p.organization_id AND m.principal_id=$1 AND m.lifecycle_status='active'
      JOIN principals actor ON actor.principal_id=m.principal_id AND actor.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE p.project_id=$2 AND (p.lifecycle_status='active' OR ($3='projects.read' AND p.lifecycle_status='archived'))
        AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
        AND r.capabilities @> ARRAY[$3]::text[] AND $4::timestamptz>clock_timestamp() AND $5::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'
      FOR UPDATE OF p FOR SHARE OF o,m,actor,r`,
        [
          principal.principalId,
          projectId,
          permission,
          principal.expiresAt,
          principal.authenticatedAt,
        ],
      ),
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined)
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    const current = await tx.query(
      sql(
        "SELECT 1 WHERE $1::timestamptz > clock_timestamp() AND $2::timestamptz <= clock_timestamp() + INTERVAL '60 seconds'",
        [principal.expiresAt, principal.authenticatedAt],
      ),
    );
    requireValue(current.rowCount === 1);
    const capabilities: unknown = JSON.parse(text(row, "capabilities_json"));
    requireValue(
      Array.isArray(capabilities) &&
        capabilities.every((value) => typeof value === "string"),
    );
    return {
      principalId: principal.principalId,
      sessionId: principal.sessionId,
      correlationId: principal.correlationId,
      organizationId: text(row, "organization_id"),
      membershipId: text(row, "membership_id"),
      roleKey: text(row, "role_key"),
      capabilities,
    };
  }
  async #record(
    tx: SqlExecutor,
    scope: AuthorizedOrganizationScope,
    projectId: string,
    acceptedIntentId: string,
  ): Promise<SqlRow> {
    const result = await tx.query(
      sql(
        `SELECT ${columns} FROM accepted_intents a WHERE organization_id=$1 AND project_id=$2 AND accepted_intent_id=$3`,
        [scope.organizationId, projectId, acceptedIntentId],
      ),
    );
    const row = result.rows[0];
    if (result.rowCount !== 1 || row === undefined)
      throw new ApplicationError(
        "not_found",
        "The requested resource is unavailable.",
      );
    return row;
  }
  async #read(
    principal: PrincipalContext,
    projectId: string,
    acceptedIntentId: string,
  ): Promise<AcceptedIntentV1> {
    const initial = await this.#database.transaction(async (tx) => {
      const scope = await this.#scope(
        tx,
        principal,
        projectId,
        "projects.read",
      );
      return {
        scope,
        row: await this.#record(tx, scope, projectId, acceptedIntentId),
      };
    });
    const object = await this.#repository.getObject(
      initial.scope,
      text(initial.row, "content_object_id"),
    );
    requireValue(
      object !== null &&
        object.lifecycleState === "published" &&
        object.owner.projectId === projectId &&
        object.purpose === "accepted-intent" &&
        object.contentSha256 === text(initial.row, "intent_sha256") &&
        object.sizeBytes > 0 &&
        object.sizeBytes <= 262144 &&
        object.mediaType === "application/json",
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of verifiedObjectStream(
      await this.#objects.open(initial.scope, object),
      object.sizeBytes,
      object.contentSha256,
    ))
      chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const intentDocument = parseIntentDocument(
      JSON.parse(bytes.toString("utf8")) as unknown,
    );
    requireValue(
      sha(serializeCanonicalJson(intentDocument)) === object.contentSha256,
    );
    const final = await this.#database.transaction(async (tx) => {
      const scope = await this.#scope(
        tx,
        principal,
        projectId,
        "projects.read",
      );
      return {
        scope,
        row: await this.#record(tx, scope, projectId, acceptedIntentId),
      };
    });
    requireValue(
      digestCanonicalValue(initial.row) === digestCanonicalValue(final.row),
    );
    const current = await this.#repository.getObject(
      final.scope,
      object.objectId,
    );
    requireValue(
      current !== null &&
        current.lifecycleState === "published" &&
        referencesMatch(object, current),
    );
    // Recheck current authentication and membership after the final storage read.
    await this.#database.transaction((tx) =>
      this.#scope(tx, principal, projectId, "projects.read"),
    );
    return acceptedIntentV1Schema.parse({
      contractVersion: 1,
      acceptedIntentId,
      projectId,
      createdAt: text(final.row, "created_at_iso"),
      createdByPrincipalId: text(final.row, "principal_id"),
      sourceDraftId: text(final.row, "source_draft_id"),
      sourceDraftVersion: number(final.row, "draft_version_text"),
      invocationId: text(final.row, "invocation_id"),
      outputDigest: "sha256:" + text(final.row, "output_sha256"),
      intentDigest: "sha256:" + object.contentSha256,
      intentDocument,
    });
  }
  async get(
    rawPrincipal: PrincipalContext,
    rawProjectId: string,
    rawAcceptedIntentId: string,
  ): Promise<AcceptedIntentV1> {
    return this.#safe(async () =>
      this.#read(
        parsePreviewPrincipal(rawPrincipal),
        projectIdSchema.parse(rawProjectId),
        acceptedIntentIdV1Schema.parse(rawAcceptedIntentId),
      ),
    );
  }
  async accept(
    rawPrincipal: PrincipalContext,
    rawProjectId: string,
    rawInput: Parameters<AiIntentAcceptancePortV1["accept"]>[2],
    expectedDraftEtag: string,
    idempotencyKey: string,
  ): Promise<AcceptedIntentV1> {
    return this.#safe(async () => {
      const principal = parsePreviewPrincipal(rawPrincipal),
        projectId = projectIdSchema.parse(rawProjectId);
      const input = acceptAiIntentPreviewV1Schema.parse(rawInput);
      aiIntentPreviewAcceptanceHeadersV1Schema.parse({
        "if-match": expectedDraftEtag,
        "idempotency-key": idempotencyKey,
      });
      if (
        inspectModelValueForSecretCandidatesV1(input.candidate)
          .detectedValueCount !== 0
      )
        throw new ApplicationError(
          "invalid_request",
          "The requirements contain unsupported sensitive values.",
        );
      const intent = parseIntentDocument(input.candidate.intentDocument);
      const bytes = Buffer.from(serializeCanonicalJson(intent), "utf8"),
        intentSha = sha(bytes);
      const outputSha = digestCanonicalValue(input.candidate).slice(7),
        invocationId = input.candidate.provenance.invocationId;
      const keySha = sha(idempotencyKey);
      const requestSha = digestCanonicalValue({
        contractVersion: 1,
        projectId,
        invocationId,
        outputSha,
        intentSha,
        expectedDraftEtag,
        leaseId: input.editingProof.leaseId,
      }).slice(7);
      const resolve = async (tx: SqlExecutor) => {
        const scope = await this.#scope(
          tx,
          principal,
          projectId,
          "projects.mutate",
        );
        const suffix = sha(
          [
            scope.organizationId,
            projectId,
            principal.principalId,
            invocationId,
          ].join("\0"),
        ).slice(0, 48);
        const acceptedIntentId = "accepted_intent_" + suffix,
          objectId = "object_accepted_intent_" + suffix;
        const existing = await tx.query(
          sql(
            `SELECT ${columns} FROM accepted_intents a WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND (invocation_id=$4 OR idempotency_key_sha256=$5)`,
            [
              scope.organizationId,
              projectId,
              principal.principalId,
              invocationId,
              keySha,
            ],
          ),
        );
        requireValue(existing.rowCount <= 1);
        const row = existing.rows[0];
        if (row !== undefined) {
          requireValue(
            row["request_sha256"] === requestSha &&
              row["idempotency_key_sha256"] === keySha &&
              row["accepted_intent_id"] === acceptedIntentId &&
              row["content_object_id"] === objectId &&
              row["intent_sha256"] === intentSha &&
              row["output_sha256"] === outputSha,
          );
          return {
            scope,
            acceptedIntentId,
            objectId,
            row,
            draftId: text(row, "source_draft_id"),
            draftVersion: number(row, "draft_version_text"),
          };
        }
        const found = await tx.query(
          sql(
            `SELECT binding,output_sha256,output_bytes::text FROM ai_intent_previews WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 AND gateway_state='complete' AND generation_evidence IS NOT NULL AND normalized_usage IS NOT NULL`,
            [
              scope.organizationId,
              projectId,
              principal.principalId,
              invocationId,
            ],
          ),
        );
        const preview = found.rows[0];
        requireValue(found.rowCount === 1 && preview !== undefined);
        const binding = parsePreviewBinding(
          previewReadJson(preview["binding"]),
        );
        requireValue(
          preview["output_sha256"] === outputSha &&
            number(preview, "output_bytes") ===
              Buffer.byteLength(
                serializeCanonicalJson(input.candidate),
                "utf8",
              ) &&
            binding.scope.organizationId === scope.organizationId &&
            binding.scope.projectId === projectId &&
            binding.scope.userId === principal.principalId &&
            binding.invocationId === invocationId,
        );
        const authority = new PreviewRequestAuthority({
          principal,
          editingProof: input.editingProof,
          baseline: {
            draftEtag: expectedDraftEtag,
            editingLeaseId: input.editingProof.leaseId,
          },
        });
        const draft = await authority.assertCurrent(tx, binding.scope, binding);
        return {
          scope,
          acceptedIntentId,
          objectId,
          row: undefined,
          draftId: draft.draftId,
          draftVersion: Number(draft.version),
        };
      };
      const initial = await this.#database.transaction(resolve);
      await this.#publication.publish(
        initial.scope,
        {
          objectId: initial.objectId,
          owner: { organizationId: initial.scope.organizationId, projectId },
          purpose: "accepted-intent",
          contentSha256: intentSha,
          sizeBytes: bytes.length,
          mediaType: "application/json",
          open: async function* () {
            yield await Promise.resolve(bytes);
          },
        },
        async (object) =>
          this.#database.transaction(async (tx) => {
            const current = await resolve(tx);
            assertObjectReference(current.scope, object);
            requireValue(
              object.objectId === current.objectId &&
                object.owner.projectId === projectId &&
                object.purpose === "accepted-intent" &&
                object.contentSha256 === intentSha &&
                object.sizeBytes === bytes.length &&
                object.mediaType === "application/json",
            );
            if (current.row !== undefined) return;
            await this.#insertObject(tx, current.scope, object);
            const auditId =
              "audit_intent_" + sha(current.acceptedIntentId).slice(0, 48);
            await tx.query(
              sql(
                `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id) VALUES($1,$2,$3,'ai-intent.accepted','project',$4,'succeeded','Accepted reviewed requirements.', $5)`,
                [
                  auditId,
                  current.scope.organizationId,
                  principal.principalId,
                  projectId,
                  principal.correlationId,
                ],
              ),
            );
            await tx.query(
              sql(
                `INSERT INTO accepted_intents(accepted_intent_id,organization_id,project_id,principal_id,invocation_id,content_object_id,intent_sha256,output_sha256,request_sha256,idempotency_key_sha256,source_draft_id,source_draft_version,audit_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [
                  current.acceptedIntentId,
                  current.scope.organizationId,
                  projectId,
                  principal.principalId,
                  invocationId,
                  current.objectId,
                  intentSha,
                  outputSha,
                  requestSha,
                  keySha,
                  current.draftId,
                  current.draftVersion,
                  auditId,
                ],
              ),
            );
          }),
      );
      return this.#read(principal, projectId, initial.acceptedIntentId);
    });
  }
  async #insertObject(
    tx: SqlExecutor,
    scope: AuthorizedOrganizationScope,
    object: StoredObjectReference,
  ): Promise<void> {
    await tx.query(
      sql(
        `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type,created_by_principal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          object.objectId,
          scope.organizationId,
          object.owner.projectId ?? null,
          object.storageProvider,
          object.purpose,
          object.storageKey,
          object.objectVersion,
          object.entityTag ?? null,
          object.contentSha256,
          object.sizeBytes,
          object.mediaType,
          scope.principalId,
        ],
      ),
    );
  }
  async #safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error instanceof AiIntentPreviewError)
        throw new ApplicationError(
          "precondition_failed",
          "The original requirements review authority is no longer current.",
        );
      throw new ApplicationError(
        "service_unavailable",
        "Accepted requirements are unavailable.",
      );
    }
  }
}
