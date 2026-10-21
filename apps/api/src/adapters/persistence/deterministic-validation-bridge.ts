import { createHash } from "node:crypto";

import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import {
  RepositoryError,
  type AuthorizedOrganizationScope,
  type CloudMarkupRepository,
  type DraftMetadataRecord,
  type ObjectStore,
  type StoredObjectReference,
  type StoredObjectState,
} from "../../application/persistence.js";
import {
  getArchitectureDocumentStorage,
  type ArchitectureDocumentStorage,
} from "../../application/architecture-document-storage.js";
import type {
  CompleteDeterministicValidationInput,
  RevisionValidation,
} from "../../application/revision-validation.js";
import { ObjectPublicationCoordinator } from "./publication.js";
import { sql, type SqlDatabase, type SqlRow } from "./sql.js";

interface ValidationRow extends SqlRow {
  readonly content_sha256: unknown;
  readonly document_object_id: unknown;
  readonly document_schema_version: unknown;
  readonly draft_id: unknown;
  readonly draft_version: unknown;
  readonly lifecycle_status: unknown;
  readonly organization_id: unknown;
  readonly project_id: unknown;
  readonly report_object_id: unknown;
  readonly report_sha256: unknown;
  readonly semantic_sha256: unknown;
  readonly validation_run_id: unknown;
  readonly visual_sha256: unknown;
}

interface VerifiedDraft {
  readonly metadata: DraftMetadataRecord;
  readonly object: StoredObjectState;
  readonly storage: ArchitectureDocumentStorage;
}

export type {
  CompleteDeterministicValidationInput,
  RevisionValidation,
} from "../../application/revision-validation.js";

export type ValidationEnvironment =
  | "development"
  | "test"
  | "staging"
  | "production"
  | "disaster-recovery"
  | "multi-environment"
  | "unknown";

const MAX_ARCHITECTURE_DOCUMENT_BYTES = 4 * 1024 * 1024;

function unavailable(): never {
  throw new RepositoryError(
    "persistence-unavailable",
    "The stored Architecture Document could not be validated.",
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

async function readBoundedBytes(
  scope: AuthorizedOrganizationScope,
  objectStore: ObjectStore,
  object: StoredObjectState,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(object.sizeBytes) ||
    object.sizeBytes < 0 ||
    object.sizeBytes > MAX_ARCHITECTURE_DOCUMENT_BYTES
  ) {
    return unavailable();
  }
  const stream = await objectStore.open(scope, object);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) {
      return unavailable();
    }
    size += chunk.byteLength;
    if (size > object.sizeBytes || size > MAX_ARCHITECTURE_DOCUMENT_BYTES) {
      return unavailable();
    }
    chunks.push(chunk);
  }
  if (size !== object.sizeBytes) {
    return unavailable();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new RepositoryError(
      "persistence-unavailable",
      "Validation persistence is unavailable.",
    );
  }
  return value;
}

function readVersion(value: unknown): number {
  const version = typeof value === "bigint" ? Number(value) : value;
  if (typeof version !== "number" || !Number.isSafeInteger(version)) {
    throw new RepositoryError(
      "persistence-unavailable",
      "Validation persistence is unavailable.",
    );
  }
  return version;
}

function evidenceBytes(
  input: CompleteDeterministicValidationInput,
  verified: VerifiedDraft,
): Uint8Array {
  return new TextEncoder().encode(
    serializeCanonicalJson({
      checks: [
        "architecture-document-v3-schema",
        "provider-neutral-semantic-invariants",
        "canonical-storage-encoding",
        "exact-draft-identity",
        "published-object-metadata",
        "exact-digest-binding",
      ],
      complete: true,
      contractVersion: 1,
      document: {
        contentHash: `sha256:${input.contentSha256}`,
        semanticHash: `sha256:${input.semanticSha256}`,
        visualHash: `sha256:${input.visualSha256}`,
      },
      findings: [],
      input: {
        draftId: input.draftId,
        draftVersion: input.draftVersion,
        projectId: input.projectId,
      },
      kind: "cloudmarkup.deterministic-validation-report",
      source: {
        draft: {
          documentObjectId: verified.metadata.documentObjectId,
          documentSchemaVersion: verified.metadata.documentSchemaVersion,
        },
        object: {
          objectId: verified.object.objectId,
          objectVersion: verified.object.objectVersion,
          sizeBytes: verified.storage.bytes.byteLength,
        },
      },
      validator: {
        id: "cloudmarkup.deterministic-contract-validator",
        version: "1.0.0",
      },
    }),
  );
}

