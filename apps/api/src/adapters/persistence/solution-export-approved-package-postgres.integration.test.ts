import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { workflowFixture } from "@cloudmarkup/solution-export-workflow/testing";
import { FakeGitHubAppAdapter } from "@cloudmarkup/github-repository-export/testing";
import type {
  GitHubAppAdapter,
  GitHubInstallationSession,
} from "@cloudmarkup/github-repository-export/ports";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProductionGitHubExports } from "../../production-github-exports.js";
import { ApplicationError } from "../../application/errors.js";
import { PostgresGitHubExportStore } from "./github-export-store.js";
import { createSolutionExportRunInsertionBindingV1 } from "../../application/solution-export-persistence-binding.js";
import { solutionExportPrimaryInputDigest } from "../../application/solution-exports.js";
import {
  solutionExportWorkflowRequestDigest,
  solutionExportWorkflowRequestV1Schema,
} from "@cloudmarkup/solution-export-workflow";
import { permissionsForRole } from "../../application/authorization.js";
import type {
  ObjectPurpose,
  ObjectStore,
  StoredObjectReference,
} from "../../application/persistence.js";
import {
  exportPrincipal,
  retainedArtifactFixture,
} from "./solution-export-artifact-test-helpers.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { SolutionExportArtifactObjects } from "./solution-export-artifact-objects.js";
import { PostgresApprovedSolutionPackageRepository } from "./solution-export-approved-package-repository.js";
import { sql, type SqlDatabase } from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_retained_it_${nonce}`;
const marker = `CloudMarkup synthetic retained export ${nonce}`;
const id = (kind: string) => `${kind}_${randomUUID().replaceAll("-", "")}`;
const bytes = (value: unknown) =>
  new TextEncoder().encode(serializeCanonicalJson(value));
const hex = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

function loopbackUrl(): string {
  let parsed: URL;
  try {
    parsed = new URL(configuredUrl ?? "");
  } catch {
    throw new Error("An explicit loopback PostgreSQL URL is required.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(parsed.pathname)
  )
    throw new Error(
      "Only an explicit loopback PostgreSQL database without overrides is supported.",
    );
  return configuredUrl ?? "";
}

integrationDescribe(
  "retained Solution packages on isolated real PostgreSQL",
  () => {
    let admin: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let created = false;
    async function verifySchema() {
      if (
        admin === undefined ||
        !/^cm_export_retained_it_[a-f0-9]{32}$/u.test(schema)
      )
        throw new Error("Unsafe synthetic schema.");
      const found = await admin.query(
        sql(
          "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
          [schema],
        ),
      );
      if (found.rows[0]?.["marker"] !== marker)
        throw new Error("Synthetic schema marker mismatch.");
    }
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_export_retained_it_[a-f0-9]{32}$/u.test(schema))
        throw new Error("Unsafe synthetic schema.");
      admin = new PostgresDatabase({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await admin.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schema}"`));
        await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
      });
      created = true;
      database = new PostgresDatabase({
        connectionString,
        max: 3,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schema} -c timezone=Pacific/Honolulu -c statement_timeout=5000`,
      });
      opened = database;
      await runMigrations(
        database,
        await loadHistoricalBetaMigrations(
          fileURLToPath(new URL("../../../migrations", import.meta.url)),
        ),
      );
    }, 60_000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (created && admin !== undefined) {
          await verifySchema();
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        }
      } finally {
        await admin?.close();
      }
    }, 30_000);

    async function fixture(
      options: { expired?: boolean; rootQueued?: boolean } = {},
    ) {
      await verifySchema();
      const actor = { ...exportPrincipal(), principalId: id("principal") };
      const organizationId = id("org");
      const projectId = id("project");
      const artifactId = id("solutionartifact");
      const membershipId = id("membership");
      const jobId = id("job");
      const recordId = id("record");
      const draftId = id("draft");
      const revisionId = id("revision");
      const scope = {
        capabilities: permissionsForRole("owner"),
        correlationId: actor.correlationId,
        membershipId,
        organizationId,
        principalId: actor.principalId,
        roleKey: "owner",
        sessionId: actor.sessionId,
      };
      const store = new InMemoryObjectStore();
      const artifact = retainedArtifactFixture();
      const fixtureData = workflowFixture("infrastructure-only");
      const request = solutionExportWorkflowRequestV1Schema.parse({
        ...fixtureData.request,
        environment: { environmentType: "development" },
        exportName: artifact.manifest.package.displayName,
        subject: { ...fixtureData.request.subject, manifestRecordId: recordId },
        targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
      });
      const binding = createSolutionExportRunInsertionBindingV1({
        createdByPrincipalId: actor.principalId,
        entitlementDecisionReference: "entitlement.synthetic",
        jobId,
        organizationId,
        projectId,
        primaryInputDigest: solutionExportPrimaryInputDigest({
          organizationId,
          projectId,
          request,
        }),
        request,
        requestDigest: solutionExportWorkflowRequestDigest(request),
      });
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic retained export')",
            [actor.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic export',$2)",
            [organizationId, id("slug").replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT $1,role,'authorization-v2',role='owner',cloudmarkup_authorization_v2_permissions(role) FROM unnest(ARRAY['owner','administrator','editor','viewer']) role",
            [organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
            [membershipId, organizationId, actor.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic export',$3)",
            [projectId, organizationId, actor.principalId],
          ),
        );
      });
      async function recordObject(object: StoredObjectReference) {
        await store.publish(scope, object);
        await database.query(
          sql(
            `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,entity_tag,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,published_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published',$12,CURRENT_TIMESTAMP)`,
            [
              object.objectId,
              organizationId,
              projectId,
              object.storageProvider,
              object.purpose,
              object.storageKey,
              object.objectVersion,
              object.entityTag ?? null,
              object.contentSha256,
              object.sizeBytes,
              object.mediaType,
              actor.principalId,
            ],
          ),
        );
        return object;
      }
      async function publish(
        value: unknown,
        purpose: ObjectPurpose,
        objectId = id("object"),
      ) {
        const body = bytes(value);
        return recordObject(
          await store.stage(scope, {
            contentSha256: hex(body),
            mediaType: "application/json",
            objectId,
            open: async function* () {
              yield await Promise.resolve(body);
            },
            owner: { organizationId, projectId },
            purpose,
            sizeBytes: body.byteLength,
          }),
        );
      }
      const document = await publish(
        fixtureData.generationRequest.architectureDocument,
        "architecture-revision",
      );
      await database.query(
        sql(
          `INSERT INTO architecture_drafts(draft_id,organization_id,project_id,draft_version,document_schema_version,document_object_id,content_sha256,semantic_sha256,visual_sha256,updated_by_principal_id)
      VALUES($1,$2,$3,1,3,$4,$5,$5,$5,$6)`,
          [
            draftId,
            organizationId,
            projectId,
            document.objectId,
            document.contentSha256,
            actor.principalId,
          ],
        ),
      );
      await database.query(
        sql(
          `INSERT INTO validation_runs(validation_run_id,organization_id,project_id,input_kind,draft_id,draft_version,environment,target,lifecycle_status,created_by_principal_id)
      VALUES($1,$2,$3,'draft',$4,1,'development','revision','succeeded',$5)`,
          [revisionId, organizationId, projectId, draftId, actor.principalId],
        ),
      );
      await database.query(
        sql(
          `INSERT INTO architecture_revisions(revision_id,organization_id,project_id,document_object_id,content_sha256,semantic_sha256,visual_sha256,graph_schema_version,workload_behavior_version,catalog_id,catalog_version,catalog_sha256,source_draft_id,source_draft_version,validation_run_id,created_by_principal_id,revision_name,revision_number,compiler_input_contract_version,minimum_compiler_version)
      VALUES($1,$2,$3,$4,$5,$5,$5,3,1,'catalog.synthetic','1.0.0',$5,$6,1,$1,$7,'Synthetic revision',1,1,'1.0.0')`,
          [
            revisionId,
            organizationId,
            projectId,
            document.objectId,
            document.contentSha256,
            draftId,
            actor.principalId,
          ],
        ),
      );
      const revision = await publish(
        fixtureData.generationRequest.solutionRevision,
        "solution-revision-manifest",
      );
      expect(revision.contentSha256).toBe(
        artifact.manifest.solutionRevision.digest.slice(7),
      );
      await database.query(
        sql(
          `INSERT INTO solution_records(solution_record_id,organization_id,project_id,record_kind,subject_id,contract_version,content_object_id,content_sha256,architecture_revision_id,created_by_principal_id)
      VALUES($1,$2,$3,'solution-revision-manifest',$4,1,$5,$6,$7,$8)`,
          [
            recordId,
            organizationId,
            projectId,
            artifact.manifest.solutionRevision.id,
            revision.objectId,
            revision.contentSha256,
            revisionId,
            actor.principalId,
          ],
        ),
      );
      const input = await publish(
        binding.orchestrationInput,
        "input-payload",
        binding.orchestrationInputObjectId,
      );
      const workflowRequest = await publish(
        request,
        "input-payload",
        binding.workflowRequestObjectId,
      );
      const coverage = await publish(
        artifact.manifest.generationCoverage.revision,
        "evidence",
      );
      const evidence = await publish([], "evidence");
      const readModel = await publish(
        { contractVersion: 1, state: "succeeded" },
        "checkpoint-state",
      );
      const output = await publish(
        { contractVersion: 1, artifactId },
        "report",
      );
      const at = new Date(Date.now() - 10_000).toISOString();
      const digest = binding.sqlDigests.requestSha256;
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            `INSERT INTO async_job_identity_reservations(organization_id,project_id,job_id,reservation_kind,root_job_id,correlation_id,reserving_operation_id,reserving_idempotency_key_sha256)
        VALUES($1,$2,$3,'root',$3,$4,'solution-export.create',$5)`,
            [organizationId, projectId, jobId, actor.correlationId, digest],
          ),
        );
        await tx.query(
          sql(
            `INSERT INTO async_jobs(job_id,organization_id,project_id,family,lifecycle_status,subject_kind,solution_revision_id,solution_manifest_record_id,solution_manifest_sha256,environment_type,input_object_id,input_sha256,referenced_input_size_bytes,inline_input_size_bytes,output_object_id,output_sha256,output_size_bytes,idempotency_scope,idempotency_key_sha256,idempotency_actor_id,idempotency_request_sha256,correlation_id,entitlement_decision_reference,root_job_id,parent_failure_policy,max_attempts,max_runtime_seconds,max_referenced_input_bytes,max_inline_input_bytes,max_output_bytes,max_checkpoint_bytes,max_checkpoints,max_artifacts,created_by_actor_kind,created_by_actor_reference,created_by_principal_id,created_at,updated_at,queued_at,completed_at)
        VALUES($1,$2,$3,'solution-export-orchestration',$4,'solution-revision',$5,$6,$7,'development',$8,$9,0,$10,$11,$12,$13,'solution-export.create',$14,$15,$14,$16,'entitlement.synthetic',$1,'fail-parent',3,300,67108864,65536,67108864,1048576,16,16,'principal',$15,$15,$17,$17,$17,$18)`,
            [
              jobId,
              organizationId,
              projectId,
              "queued",
              artifact.manifest.solutionRevision.id,
              recordId,
              revision.contentSha256,
              input.objectId,
              input.contentSha256,
              input.sizeBytes,
              null,
              null,
              null,
              digest,
              actor.principalId,
              actor.correlationId,
              at,
              null,
            ],
          ),
        );
        await tx.query(
          sql(
            `INSERT INTO async_job_creation_claims(organization_id,project_id,operation_id,idempotency_key_sha256,request_sha256,actor_id,correlation_id,job_id,creation_plan_sha256,family,subject_kind,solution_revision_id,solution_manifest_record_id,solution_manifest_sha256,environment_type,input_object_id,input_sha256,referenced_input_size_bytes,inline_input_size_bytes,root_job_id,parent_failure_policy,max_attempts,max_runtime_seconds,max_referenced_input_bytes,max_inline_input_bytes,max_output_bytes,max_checkpoint_bytes,max_checkpoints,max_artifacts,reservation_requested,claim_status,entitlement_outcome,entitlement_decision_reference,claimed_at,updated_at)
        SELECT organization_id,project_id,idempotency_scope,idempotency_key_sha256,idempotency_request_sha256,idempotency_actor_id,correlation_id,job_id,idempotency_request_sha256,family,subject_kind,solution_revision_id,solution_manifest_record_id,solution_manifest_sha256,environment_type,input_object_id,input_sha256,referenced_input_size_bytes,inline_input_size_bytes,root_job_id,parent_failure_policy,max_attempts,max_runtime_seconds,max_referenced_input_bytes,max_inline_input_bytes,max_output_bytes,max_checkpoint_bytes,max_checkpoints,max_artifacts,FALSE,'completed','allowed',entitlement_decision_reference,created_at,created_at FROM async_jobs WHERE job_id=$1`,
            [jobId],
          ),
        );
        if (!options.rootQueued) {
          await tx.query(
            sql(
              "UPDATE async_jobs SET lifecycle_status='running',record_version=2,started_at=created_at WHERE job_id=$1",
              [jobId],
            ),
          );
          await tx.query(
            sql(
              "UPDATE async_jobs SET lifecycle_status='succeeded',record_version=3,completed_at=created_at,output_object_id=$2,output_sha256=$3,output_size_bytes=$4 WHERE job_id=$1",
              [jobId, output.objectId, output.contentSha256, output.sizeBytes],
            ),
          );
        }
        await tx.query(
          sql(
            `INSERT INTO solution_export_runs(solution_export_run_id,organization_id,project_id,root_job_id,solution_revision_id,solution_manifest_record_id,solution_manifest_subject_id,solution_manifest_sha256,environment_type,target_profile_id,target_settings_sha256,export_name,orchestration_input_object_id,orchestration_input_sha256,workflow_request_object_id,request_sha256,primary_input_sha256,run_sequence,request_intent_sha256,idempotency_key_sha256,entitlement_decision_reference,lifecycle_status,progress_message,generation_coverage_object_id,generation_coverage_sha256,evidence_object_id,evidence_sha256,workflow_read_model_object_id,workflow_read_model_sha256,created_by_principal_id,created_at,updated_at,completed_at)
        VALUES($1,$2,$3,$1,$4,$5,$4,$6,'development',$7,$8,$9,$10,$11,$12,$13,$14,1,$13,$13,'entitlement.synthetic','succeeded','Synthetic completed export',$15,$16,$17,$18,$19,$20,$21,$22,$22,$22)`,
            [
              jobId,
              organizationId,
              projectId,
              artifact.manifest.solutionRevision.id,
              recordId,
              revision.contentSha256,
              request.targetProfileId,
              binding.sqlDigests.targetSettingsSha256,
              request.exportName,
              input.objectId,
              input.contentSha256,
              workflowRequest.objectId,
              workflowRequest.contentSha256,
              binding.sqlDigests.primaryInputSha256,
              coverage.objectId,
              coverage.contentSha256,
              evidence.objectId,
              evidence.contentSha256,
              readModel.objectId,
              readModel.contentSha256,
              actor.principalId,
              at,
            ],
          ),
        );
      });
      const retained = await new SolutionExportArtifactObjects(store).stage(
        { artifact, artifactId, organizationId, projectId },
        () => Promise.resolve(scope),
      );
      await recordObject(retained.manifest);
      await recordObject(retained.archive);
      await database.query(
        sql(
          `INSERT INTO solution_export_artifacts(solution_export_artifact_id,organization_id,project_id,solution_export_run_id,solution_revision_id,manifest_object_id,manifest_sha256,manifest_size_bytes,archive_object_id,archive_sha256,archive_file_name,file_count,size_bytes,retention_expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            artifactId,
            organizationId,
            projectId,
            jobId,
            artifact.manifest.solutionRevision.id,
            retained.manifest.objectId,
            retained.manifest.contentSha256,
            retained.manifest.sizeBytes,
            retained.archive.objectId,
            retained.archive.contentSha256,
            artifact.archiveFileName,
            artifact.files.length,
            artifact.zipBytes.byteLength,
            new Date(
              Date.now() + (options.expired ? -1000 : 600_000),
            ).toISOString(),
            at,
          ],
        ),
      );
      const repository = (
        objectStore: ObjectStore = store,
        principal = actor,
        sqlDatabase: SqlDatabase = database,
        clock?: () => Date,
      ) =>
        new PostgresApprovedSolutionPackageRepository({
          database: sqlDatabase,
          objectStore,
          principal,
          ...(clock === undefined ? {} : { clock }),
        });
      return {
        actor,
        artifact,
        input: { artifactId, organizationId, projectId },
        membershipId,
        repository,
        retained,
        store,
      };
    }

    it("reads exact retained bytes through real migration constraints in a non-UTC database", async () => {
      const f = await fixture();
      expect(await f.repository().getApprovedPackage(f.input)).toEqual({
        ...f.input,
        artifact: f.artifact,
      });
      expect(await f.repository().getApprovedPackage(f.input)).toEqual({
        ...f.input,
        artifact: f.artifact,
      });
    });
    it.each(["expired", "root-queued"])(
      "returns no package for %s metadata",
      async (kind) => {
        const f = await fixture({
          expired: kind === "expired",
          rootQueued: kind === "root-queued",
        });
        const open = vi.spyOn(f.store, "open");
        expect(await f.repository().getApprovedPackage(f.input)).toBeNull();
        expect(open).not.toHaveBeenCalled();
      },
    );
    it.each(["viewer", "cross-tenant", "expired-auth", "suspended-membership"])(
      "denies %s before object access",
      async (kind) => {
        const f = await fixture();
        if (kind === "viewer")
          await database.query(
            sql(
              "UPDATE memberships SET role_key='viewer',record_version=record_version+1 WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
        if (kind === "suspended-membership")
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended',record_version=record_version+1 WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
        const open = vi.spyOn(f.store, "open");
        const principal =
          kind === "expired-auth"
            ? { ...f.actor, expiresAt: "2000-01-01T00:00:00.000Z" }
            : f.actor;
        await expect(
          f.repository(f.store, principal).getApprovedPackage({
            ...f.input,
            ...(kind === "cross-tenant"
              ? { organizationId: id("foreign") }
              : {}),
          }),
        ).rejects.toThrow();
        expect(open).not.toHaveBeenCalled();
      },
    );
    it("does not hold SQL authorization locks across object I/O and withholds bytes after concurrent membership revocation", async () => {
      const f = await fixture();
      vi.spyOn(f.store, "open").mockImplementation(async (scope, ref) => {
        // This UPDATE would hit statement_timeout if the read held the membership FOR SHARE lock.
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended',record_version=record_version+1 WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
        return InMemoryObjectStore.prototype.open.call(f.store, scope, ref);
      });
      await expect(
        f.repository().getApprovedPackage(f.input),
      ).rejects.toMatchObject({ code: "not_found" });
    });
    it("withholds bytes when retention expires during the first object read", async () => {
      const f = await fixture();
      let now = new Date();
      vi.spyOn(f.store, "open").mockImplementation(async (scope, ref) => {
        now = new Date(Date.now() + 900_000);
        return InMemoryObjectStore.prototype.open.call(f.store, scope, ref);
      });
      await expect(
        f
          .repository(f.store, f.actor, database, () => now)
          .getApprovedPackage(f.input),
      ).rejects.toMatchObject({ code: "not_found" });
    });
    it("returns no package after published archive metadata enters deletion", async () => {
      const f = await fixture();
      await database.query(
        sql(
          "UPDATE stored_objects SET lifecycle_state='delete-pending',delete_requested_at=CURRENT_TIMESTAMP WHERE object_id=$1",
          [f.retained.archive.objectId],
        ),
      );
      const open = vi.spyOn(f.store, "open");
      expect(await f.repository().getApprovedPackage(f.input)).toBeNull();
      expect(open).not.toHaveBeenCalled();
    });

    let installationSequence = 100;
    async function githubFixture() {
      const f = await fixture();
      const provider = new FakeGitHubAppAdapter();
      const store = new PostgresGitHubExportStore(database);
      const installationId = ++installationSequence;
      const integrationId = id("integration");
      const repositoryId = installationId + 1000;
      const at = new Date().toISOString();
      const installation = {
        accountId: installationId + 2000,
        accountLogin: "synthetic-export-owner",
        accountType: "Organization" as const,
        installationId,
        permissions: {
          contents: "write",
          metadata: "read",
          pullRequests: "write",
          workflows: "none",
        } as const,
        repositorySelection: "selected" as const,
        suspended: false,
      };
      const repository = {
        archived: false,
        defaultBranch: "main",
        disabled: false,
        installationId,
        name: "synthetic-export-repository",
        nodeId: `synthetic-repository-${String(repositoryId)}`,
        owner: installation.accountLogin,
        ownerId: installation.accountId,
        private: true,
        pushedAt: at,
        repositoryId,
      };
      provider.addInstallation(installation);
      provider.addRepository(
        repository,
        { main: { "CUSTOMER.md": "Unrelated customer file.\n" } },
        ["main"],
        [],
      );
      const { suspended: _suspended, ...installationRecord } = installation;
      const { ownerId: _ownerId, ...repositoryRecord } = repository;
      void _suspended;
      void _ownerId;
      await store.saveInstallation({
        ...installationRecord,
        integrationId,
        organizationId: f.input.organizationId,
        createdAt: at,
        updatedAt: at,
        status: "connected",
      });
      await store.saveRepositories({
        installationId,
        integrationId,
        organizationId: f.input.organizationId,
        repositories: [
          {
            ...repositoryRecord,
            integrationId,
            organizationId: f.input.organizationId,
            updatedAt: at,
          },
        ],
      });
      const sent: string[] = [];
      let beforeRequest: (name: string) => Promise<void> = () =>
        Promise.resolve();
      let entitled = true;
      function createGitHub(authorize: () => Promise<void>): GitHubAppAdapter {
        async function request<T>(
          name: string,
          work: () => Promise<T>,
        ): Promise<T> {
          await beforeRequest(name);
          await authorize();
          sent.push(name);
          return work();
        }
        function session(
          value: GitHubInstallationSession,
        ): GitHubInstallationSession {
          return {
            createBranch: (input) =>
              request("createBranch", () => value.createBranch(input)),
            createCommit: (input) =>
              request("createCommit", () => value.createCommit(input)),
            createPullRequest: (input) =>
              request("createPullRequest", () =>
                value.createPullRequest(input),
              ),
            findBranch: (input) =>
              request("findBranch", () => value.findBranch(input)),
            findPullRequest: (input) =>
              request("findPullRequest", () => value.findPullRequest(input)),
            findMergeBase: (input) =>
              request("findMergeBase", () => value.findMergeBase(input)),
            listBranches: (input) =>
              request("listBranches", () => value.listBranches(input)),
            listRepositories: () =>
              request("listRepositories", () => value.listRepositories()),
            readSnapshot: (input) =>
              request("readSnapshot", () => value.readSnapshot(input)),
            discoverPinnedFiles: (input) =>
              request("discoverPinnedFiles", () =>
                value.discoverPinnedFiles(input),
              ),
            readPinnedSnapshot: (input) =>
              request("readPinnedSnapshot", () =>
                value.readPinnedSnapshot(input),
              ),
          };
        }
        return {
          inspectInstallation: (value) =>
            request("inspectInstallation", () =>
              provider.inspectInstallation(value),
            ),
          withInstallationSession: (input, work) =>
            request("createInstallationToken", () =>
              provider.withInstallationSession(input, (value) =>
                work(session(value)),
              ),
            ),
          withRepositoryReadSession: (input, work) =>
            request("createReadToken", () =>
              provider.withRepositoryReadSession(input, (value) =>
                work({
                  listBranches: (repository) =>
                    request("listBranches", () =>
                      value.listBranches(repository),
                    ),
                  listRepositories: () =>
                    request("listRepositories", () => value.listRepositories()),
                  discoverPinnedFiles: (input) =>
                    request("discoverPinnedFiles", () =>
                      value.discoverPinnedFiles(input),
                    ),
                  readPinnedSnapshot: (snapshot) =>
                    request("readPinnedSnapshot", () =>
                      value.readPinnedSnapshot(snapshot),
                    ),
                }),
              ),
            ),
        };
      }
      const application = createProductionGitHubExports({
        database,
        objectStore: f.store,
        createGitHub,
        organizationForProject: () => Promise.resolve(f.input.organizationId),
        entitlements: {
          authorize: () => {
            if (!entitled)
              throw new ApplicationError(
                "access_denied",
                "Synthetic entitlement denied.",
              );
            return Promise.resolve();
          },
        },
      });
      const preview = () =>
        application.createPreview(f.actor, f.input.projectId, {
          contractVersion: 1,
          artifactId: f.input.artifactId,
          baseBranch: "main",
          destinationFolder: "solutions/example",
          featureBranch: "cloudmarkup/example",
          includeWorkflows: false,
          integrationId,
          repositoryId,
        });
      return {
        ...f,
        application,
        installation,
        integrationId,
        preview,
        provider,
        repository,
        sent,
        beforeRequest: (value: (name: string) => Promise<void>) => {
          beforeRequest = value;
        },
        denyEntitlement: () => {
          entitled = false;
        },
      };
    }

    it("creates a real-SQL reviewed export and replays one synthetic pull request without touching the default branch", async () => {
      const f = await githubFixture();
      const preview = await f.preview();
      expect(preview.artifactDigest).toBe(f.artifact.zipDigest);
      expect(preview.workflowFiles).toEqual([]);
      const input = {
        contractVersion: 1 as const,
        previewId: preview.previewId,
        previewDigest: preview.previewDigest,
        confirmedWorkflowFiles: [],
      };
      const receipt = await f.application.execute(
        f.actor,
        f.input.projectId,
        input,
        "synthetic-export-once",
      );
      expect(
        await f.application.execute(
          f.actor,
          f.input.projectId,
          input,
          "synthetic-export-once",
        ),
      ).toEqual(receipt);
      expect(f.provider.pullRequestCount).toBe(1);
      expect(f.sent.filter((name) => name === "createBranch")).toHaveLength(1);
      expect(f.sent.filter((name) => name === "createCommit")).toHaveLength(1);
      expect(
        f.sent.filter((name) => name === "createPullRequest"),
      ).toHaveLength(1);
      expect(
        f.provider.branchFiles(f.repository.owner, f.repository.name, "main"),
      ).toEqual(
        new Map([
          [
            "CUSTOMER.md",
            new TextEncoder().encode("Unrelated customer file.\n"),
          ],
        ]),
      );
      expect(
        f.provider
          .branchFiles(
            f.repository.owner,
            f.repository.name,
            "cloudmarkup/example",
          )
          .has("solutions/example/cloudmarkup/architecture.json"),
      ).toBe(true);
      const counts = await database.query(
        sql(
          "SELECT (SELECT count(*)::int FROM github_repository_export_previews WHERE organization_id=$1) AS previews, (SELECT count(*)::int FROM github_repository_export_executions WHERE organization_id=$1 AND lifecycle_status='succeeded') AS executions, (SELECT count(*)::int FROM audit_events WHERE organization_id=$1 AND action='github.export.pull-request-created') AS audits",
          [f.input.organizationId],
        ),
      );
      expect(counts.rows[0]).toEqual({ previews: 1, executions: 1, audits: 1 });
      expect(f.provider.sessionsOpened).toBe(f.provider.sessionsClosed);
      // Full retained-package setup plus preview, export and replay can exceed
      // the unit-test default on Windows. SQL lock waits retain their 5s limit.
    }, 15_000);

    it("denies a membership revoked immediately before branch creation without holding SQL locks across the provider", async () => {
      const f = await githubFixture();
      const preview = await f.preview();
      f.beforeRequest(async (name) => {
        if (name === "createBranch")
          await database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended',record_version=record_version+1 WHERE membership_id=$1",
              [f.membershipId],
            ),
          );
      });
      await expect(
        f.application.execute(
          f.actor,
          f.input.projectId,
          {
            contractVersion: 1,
            previewId: preview.previewId,
            previewDigest: preview.previewDigest,
            confirmedWorkflowFiles: [],
          },
          "synthetic-revoked",
        ),
      ).rejects.toThrow();
      expect(f.sent).not.toContain("createBranch");
      expect(f.sent).not.toContain("createCommit");
      expect(f.provider.pullRequestCount).toBe(0);
    });

    it("rechecks paid entitlement after provider setup and before any token request", async () => {
      const f = await githubFixture();
      f.beforeRequest((name) => {
        if (name === "createInstallationToken") f.denyEntitlement();
        return Promise.resolve();
      });
      await expect(f.preview()).rejects.toThrow();
      expect(f.sent).not.toContain("createInstallationToken");
      expect(f.provider.sessionsOpened).toBe(0);
    });

    it("rejects a live installation changed to all repositories before issuing a token", async () => {
      const f = await githubFixture();
      f.provider.addInstallation({
        ...f.installation,
        repositorySelection: "all",
      });
      await expect(f.preview()).rejects.toThrow();
      expect(f.sent).not.toContain("createInstallationToken");
      expect(f.provider.sessionsOpened).toBe(0);
    });
  },
);
