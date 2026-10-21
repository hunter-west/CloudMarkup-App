import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  AuthorizedOrganizationScope,
  StageObjectInput,
} from "../../application/persistence.js";
import type { CleanupHistoryPort } from "../../application/project-cleanup-history.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import {
  OrdinaryRuntimeDatabase,
  type OrdinaryRuntimeHost,
} from "./ordinary-runtime-database.js";
import {
  executeOrdinaryRuntimeStatement,
  ordinaryProjectLocks,
} from "./ordinary-runtime-locks.js";
import { createProjectWriteFencedObjectStore } from "./project-content-write-fence.js";
import { CleanupHistoryBoundDatabase } from "./project-cleanup-restore-guard.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

const scope: AuthorizedOrganizationScope = {
  organizationId: "org_test",
  principalId: "principal_test",
  membershipId: "membership_test",
  sessionId: "session_test",
  correlationId: "correlation_test",
  roleKey: "owner",
  capabilities: ["projects.mutate"],
};
const body = new TextEncoder().encode("bounded ordinary staging regression");
const input: StageObjectInput = {
  owner: { organizationId: scope.organizationId, projectId: "project_test" },
  objectId: "object_test",
  purpose: "report",
  contentSha256: createHash("sha256").update(body).digest("hex"),
  sizeBytes: body.byteLength,
  mediaType: "text/plain",
  open: () =>
    (async function* () {
      yield await Promise.resolve(body);
    })(),
};
type Mode =
  | "ready"
  | "initial-absent"
  | "closed"
  | "inactive-project"
  | "cross-tenant"
  | "missing-membership"
  | "membership-drift"
  | "project-drift"
  | "control-drift"
  | "malformed-control";