function assertReplay(
  row: ValidationRow,
  scope: AuthorizedOrganizationScope,
  input: CompleteDeterministicValidationInput,
  reportObject: StoredObjectReference,
  source: VerifiedDraft,
): void {
  const lifecycle = readString(row.lifecycle_status);
  if (
    readString(row.validation_run_id) !== input.validationRunId ||
    readString(row.organization_id) !== scope.organizationId ||
    readString(row.project_id) !== input.projectId ||
    readString(row.draft_id) !== input.draftId ||
    readVersion(row.draft_version) !== input.draftVersion ||
    readVersion(row.document_schema_version) !==
      source.metadata.documentSchemaVersion ||
    readString(row.document_object_id) !== source.object.objectId ||
    readString(row.content_sha256) !== input.contentSha256 ||
    readString(row.semantic_sha256) !== input.semanticSha256 ||
    readString(row.visual_sha256) !== input.visualSha256 ||
    readString(row.report_object_id) !== reportObject.objectId ||
    readString(row.report_sha256) !== reportObject.contentSha256 ||
    (lifecycle !== "running" && lifecycle !== "succeeded")
  ) {
    throw new RepositoryError(
      "idempotency-conflict",
      "The validation request conflicts with an earlier request.",
    );
  }
}

export interface DeterministicValidationBridgeOptions {
  readonly database: SqlDatabase;
  readonly environment?: ValidationEnvironment;
  readonly identifierNamespace: string;
  readonly objectStore: ObjectStore;
  readonly repository: CloudMarkupRepository;
}

export class DeterministicValidationBridge implements RevisionValidation {
  readonly #database: SqlDatabase;
  readonly #environment: string;
  readonly #identifierNamespace: string;
  readonly #objectStore: ObjectStore;
  readonly #publication: ObjectPublicationCoordinator;
  readonly #repository: CloudMarkupRepository;

