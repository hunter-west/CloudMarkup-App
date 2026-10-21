import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ordinaryAuthorizationLocks,
  ordinaryAuthorizationReceiptColumn as marker,
} from "./ordinary-runtime-authorization-locks.js";
import { tryExecuteOrdinaryAuthorizationStatement } from "./ordinary-runtime-authorization.js";
import {
  sql,
  type SqlExecutor,
  type SqlResult,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

function fixture(keys: unknown, rows: readonly SqlRow[]) {
  const statements: SqlStatement[] = [];
  const query = vi.fn((statement: SqlStatement): Promise<SqlResult> => {
    statements.push(statement);
    const result =
      statements.length === 1
        ? [{ locked_keys_json: JSON.stringify(keys) }]
        : rows;
    return Promise.resolve({
      rowCount: result.length,
      rows: result,
    });
  });
  const tx: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      return query(statement) as Promise<SqlResult<TRow>>;
    },
  };
  return { tx, query, statements };
}

function binding(id: number) {
  const found = ordinaryAuthorizationLocks.find(
    (entry) => entry.inventoryId === id,
  );
  if (found === undefined)
    throw new Error("Unknown synthetic authorization case");
  return found;
}

describe("ordinary authorization identity receipts", () => {
  for (const entry of ordinaryAuthorizationLocks) {
    it(`returns ordinary business fields after the fixed lock for pattern ${String(entry.inventoryId)}`, async () => {
      const f = fixture(
        entry.inventoryId === 7 ? ["fixed"] : ["identity_test"],
        entry.inventoryId === 7
          ? [{ locked_keys_json: '["fixed"]' }]
          : [{ [marker]: "identity_test", allowed: true }],
      );
      const values = Array.from(
        { length: entry.parameterCount },
        (_v, i) => `key_${String(i)}`,
      );
      const result = await tryExecuteOrdinaryAuthorizationStatement(
        f.tx,
        entry.hosts[0],
        sql(entry.statement, values),
      );
      expect(result).toEqual({
        rowCount: 1,
        rows:
          entry.inventoryId === 7 ? [{ "?column?": 1 }] : [{ allowed: true }],
      });
      expect(f.statements[0]?.text).toMatch(
        /^SELECT locked_keys_json FROM cloudmarkup_ordinary_private\.lock_[a-z_]+\(/u,
      );
      expect(f.statements[1]?.text).toBe(entry.reread);
      expect(f.statements[1]?.values).toEqual(values);
      expect(f.statements[1]?.text).not.toMatch(/\bFOR (?:SHARE|UPDATE)\b/u);
    });

    it(`rejects replaced authority or a cross-tenant row after the lock for pattern ${String(entry.inventoryId)}`, async () => {
      const f =
        entry.inventoryId === 7
          ? fixture(["fixed"], [{ locked_keys_json: "[]" }])
          : fixture(["identity_org_a"], [{ [marker]: "identity_org_b" }]);
      const values = Array.from(
        { length: entry.parameterCount },
        (_v, i) => `key_${String(i)}`,
      );
      await expect(
        tryExecuteOrdinaryAuthorizationStatement(
          f.tx,
          entry.hosts[0],
          sql(entry.statement, values),
        ),
      ).rejects.toThrow();
      expect(f.query).toHaveBeenCalledTimes(2);
    });

    it(`rejects an unauthorized host before accessing rows for pattern ${String(entry.inventoryId)}`, async () => {
      const f = fixture([], []);
      const values = Array.from(
        { length: entry.parameterCount },
        (_v, i) => `key_${String(i)}`,
      );
      await expect(
        tryExecuteOrdinaryAuthorizationStatement(
          f.tx,
          "billing",
          sql(entry.statement, values),
        ),
      ).rejects.toThrow();
      expect(f.query).not.toHaveBeenCalled();
    });
  }

  it("reuses membership authorization with the explicit environment mutation argument order", async () => {
    const entry = binding(21);
    const f = fixture(
      ["membership_test"],
      [
        {
          membership_id: "membership_test",
          role_key: "editor",
          [marker]: "membership_test",
        },
      ],
    );
    await tryExecuteOrdinaryAuthorizationStatement(
      f.tx,
      "api",
      sql(entry.statement, [
        "membership_test",
        "principal_test",
        "organization_test",
      ]),
    );
    expect(f.statements[0]?.text).toBe(
      "SELECT locked_keys_json FROM cloudmarkup_ordinary_private.lock_request_membership($1::text,$2::text)",
    );
    expect(f.statements[0]?.values).toEqual([
      "principal_test",
      "organization_test",
    ]);
    expect(f.statements[1]?.values).toEqual([
      "membership_test",
      "principal_test",
      "organization_test",
    ]);
    expect(f.statements[1]?.text).toContain("m.membership_id = $1");
  });

  it("fails closed when time expires or membership is revoked while the project lock waits", async () => {
    const entry = binding(2);
    const f = fixture(["authority_test"], []);
    await expect(
      tryExecuteOrdinaryAuthorizationStatement(
        f.tx,
        "api",
        sql(entry.statement, [
          "principal_test",
          "project_test",
          "expiry_test",
          "authentication_test",
        ]),
      ),
    ).rejects.toThrow();
    expect(f.statements[0]?.values).toEqual([
      "preview-resolve",
      "principal_test",
      "project_test",
      "expiry_test",
      "authentication_test",
      null,
    ]);
    expect(f.statements[1]?.text).toContain(
      "$3::timestamptz>clock_timestamp()",
    );
    expect(f.statements[1]?.text).toContain(
      "$4::timestamptz<=clock_timestamp()+INTERVAL '60 seconds'",
    );
    expect(f.statements[1]?.text).toContain("m.lifecycle_status='active'");
  });

  it("preserves target member reads for ended memberships instead of inventing active authority", async () => {
    const entry = binding(17);
    const f = fixture(
      ["target_test"],
      [
        {
          membership_id: "membership_test",
          lifecycle_status: "ended",
          [marker]: "target_test",
        },
      ],
    );
    const result = await tryExecuteOrdinaryAuthorizationStatement(
      f.tx,
      "api",
      sql(entry.statement, ["organization_test", "principal_test"]),
    );
    expect(result?.rows[0]?.["lifecycle_status"]).toBe("ended");
    expect(f.statements[0]?.values).toEqual([
      "invitation-target",
      "organization_test",
      "principal_test",
    ]);
    expect(f.statements[1]?.text).not.toContain("m.lifecycle_status='active'");
    expect(f.statements[1]?.text).toContain(
      "role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key)",
    );
  });

  it("preserves absent membership as one diagnostic anchor and leaves expired authentication false", async () => {
    const entry = binding(23);
    const row = {
      authenticated: false,
      membership_id: null,
      role_key: null,
      capabilities_json: null,
      [marker]: null,
    };
    const f = fixture([], [row]);
    await expect(
      tryExecuteOrdinaryAuthorizationStatement(
        f.tx,
        "api",
        sql(entry.statement, [
          "organization_test",
          "project_test",
          "principal_test",
          "expiry_test",
        ]),
      ),
    ).resolves.toEqual({
      rowCount: 1,
      rows: [
        {
          authenticated: false,
          membership_id: null,
          role_key: null,
          capabilities_json: null,
        },
      ],
    });
    expect(f.statements[1]?.text).toContain(
      "authorized_project AS MATERIALIZED",
    );
    expect(f.statements[1]?.text).toContain(
      "LEFT JOIN authorized_membership m ON TRUE",
    );
    expect(f.statements[1]?.text).toContain(
      "$4::timestamptz > clock_timestamp() AS authenticated",
    );
  });

  it("never sends optional stored-object selection or content to the project lock helper", async () => {
    const entry = binding(24);
    const f = fixture(
      ["authority_test"],
      [
        {
          membership_id: "membership_test",
          role_key: "viewer",
          object_json: '{"object_id":"object_test"}',
          [marker]: "authority_test",
        },
      ],
    );
    const values = [
      "organization_test",
      "project_test",
      "principal_test",
      "expiry_test",
      "object_test",
    ];
    const result = await tryExecuteOrdinaryAuthorizationStatement(
      f.tx,
      "api",
      sql(entry.statement, values),
    );
    expect(f.statements[0]?.values).toEqual([
      "active-project-lookup",
      ...values.slice(0, 4),
      null,
    ]);
    expect(f.statements[1]?.values).toEqual(values);
    expect(f.statements[1]?.text).toContain(
      "s.organization_id=$1 AND s.project_id=$2 AND s.object_id=$5",
    );
    expect(result?.rows[0]?.["object_json"]).toContain("object_test");
    await expect(
      tryExecuteOrdinaryAuthorizationStatement(
        f.tx,
        "export",
        sql(entry.statement, values),
      ),
    ).rejects.toThrow();
  });

  it("keeps the ACK workflow bridge content-free and scoped to all five immutable keys", async () => {
    const entry = binding(7);
    const f = fixture(["fixed"], [{ locked_keys_json: '["fixed"]' }]);
    const values = [
      "organization_test",
      "project_test",
      "principal_test",
      "workflow_test",
      "scope_test",
    ];
    await tryExecuteOrdinaryAuthorizationStatement(
      f.tx,
      "api",
      sql(entry.statement, values),
    );
    expect(f.statements[0]?.values).toEqual(values);
    expect(f.statements[0]?.text).toContain("lock_preview_ack_workflow");
    expect(f.statements[1]?.text).toBe(entry.reread);
    expect(f.statements[1]?.values).toEqual(values);
    expect(f.statements[1]?.text).not.toMatch(
      /FROM (?:public\.)?model_commercial_workflows/iu,
    );
    expect(f.statements[1]?.text).not.toMatch(
      /snapshot|lease_expires_at|provider_request/iu,
    );
  });

  it("keeps subscription/provider-mode and financial state as ordinary invoker fields", async () => {
    const entry = binding(8);
    const f = fixture(
      ["billing_test"],
      [
        {
          expensive_operations_enabled: false,
          current_subscription_state: "past_due",
          [marker]: "billing_test",
        },
      ],
    );
    const result = await tryExecuteOrdinaryAuthorizationStatement(
      f.tx,
      "api",
      sql(entry.statement, [
        "membership_test",
        "principal_test",
        "organization_test",
        "live",
      ]),
    );
    expect(f.statements[0]?.values).toEqual([
      "billing-session",
      "membership_test",
      "principal_test",
      "organization_test",
      "live",
    ]);
    expect(f.statements[1]?.text).toContain(
      "subscription.provider_environment = $4",
    );
    expect(f.statements[1]?.text).toContain(
      "'billing.manage' = ANY(role.capabilities)",
    );
    expect(result?.rows[0]).toEqual({
      expensive_operations_enabled: false,
      current_subscription_state: "past_due",
    });
  });

  it("initial export claim retains recorded creator/lineage and current state without a fabricated HTTP session", async () => {
    const entry = binding(41);
    const f = fixture(
      ["creator_test"],
      [
        {
          actor_id: "principal_recorded",
          root_state: "queued",
          root_canceled: true,
          [marker]: "creator_test",
        },
      ],
    );
    const result = await tryExecuteOrdinaryAuthorizationStatement(
      f.tx,
      "export",
      sql(entry.statement, ["organization_test", "project_test", "run_test"]),
    );
    expect(f.statements[0]?.values).toEqual([
      "organization_test",
      "project_test",
      "run_test",
    ]);
    expect(f.statements[1]?.text).toContain(
      "j.created_by_principal_id=x.created_by_principal_id",
    );
    expect(f.statements[1]?.text).toContain(
      "j.entitlement_decision_reference=x.entitlement_decision_reference",
    );
    expect(f.statements[1]?.text).toContain(
      "j.environment_id IS NOT DISTINCT FROM x.environment_id",
    );
    expect(result?.rows[0]?.["root_canceled"]).toBe(true);
  });

  it.each([null, {}, [null], [4], "authority_test"])(
    "rejects malformed lock identity data %j before an invoker read",
    async (keys) => {
      const entry = binding(34);
      const f = fixture(keys, []);
      await expect(
        tryExecuteOrdinaryAuthorizationStatement(
          f.tx,
          "api",
          sql(entry.statement, ["principal_test", "organization_test"]),
        ),
      ).rejects.toThrow();
      expect(f.query).toHaveBeenCalledTimes(1);
    },
  );

  it("leaves an unowned SQL variant to the central adapter without executing or interpreting it", async () => {
    const f = fixture([], []);
    await expect(
      tryExecuteOrdinaryAuthorizationStatement(
        f.tx,
        "api",
        sql(binding(34).statement + " /* different statement */", [
          "principal_test",
          "organization_test",
        ]),
      ),
    ).resolves.toBeUndefined();
    expect(f.query).not.toHaveBeenCalled();
  });

  it("refuses wrong arity and non-text authority values before issuing a lock", async () => {
    const entry = binding(34);
    const f = fixture([], []);
    for (const values of [
      ["principal_test"],
      ["principal_test", null],
      [4, "organization_test"],
      ["", "organization_test"],
    ]) {
      await expect(
        tryExecuteOrdinaryAuthorizationStatement(
          f.tx,
          "api",
          sql(entry.statement, values),
        ),
      ).rejects.toThrow();
    }
    expect(f.query).not.toHaveBeenCalled();
  });

  it("strips the internal receipt column from native labels and rejects duplicate labels", async () => {
    const entry = binding(35);
    const values = ["principal_test", "organization_test"];
    const tx: SqlExecutor = {
      query: <TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> => {
        const receipt = statement.text.includes("locked_keys_json");
        const rows: SqlRow[] = receipt
          ? [{ locked_keys_json: '["membership_test"]' }]
          : [{ role_key: "editor", [marker]: "membership_test" }];
        return Promise.resolve({
          rowCount: 1,
          rows: rows as TRow[],
          columnNames: receipt ? ["locked_keys_json"] : ["role_key", marker],
        });
      },
    };
    await expect(
      tryExecuteOrdinaryAuthorizationStatement(
        tx,
        "api",
        sql(entry.statement, values),
      ),
    ).resolves.toEqual({
      rowCount: 1,
      rows: [{ role_key: "editor" }],
      columnNames: ["role_key"],
    });
    const bad: SqlExecutor = {
      query: async <TRow extends SqlRow>(
        statement: SqlStatement,
      ): Promise<SqlResult<TRow>> => {
        const result = await tx.query<TRow>(statement);
        return statement.text.includes("locked_keys_json")
          ? result
          : { ...result, columnNames: ["role_key", marker, marker] };
      },
    };
    await expect(
      tryExecuteOrdinaryAuthorizationStatement(
        bad,
        "api",
        sql(entry.statement, values),
      ),
    ).rejects.toThrow();
  });
});

describe("source-only authorization SQL boundary", () => {
  const helpers = readFileSync(
    new URL(
      "../../../authorization-proposals/ordinary-authorization-locks.sql",
      import.meta.url,
    ),
    "utf8",
  ).replace(/\r\n/gu, "\n");
  const successor = readFileSync(
    new URL(
      "../../../migrations/0134_ordinary_invoker_successors.sql",
      import.meta.url,
    ),
    "utf8",
  ).replace(/\r\n/gu, "\n");
  const predecessor = readFileSync(
    new URL(
      "../../../migrations/0031_ai_intent_preview_authorities.sql",
      import.meta.url,
    ),
    "utf8",
  ).replace(/\r\n/gu, "\n");

  it("uses fixed purposes/relations with no caller SQL or immutable mutation grants", () => {
    expect(helpers.match(/LANGUAGE plpgsql SECURITY DEFINER/gu)).toHaveLength(
      6,
    );
    expect(
      helpers.match(/SET search_path=pg_catalog,pg_temp SET row_security=on/gu),
    ).toHaveLength(6);
    expect(helpers.match(/OWNER TO cloudmarkup_admin/gu)).toHaveLength(6);
    expect(helpers.match(/FROM PUBLIC/gu)).toHaveLength(6);
    expect(helpers).not.toMatch(/^\s*(?:GRANT|UPDATE|DELETE|INSERT)\b/gmu);
    expect(helpers).not.toMatch(/\bEXECUTE\s+(?:format\(|['"])/iu);
    expect(helpers).toContain("relrowsecurity OR relforcerowsecurity");
    expect(helpers).toContain(
      "has_parameter_privilege(session_user,'session_replication_role','SET, ALTER SYSTEM')",
    );
    expect(helpers).not.toContain("SELECT snapshot");
  });

  it("retains the protected predecessor authority query and every post-wait deferred commit check", () => {
    const queryStart = predecessor.indexOf(
      "  PERFORM 1 FROM projects p\n    JOIN organizations",
    );
    const queryEnd = predecessor.indexOf(";", queryStart) + 1;
    expect(successor).toContain(predecessor.slice(queryStart, queryEnd));
    const clocks = "  -- Locks can themselves wait beyond an expiry.";
    const originalTail = predecessor
      .slice(
        predecessor.indexOf(clocks),
        predecessor.indexOf(
          "CREATE CONSTRAINT TRIGGER ai_intent_preview_authorities_commit",
        ),
      )
      .trim();
    expect(successor).toContain(originalTail);
    expect(successor).toContain("LANGUAGE plpgsql SECURITY INVOKER");
    expect(successor).toContain(
      "current_user::text=session_user::text AND session_user::text='cloudmarkup_beta_api_runtime'",
    );
    expect(successor).toContain(
      "ordinary_locked_keys IS DISTINCT FROM jsonb_build_array(ordinary_observed_key)::text",
    );
    expect(successor).toContain(
      "encode(sha256(convert_to(l.session_id,'UTF8')),'hex')=receipt.session_sha256",
    );
    expect(successor).toContain(
      "obj.lifecycle_state='published' AND obj.content_sha256=d.content_sha256",
    );
    expect(successor).toContain("NEW.delivery_expires_at<=clock_timestamp()");
  });
});
