import {
  ProjectDeletionRecoveryAuthority,
  sealProjectDeletionForErasure,
} from "./project-deletion-recovery-authority.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  projectCleanupAdmissionWake,
  type ProjectCleanupAdmissionWake,
} from "../../application/project-cleanup-wake.js";
import { PostgresCleanupAdmissionJournal } from "./project-cleanup-admission.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { withDataApiTypes } from "./data-api-postgres-test-helpers.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite = configured ? describe : describe.skip;
const nonce = randomUUID().replaceAll("-", "");
const schema = "cm_cleanup_admission_it_" + nonce;
const marker = "CloudMarkup synthetic cleanup admission " + nonce;
const id = (kind: string) => kind + "_" + randomUUID().replaceAll("-", "");

suite(
  "cleanup admission on isolated genuine PostgreSQL with Data API types",
  () => {
    let opened: PostgresDatabase | undefined;
    let admin: PostgresDatabase | undefined;
    let database: SqlDatabase;
    let created = false;
    beforeAll(async () => {
      const url = new URL(configured ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.search !== "" ||
        url.hash !== "" ||
        !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
      )
        throw Error("Loopback test database required");
      admin = new PostgresDatabase({
        connectionString: configured,
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      await admin.transaction(async (tx) => {
        await tx.query(sql('CREATE SCHEMA "' + schema + '"'));
        await tx.query(
          sql('COMMENT ON SCHEMA "' + schema + '" IS ' + "'" + marker + "'"),
        );
      });
      created = true;
      opened = new PostgresDatabase({
        connectionString: configured,
        max: 4,
        connectionTimeoutMillis: 5_000,
        options:
          "-c search_path=" +
          schema +
          " -c timezone=Pacific/Honolulu -c statement_timeout=5000",
      });
      await runMigrations(
        opened,
        await loadHistoricalBetaMigrations(
          fileURLToPath(new URL("../../../migrations", import.meta.url)),
        ),
      );
      database = withDataApiTypes(opened);
    }, 60_000);
    afterAll(async () => {
      try {
        await opened?.close();
        if (created && admin !== undefined) {
          const receipt = await admin.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schema],
            ),
          );
          if (
            !/^cm_cleanup_admission_it_[a-f0-9]{32}$/u.test(schema) ||
            receipt.rows[0]?.["marker"] !== marker
          )
            throw Error("Unsafe test schema");
          await admin.query(sql('DROP SCHEMA "' + schema + '" CASCADE'));
        }
      } finally {
        await admin?.close();
      }
    }, 30_000);

    async function fixture(expired = false) {
      const principalId = id("principal"),
        organizationId = id("organization"),
        projectId = id("project");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic admission')",
            [principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic admission',$2)",
            [organizationId, id("slug").replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'owner','authorization-v2',true,cloudmarkup_authorization_v2_permissions('owner'))",
            [organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
            [id("membership"), organizationId, principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO projects(project_id,organization_id,name,created_by_principal_id) VALUES($1,$2,'Synthetic admission',$3)",
            [projectId, organizationId, principalId],
          ),
        );
      });
      const journal = new PostgresCleanupAdmissionJournal(database);
      let wake: ProjectCleanupAdmissionWake;
      if (expired) {
        wake = projectCleanupAdmissionWake({
          organizationId,
          projectId,
          recordVersion: 2,
          admissionId: randomUUID().replaceAll("-", "").repeat(2),
          deletionRequestedAt: "2000-01-01T00:00:00.000Z",
          admissionDeadline: "2000-01-01T00:01:00.000Z",
        });
        await database.query(
          sql(
            `INSERT INTO project_cleanup_admissions(admission_id,organization_id,project_id,principal_id,
        idempotency_key_sha256,request_sha256,expected_record_version,wake_binding,admission_deadline)
        VALUES($1,$2,$3,$4,$5,$6,1,$7,$8::timestamptz)`,
            [
              wake.admissionId,
              organizationId,
              projectId,
              principalId,
              "a".repeat(64),
              "b".repeat(64),
              JSON.stringify(wake),
              wake.admissionDeadline,
            ],
          ),
        );
      } else {
        wake = await database.transaction(async (tx) => {
          await tx.query(
            sql(
              "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
              [organizationId, projectId],
            ),
          );
          return journal.prepare(tx, {
            organizationId,
            projectId,
            principalId,
            keySha256: "a".repeat(64),
            requestSha256: "b".repeat(64),
            expectedRecordVersion: 1,
          });
        });
      }
      const updateProject = (tx: SqlExecutor) =>
        tx.query(
          sql(
            `UPDATE projects SET lifecycle_status='deletion-pending',
      record_version=2,deletion_requested_at=$3::timestamptz WHERE organization_id=$1 AND project_id=$2`,
            [organizationId, projectId, wake.deletionRequestedAt],
          ),
        );
      return {
        principalId,
        journal,
        wake,
        updateProject,
        read: async () => {
          const row = await database.query(
            sql(
              `SELECT p.lifecycle_status AS project_status,a.lifecycle_status AS admission_status
        FROM projects p JOIN project_cleanup_admissions a ON a.organization_id=p.organization_id AND a.project_id=p.project_id
        WHERE a.admission_id=$1`,
              [wake.admissionId],
            ),
          );
          return row.rows[0];
        },
      };
    }
    it("commits the exact project/journal together and preserves SQL-prepared timestamps", async () => {
      const f = await fixture();
      expect(await f.journal.resolve(f.wake)).toBe("prepared");
      await database.transaction(async (tx) => {
        await f.journal.assertCommittable(tx, f.wake);
        await f.updateProject(tx);
        await f.journal.commit(tx, f.wake);
      });
      expect(await f.journal.resolve(f.wake)).toBe("committed");
      expect(await f.read()).toEqual({
        project_status: "deletion-pending",
        admission_status: "committed",
      });
    });
    it("refuses an unmatched canonical deletion job terminal without creating evidence", async () => {
      const f = await fixture();
      await expect(
        database.query(
          sql(
            `INSERT INTO project_deletion_job_terminals(organization_id,project_id,job_id,
              deletion_record_version,prior_record_version,terminal_record_version,
              prior_snapshot_object_id,terminal_snapshot_object_id,command_at)
             VALUES($1,$2,$3,2,1,2,$4,$5,clock_timestamp())`,
            [
              f.wake.organizationId,
              f.wake.projectId,
              id("unmatched_job"),
              id("prior_snapshot"),
              id("terminal_snapshot"),
            ],
          ),
        ),
      ).rejects.toThrow("Exact canonical deletion command receipt is required");
      const evidence = await database.query(
        sql(
          "SELECT job_id FROM project_deletion_job_terminals WHERE organization_id=$1 AND project_id=$2",
          [f.wake.organizationId, f.wake.projectId],
        ),
      );
      expect(evidence.rows).toHaveLength(0);
    });
    it("rejects journal-only commit and rolls back the entire transaction", async () => {
      const f = await fixture();
      await expect(
        database.transaction(async (tx) => {
          await f.journal.assertCommittable(tx, f.wake);
          await f.journal.commit(tx, f.wake);
        }),
      ).rejects.toThrow();
      expect(await f.read()).toEqual({
        project_status: "active",
        admission_status: "prepared",
      });
    });
    it("assigns distinct exact deletion bindings for multiple prepared attempts on one project version", async () => {
      const f = await fixture();
      const second = await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
            [f.wake.organizationId, f.wake.projectId],
          ),
        );
        return f.journal.prepare(tx, {
          organizationId: f.wake.organizationId,
          projectId: f.wake.projectId,
          principalId: f.principalId,
          keySha256: "c".repeat(64),
          requestSha256: "b".repeat(64),
          expectedRecordVersion: 1,
        });
      });
      expect(second.deletionRequestedAt > f.wake.deletionRequestedAt).toBe(
        true,
      );
      await database.transaction(async (tx) => {
        await f.journal.assertCommittable(tx, f.wake);
        await f.updateProject(tx);
        await f.journal.commit(tx, f.wake);
      });
      expect(await f.journal.resolve(f.wake)).toBe("committed");
      expect(await f.journal.resolve(second)).toBe("prepared");
    });
    it("rejects project-only commit when a matching journal exists", async () => {
      const f = await fixture();
      await expect(database.transaction(f.updateProject)).rejects.toThrow();
      expect(await f.read()).toEqual({
        project_status: "active",
        admission_status: "prepared",
      });
    });
    it("seals expired PREPARED under lock and prevents both adapter and SQL late commit", async () => {
      const f = await fixture(true);
      expect(await f.journal.resolve(f.wake)).toBe("aborted");
      await expect(
        database.transaction((tx) => f.journal.assertCommittable(tx, f.wake)),
      ).rejects.toThrow();
      await expect(database.transaction(f.updateProject)).rejects.toThrow();
      expect(await f.read()).toEqual({
        project_status: "active",
        admission_status: "aborted",
      });
    });
    it("retains terminal admissions and rejects mutation, reopening and deletion", async () => {
      const f = await fixture(true);
      await f.journal.resolve(f.wake);
      await expect(
        database.query(
          sql(
            "UPDATE project_cleanup_admissions SET lifecycle_status='prepared',resolved_at=NULL WHERE admission_id=$1",
            [f.wake.admissionId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE project_cleanup_admissions SET request_sha256=$2 WHERE admission_id=$1",
            [f.wake.admissionId, "c".repeat(64)],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql("DELETE FROM project_cleanup_admissions WHERE admission_id=$1", [
            f.wake.admissionId,
          ]),
        ),
      ).rejects.toThrow();
      expect(await f.journal.resolve(f.wake)).toBe("aborted");
    });
    it("keeps legacy defaults compatible but rejects unmatched deletion when required mode is locked on", async () => {
      const f = await fixture();
      const legacyUpdate = (tx: SqlExecutor) =>
        tx.query(
          sql(
            `UPDATE projects SET lifecycle_status='deletion-pending',
        record_version=2,deletion_requested_at=$3::timestamptz + interval '1 second'
        WHERE organization_id=$1 AND project_id=$2`,
            [
              f.wake.organizationId,
              f.wake.projectId,
              f.wake.deletionRequestedAt,
            ],
          ),
        );
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "UPDATE project_cleanup_controls SET admission_required=true WHERE control_id='beta'",
          ),
        );
      });
      try {
        await expect(database.transaction(legacyUpdate)).rejects.toThrow();
        expect((await f.read())?.["project_status"]).toBe("active");
        await database.transaction(async (tx) => {
          await f.journal.assertCommittable(tx, f.wake);
          await f.updateProject(tx);
          await f.journal.commit(tx, f.wake);
        });
      } finally {
        await database.query(
          sql(
            "UPDATE project_cleanup_controls SET admission_required=false WHERE control_id='beta'",
          ),
        );
      }
      const compatibility = await fixture();
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            `UPDATE projects SET lifecycle_status='deletion-pending',record_version=2,
          deletion_requested_at=$3::timestamptz + interval '1 second' WHERE organization_id=$1 AND project_id=$2`,
            [
              compatibility.wake.organizationId,
              compatibility.wake.projectId,
              compatibility.wake.deletionRequestedAt,
            ],
          ),
        );
      });
      expect((await compatibility.read())?.["project_status"]).toBe(
        "deletion-pending",
      );
      await database.query(
        sql(
          "UPDATE project_cleanup_controls SET admission_required=true WHERE control_id='beta'",
        ),
      );
      try {
        await database.query(
          sql(
            "UPDATE projects SET content_cleanup_attempted_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2",
            [compatibility.wake.organizationId, compatibility.wake.projectId],
          ),
        );
        await expect(
          database.query(
            sql(
              "UPDATE projects SET deletion_requested_at=deletion_requested_at+interval '1 second' WHERE organization_id=$1 AND project_id=$2",
              [compatibility.wake.organizationId, compatibility.wake.projectId],
            ),
          ),
        ).rejects.toThrow();
      } finally {
        await database.query(
          sql(
            "UPDATE project_cleanup_controls SET admission_required=false WHERE control_id='beta'",
          ),
        );
      }
    });
    it("resolver cannot bypass the deletion transaction's project lock", async () => {
      const f = await fixture();
      let locked: () => void = () => {
          throw Error("Lock signal was not initialized");
        },
        finish: () => void = () => {
          throw Error("Release signal was not initialized");
        };
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const admission = database.transaction(async (tx) => {
        await f.journal.assertCommittable(tx, f.wake);
        locked();
        await release;
        await f.updateProject(tx);
        await f.journal.commit(tx, f.wake);
      });
      await acquired;
      const bounded: SqlDatabase = {
        ...database,
        transaction: (work) =>
          database.transaction(async (tx) => {
            await tx.query(sql("SET LOCAL lock_timeout='100ms'"));
            return work(tx);
          }),
      };
      try {
        await expect(
          new PostgresCleanupAdmissionJournal(bounded).resolve(f.wake),
        ).rejects.toThrow();
      } finally {
        finish();
        await admission;
      }
      expect(await f.journal.resolve(f.wake)).toBe("committed");
    });

    async function closeFixture(f: Awaited<ReturnType<typeof fixture>>) {
      await database.transaction(async (tx) => {
        await f.updateProject(tx);
        await f.journal.commit(tx, f.wake);
        await tx.query(
          sql(
            "INSERT INTO project_content_write_scopes(organization_id,project_id,closed_at) VALUES($1,$2,clock_timestamp())",
            [f.wake.organizationId, f.wake.projectId],
          ),
        );
      });
      const authority = new ProjectDeletionRecoveryAuthority(database, {
        organizationId: f.wake.organizationId,
        projectId: f.wake.projectId,
        recordVersion: f.wake.recordVersion,
        deletionRequestedAt: f.wake.deletionRequestedAt,
      });
      await authority.transaction(() => Promise.resolve());
      return authority;
    }
    it("permanently seals drained recovery and rejects reopening or a changed binding", async () => {
      const f = await fixture(),
        authority = await closeFixture(f);
      await sealProjectDeletionForErasure(authority);
      await expect(
        authority.transaction(() => Promise.resolve()),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE project_cleanup_phases SET phase='draining' WHERE organization_id=$1 AND project_id=$2",
            [f.wake.organizationId, f.wake.projectId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE project_cleanup_phases SET deletion_record_version=deletion_record_version+1 WHERE organization_id=$1 AND project_id=$2",
            [f.wake.organizationId, f.wake.projectId],
          ),
        ),
      ).rejects.toThrow();
    });
    it("required recovery SQL receipt rejects an unsealed phase and admits the exact sealed binding", async () => {
      const f = await fixture(),
        authority = await closeFixture(f);
      await database.query(
        sql(
          "UPDATE project_cleanup_controls SET recovery_required=true WHERE control_id='beta'",
        ),
      );
      const receipt = () =>
        database.query(
          sql(
            `INSERT INTO project_content_erasure_receipts(organization_id,project_id,deletion_record_version,deletion_requested_at,write_scope_closed_at,storage_configuration_sha256,object_metadata_count)
        SELECT p.organization_id,p.project_id,p.record_version,p.deletion_requested_at,s.closed_at,$3,0 FROM projects p JOIN project_content_write_scopes s USING(organization_id,project_id) WHERE p.organization_id=$1 AND p.project_id=$2`,
            [f.wake.organizationId, f.wake.projectId, "d".repeat(64)],
          ),
        );
      try {
        await expect(receipt()).rejects.toThrow();
        await sealProjectDeletionForErasure(authority);
        await receipt();
      } finally {
        await database.query(
          sql(
            "UPDATE project_cleanup_controls SET recovery_required=false WHERE control_id='beta'",
          ),
        );
      }
    });
    it("scope lock excludes erasure seal until recovery registration has committed", async () => {
      const f = await fixture(),
        authority = await closeFixture(f);
      let acquired!: () => void, release!: () => void;
      const held = new Promise<void>((resolve) => {
          acquired = resolve;
        }),
        done = new Promise<void>((resolve) => {
          release = resolve;
        });
      const holding = database.transaction(async (tx) => {
        await tx.query(
          sql(
            "SELECT closed_at FROM project_content_write_scopes WHERE organization_id=$1 AND project_id=$2 FOR UPDATE",
            [f.wake.organizationId, f.wake.projectId],
          ),
        );
        acquired();
        await done;
      });
      await held;
      const bounded: SqlDatabase = {
        query: database.query.bind(database),
        close: () => Promise.resolve(),
        transaction: (work) =>
          database.transaction(async (tx) => {
            await tx.query(sql("SET LOCAL lock_timeout='100ms'"));
            return work(tx);
          }),
      };
      try {
        await expect(
          sealProjectDeletionForErasure(
            new ProjectDeletionRecoveryAuthority(bounded, authority.binding),
          ),
        ).rejects.toThrow();
      } finally {
        release();
        await holding;
      }
      expect(
        (
          await database.query(
            sql(
              "SELECT phase FROM project_cleanup_phases WHERE organization_id=$1 AND project_id=$2",
              [f.wake.organizationId, f.wake.projectId],
            ),
          )
        ).rows[0]?.["phase"],
      ).toBe("draining");
    });
    it("uncertain ordinary writer cannot complete from elapsed time or a mismatched history proof", async () => {
      const f = await fixture(),
        writeId = "write_" + randomUUID().replaceAll("-", "");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO project_content_write_scopes(organization_id,project_id) VALUES($1,$2)",
            [f.wake.organizationId, f.wake.projectId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO project_content_writes(write_id,organization_id,project_id,storage_namespace,object_id,content_sha256,created_by_principal_id,history_id) VALUES($1,$2,$3,'documents',$4,$5,$6,$7)",
            [
              writeId,
              f.wake.organizationId,
              f.wake.projectId,
              id("object"),
              "d".repeat(64),
              f.principalId,
              "e".repeat(64),
            ],
          ),
        );
        await tx.query(
          sql(
            "UPDATE project_content_writes SET lifecycle_status='uncertain',finalized_at=clock_timestamp() WHERE write_id=$1",
            [writeId],
          ),
        );
      });
      const complete = () =>
        database.query(
          sql(
            "UPDATE project_content_writes SET lifecycle_status='completed',finalized_at=clock_timestamp() WHERE write_id=$1",
            [writeId],
          ),
        );
      await expect(complete()).rejects.toThrow();
      await database.query(
        sql(
          "INSERT INTO project_content_write_completion_proofs(write_id,history_id,history_state,object_version) VALUES($1,$2,'completed','synthetic-returned-version')",
          [writeId, "f".repeat(64)],
        ),
      );
      await expect(complete()).rejects.toThrow();
      await expect(
        database.query(
          sql(
            "UPDATE project_content_write_completion_proofs SET history_id=$2 WHERE write_id=$1",
            [writeId, "e".repeat(64)],
          ),
        ),
      ).rejects.toThrow();
    });
    it("exact returned writer completion proof can close uncertainty without reopening registration", async () => {
      const f = await fixture(),
        writeId = "write_" + randomUUID().replaceAll("-", "");
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO project_content_write_scopes(organization_id,project_id) VALUES($1,$2)",
            [f.wake.organizationId, f.wake.projectId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO project_content_writes(write_id,organization_id,project_id,storage_namespace,object_id,content_sha256,created_by_principal_id,history_id) VALUES($1,$2,$3,'documents',$4,$5,$6,$7)",
            [
              writeId,
              f.wake.organizationId,
              f.wake.projectId,
              id("object"),
              "d".repeat(64),
              f.principalId,
              "e".repeat(64),
            ],
          ),
        );
        await tx.query(
          sql(
            "UPDATE project_content_writes SET lifecycle_status='uncertain',finalized_at=clock_timestamp() WHERE write_id=$1",
            [writeId],
          ),
        );
        await f.updateProject(tx);
        await f.journal.commit(tx, f.wake);
        await tx.query(
          sql(
            "UPDATE project_content_write_scopes SET closed_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2",
            [f.wake.organizationId, f.wake.projectId],
          ),
        );
      });
      await database.query(
        sql(
          "INSERT INTO project_content_write_completion_proofs(write_id,history_id,history_state,object_version) VALUES($1,$2,'completed','synthetic-returned-version')",
          [writeId, "e".repeat(64)],
        ),
      );
      await database.query(
        sql(
          "UPDATE project_content_writes SET lifecycle_status='completed',finalized_at=clock_timestamp() WHERE write_id=$1",
          [writeId],
        ),
      );
      await expect(
        database.query(
          sql(
            "INSERT INTO project_content_writes(write_id,organization_id,project_id,storage_namespace,object_id,content_sha256,created_by_principal_id) VALUES($1,$2,$3,'documents',$4,$5,$6)",
            [
              "write_" + randomUUID().replaceAll("-", ""),
              f.wake.organizationId,
              f.wake.projectId,
              id("object"),
              "d".repeat(64),
              f.principalId,
            ],
          ),
        ),
      ).rejects.toThrow();
    });
    it("expired restored admission commits only from exact externally committed history in frozen restore mode", async () => {
      const f = await fixture(true),
        envelope = await f.journal.envelope(f.wake);
      await database.query(
        sql(
          "INSERT INTO project_cleanup_restore_history(history_id,envelope,history_state) VALUES($1,$2,'committed')",
          [f.wake.wakeId, JSON.stringify(envelope)],
        ),
      );
      await expect(
        database.transaction(async (tx) => {
          await f.updateProject(tx);
          await f.journal.commit(tx, f.wake);
        }),
      ).rejects.toThrow();
      await database.query(
        sql(
          "UPDATE project_cleanup_controls SET restore_status='restoring' WHERE control_id='beta'",
        ),
      );
      try {
        await database.transaction(async (tx) => {
          await f.updateProject(tx);
          await f.journal.commit(tx, f.wake);
        });
      } finally {
        await database.query(
          sql(
            "UPDATE project_cleanup_controls SET restore_status='ready' WHERE control_id='beta'",
          ),
        );
      }
      expect(await f.journal.resolve(f.wake)).toBe("committed");
    });
  },
);