function fixture(host: OrdinaryRuntimeHost, mode: Mode = "ready") {
  const statements: SqlStatement[] = [];
  const events: string[] = [];
  let restoreStatus = "ready";
  const rows = (s: SqlStatement): SqlRow[] => {
    if (s.text.includes("AS effective_role")) {
      const login = "cloudmarkup_beta_" + host + "_runtime";
      return [
        {
          login,
          effective_role: login,
          database_name: "cloudmarkup",
          can_login: true,
          superuser: false,
          create_database: false,
          create_role: false,
          inherits: false,
          replication: false,
          bypass_rls: false,
          has_membership: false,
          owns_object: false,
          can_create: false,
          replication_role: "origin",
          can_bypass_triggers: false,
        },
      ];
    }
    const helper = /cloudmarkup_ordinary_private\.lock_([a-z_]+)/u.exec(
      s.text,
    )?.[1];
    if (helper !== undefined) {
      const keys =
        helper === "staging_membership"
          ? mode === "missing-membership"
            ? []
            : [scope.membershipId]
          : helper === "staging_project"
            ? mode === "initial-absent"
              ? []
              : [mode === "cross-tenant" ? "org_other" : scope.organizationId]
            : helper === "cleanup_control" && mode === "control-drift"
              ? []
              : ["fixed"];
      return [
        {
          locked_keys_json:
            helper === "cleanup_control" && mode === "malformed-control"
              ? "{}"
              : JSON.stringify(keys),
        },
      ];
    }
    if (s.text.startsWith("SELECT closed_at FROM project_content_write_scopes"))
      return [{ closed_at: mode === "closed" ? "2026-10-09T00:00:00Z" : null }];
    if (s.text.startsWith("SELECT m.membership_id FROM memberships"))
      return mode === "missing-membership"
        ? []
        : [
            {
              membership_id:
                mode === "membership-drift"
                  ? "membership_changed"
                  : scope.membershipId,
            },
          ];
    if (
      s.text.startsWith("SELECT organization_id,lifecycle_status FROM projects")
    )
      return mode === "initial-absent"
        ? []
        : [
            {
              organization_id: ["cross-tenant", "project-drift"].includes(mode)
                ? "org_other"
                : scope.organizationId,
              lifecycle_status:
                mode === "inactive-project" ? "deleted" : "active",
            },
          ];
    if (s.text.startsWith("SELECT history_required,restore_status"))
      return [{ history_required: true, restore_status: restoreStatus }];
    if (s.text.startsWith("UPDATE project_content_writes"))
      return [{ write_id: s.values[0] }];
    return [];
  };
  const raw: SqlDatabase = {
    query<T extends SqlRow>(s: SqlStatement): Promise<SqlResult<T>> {
      statements.push(s);
      const result = rows(s);
      return Promise.resolve({ rows: result as T[], rowCount: result.length });
    },
    async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      events.push("begin");
      try {
        const value = await work(raw);
        events.push("commit");
        return value;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
    close: () => Promise.resolve(),
  };
  const ordinary = new OrdinaryRuntimeDatabase(raw, host);
  return {
    raw,
    ordinary,
    statements,
    events,
    setRestoreStatus: (value: string) => {
      restoreStatus = value;
    },
  };
}
function staging(host: "proposal" | "export", mode: Mode = "ready") {
  const f = fixture(host, mode),
    delegate = new InMemoryObjectStore(),
    stage = vi.spyOn(delegate, "stage");
  const store = createProjectWriteFencedObjectStore({
    database: f.ordinary,
    delegate,
    storageNamespace: "ordinary-regression",
  });
  return { ...f, store, stage };
}
describe("actual ordinary staging and history lock paths", () => {
  it.each(["proposal", "export"] as const)(
    "routes %s staging authority and project queries before provider work",
    async (host) => {
      const f = staging(host);
      await expect(f.store.stage(scope, input)).resolves.toMatchObject({
        objectId: input.objectId,
      });
      expect(f.stage).toHaveBeenCalledOnce();
      const membership = f.statements.find((s) =>
        s.text.startsWith("SELECT m.membership_id FROM memberships"),
      );
      expect(membership?.text).toContain("m.membership_id=$3");
      expect(membership?.text).toContain(
        "r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)",
      );
      expect(membership?.text).toContain(
        "'projects.create'=ANY(r.capabilities)",
      );
      expect(membership?.text).toContain(
        "'projects.mutate'=ANY(r.capabilities)",
      );
      expect(membership?.text).toContain("'exports.run'=ANY(r.capabilities)");
      expect(membership?.values).toEqual([
        scope.organizationId,
        scope.principalId,
        scope.membershipId,
      ]);
      const helpers = f.statements
        .filter((s) => s.text.includes("cloudmarkup_ordinary_private."))
        .map((s) => s.text);
      expect(helpers).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "lock_staging_membership($1::text,$2::text,$3::text)",
          ),
          expect.stringContaining("lock_staging_project($1::text)"),
        ]),
      );
      expect(
        f.statements
          .filter((s) => !s.text.includes("cloudmarkup_ordinary_private."))
          .map((s) => s.text)
          .join("\n"),
      ).not.toMatch(/FOR (SHARE|UPDATE)/u);
    },
  );
  it("preserves initial project absence while the durable writer fence stays open", async () => {
    const f = staging("proposal", "initial-absent");
    await expect(f.store.stage(scope, input)).resolves.toMatchObject({
      objectId: input.objectId,
    });
    expect(f.stage).toHaveBeenCalledOnce();
  });
  it.each([
    "closed",
    "inactive-project",
    "cross-tenant",
    "missing-membership",
    "membership-drift",
    "project-drift",
  ] as const)("refuses %s before provider staging", async (mode) => {
    const f = staging("export", mode);
    await expect(f.store.stage(scope, input)).rejects.toThrow();
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.events).toEqual(["begin", "rollback"]);
  });
  it("refuses a host without staging authority and the zero-parameter control shape before delegation", async () => {
    const f = fixture("billing"),
      stagingQuery = ordinaryProjectLocks.find(
        (s) => s.name === "staging_project",
      ),
      control = ordinaryProjectLocks.find((s) => s.name === "cleanup_control");
    if (stagingQuery === undefined || control === undefined)
      throw Error("Missing fixed source selector");
    await expect(
      executeOrdinaryRuntimeStatement(
        f.raw,
        "billing",
        sql(stagingQuery.statement, ["project_test"]),
      ),
    ).rejects.toThrow();
    await expect(
      executeOrdinaryRuntimeStatement(
        f.raw,
        "billing",
        sql(control.statement, ["unexpected"]),
      ),
    ).rejects.toThrow();
    expect(f.statements).toEqual([]);
  });
  const hosts = ["api", "proposal", "export", "cleanup", "billing"] as const;
  function historyGuard(host: OrdinaryRuntimeHost, mode: Mode = "ready") {
    const f = fixture(host, mode);
    const history: CleanupHistoryPort = {
      prepare: () => Promise.resolve(),
      transition: () => Promise.resolve(),
      read: () => Promise.resolve(null),
      page: () => Promise.resolve({ records: [] }),
    };
    const guard = new CleanupHistoryBoundDatabase({
      database: f.ordinary,
      history,
      assertSchema: () => Promise.resolve(),
      incarnation: {
        expectedArn: "synthetic",
        expectedResourceId: "synthetic",
        assertCurrent: () => Promise.resolve(),
      },
    });
    return { ...f, guard };
  }
  it.each(hosts)(
    "routes enabled %s empty history control checks before and after work",
    async (host) => {
      const f = historyGuard(host),
        work = vi.fn(() => Promise.resolve("result"));
      await expect(f.guard.transaction(work)).resolves.toBe("result");
      expect(work).toHaveBeenCalledOnce();
      const helpers = f.statements.filter(
        (s) =>
          s.text ===
          "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_cleanup_control()",
      );
      expect(helpers).toHaveLength(2);
      expect(helpers.every((s) => s.values.length === 0)).toBe(true);
      const rereads = f.statements.filter((s) =>
        s.text.startsWith("SELECT history_required,restore_status"),
      );
      expect(rereads).toHaveLength(2);
      expect(rereads.every((s) => !s.text.includes("FOR SHARE"))).toBe(true);
    },
  );
  it.each(["control-drift", "malformed-control"] as const)(
    "refuses %s with empty history before ordinary work",
    async (mode) => {
      const f = historyGuard("billing", mode),
        work = vi.fn(() => Promise.resolve("never"));
      await expect(f.guard.transaction(work)).rejects.toThrow();
      expect(work).not.toHaveBeenCalled();
      expect(f.events).toEqual(["begin", "rollback"]);
    },
  );
  it("retains quarantine before work and after a callback even with empty history", async () => {
    const before = historyGuard("cleanup"),
      work = vi.fn(() => Promise.resolve("never"));
    before.setRestoreStatus("restoring");
    await expect(before.guard.transaction(work)).rejects.toThrow("quarantined");
    expect(work).not.toHaveBeenCalled();
    const after = historyGuard("billing");
    await expect(
      after.guard.transaction(() => {
        after.setRestoreStatus("restoring");
        return Promise.resolve("discard");
      }),
    ).rejects.toThrow("quarantined");
    expect(after.events).toEqual(["begin", "rollback"]);
  });
});
