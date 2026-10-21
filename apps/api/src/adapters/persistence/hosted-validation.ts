import { createHash } from "node:crypto";

import {
  createValidationRunV1Schema,
  validationRunV1Schema,
  validationSummaryV1Schema,
  type CreateValidationRunV1,
  type ValidationRunV1,
} from "@cloudmarkup/api-contract";
import {
  parseArchitectureDocument,
  validateArchitectureDocumentWithRules,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import {
  AWS_CATALOG_DIGEST_V1,
  awsCatalogV1,
} from "@cloudmarkup/provider-aws/catalog";
import { awsValidationRulesV1 } from "@cloudmarkup/provider-aws/validation";
import { validateProviderConfigurationV1 } from "@cloudmarkup/provider-sdk";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";

import { getArchitectureDocumentStorage } from "../../application/architecture-document-storage.js";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type {
  AuthorizedOrganizationScope,
  CloudMarkupRepository,
  ObjectStore,
  StoredObjectReference,
  StoredObjectState,
} from "../../application/persistence.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "../../application/ports.js";
import { ObjectPublicationCoordinator } from "./publication.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const REPORT_KIND = "cloudmarkup.hosted-provider-validation.v1";
const OPERATION = "validation-runs.create";
const MAX_BYTES = 4 * 1024 * 1024;

function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "Stored validation evidence is unavailable.",
  );
}
function notFound(): never {
  throw new ApplicationError(
    "not_found",
    "The requested resource is unavailable.",
  );
}
function conflict(): never {
  throw new ApplicationError(
    "idempotency_key_reused",
    "The idempotency key was reused for different input.",
  );
}
function hash(value: unknown): string {
  return createHash("sha256")
    .update(serializeCanonicalJson(value))
    .digest("hex");
}
function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || value.length === 0) return unavailable();
  return value;
}

function timestamp(value: unknown): string {
  const raw = text(value);
  const dataApi = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u.test(
    raw,
  );
  const date = new Date(dataApi ? `${raw.replace(" ", "T")}Z` : raw);
  return Number.isNaN(date.valueOf()) ? unavailable() : date.toISOString();
}

/** Pure provider composition; the domain stays provider-neutral and never reads storage. */
export function evaluateHostedAwsValidation(
  document: ArchitectureDocument,
  input: CreateValidationRunV1,
) {
  const artifact = awsCatalogV1.artifact;
  if (
    document.provider.id !== artifact.provider.id ||
    document.catalog.id !== artifact.catalog.id ||
    document.catalog.version !== artifact.catalog.version ||
    document.catalog.digest !== AWS_CATALOG_DIGEST_V1
  ) {
    throw new ApplicationError(
      "invalid_request",
      "Validation requires the current reviewed AWS catalog. Open and save this project in the editor first.",
    );
  }
  for (const node of document.nodes) {
    const service = awsCatalogV1.getService(node.semantic.serviceType);
    if (
      service === undefined ||
      (service.nodeKind.kind === "resource"
        ? service.nodeKind.resourceType
        : service.nodeKind.boundaryType) !== node.semantic.resourceType ||
      service.configuration.schemaId !== node.semantic.configuration.schemaId ||
      service.configuration.schemaVersion !==
        node.semantic.configuration.schemaVersion ||
      !awsCatalogV1.validateConfiguration(
        service.id,
        node.semantic.configuration.values,
      ).success
    ) {
      throw new ApplicationError(
        "invalid_request",
        "The document contains an unsupported AWS resource or invalid resource configuration.",
      );
    }
  }
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const relationships = awsCatalogV1.listConnectionRules();
  for (const edge of document.edges) {
    const source = nodes.get(edge.semantic.source.nodeId);
    const target = nodes.get(edge.semantic.target.nodeId);
    const relationship = relationships.find(
      (candidate) =>
        candidate.relationshipType === edge.semantic.relationshipType &&
        candidate.source.serviceId === source?.semantic.serviceType &&
        candidate.target.serviceId === target?.semantic.serviceType &&
        candidate.source.portId === edge.semantic.source.port &&
        candidate.target.portId === edge.semantic.target.port &&
        candidate.configuration.schemaId ===
          edge.semantic.configuration.schemaId &&
        candidate.configuration.schemaVersion ===
          edge.semantic.configuration.schemaVersion,
    );
    if (
      relationship === undefined ||
      !validateProviderConfigurationV1(
        relationship.configuration,
        edge.semantic.configuration.values,
      ).success
    ) {
      throw new ApplicationError(
        "invalid_request",
        "The document contains an unsupported AWS relationship or invalid relationship configuration.",
      );
    }
  }
  const inventory = awsCatalogV1.createPortInventory(
    document.nodes.map((node) => ({
      nodeId: node.id,
      serviceId: node.semantic.serviceType,
    })),
    "complete",
  );
  return validateArchitectureDocumentWithRules({
    additionalRules: awsValidationRulesV1,
    document,
    environment: input.environment,
    portInventory: inventory,
    target: input.target,
  });
}

