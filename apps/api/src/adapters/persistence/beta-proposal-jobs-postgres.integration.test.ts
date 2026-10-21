import {
  ENTITLEMENT_POLICY_VERSION,
  createAsyncJobFailureV1,
} from "@cloudmarkup/domain";
import { JobExecutionError } from "@cloudmarkup/job-framework";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBetaInfrastructureApplication } from "../../application/beta-infrastructure.js";
import { createBetaInfrastructureJobs } from "../../application/beta-infrastructure-jobs.js";
import { createBetaInfrastructureWorker } from "../../beta-infrastructure-worker.js";
import { ProductionSolutionExportAudit } from "../../production-solution-export-audit.js";
import { createInitialArchitectureDocument } from "../../application/architecture-document-storage.js";
import { createProductionInitialDocument } from "../../production-initial-document.js";
import type {
  CloudMarkupApplication,
  PrincipalContext,
} from "../../application/ports.js";
import {
  digestCanonicalValue,
  serializeCanonicalJson,
  regionIdentifierSchema,
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";
import { closeProjectContentWrites } from "./project-content-write-fence.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import {
  betaAiReservationId,
  PostgresBetaAiCreditMeter,
} from "./beta-ai-credit-meter.js";
import { createBetaAiExportCredits } from "./beta-ai-export-credits.js";
import { ActiveProjectRequestAuthority } from "./solution-export-authority.js";
import { createBetaProposalBaselineReader } from "./beta-proposal-baseline-reader.js";
import { betaProposalCommandPreparerV1 } from "../../application/beta-proposal-command-preparer.js";

