import {
  asyncJobIdSchema,
  asyncJobOrganizationIdSchema,
  asyncJobTrustedOwnershipV1Schema,
} from "@cloudmarkup/schemas";
import {
  projectGoCompilationResultToSolutionExportInfrastructure,
  validateCloudFormationInfrastructure,
} from "@cloudmarkup/solution-export-workflow";
import { SolutionExportWorkflowObjects } from "./solution-export-workflow-objects.js";
import { SolutionExportWorkflowStorage } from "./solution-export-workflow-storage.js";
import {
  SolutionExportWorkerAuthority,
  solutionExportExecutionIdentity,
} from "./solution-export-worker-authority.js";
import { PostgresSolutionRecordRepository } from "./solution-record-repository.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { PostgresSolutionExportRunRepository } from "./solution-export-run-repository.js";
import { persistedExportRunFixture } from "./solution-export-run-test-helpers.js";
import { sql } from "./sql.js";

const configuredUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integrationDescribe =
  configuredUrl === undefined || configuredUrl === ""
    ? describe.skip
    : describe;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_export_cfn_it_${nonce}`;
const marker = `CloudMarkup synthetic CloudFormation export compatibility ${nonce}`;
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
  "CloudFormation compatibility on isolated real PostgreSQL",
  () => {
    let admin: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let opened: PostgresDatabase | undefined;
    let created = false;
    let historical: Awaited<ReturnType<typeof persistedExportRunFixture>>;
    beforeAll(async () => {
      const connectionString = loopbackUrl();
      if (!/^cm_export_cfn_it_[a-f0-9]{32}$/u.test(schema))
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
        max: 6,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schema} -c timezone=Pacific/Honolulu -c statement_timeout=5000`,
      });
      opened = database;
      const migrations = await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      );
      await runMigrations(
        database,
        migrations.filter(({ version }) => version <= "0054"),
      );
      historical = await persistedExportRunFixture(database);
      await historical.createRoot();
      await historical.repository.insertPreparedRun(historical.prepared);
      await runMigrations(database, migrations);
    }, 60_000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (created && admin !== undefined) {
          const found = await admin.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schema],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== marker ||
            !/^cm_export_cfn_it_[a-f0-9]{32}$/u.test(schema)
          )
            throw new Error(
              "Refusing cleanup of an unverified synthetic schema.",
            );
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        }
      } finally {
        await admin?.close();
      }
    }, 30_000);

    it("migrates a retained Terraform checkpoint without changing its bytes or authority", async () => {
      expect(await historical.repository.getJob(historical.selector)).toEqual({
        record: historical.record,
        recordVersion: 1,
      });
      const applied = await database.query(
        sql(
          "SELECT version FROM cloudmarkup_schema_migrations ORDER BY version",
        ),
      );
      expect(applied.rows).toHaveLength(81);
      expect(applied.rows.at(-2)?.["version"]).toBe("0098");
      expect(applied.rows.at(-1)?.["version"]).toBe("0138");
    });
    it("roundtrips exact CloudFormation jobs, replays idempotently and rejects foreign principals and target substitution", async () => {
      const f = await persistedExportRunFixture(database, "cloudformation");
      await expect(
        f.repository.insertPreparedRun(f.prepared),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      await f.createRoot();
      expect((await f.repository.insertPreparedRun(f.prepared)).created).toBe(
        true,
      );
      expect((await f.repository.insertPreparedRun(f.prepared)).created).toBe(
        false,
      );
      expect(await f.repository.getJob(f.selector)).toEqual({
        record: f.record,
        recordVersion: 1,
      });
      const foreign = await persistedExportRunFixture(database);
      const foreignReader = new PostgresSolutionExportRunRepository({
        database,
        objectStore: f.objects,
        principal: foreign.principal,
      });
      await expect(foreignReader.getJob(f.selector)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(
        f.repository.getJob({
          ...f.selector,
          projectId: foreign.selector.projectId,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        f.repository.insertPreparedRun({
          ...f.prepared,
          record: {
            ...f.record,
            targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
          },
        }),
      ).rejects.toThrow();
      expect((await f.repository.getJob(f.selector))?.record).toEqual(f.record);
      await expect(
        database.query(
          sql(
            "UPDATE solution_export_runs SET progress_stage='terraform-validation' WHERE solution_export_run_id=$1",
            [f.record.job.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE membership_id=$1",
          [f.membershipId],
        ),
      );
      await expect(f.repository.getJob(f.selector)).rejects.toMatchObject({
        code: "not_found",
      });
    });
    it("persists the actual local CloudFormation report and template bytes only under current leased tenant authority", async () => {
      const f = await persistedExportRunFixture(database, "cloudformation");
      await f.createRoot();
      await f.repository.insertPreparedRun(f.prepared);
      const running = await f.startRoot();
      const identity = solutionExportExecutionIdentity(running);
      const authority = new SolutionExportWorkerAuthority(database, identity);
      const storage = new SolutionExportWorkflowStorage(authority, f.objects);
      const objects = new SolutionExportWorkflowObjects(
        storage,
        identity,
        f.record,
        new PostgresSolutionRecordRepository(authority),
      );
      const settings = f.record.workflowSubmission.request.targetSettings;
      if (settings.target !== "cloudformation")
        throw new Error("Expected CloudFormation.");
      const infrastructure =
        projectGoCompilationResultToSolutionExportInfrastructure(
          f.source.compilation,
        );
      const report = validateCloudFormationInfrastructure({
        infrastructure,
        now: f.record.job.createdAt,
        request: f.record.workflowSubmission.request,
        settings: settings.stageDescriptors.cloudFormationValidation,
      });
      const scope = {
        jobId: asyncJobIdSchema.parse(f.record.job.id),
        ownership: asyncJobTrustedOwnershipV1Schema.parse(authority.ownership),
      };
      const saved = await objects.persistStageReport({
        scope,
        stage: "validate-infrastructure",
        report,
        digest: report.reportDigest,
        evidenceRecords: report.evidenceRecords,
      });
      expect(saved.artifact.kind).toBe("cloudformation-validation-report");
      if (saved.artifact.object === undefined)
        throw new Error("Expected retained report object.");
      const metadata = await storage.metadata(saved.artifact.object.objectId);
      if (metadata === null) throw new Error("Expected persisted report.");
      expect(await storage.readJson(metadata.reference)).toEqual({
        diagnostics: report.diagnostics,
        target: report.target,
        validation: report.validation,
      });
      const template = infrastructure.files[0];
      if (template === undefined)
        throw new Error("Expected compiler template.");
      const bytes = new TextEncoder().encode(template.content);
      const stored = await storage.put(
        bytes,
        "generated-source",
        "application/vnd.amazon.cloudformation.template+json",
      );
      expect(await storage.read(stored)).toEqual(bytes);
      await expect(
        objects.persistStageReport({
          scope: {
            ...scope,
            ownership: {
              ...scope.ownership,
              organizationId: asyncJobOrganizationIdSchema.parse("org.foreign"),
            },
          },
          stage: "validate-infrastructure",
          report,
          digest: report.reportDigest,
          evidenceRecords: report.evidenceRecords,
        }),
      ).rejects.toThrow();
      await expect(
        storage.put(
          new TextEncoder().encode("altered"),
          "generated-source",
          stored.mediaType,
          stored.objectId,
        ),
      ).rejects.toThrow();
      await f.cancelRoot();
      await expect(storage.read(stored)).rejects.toThrow();
    });
  },
);