export interface HostedValidationOptions {
  readonly database: SqlDatabase;
  readonly documentStore: ObjectStore;
  readonly reportStore: ObjectStore;
  readonly repository: CloudMarkupRepository;
  readonly organizationForProject: (
    principal: PrincipalContext,
    projectId: string,
  ) => Promise<string | null>;
}

type ValidationApplication = Pick<
  CloudMarkupApplication,
  "createValidationRun" | "getValidationRun"
>;

// A fresh authorization check is made inside every persistence transaction.
// Locks serialize source-version selection with draft updates/project deletion.
async function authorize(
  executor: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  projectId: string,
  write: boolean,
): Promise<void> {
  const result = await executor.query(
    sql(
      `SELECT m.role_key
    FROM memberships m
    JOIN principals u ON u.principal_id = m.principal_id AND u.lifecycle_status = 'active'
    JOIN organizations o ON o.organization_id = m.organization_id AND o.lifecycle_status = 'active'
    JOIN organization_roles r ON r.organization_id = m.organization_id AND r.role_key = m.role_key AND r.policy_version = 'authorization-v2'
    JOIN projects p ON p.organization_id = m.organization_id AND p.project_id = $4 AND p.lifecycle_status = 'active'
    WHERE m.membership_id = $1 AND m.principal_id = $2 AND m.organization_id = $3 AND m.lifecycle_status = 'active'
    FOR SHARE OF m, u, o, r, p`,
      [scope.membershipId, scope.principalId, scope.organizationId, projectId],
    ),
  );
  const role = result.rows[0]?.["role_key"];
  if (
    result.rows.length !== 1 ||
    typeof role !== "string" ||
    !isOrganizationRole(role)
  )
    return notFound();
  if (
    role !== scope.roleKey ||
    !permissionsForRole(role).includes(
      write ? "validation.run" : "projects.read",
    )
  ) {
    throw new ApplicationError(
      "access_denied",
      "This action is not available for the current account.",
    );
  }
}

async function readJson(
  store: ObjectStore,
  scope: AuthorizedOrganizationScope,
  object: StoredObjectState,
): Promise<unknown> {
  if (
    !Number.isSafeInteger(object.sizeBytes) ||
    object.sizeBytes < 1 ||
    object.sizeBytes > MAX_BYTES ||
    object.mediaType !== "application/json"
  )
    return unavailable();
  const bytes = new Uint8Array(object.sizeBytes);
  let size = 0;
  for await (const chunk of await store.open(scope, object)) {
    if (
      !(chunk instanceof Uint8Array) ||
      size + chunk.byteLength > bytes.length
    )
      return unavailable();
    bytes.set(chunk, size);
    size += chunk.byteLength;
  }
  if (
    size !== bytes.length ||
    createHash("sha256").update(bytes).digest("hex") !== object.contentSha256
  )
    return unavailable();
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const decoded: unknown = JSON.parse(source);
    if (serializeCanonicalJson(decoded) !== source) return unavailable();
    return decoded;
  } catch {
    return unavailable();
  }
}