  constructor(input: DeterministicValidationBridgeOptions) {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(input.identifierNamespace)) {
      throw new TypeError("The validation identifier namespace is invalid.");
    }
    this.#database = input.database;
    this.#environment = input.environment ?? "unknown";
    this.#identifierNamespace = input.identifierNamespace;
    this.#objectStore = input.objectStore;
    this.#repository = input.repository;
    this.#publication = new ObjectPublicationCoordinator(
      input.repository,
      input.objectStore,
    );
  }

  async ensureComplete(
    scope: AuthorizedOrganizationScope,
    input: CompleteDeterministicValidationInput,
  ): Promise<void> {
    if (!scope.capabilities.includes("revisions.create")) {
      throw new RepositoryError(
        "access-denied",
        "The current membership cannot validate immutable revisions.",
      );
    }
    const verified = await this.#verifyDraft(scope, input);
    const bytes = evidenceBytes(input, verified);
    const reportSha256 = createHash("sha256").update(bytes).digest("hex");
    const suffix = createHash("sha256")
      .update(input.validationRunId, "utf8")
      .digest("hex")
      .slice(0, 24);
    const object = await this.#publication.publish(
      scope,
      {
        contentSha256: reportSha256,
        mediaType: "application/json",
        objectId: `object_${this.#identifierNamespace}_validation_${suffix}`,
        open: async function* open(): AsyncIterable<Uint8Array> {
          yield bytes;
          await Promise.resolve();
        },
        owner: {
          organizationId: scope.organizationId,
          projectId: input.projectId,
        },
        purpose: "validation-report",
        sizeBytes: bytes.byteLength,
      },
      async (stagedObject) => {
        await this.#ensurePending(scope, input, stagedObject, verified);
        return stagedObject;
      },
    );
    const published = await this.#objectStore.head(scope, object);
    if (
      published?.contentSha256 !== object.contentSha256 ||
      published.objectId !== object.objectId ||
      published.objectVersion !== object.objectVersion
    ) {
      throw new RepositoryError(
        "persistence-unavailable",
        "Published validation evidence could not be verified.",
      );
    }
    await this.#complete(scope, input, object, verified);
  }

  async #verifyDraft(
    scope: AuthorizedOrganizationScope,
    input: CompleteDeterministicValidationInput,
  ): Promise<VerifiedDraft> {
    const metadata = await this.#repository.getDraft(scope, input.projectId);
    if (
      metadata?.draftId !== input.draftId ||
      metadata.draftVersion !== input.draftVersion ||
      metadata.projectId !== input.projectId ||
      metadata.contentSha256 !== input.contentSha256 ||
      metadata.semanticSha256 !== input.semanticSha256 ||
      metadata.visualSha256 !== input.visualSha256
    ) {
      throw new RepositoryError(
        "version-conflict",
        "The exact draft changed before validation completed.",
      );
    }
    if (
      metadata.organizationId !== scope.organizationId ||
      metadata.documentSchemaVersion !== 3
    ) {
      return unavailable();
    }

    const object = await this.#repository.getObject(
      scope,
      metadata.documentObjectId,
    );
    if (
      object?.lifecycleState !== "published" ||
      object.objectId !== metadata.documentObjectId ||
      object.owner.organizationId !== scope.organizationId ||
      object.owner.projectId !== input.projectId ||
      object.purpose !== "architecture-draft" ||
      object.mediaType !== "application/json" ||
      object.contentSha256 !== metadata.contentSha256
    ) {
      return unavailable();
    }

    const bytes = await readBoundedBytes(scope, this.#objectStore, object);
    let storage: ArchitectureDocumentStorage;
    try {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const decoded: unknown = JSON.parse(source);
      if (
        typeof decoded !== "object" ||
        decoded === null ||
        Array.isArray(decoded) ||
        (decoded as Readonly<Record<string, unknown>>)["schemaVersion"] !== 3
      ) {
        return unavailable();
      }
      const document = parseArchitectureDocument(decoded);
      if (document.revision.sourceDraftId !== metadata.draftId) {
        return unavailable();
      }
      storage = getArchitectureDocumentStorage(document);
    } catch {
      return unavailable();
    }

    if (
      !bytesEqual(bytes, storage.bytes) ||
      storage.contentSha256 !== input.contentSha256 ||
      storage.contentSha256 !== metadata.contentSha256 ||
      storage.contentSha256 !== object.contentSha256 ||
      storage.semanticSha256 !== input.semanticSha256 ||
      storage.semanticSha256 !== metadata.semanticSha256 ||
      storage.visualSha256 !== input.visualSha256 ||
      storage.visualSha256 !== metadata.visualSha256
    ) {
      return unavailable();
    }

    return { metadata, object, storage };
  }

  async #ensurePending(
    scope: AuthorizedOrganizationScope,
    input: CompleteDeterministicValidationInput,
    reportObject: StoredObjectReference,
    source: VerifiedDraft,
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      const authorized = await transaction.query(
        sql(
          `SELECT 1
           FROM memberships m
           JOIN projects p
             ON p.organization_id = m.organization_id
            AND p.project_id = $4
            AND p.lifecycle_status = 'active'
           JOIN architecture_drafts d
             ON d.organization_id = p.organization_id
            AND d.project_id = p.project_id
            AND d.draft_id = $5
            AND d.draft_version = $6
            AND d.document_schema_version = $13
            AND d.content_sha256 = $7
            AND d.semantic_sha256 = $8
            AND d.visual_sha256 = $9
            AND d.pending_document_object_id IS NULL
           JOIN stored_objects source_object
             ON source_object.organization_id = d.organization_id
            AND source_object.project_id = d.project_id
            AND source_object.object_id = d.document_object_id
            AND source_object.object_id = $10
            AND source_object.object_version = $11
            AND source_object.content_sha256 = $7
            AND source_object.size_bytes = $12
            AND source_object.object_purpose = 'architecture-draft'
            AND source_object.media_type = 'application/json'
            AND source_object.lifecycle_state = 'published'
           WHERE m.membership_id = $1
             AND m.principal_id = $2
             AND m.organization_id = $3
             AND m.lifecycle_status = 'active'`,
          [
            scope.membershipId,
            scope.principalId,
            scope.organizationId,
            input.projectId,
            input.draftId,
            input.draftVersion,
            input.contentSha256,
            input.semanticSha256,
            input.visualSha256,
            source.object.objectId,
            source.object.objectVersion,
            source.object.sizeBytes,
            source.metadata.documentSchemaVersion,
          ],
        ),
      );
      if (authorized.rows[0] === undefined) {
        throw new RepositoryError(
          "version-conflict",
          "The exact draft changed before validation completed.",
        );
      }

      const existing = await transaction.query<ValidationRow>(
        sql(
          `SELECT v.validation_run_id, v.organization_id, v.project_id,
                  v.draft_id, v.draft_version, v.lifecycle_status,
                  v.report_object_id, v.report_sha256,
                  d.document_schema_version, d.document_object_id,
                  d.content_sha256, d.semantic_sha256, d.visual_sha256
           FROM validation_runs v
           JOIN architecture_drafts d
             ON d.organization_id = v.organization_id
            AND d.project_id = v.project_id
            AND d.draft_id = v.draft_id
            AND d.draft_version = v.draft_version
           WHERE v.validation_run_id = $1`,
          [input.validationRunId],
        ),
      );
      const existingRow = existing.rows[0];
      if (existingRow !== undefined) {
        assertReplay(existingRow, scope, input, reportObject, source);
        return;
      }

      await transaction.query(
        sql(
          `INSERT INTO stored_objects (
             object_id, organization_id, project_id, storage_provider,
             object_purpose, storage_key, object_version, entity_tag,
             content_sha256, size_bytes, media_type, created_by_principal_id
           ) VALUES ($1, $2, $3, $4, 'validation-report', $5, $6, $7,
                     $8, $9, $10, $11)`,
          [
            reportObject.objectId,
            scope.organizationId,
            input.projectId,
            reportObject.storageProvider,
            reportObject.storageKey,
            reportObject.objectVersion,
            reportObject.entityTag ?? null,
            reportObject.contentSha256,
            reportObject.sizeBytes,
            reportObject.mediaType,
            scope.principalId,
          ],
        ),
      );
      await transaction.query(
        sql(
          `INSERT INTO validation_runs (
             validation_run_id, organization_id, project_id, input_kind,
             draft_id, draft_version, environment, target, lifecycle_status,
             report_object_id, report_sha256, created_by_principal_id,
             started_at
           ) VALUES ($1, $2, $3, 'draft', $4, $5, $9, 'draft',
                     'running', $6, $7, $8, CURRENT_TIMESTAMP)`,
          [
            input.validationRunId,
            scope.organizationId,
            input.projectId,
            input.draftId,
            input.draftVersion,
            reportObject.objectId,
            reportObject.contentSha256,
            scope.principalId,
            this.#environment,
          ],
        ),
      );
    });
  }

  async #complete(
    scope: AuthorizedOrganizationScope,
    input: CompleteDeterministicValidationInput,
    reportObject: StoredObjectReference,
    source: VerifiedDraft,
  ): Promise<void> {
    const result = await this.#database.query(
      sql(
        `UPDATE validation_runs v
         SET lifecycle_status = 'succeeded',
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
         FROM stored_objects report_object,
              architecture_drafts d,
              stored_objects source_object
         WHERE v.validation_run_id = $1
           AND v.organization_id = $2
           AND v.project_id = $3
           AND v.draft_id = $4
           AND v.draft_version = $5
           AND v.report_object_id = $6
           AND v.report_sha256 = $7
           AND v.lifecycle_status IN ('running', 'succeeded')
           AND d.organization_id = v.organization_id
           AND d.project_id = v.project_id
           AND d.draft_id = v.draft_id
           AND d.draft_version = v.draft_version
           AND d.document_schema_version = $8
           AND d.document_object_id = $9
           AND d.content_sha256 = $10
           AND d.semantic_sha256 = $11
           AND d.visual_sha256 = $12
           AND d.pending_document_object_id IS NULL
           AND source_object.organization_id = d.organization_id
           AND source_object.project_id = d.project_id
           AND source_object.object_id = d.document_object_id
           AND source_object.object_version = $13
           AND source_object.content_sha256 = d.content_sha256
           AND source_object.size_bytes = $14
           AND source_object.object_purpose = 'architecture-draft'
           AND source_object.media_type = 'application/json'
           AND source_object.lifecycle_state = 'published'
           AND report_object.organization_id = v.organization_id
           AND report_object.project_id = v.project_id
           AND report_object.object_id = v.report_object_id
           AND report_object.object_version = $15
           AND report_object.content_sha256 = v.report_sha256
           AND report_object.size_bytes = $16
           AND report_object.object_purpose = 'validation-report'
           AND report_object.media_type = 'application/json'
           AND report_object.lifecycle_state = 'published'`,
        [
          input.validationRunId,
          scope.organizationId,
          input.projectId,
          input.draftId,
          input.draftVersion,
          reportObject.objectId,
          reportObject.contentSha256,
          source.metadata.documentSchemaVersion,
          source.object.objectId,
          source.storage.contentSha256,
          source.storage.semanticSha256,
          source.storage.visualSha256,
          source.object.objectVersion,
          source.object.sizeBytes,
          reportObject.objectVersion,
          reportObject.sizeBytes,
        ],
      ),
    );
    if (result.rowCount !== 1) {
      throw new RepositoryError(
        "persistence-unavailable",
        "Validation evidence could not be completed.",
      );
    }
  }
}