import { BETA_AI_PRICING_V1 } from "../../application/beta-ai-pricing.js";
import type { BetaConverseUsage } from "@cloudmarkup/model-gateway";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const suite = configured ? describe : describe.skip;
const id = (prefix: string) => prefix + "_" + randomUUID().replaceAll("-", "");
const schema = id("cm_beta_proposal");
suite("durable beta proposal PostgreSQL boundary", () => {
  let admin: PostgresDatabase | undefined;
  let db: PostgresDatabase;
  let historical: Awaited<ReturnType<typeof prepareHistoricalReservation>>;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash
    )
      throw Error("Loopback synthetic database required.");
    admin = new PostgresDatabase({ connectionString: configured, max: 1 });
    await admin.query(sql(`CREATE SCHEMA "${schema}"`));
    await admin.query(
      sql(`COMMENT ON SCHEMA "${schema}" IS 'Synthetic beta proposal tests'`),
    );
    db = new PostgresDatabase({
      connectionString: configured,
      max: 6,
      options: `-c search_path=${schema} -c timezone=UTC`,
      connectionTimeoutMillis: 15000,
    });
    const migrations = await loadHistoricalBetaMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    await runMigrations(
      db,
      migrations.filter((migration) => migration.version < "0082"),
    );
    await runMigrations(
      {
        close: () => Promise.resolve(),
        query: (statement) => db.query(statement),
        transaction: (work) =>
          db.transaction((transaction) =>
            work({
              query: async <Row extends SqlRow = SqlRow>(
                statement: SqlStatement,
              ) => {
                const result = await transaction.query<Row>(statement);
                if (
                  statement.text.includes("SELECT version, checksum_sha256") &&
                  statement.values[0] === "0082"
                ) {
                  // A different transaction reserves after this migration transaction
                  // starts, but before it takes its pricing-transition lock.
                  historical = await prepareHistoricalReservation();
                  const timing = await transaction.query(
                    sql(
                      "SELECT created_at > CURRENT_TIMESTAMP AS after_transaction_start FROM credit_reservations WHERE organization_id=$1 AND reservation_id=$2",
                      [
                        historical.identity.organizationId,
                        historical.reservationId,
                      ],
                    ),
                  );
                  expect(timing.rows[0]?.["after_transaction_start"]).toBe(
                    true,
                  );
                }
                return result;
              },
            }),
          ),
      },
      migrations,
    );
  }, 120000);
  afterAll(async () => {
    await db.close();
    if (admin) {
      const found = await admin.query(
        sql(
          "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
          [schema],
        ),
      );
      if (
        found.rows[0]?.["marker"] === "Synthetic beta proposal tests" &&
        /^cm_beta_proposal_[a-f0-9]{32}$/u.test(schema)
      )
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      await admin.close();
    }
  }, 30000);
  async function fixture(proposalVersion: 3 | 5 | 6 = 3) {
    const principal: PrincipalContext = {
      principalId: id("principal"),
      sessionId: id("session"),
      correlationId: id("correlation"),
      authenticatedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      authenticationSource: "test",
    };
    const organizationId = id("org"),
      projectId = id("project"),
      draftId = id("draft"),
      objectId = id("object"),
      membershipId = id("membership");
    const document = (
      proposalVersion >= 5
        ? createProductionInitialDocument
        : createInitialArchitectureDocument
    )({
      identity: {
        architectureId: id("architecture"),
        documentId: id("document"),
        draftId,
        revisionId: id("revision"),
        principalId: principal.principalId,
      },
      createdAt: principal.authenticatedAt,
      blank: true,
      infrastructureOnly: true,
    });
    const digest = digestCanonicalValue(document);
    const objectStore = new InMemoryObjectStore();
    const draftBytes = new TextEncoder().encode(
      serializeCanonicalJson(document),
    );
    const objectScope = {
      organizationId,
      principalId: principal.principalId,
      sessionId: principal.sessionId,
      correlationId: principal.correlationId,
      membershipId,
      roleKey: "owner",
      capabilities: ["projects.mutate"],
    };
    const initialObject = await objectStore.stage(objectScope, {
      objectId,
      owner: { organizationId, projectId },
      purpose: "architecture-draft",
      contentSha256: digest.slice(7),
      sizeBytes: draftBytes.length,
      mediaType: "application/json",
      open: async function* () {
        yield await Promise.resolve(draftBytes);
      },
    });
    await objectStore.publish(objectScope, initialObject);
    await db.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic proposal')",
          [principal.principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic proposal',$2)",
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
          [membershipId, organizationId, principal.principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic proposal',$3)",
          [projectId, organizationId, principal.principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,object_version,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,published_at,entity_tag) VALUES($1,$2,$3,'memory','architecture-draft',$6,$7,$4,$9,'application/json','published',$5,clock_timestamp(),$8)",
          [
            objectId,
            organizationId,
            projectId,
            digest.slice(7),
            principal.principalId,
            initialObject.storageKey,
            initialObject.objectVersion,
            initialObject.entityTag ?? null,
            initialObject.sizeBytes,
          ],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO architecture_drafts(draft_id,organization_id,project_id,draft_version,document_schema_version,document_object_id,content_sha256,semantic_sha256,visual_sha256,updated_by_principal_id) VALUES($1,$2,$3,1,3,$4,$5,$5,$5,$6)",
          [
            draftId,
            organizationId,
            projectId,
            objectId,
            digest.slice(7),
            principal.principalId,
          ],
        ),
      );
      await tx.query(
        sql(
          "UPDATE projects SET current_draft_id=$3 WHERE organization_id=$1 AND project_id=$2",
          [organizationId, projectId, draftId],
        ),
      );
    });
    const commercial = new PostgresCommercialPersistenceRepository(db);
    const administration = {
      actorId: id("billingadmin"),
      actorPrincipalId: principal.principalId,
      authority: "internal-administration" as const,
      correlationId: principal.correlationId,
      organizationId,
    };
    const accounting = {
      actorId: id("billingworker"),
      authority: "internal-accounting" as const,
      correlationId: principal.correlationId,
      organizationId,
    };
    const account = await commercial.createBillingAccount(administration, {
      billingAccountId: id("billing"),
    });
    const enabled = await commercial.updateBillingAccount(administration, {
      expectedRecordVersion: account.recordVersion,
      expensiveOperationsEnabled: true,
      lifecycleStatus: "active",
    });
    const subscription = await commercial.updateSubscriptionProjection(
      administration,
      {
        billableSeatQuantity: "1",
        billingProvider: "stripe-sandbox",
        cancelAtPeriodEnd: false,
        effectiveAt: new Date(Date.now() - 60_000).toISOString(),
        expectedRecordVersion: "0",
        normalizedStatus: "active",
        planVersionId: "planver_pro_2026_09_12_v4",
        providerCustomerReference: id("customer"),
        providerSubscriptionReference: id("subscription"),
        subscriptionProjectionId: id("subscriptionprojection"),
      },
    );
    await commercial.updateEntitlementSnapshot(administration, {
      effectiveAt: new Date(Date.now() - 60_000).toISOString(),
      entitlementPolicyVersion: "cloudmarkup-entitlements-v1",
      entitlementSnapshotId: id("entitlement"),
      expensiveOperationsEnabled: enabled.expensiveOperationsEnabled,
      expectedRecordVersion: "0",
      planVersionId: "planver_pro_2026_09_12_v4",
      sourceRecordVersion: subscription.recordVersion,
      subscriptionProjectionId: subscription.subscriptionProjectionId,
    });
    await commercial.createCreditGrant(accounting, {
      chargingPolicyVersion: "cloudmarkup-charging-and-failure-v1",
      consumptionPriority: "100",
      creditGrantId: id("grant"),
      creditUnits: "400",
      expirationPolicy: {
        kind: "does-not-expire",
        policyVersion: "cloudmarkup-credit-expiration-v1",
      },
      grantKind: "promotional",
      grantPolicyVersion: "cloudmarkup-credit-grants-v1",
      idempotencyKey: id("grantkey"),
      ledgerEntryId: id("grantledger"),
      reasonCode: "test.promotional-grant",
      sourceReference: id("grantsource"),
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const etag = `"draft:${draftId}:v1"`;
    const application = {
      getProject: vi.fn().mockResolvedValue({
        etag: '"project:v1"',
        value: { organizationId, lifecycleStatus: "active" },
      }),
      getDraft: vi.fn().mockResolvedValue({
        etag,
        value: {
          id: draftId,
          version: 1,
          contentDigest: digest,
          architectureDocument: document,
        },
      }),
      getCurrentPrincipal: vi.fn().mockResolvedValue({
        organizationContexts: [
          { organizationId, capabilities: ["projects.mutate"] },
        ],
      }),
    } satisfies Pick<
      CloudMarkupApplication,
      "getProject" | "getDraft" | "getCurrentPrincipal"
    >;
    const proposal = {
      contractVersion: proposalVersion,
      summary:
        proposalVersion >= 5 ? "Topic delivery" : "A private files bucket",
      resources:
        proposalVersion >= 5
          ? [
              {
                key: "topic",
                serviceType: "aws.sns.topic",
                label: "Events",
                parentKey: null,
              },
              {
                key: "queue",
                serviceType: "aws.sqs.queue",
                label: "Delivery",
                parentKey: null,
              },
              {
                key: "subscription",
                serviceType: "aws.sns.subscription",
                label: "Queue subscription",
                parentKey: "topic",
                configuration: {
                  protocol: "SQS",
                  filterScope: "NONE",
                  filterKeys: [],
                },
              },
            ]
          : [
              {
                key: "files",
                serviceType: "aws.s3.bucket",
                label: "Files",
                parentKey: null,
              },
            ],
      existingResources: [],
      connections:
        proposalVersion >= 5
          ? [
              {
                ruleId: "aws.sns.subscription-sends-to-sqs",
                sourceKey: "subscription",
                targetKey: "queue",
                configuration: {},
              },
            ]
          : [],
      limitations: [],
      ...(proposalVersion >= 5
        ? {
            updates: [],
            review: {
              intent: "Deliver topic messages to the queue.",
              assumptions: [],
              checks: ["Review the queue subscription before applying."],
              questions: [],
            },
          }
        : {}),
    };
    const model = vi
      .fn()
      .mockImplementation(
        async (input: {
          onUsage?: (usage: {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens: number;
            providerRequestId: string;
          }) => Promise<void>;
        }) => {
          await input.onUsage?.({
            inputTokens: 1200,
            outputTokens: 320,
            cacheReadInputTokens: 0,
            providerRequestId: "synthetic-bedrock-request",
          });
          return proposal;
        },
      );
    const proposals = createBetaInfrastructureApplication({
      application,
      model,
      applicability: {
        preparer: betaProposalCommandPreparerV1,
        forPrincipal: (actor, ownership) =>
          createBetaProposalBaselineReader({
            authority: new ActiveProjectRequestAuthority(
              withDataApiTypes(db),
              actor,
              ownership,
              "projects.mutate",
            ),
            objectStore,
          }),
      },
    });
    const typedDatabase = withDataApiTypes(db);
    const transport = { roundTrips: 0 };
    const measured = (executor: SqlExecutor): SqlExecutor => ({
      query<T extends SqlRow>(statement: SqlStatement) {
        transport.roundTrips += 1;
        return executor.query<T>(statement);
      },
    });
    const database: SqlDatabase = {
      ...measured(typedDatabase),
      close: () => Promise.resolve(),
      transaction: (work) => {
        // Data API begin and commit each require a separate network request.
        transport.roundTrips += 2;
        return typedDatabase.transaction((tx) => work(measured(tx)));
      },
    };
    const envelopes: AsyncJobQueueEnvelopeV1[] = [];
    const publisher = () => ({
      contractVersion: 1 as const,
      publish: (envelope: AsyncJobQueueEnvelopeV1) => {
        envelopes.push(envelope);
        return Promise.resolve();
      },
    });
    const jobs = createBetaInfrastructureJobs({
      database,
      objectStore,
      application,
      proposals,
      publisher,
    });
    const onFailure = vi.fn();
    const worker = createBetaInfrastructureWorker({
      onFailure,
      database,
      objectStore,
      proposals,
      publisher,
    });
    const request = {
      contractVersion: 1 as const,
      proposalVersion,
      requirements:
        proposalVersion >= 5
          ? "Create topic delivery to a queue filtered by category"
          : "Create a private files bucket",
      architectureDocument: document,
    };
    const start = (key = "request" + randomUUID()) =>
      jobs.create(principal, projectId, request, etag, key);
    return {
      principal,
      organizationId,
      projectId,
      application,
      draftId,
      membershipId,
      document,
      jobs,
      worker,
      onFailure,
      envelopes,
      model,
      proposals,
      proposal,
      request,
      etag,
      start,
      transport,
      objectStore,
    };
  }
  // Simulate the eraser's already-verified empty storage; exercise the actual
  // database receipt guard and its atomic rollback, not a fake SQL responder.
  async function recordVerifiedErasure(owner: {
    organizationId: string;
    projectId: string;
  }) {
    await db.transaction(async (tx) => {
      await tx.query(
        sql(
          "UPDATE stored_objects SET lifecycle_state='deleted',deleted_at=clock_timestamp(),delete_requested_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2",
          [owner.organizationId, owner.projectId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO project_content_erasure_receipts(organization_id,project_id,deletion_record_version,deletion_requested_at,write_scope_closed_at,storage_configuration_sha256,object_metadata_count) SELECT p.organization_id,p.project_id,p.record_version,p.deletion_requested_at,s.closed_at,$3,(SELECT count(*) FROM stored_objects o WHERE o.organization_id=p.organization_id AND o.project_id=p.project_id) FROM projects p JOIN project_content_write_scopes s ON s.organization_id=p.organization_id AND s.project_id=p.project_id WHERE p.organization_id=$1 AND p.project_id=$2",
          [owner.organizationId, owner.projectId, "a".repeat(64)],
        ),
      );
    });
  }

  async function prepareHistoricalReservation() {
    const f = await fixture();
    const typed = withDataApiTypes(db);
    const authority = new ActiveProjectRequestAuthority(
      typed,
      f.principal,
      { organizationId: f.organizationId, projectId: f.projectId },
      "projects.mutate",
    );
    const scope = await authority.scope();
    const ledger = new PostgresCommercialPersistenceRepository(typed);
    // This reservation is deliberately created before 0082. Read the
    // historical snapshot directly; the current effective projection is
    // introduced only by the later staff-credit migration.
    const historicalPlan = await typed.query(
      sql(
        "SELECT plan_version_id FROM organization_entitlement_snapshots WHERE organization_id=$1",
        [scope.organizationId],
      ),
    );
    expect(historicalPlan.rows.map((row) => row["plan_version_id"])).toEqual([
      "planver_pro_2026_09_12_v4",
    ]);
    const identity = {
      organizationId: f.organizationId,
      projectId: f.projectId,
      jobId: id("legacyexport"),
      purpose: "application-source" as const,
      requestSha256: "d".repeat(64),
    };
    const reservationId = betaAiReservationId(identity);
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    await typed.transaction(async (tx) => {
      await ledger.reserveCreditsInTransaction(tx, scope, {
        chargingPolicyVersion: BETA_AI_PRICING_V1.chargingPolicyVersion,
        entitlementPolicyVersion: ENTITLEMENT_POLICY_VERSION,
        expiresAt,
        featureKey: "ai-assisted-operations",
        idempotencyKey: "beta-ai:reserve:" + reservationId,
        jobId: identity.jobId,
        modelId: BETA_AI_PRICING_V1.modelId,
        modelVersion: BETA_AI_PRICING_V1.modelVersion,
        planVersionId: "planver_pro_2026_09_12_v4",
        pricingVersionId: BETA_AI_PRICING_V1.pricingVersionId,
        projectId: identity.projectId,
        providerKey: BETA_AI_PRICING_V1.providerKey,
        requestId: reservationId,
        requestSha256: identity.requestSha256,
        requestedCreditUnits: "100",
        reservationId,
      });
      await tx.query(
        sql(
          "INSERT INTO beta_ai_invocations (organization_id,reservation_id,project_id,job_id,purpose,request_sha256,estimated_credit_units) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [
            identity.organizationId,
            reservationId,
            identity.projectId,
            identity.jobId,
            identity.purpose,
            identity.requestSha256,
            2n,
          ],
        ),
      );
    });
    return {
      identity,
      reservationId,
      scope,
      expiresAt,
      meter: new PostgresBetaAiCreditMeter(authority, typed),
    };
  }
  it("replays and settles a reservation across the pricing transition using its original rate", async () => {
    const { meter, scope, identity, expiresAt, reservationId } = historical;
    expect(await meter.reserve(scope, identity, "1", "100", expiresAt)).toEqual(
      {
        reservationId,
        estimatedCreditUnits: "2",
        reservedCreditUnits: "100",
      },
    );
    expect(await meter.claim(identity)).toBe("dispatch");
    const evidence = {
      outputObjectId: id("source"),
      outputSha256: "b".repeat(64),
      usage: { inputTokens: 1200, outputTokens: 320, cacheReadInputTokens: 0 },
    };
    expect(await meter.record(identity, evidence)).toEqual({
      providerCostMicros: "8400",
      creditUnits: "2",
    });
    expect(await meter.settle(identity)).toEqual({
      providerCostMicros: "8400",
      creditUnits: "2",
    });
    expect(await meter.settle(identity)).toEqual({
      providerCostMicros: "8400",
      creditUnits: "2",
    });
    const ledger = await db.query(
      sql(
        "SELECT pricing_version_id,settled_credit_units FROM usage_ledger_entries WHERE organization_id=$1 AND reservation_id=$2 AND entry_kind='settlement'",
        [identity.organizationId, reservationId],
      ),
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.["pricing_version_id"]).toBe(
      BETA_AI_PRICING_V1.pricingVersionId,
    );
    expect(String(ledger.rows[0]?.["settled_credit_units"])).toBe("2");
  }, 30000);

  it("shows the exact source export charge from the same grant ledger", async () => {
    const f = await fixture();
    const typed = withDataApiTypes(db);
    const authority = new ActiveProjectRequestAuthority(
      typed,
      f.principal,
      { organizationId: f.organizationId, projectId: f.projectId },
      "projects.mutate",
    );
    const meter = new PostgresBetaAiCreditMeter(authority, typed);
    const jobId = id("exportjob");
    const identity = {
      organizationId: f.organizationId,
      projectId: f.projectId,
      jobId,
      purpose: "application-source" as const,
      requestSha256: "a".repeat(64),
    };
    await meter.reserve(
      await authority.scope(),
      identity,
      "2",
      "100",
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    expect(await meter.claim(identity)).toBe("dispatch");
    await meter.record(identity, {
      outputObjectId: id("source"),
      outputSha256: "b".repeat(64),
      usage: {
        inputTokens: 1_200,
        outputTokens: 320,
        cacheReadInputTokens: 0,
      },
    });
    await meter.settle(identity);
    const getJob = vi.fn().mockResolvedValue({ id: jobId });
    const credits = createBetaAiExportCredits({
      database: typed,
      application: f.application,
      reads: { getJob },
    });
    expect(await credits.get(f.principal, f.projectId, jobId)).toMatchObject({
      jobId,
      state: "settled",
      estimatedCreditUnits: "2",
      maximumCreditUnits: "100",
      actualCreditUnits: "1",
    });
    expect(getJob).toHaveBeenCalledWith(f.principal, f.projectId, jobId);
    getJob.mockRejectedValueOnce(new Error("denied"));
    await expect(credits.get(f.principal, f.projectId, jobId)).rejects.toThrow(
      "denied",
    );
  }, 30_000);
  it("keeps proposal admission within its short-request database budget", async () => {
    const f = await fixture();
    const job = await f.start();
    expect(job.state).toBe("queued");
    expect(f.model).not.toHaveBeenCalled();
    // The ledger adds grant allocation and journal work to admission. Keep a
    // bounded regression budget; hosted smoke measures actual latency.
    expect(f.transport.roundTrips).toBeLessThanOrEqual(300);
  }, 30000);
  it("releases an abandoned expired hold before another paid request", async () => {
    const f = await fixture();
    const job = await f.start();
    const meter = new PostgresBetaAiCreditMeter(db, db);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3_600_000 + 11 * 60_000);
      expect(await meter.reconcileExpired(f.organizationId)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(
      await f.jobs.credits(f.principal, f.projectId, job.id),
    ).toMatchObject({
      state: "released",
      actualCreditUnits: "0",
    });
    const balance = await db.query(
      sql(
        "SELECT COALESCE(sum(a.reserved_credit_units),0) AS held " +
          "FROM credit_reservation_allocations a JOIN credit_reservations r " +
          "ON r.organization_id=a.organization_id AND r.reservation_id=a.reservation_id " +
          "WHERE r.organization_id=$1 AND r.status='active'",
        [f.organizationId],
      ),
    );
    expect(String(balance.rows[0]?.["held"])).toBe("0");
    await f.start();
  }, 30_000);
  it("releases an undispatched proposal hold before verified project erasure", async () => {
    const f = await fixture();
    const job = await f.start();
    await f.jobs.cancel(f.principal, f.projectId, job.id);
    await db.query(
      sql(
        "UPDATE projects SET lifecycle_status='deletion-pending',deletion_requested_at=clock_timestamp(),record_version=record_version+1 WHERE organization_id=$1 AND project_id=$2",
        [f.organizationId, f.projectId],
      ),
    );
    expect(
      (
        await closeProjectContentWrites(db, {
          organizationId: f.organizationId,
          projectId: f.projectId,
        })
      ).ready,
    ).toBe(true);
    await expect(f.worker.process(f.envelopes[0])).rejects.toThrow();
    expect(f.model).not.toHaveBeenCalled();
    await expect(
      recordVerifiedErasure({
        organizationId: f.organizationId,
        projectId: f.projectId,
      }),
    ).resolves.toBeUndefined();
  }, 30000);
  it("does not generalize erasure to another architecture-proposal producer", async () => {
    const f = await fixture();
    const beta = await f.start();
    const other = id("otherjob");
    await db.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO async_job_identity_reservations SELECT (jsonb_populate_record(NULL::async_job_identity_reservations,to_jsonb(r)||jsonb_build_object('job_id',$3::text,'root_job_id',$3::text,'reserving_operation_id','other.proposal.create'))).* FROM async_job_identity_reservations r WHERE r.organization_id=$1 AND r.job_id=$2",
          [f.organizationId, beta.id, other],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO async_jobs SELECT (jsonb_populate_record(NULL::async_jobs,to_jsonb(j)||jsonb_build_object('job_id',$3::text,'root_job_id',$3::text,'idempotency_scope','other.proposal.create'))).* FROM async_jobs j WHERE j.organization_id=$1 AND j.job_id=$2",
          [f.organizationId, beta.id, other],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO async_job_creation_claims SELECT (jsonb_populate_record(NULL::async_job_creation_claims,to_jsonb(c)||jsonb_build_object('job_id',$3::text,'root_job_id',$3::text,'operation_id','other.proposal.create'))).* FROM async_job_creation_claims c WHERE c.organization_id=$1 AND c.job_id=$2",
          [f.organizationId, beta.id, other],
        ),
      );
    });
    await db.query(
      sql(
        "UPDATE projects SET lifecycle_status='deletion-pending',deletion_requested_at=clock_timestamp(),record_version=record_version+1 WHERE organization_id=$1 AND project_id=$2",
        [f.organizationId, f.projectId],
      ),
    );
    const owner = { organizationId: f.organizationId, projectId: f.projectId };
    expect((await closeProjectContentWrites(db, owner)).ready).toBe(false);
    await expect(recordVerifiedErasure(owner)).rejects.toThrow(
      "erasure evidence is incomplete",
    );
  }, 30000);
  it("waits for an active proposal lease before erasing deletion-requested content", async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 236_000);
    await f.start();
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const modelWait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    f.model.mockImplementationOnce(async () => {
      vi.useRealTimers();
      started();
      await modelWait;
      return f.proposal;
    });
    const execution = f.worker.process(f.envelopes[0]);
    const rejected = expect(execution).rejects.toThrow();
    try {
      await dispatched;
      await db.query(
        sql(
          "UPDATE projects SET lifecycle_status='deletion-pending',deletion_requested_at=clock_timestamp(),record_version=record_version+1 WHERE organization_id=$1 AND project_id=$2",
          [f.organizationId, f.projectId],
        ),
      );
      const owner = {
        organizationId: f.organizationId,
        projectId: f.projectId,
      };
      expect((await closeProjectContentWrites(db, owner)).ready).toBe(false);
      await expect(recordVerifiedErasure(owner)).rejects.toThrow(
        "erasure evidence is incomplete",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      // An expired execution lease does not erase an unresolved credit hold.
      expect((await closeProjectContentWrites(db, owner)).ready).toBe(false);
      finish();
      await rejected;
      expect((await closeProjectContentWrites(db, owner)).ready).toBe(true);
      await expect(recordVerifiedErasure(owner)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
      finish();
      await rejected;
    }
  }, 30000);
  it("reports fixed failure categories without model or exception content", async () => {
    const f = await fixture();
    const job = await f.start();
    f.model.mockRejectedValueOnce(
      new Error("sensitive model response must not be logged"),
    );
    expect(await f.worker.process(f.envelopes[0])).toBe("completed");
    expect((await f.jobs.get(f.principal, f.projectId, job.id)).state).toBe(
      "failed",
    );
    expect(f.onFailure.mock.calls).toEqual([
      [{ stage: "generation", kind: "model" }],
    ]);
  }, 30000);
  it.each([3, 5, 6] as const)(
    "queues v%i idempotently, persists its settings and settles duplicate deliveries once",
    async (proposalVersion) => {
      const f = await fixture(proposalVersion);
      const authority = new ActiveProjectRequestAuthority(
        withDataApiTypes(db),
        f.principal,
        { organizationId: f.organizationId, projectId: f.projectId },
        "projects.mutate",
      );
      const ledger = new PostgresCommercialPersistenceRepository(
        withDataApiTypes(db),
      );
      const scope = await authority.scope();
      expect((await ledger.getCreditBalance(scope)).availableCreditUnits).toBe(
        "400",
      );
      const job = await f.start("same-request");
      expect((await ledger.getCreditBalance(scope)).availableCreditUnits).toBe(
        "300",
      );
      expect(job.state).toBe("queued");
      expect(f.model).not.toHaveBeenCalled();
      expect((await f.start("same-request")).id).toBe(job.id);
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
      const result = await f.jobs.get(f.principal, f.projectId, job.id);
      expect(result.state).toBe("succeeded");
      expect(result.result?.proposal).toEqual(f.proposal);
      expect(
        await f.jobs.credits(f.principal, f.projectId, job.id),
      ).toMatchObject({
        state: "settled",
        actualCreditUnits: "1",
        maximumCreditUnits: "100",
      });
      const financial = await db.query(
        sql(
          "SELECT entry_kind,settled_credit_units FROM usage_ledger_entries WHERE organization_id=$1 AND job_id=$2 AND entry_kind='settlement'",
          [f.organizationId, job.id],
        ),
      );
      expect(financial.rows).toHaveLength(1);
      expect(String(financial.rows[0]?.["settled_credit_units"])).toBe("1");
      expect((await ledger.getCreditBalance(scope)).availableCreditUnits).toBe(
        "399",
      );
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
      expect((await ledger.getCreditBalance(scope)).availableCreditUnits).toBe(
        "399",
      );
      expect(f.model).toHaveBeenCalledTimes(1);
    },
    30000,
  );
  it("releases v6 semantic-invalid output after reported usage without publication or settlement", async () => {
    const f = await fixture(6);
    const resource = f.proposal.resources[0];
    if (!resource) throw Error("Missing native proposal resource.");
    resource.serviceType = "aws.unsupported.resource";
    const job = await f.start();
    expect(await f.worker.process(f.envelopes[0])).toBe("completed");
    expect((await f.jobs.get(f.principal, f.projectId, job.id)).state).toBe(
      "failed",
    );
    expect(f.model).toHaveBeenCalledTimes(1);
    expect(
      await f.jobs.credits(f.principal, f.projectId, job.id),
    ).toMatchObject({
      state: "released",
      actualCreditUnits: "0",
    });
    const stored = await db.query(
      sql(
        "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND object_purpose='proposal'",
        [f.organizationId],
      ),
    );
    const settled = await db.query(
      sql(
        "SELECT ledger_entry_id FROM usage_ledger_entries WHERE organization_id=$1 AND job_id=$2 AND entry_kind='settlement'",
        [f.organizationId, job.id],
      ),
    );
    expect(stored.rows).toHaveLength(0);
    expect(settled.rows).toHaveLength(0);
  }, 30000);
  it("settles valid v6 clarification questions once and retains their applicability receipt on replay", async () => {
    const f = await fixture(6);
    f.model.mockImplementationOnce(
      async (input: {
        onUsage?: (usage: BetaConverseUsage) => Promise<void>;
      }) => {
        await input.onUsage?.({
          inputTokens: 1200,
          outputTokens: 320,
          cacheReadInputTokens: 0,
          providerRequestId: "synthetic-bedrock-questions",
        });
        return {
          ...f.proposal,
          resources: [],
          connections: [],
          existingResources: [],
          updates: [],
          review: {
            intent: "Clarify the requested filter",
            assumptions: [],
            checks: [],
            questions: ["Which message categories should be delivered?"],
          },
        };
      },
    );
    const job = await f.start();
    expect(await f.worker.process(f.envelopes[0])).toBe("completed");
    const completed = await f.jobs.get(f.principal, f.projectId, job.id);
    expect(completed.state).toBe("succeeded");
    expect(completed.result).toMatchObject({
      applicability: { kind: "questions-or-assessment" },
    });
    expect(
      await f.jobs.credits(f.principal, f.projectId, job.id),
    ).toMatchObject({
      state: "settled",
      actualCreditUnits: "1",
    });
    expect(await f.worker.process(f.envelopes[0])).toBe("completed");
    expect((await f.jobs.get(f.principal, f.projectId, job.id)).result).toEqual(
      completed.result,
    );
    const settled = await db.query(
      sql(
        "SELECT ledger_entry_id FROM usage_ledger_entries WHERE organization_id=$1 AND job_id=$2 AND entry_kind='settlement'",
        [f.organizationId, job.id],
      ),
    );
    expect(settled.rows).toHaveLength(1);
    expect(f.model).toHaveBeenCalledTimes(1);
  }, 30000);
  it("refuses unsaved v6 context before creating a reservation or delivery", async () => {
    const f = await fixture(6);
    const unsaved = structuredClone(f.document);
    unsaved.provider.region = regionIdentifierSchema.parse("us-west-2");
    await expect(
      f.jobs.create(
        f.principal,
        f.projectId,
        { ...f.request, architectureDocument: unsaved },
        f.etag,
        "unsaved-v6",
      ),
    ).rejects.toThrow(
      "Save the exact canvas before requesting a semantic AI proposal.",
    );
    const reservations = await db.query(
      sql(
        "SELECT reservation_id FROM credit_reservations WHERE organization_id=$1",
        [f.organizationId],
      ),
    );
    expect(reservations.rows).toHaveLength(0);
    expect(f.envelopes).toHaveLength(0);
    expect(f.model).not.toHaveBeenCalled();
  }, 30000);
  it("rechecks actual membership after the v6 immutable object read before reservation", async () => {
    const f = await fixture(6);
    const original = f.objectStore.open.bind(f.objectStore);
    vi.spyOn(f.objectStore, "open").mockImplementationOnce(
      async (scope, reference) => {
        const stream = await original(scope, reference);
        await db.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
        return stream;
      },
    );
    await expect(f.start()).rejects.toThrow();
    const reservations = await db.query(
      sql(
        "SELECT reservation_id FROM credit_reservations WHERE organization_id=$1",
        [f.organizationId],
      ),
    );
    expect(reservations.rows).toHaveLength(0);
    expect(f.envelopes).toHaveLength(0);
    expect(f.model).not.toHaveBeenCalled();
  }, 30000);
  it.each([3_500_000])(
    "settles a delivery delayed by %i ms without extending its expiry",
    async (delay) => {
      const f = await fixture();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() - delay);
        const job = await f.start();
        vi.useRealTimers();
        expect(await f.worker.process(f.envelopes[0])).toBe("completed");
        expect((await f.jobs.get(f.principal, f.projectId, job.id)).state).toBe(
          delay < 3_600_000 ? "succeeded" : "expired",
        );
        expect(f.model).toHaveBeenCalledTimes(delay < 3_600_000 ? 1 : 0);
      } finally {
        vi.useRealTimers();
      }
    },
    30000,
  );
  it("bounds a retry lease by the remaining runtime budget", async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() - 230_000);
      const job = await f.start();
      vi.spyOn(f.proposals, "generate").mockImplementationOnce(() => {
        vi.useRealTimers();
        throw new JobExecutionError(
          createAsyncJobFailureV1("handler-transient-failure"),
        );
      });
      expect(await f.worker.process(f.envelopes[0])).toBe("pending");
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
      expect((await f.jobs.get(f.principal, f.projectId, job.id)).state).toBe(
        "failed",
      );
      expect(f.model).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }, 30000);
  it("keeps unsaved diagram edits bound separately from the saved draft", async () => {
    const f = await fixture();
    const unsaved = structuredClone(f.document);
    unsaved.provider.region = regionIdentifierSchema.parse("us-west-2");
    const localDigest = digestCanonicalValue(unsaved);
    expect(localDigest).not.toBe(digestCanonicalValue(f.document));
    const job = await f.jobs.create(
      f.principal,
      f.projectId,
      { ...f.request, architectureDocument: unsaved },
      f.etag,
      "unsaved-context",
    );
    expect(job.architectureDigest).toBe(localDigest);
    expect(await f.worker.process(f.envelopes[0])).toBe("completed");
    const completed = await f.jobs.get(f.principal, f.projectId, job.id);
    expect(completed.state).toBe("succeeded");
    expect(completed.result?.architectureDigest).toBe(localDigest);
  }, 30000);
  it("releases an expired queued job before model invocation", async () => {
    const f = await fixture();
    const job = await f.start();
    // The audit delivery trigger compares event time to the database clock.
    // Stub only delivery while advancing the application clock through expiry.
    const append = vi
      .spyOn(ProductionSolutionExportAudit.prototype, "append")
      .mockResolvedValue(undefined);
    const flush = vi
      .spyOn(ProductionSolutionExportAudit.prototype, "flush")
      .mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3_600_001);
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
    } finally {
      vi.useRealTimers();
      append.mockRestore();
      flush.mockRestore();
    }
    expect(f.model).not.toHaveBeenCalled();
    expect(
      await f.jobs.credits(f.principal, f.projectId, job.id),
    ).toMatchObject({
      state: "released",
      actualCreditUnits: "0",
    });
  }, 30_000);
  it.each([3, 6] as const)(
    "cancels a queued v%i job before model invocation",
    async (version) => {
      const f = await fixture(version),
        job = await f.start();
      expect(
        (await f.jobs.cancel(f.principal, f.projectId, job.id)).state,
      ).toBe("canceled");
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
      expect(f.model).not.toHaveBeenCalled();
    },
    30000,
  );
  it("denies cross-tenant reads and forged delivery ownership", async () => {
    const f = await fixture(),
      other = await fixture(),
      job = await f.start();
    await expect(
      f.jobs.get(other.principal, other.projectId, job.id),
    ).rejects.toThrow();
    await expect(
      f.worker.process({
        ...f.envelopes[0],
        ownership: {
          organizationId: other.organizationId,
          projectId: other.projectId,
        },
      }),
    ).rejects.toThrow();
    expect(f.model).not.toHaveBeenCalled();
  }, 30000);
  it.each([3, 6] as const)(
    "rejects current membership revocation before v%i model dispatch",
    async (version) => {
      const f = await fixture(version);
      await f.start();
      await db.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.membershipId],
        ),
      );
      await expect(f.worker.process(f.envelopes[0])).rejects.toThrow();
      expect(f.model).not.toHaveBeenCalled();
    },
    30000,
  );
  it.each([3, 6] as const)(
    "rejects a draft changed after v%i queueing",
    async (version) => {
      const f = await fixture(version),
        job = await f.start();
      await db.query(
        sql(
          "UPDATE architecture_drafts SET draft_version=draft_version+1 WHERE draft_id=$1",
          [f.draftId],
        ),
      );
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
      expect((await f.jobs.get(f.principal, f.projectId, job.id)).state).toBe(
        "failed",
      );
      expect(f.model).not.toHaveBeenCalled();
    },
    30000,
  );
  it("binds admission to the original expiry even when identical creates race", async () => {
    const f = await fixture();
    const requests = await Promise.allSettled([
      f.start("concurrent-key"),
      f.start("concurrent-key"),
    ]);
    const successful = requests.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    expect(successful.length).toBeGreaterThan(0);
    const replay = await f.start("concurrent-key");
    expect(successful.every((j) => j.id === replay.id)).toBe(true);
    await expect(
      f.jobs.create(
        f.principal,
        f.projectId,
        { ...f.request, requirements: "A different application request" },
        f.etag,
        "concurrent-key",
      ),
    ).rejects.toThrow();
  }, 30000);
  it("fences concurrent duplicate deliveries before a second model invocation", async () => {
    const f = await fixture();
    await f.start();
    const outcomes = await Promise.allSettled([
      f.worker.process(f.envelopes[0]),
      f.worker.process(f.envelopes[0]),
    ]);
    expect(
      outcomes.some((r) => r.status === "fulfilled" && r.value === "completed"),
    ).toBe(true);
    expect(f.model).toHaveBeenCalledTimes(1);
  }, 30000);
  it.each([3, 6] as const)(
    "never publishes v%i output after cancellation during generation",
    async (version) => {
      const f = await fixture(version),
        job = await f.start();
      f.model.mockImplementationOnce(async () => {
        await f.jobs.cancel(f.principal, f.projectId, job.id);
        return f.proposal;
      });
      expect(await f.worker.process(f.envelopes[0])).toBe("completed");
      expect((await f.jobs.get(f.principal, f.projectId, job.id)).state).toBe(
        "canceled",
      );
      const results = await db.query(
        sql(
          "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND object_purpose='proposal'",
          [f.organizationId],
        ),
      );
      expect(results.rows).toHaveLength(0);
    },
    30000,
  );
  it.each([3, 6] as const)(
    "never publishes v%i output after permission is revoked during generation",
    async (version) => {
      const f = await fixture(version);
      await f.start();
      f.model.mockImplementationOnce(async () => {
        await db.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
        return f.proposal;
      });
      await expect(f.worker.process(f.envelopes[0])).rejects.toThrow();
      const results = await db.query(
        sql(
          "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND object_purpose='proposal'",
          [f.organizationId],
        ),
      );
      expect(results.rows).toHaveLength(0);
    },
    30000,
  );
});