export function createHostedValidationOverrides(
  options: HostedValidationOptions,
): ValidationApplication {
  const { repository, database, documentStore, reportStore } = options;
  const publication = new ObjectPublicationCoordinator(repository, reportStore);

  async function scopeFor(
    principal: PrincipalContext,
    projectId: string,
    write: boolean,
  ) {
    const organizationId = await options.organizationForProject(
      principal,
      projectId,
    );
    if (organizationId === null) return notFound();
    const scope = await repository.resolveOrganizationScope(
      principal,
      organizationId,
    );
    if (
      scope?.organizationId !== organizationId ||
      scope.principalId !== principal.principalId ||
      !isOrganizationRole(scope.roleKey)
    )
      return notFound();
    const permission = write ? "validation.run" : "projects.read";
    if (
      !scope.capabilities.includes(permission) ||
      !permissionsForRole(scope.roleKey).includes(permission)
    )
      throw new ApplicationError(
        "access_denied",
        "This action is not available for the current account.",
      );
    return scope;
  }

  async function rowFor(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    id: string,
  ): Promise<SqlRow | undefined> {
    return database.transaction(async (tx) => {
      await authorize(tx, scope, projectId, false);
      // Internal revision-integrity evidence has no public creation receipt and
      // cannot be exposed as a provider validation result.
      const result = await tx.query(
        sql(
          `SELECT v.*, i.request_sha256 FROM validation_runs v
        JOIN idempotency_records i ON i.organization_id = v.organization_id
          AND i.operation_name = 'validation-runs.create' AND i.resource_kind = 'validation-run'
          AND i.resource_id = v.validation_run_id AND i.principal_id = v.created_by_principal_id
        WHERE v.organization_id = $1 AND v.project_id = $2 AND v.validation_run_id = $3`,
          [scope.organizationId, projectId, id],
        ),
      );
      return result.rows[0];
    });
  }

  async function reportObject(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    row: SqlRow,
  ) {
    const object = await repository.getObject(
      scope,
      text(row["report_object_id"]),
    );
    if (
      object?.owner.organizationId !== scope.organizationId ||
      object.owner.projectId !== projectId ||
      object.purpose !== "validation-report" ||
      object.contentSha256 !== row["report_sha256"]
    )
      return unavailable();
    return object;
  }

  async function response(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    row: SqlRow,
  ): Promise<ValidationRunV1> {
    const input =
      row["input_kind"] === "draft"
        ? {
            kind: "draft",
            draftId: text(row["draft_id"]),
            draftVersion: Number(row["draft_version"]),
          }
        : { kind: "revision", revisionId: text(row["revision_id"]) };
    const base = validationRunV1Schema.parse({
      id: row["validation_run_id"],
      projectId,
      input,
      target: row["target"],
      status: row["lifecycle_status"],
      createdAt: timestamp(row["created_at"]),
      ...(row["completed_at"] == null
        ? {}
        : { completedAt: timestamp(row["completed_at"]) }),
    });
    if (base.status !== "succeeded") return base;
    const object = await reportObject(scope, projectId, row);
    if (object.lifecycleState !== "published") return unavailable();
    const evidence = await readJson(reportStore, scope, object);
    if (
      typeof evidence !== "object" ||
      evidence === null ||
      Array.isArray(evidence)
    )
      return unavailable();
    const record = evidence as Record<string, unknown>;
    if (
      record["kind"] !== REPORT_KIND ||
      record["requestSha256"] !== row["request_sha256"] ||
      record["projectId"] !== projectId ||
      record["organizationId"] !== scope.organizationId ||
      record["validationRunId"] !== base.id
    )
      return unavailable();
    const summary = validationSummaryV1Schema.parse(record["summary"]);
    return { ...base, summary };
  }

  async function finish(
    scope: AuthorizedOrganizationScope,
    projectId: string,
    row: SqlRow,
  ) {
    const object = await reportObject(scope, projectId, row);
    await publication.recover(scope, object);
    // Digest-verify the immutable evidence before marking the run complete.
    await readJson(reportStore, scope, {
      ...object,
      lifecycleState: "published",
    });
    await database.transaction(async (tx) => {
      await authorize(tx, scope, projectId, true);
      const result = await tx.query(
        sql(
          `UPDATE validation_runs v SET lifecycle_status = 'succeeded', completed_at = COALESCE(v.completed_at, CURRENT_TIMESTAMP)
        FROM stored_objects o WHERE v.organization_id = $1 AND v.project_id = $2 AND v.validation_run_id = $3
          AND v.lifecycle_status IN ('running', 'succeeded') AND o.organization_id = v.organization_id AND o.project_id = v.project_id
          AND o.object_id = v.report_object_id AND o.content_sha256 = v.report_sha256 AND o.lifecycle_state = 'published'`,
          [scope.organizationId, projectId, text(row["validation_run_id"])],
        ),
      );
      if (result.rowCount !== 1) return unavailable();
      await tx.query(
        sql(
          `UPDATE idempotency_records SET lifecycle_status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
        WHERE organization_id = $1 AND principal_id = $2 AND operation_name = 'validation-runs.create' AND resource_id = $3`,
          [
            scope.organizationId,
            text(row["created_by_principal_id"]),
            text(row["validation_run_id"]),
          ],
        ),
      );
    });
    const completed = await rowFor(
      scope,
      projectId,
      text(row["validation_run_id"]),
    );
    return completed === undefined
      ? unavailable()
      : response(scope, projectId, completed);
  }

  async function create(
    principal: PrincipalContext,
    projectId: string,
    raw: CreateValidationRunV1,
    idempotencyKey: string,
  ): Promise<ValidationRunV1> {
    const input = createValidationRunV1Schema.parse(raw);
    if (!/^[\x21-\x7e]{16,128}$/u.test(idempotencyKey))
      throw new ApplicationError(
        "invalid_request",
        "The idempotency key is invalid.",
      );
    const scope = await scopeFor(principal, projectId, true);
    const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
    const requestHash = hash({ projectId, input });
    // Deliberately omit projectId: one key is scoped to principal + organization
    // + operation, so reuse for another project conflicts, never creates twice.
    const id = `validation_hosted_${hash([scope.organizationId, scope.principalId, OPERATION, keyHash]).slice(0, 32)}`;
    const requireMatchingReceipt = () =>
      database.transaction(async (tx) => {
        await authorize(tx, scope, projectId, true);
        const receipt = (
          await tx.query(
            sql(
              `SELECT request_sha256, resource_id FROM idempotency_records
        WHERE organization_id = $1 AND principal_id = $2 AND operation_name = 'validation-runs.create' AND idempotency_key_sha256 = $3`,
              [scope.organizationId, scope.principalId, keyHash],
            ),
          )
        ).rows[0];
        if (
          receipt !== undefined &&
          (receipt["request_sha256"] !== requestHash ||
            receipt["resource_id"] !== id)
        )
          return conflict();
      });
    await requireMatchingReceipt();
    const existing = await rowFor(scope, projectId, id);
    if (existing !== undefined) {
      if (existing["request_sha256"] !== requestHash) return conflict();
      return existing["lifecycle_status"] === "succeeded"
        ? response(scope, projectId, existing)
        : finish(scope, projectId, existing);
    }
    const source =
      input.input.kind === "draft"
        ? await repository.getDraft(scope, projectId)
        : await repository.getRevision(
            scope,
            projectId,
            input.input.revisionId,
          );
    if (
      source?.organizationId !== scope.organizationId ||
      source.projectId !== projectId
    )
      return notFound();
    if (
      input.input.kind === "draft" &&
      (!("draftId" in source) ||
        source.draftId !== input.input.draftId ||
        source.draftVersion !== input.input.draftVersion)
    )
      throw new ApplicationError(
        "precondition_failed",
        "The draft changed. Save and validate its current version.",
      );
    const object = await repository.getObject(scope, source.documentObjectId);
    if (
      object?.lifecycleState !== "published" ||
      object.owner.organizationId !== scope.organizationId ||
      object.owner.projectId !== projectId ||
      object.purpose !==
        (input.input.kind === "draft"
          ? "architecture-draft"
          : "architecture-revision") ||
      object.contentSha256 !== source.contentSha256
    )
      return unavailable();
    const document = parseArchitectureDocument(
      await readJson(documentStore, scope, object),
    );
    const storage = getArchitectureDocumentStorage(document);
    if (
      storage.contentSha256 !== source.contentSha256 ||
      storage.semanticSha256 !== source.semanticSha256 ||
      storage.visualSha256 !== source.visualSha256 ||
      (input.input.kind === "draft"
        ? document.revision.sourceDraftId !== input.input.draftId
        : document.revision.revisionId !== input.input.revisionId)
    )
      return unavailable();
    const report = evaluateHostedAwsValidation(document, input);
    const summary = validationSummaryV1Schema.parse({
      complete:
        report.evaluationStatus === "complete" &&
        report.findings.length <= 1000,
      reportId: id,
      findingCounts: {
        costWarning: report.summary["cost-warning"],
        educationalNote: report.summary["educational-note"],
        error: report.summary.error,
        recommendation: report.summary.recommendation,
        securityError: report.summary["security-error"],
        warning: report.summary.warning,
      },
      findings: report.findings.slice(0, 1000).map((f) => ({
        affectedPaths: f.affected.map((a) => a.path).slice(0, 100),
        code: f.code,
        id: f.findingId,
        ruleId: f.rules[0]?.ruleId,
        severity: f.severity,
        title: f.title.slice(0, 120),
      })),
    });
    const bytes = new TextEncoder().encode(
      serializeCanonicalJson({
        kind: REPORT_KIND,
        validationRunId: id,
        projectId,
        organizationId: scope.organizationId,
        requestSha256: requestHash,
        input,
        source,
        report,
        summary,
      }),
    );
    if (bytes.length > MAX_BYTES)
      throw new ApplicationError(
        "payload_too_large",
        "Validation evidence exceeds the supported report size.",
      );
    try {
      await publication.publish(
        scope,
        {
          objectId: `object_${id}`,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          mediaType: "application/json",
          owner: { organizationId: scope.organizationId, projectId },
          purpose: "validation-report",
          sizeBytes: bytes.length,
          open: async function* () {
            yield bytes;
            await Promise.resolve();
          },
        },
        async (staged) => {
          await database.transaction(async (tx) => {
            await authorize(tx, scope, projectId, true);
            await tx.query(
              sql(
                `INSERT INTO idempotency_records (organization_id, principal_id, operation_name, idempotency_key_sha256, request_sha256, resource_kind, resource_id)
          VALUES ($1, $2, 'validation-runs.create', $3, $4, 'validation-run', $5) ON CONFLICT DO NOTHING`,
                [
                  scope.organizationId,
                  scope.principalId,
                  keyHash,
                  requestHash,
                  id,
                ],
              ),
            );
            const receipt = (
              await tx.query(
                sql(
                  `SELECT request_sha256, resource_id FROM idempotency_records
          WHERE organization_id = $1 AND principal_id = $2 AND operation_name = 'validation-runs.create' AND idempotency_key_sha256 = $3 FOR UPDATE`,
                  [scope.organizationId, scope.principalId, keyHash],
                ),
              )
            ).rows[0];
            if (
              receipt?.["request_sha256"] !== requestHash ||
              receipt["resource_id"] !== id
            )
              return conflict();
            const prior = (
              await tx.query(
                sql(
                  `SELECT report_object_id, report_sha256 FROM validation_runs WHERE organization_id = $1 AND project_id = $2 AND validation_run_id = $3`,
                  [scope.organizationId, projectId, id],
                ),
              )
            ).rows[0];
            if (prior !== undefined) {
              if (
                prior["report_object_id"] !== staged.objectId ||
                prior["report_sha256"] !== staged.contentSha256
              )
                return conflict();
              return;
            }
            const sourceQuery =
              input.input.kind === "draft"
                ? sql(
                    `SELECT 1 FROM architecture_drafts WHERE organization_id = $1 AND project_id = $2 AND draft_id = $3 AND draft_version = $4 AND document_object_id = $5 AND content_sha256 = $6 AND pending_document_object_id IS NULL FOR SHARE`,
                    [
                      scope.organizationId,
                      projectId,
                      input.input.draftId,
                      input.input.draftVersion,
                      object.objectId,
                      source.contentSha256,
                    ],
                  )
                : sql(
                    `SELECT 1 FROM architecture_revisions WHERE organization_id = $1 AND project_id = $2 AND revision_id = $3 AND document_object_id = $4 AND content_sha256 = $5 FOR SHARE`,
                    [
                      scope.organizationId,
                      projectId,
                      input.input.revisionId,
                      object.objectId,
                      source.contentSha256,
                    ],
                  );
            if ((await tx.query(sourceQuery)).rows.length !== 1)
              throw new ApplicationError(
                "precondition_failed",
                "The validation source changed. Refresh and try again.",
              );
            await insertReport(tx, scope, projectId, staged);
            await tx.query(
              sql(
                `INSERT INTO validation_runs (validation_run_id, organization_id, project_id, input_kind, draft_id, draft_version, revision_id, environment, target, lifecycle_status, report_object_id, report_sha256, created_by_principal_id, started_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running', $10, $11, $12, CURRENT_TIMESTAMP)`,
                [
                  id,
                  scope.organizationId,
                  projectId,
                  input.input.kind,
                  input.input.kind === "draft" ? input.input.draftId : null,
                  input.input.kind === "draft"
                    ? input.input.draftVersion
                    : null,
                  input.input.kind === "revision"
                    ? input.input.revisionId
                    : null,
                  input.environment,
                  input.target,
                  staged.objectId,
                  staged.contentSha256,
                  scope.principalId,
                ],
              ),
            );
          });
          return staged;
        },
      );
    } catch (error) {
      // A concurrent request can commit this key after the first read. Object
      // recovery may then report a content/owner conflict instead of the SQL
      // conflict; only a freshly authorized, differing receipt establishes 409.
      await requireMatchingReceipt();
      throw error;
    }
    const persisted = await rowFor(scope, projectId, id);
    return persisted === undefined
      ? unavailable()
      : finish(scope, projectId, persisted);
  }

  async function safe<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      return unavailable();
    }
  }
  return {
    createValidationRun: (...args) => safe(() => create(...args)),
    getValidationRun: (principal, projectId, id) =>
      safe(async () => {
        const scope = await scopeFor(principal, projectId, false);
        const row = await rowFor(scope, projectId, id);
        return row === undefined ? notFound() : response(scope, projectId, row);
      }),
  };
}

async function insertReport(
  tx: SqlExecutor,
  scope: AuthorizedOrganizationScope,
  projectId: string,
  object: StoredObjectReference,
): Promise<void> {
  await tx.query(
    sql(
      `INSERT INTO stored_objects (object_id, organization_id, project_id, storage_provider, object_purpose, storage_key, object_version, entity_tag, content_sha256, size_bytes, media_type, created_by_principal_id)
    VALUES ($1, $2, $3, $4, 'validation-report', $5, $6, $7, $8, $9, $10, $11)`,
      [
        object.objectId,
        scope.organizationId,
        projectId,
        object.storageProvider,
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
