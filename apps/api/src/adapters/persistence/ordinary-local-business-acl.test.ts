import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";

interface Rights {
  SELECT: string[];
  INSERT: string[];
  UPDATE: string[];
  DELETE: boolean;
}
interface ACL {
  state: string;
  applied: boolean;
  nativeQualified: boolean;
  productionActivation: boolean;
  sourceReview: {
    state: string;
    capabilityProfile: string;
    optionalPurposesRequireSeparateAdmission: string[];
  };
  history: {
    count: number;
    statements: number;
    tip: string;
    manifestSha256: string;
  };
  sources: Record<string, string>;
  baseline: {
    artifact: { sha256: string };
    schemas: string[];
    schemaPrivileges: string[];
    ledgerReadColumns: string[];
  };
  consumers: Record<
    string,
    { login: string; tables: Record<string, Rights>; functions: string[] }
  >;
  helperMatrix: { signature: string; hosts: string[]; PUBLIC: boolean }[];
  protectedColumns: {
    host: string;
    login: string;
    table: string;
    column: string;
    enabled: boolean;
  }[];
}
interface SuccessorReview {
  state: "REVIEW_ONLY_UNARMED";
  applied: false;
  nativeQualified: false;
  productionActivation: false;
  predecessorSha256: string;
  history: ACL["history"];
  inputs: { path: string; sha256: string }[];
  changes: Record<string, { before: string; after: string; reason: string }>;
  additions: Record<string, string>;
}
const root = new URL("../../../../../", import.meta.url);
const proposals = new URL("apps/api/authorization-proposals/", root);
const read = (file: string) => readFile(new URL(file, proposals), "utf8");
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const matrix = async () =>
  JSON.parse(await read("ordinary-local-business-acl.json")) as ACL;
const successor = async () =>
  JSON.parse(
    await read("ordinary-local-business-acl-successor.json"),
  ) as SuccessorReview;

describe("unarmed ordinary local business ACL contract", () => {
  it("pins the complete history and refuses a claim of installed qualification", async () => {
    const acl = await matrix();
    expect(acl.state).toBe("REVIEW_ONLY_UNARMED");
    expect(acl.applied).toBe(false);
    expect(acl.nativeQualified).toBe(false);
    expect(acl.productionActivation).toBe(false);
    expect(acl.sourceReview.state).toBe(
      "MAIN_DERIVED_REQUALIFICATION_REQUIRED",
    );
    expect(acl.sourceReview.capabilityProfile).toBe("local-editor-core-v1");
    expect(acl.sourceReview.optionalPurposesRequireSeparateAdmission).toEqual([
      "proposal",
      "export",
      "billing",
      "private-model",
    ]);
    expect(acl.baseline.artifact.sha256).toBe(
      "cb23e25b2696079c2583fcaf3d7005ef8ab1add56c272be515b8d26f9ec9f79e",
    );
    expect(acl.baseline.schemas).toEqual([
      "public",
      "cloudmarkup_ordinary_private",
    ]);
    expect(acl.baseline.schemaPrivileges).toEqual(["USAGE"]);
    expect(acl.baseline.ledgerReadColumns).toEqual([
      "version",
      "checksum_sha256",
    ]);
    const migrations = await loadMigrations(
      fileURLToPath(new URL("apps/api/migrations/", root)),
    );
    const historical = migrations.filter(
      ({ version }) => version <= acl.history.tip,
    );
    expect(historical).toHaveLength(acl.history.count);
    expect(historical.at(-1)?.version).toBe(acl.history.tip);
    expect(historical.reduce((n, m) => n + m.statements.length, 0)).toBe(
      acl.history.statements,
    );
    expect(
      digest(
        JSON.stringify(
          {
            storageContractVersion: 1,
            migrations: historical.map(({ version, file, checksumSha256 }) => ({
              version,
              file,
              checksumSha256,
            })),
          },
          null,
          2,
        ) + "\n",
      ),
    ).toBe(acl.history.manifestSha256);
    const next = await successor();
    expect(next.state).toBe("REVIEW_ONLY_UNARMED");
    expect(next.applied).toBe(false);
    expect(next.nativeQualified).toBe(false);
    expect(next.productionActivation).toBe(false);
    expect(digest(await read("ordinary-local-business-acl.json"))).toBe(
      next.predecessorSha256,
    );
    expect(migrations).toHaveLength(next.history.count);
    expect(migrations.at(-1)?.version).toBe(next.history.tip);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(
      next.history.statements,
    );
    expect(
      digest(
        await readFile(new URL("apps/api/migrations/manifest.json", root)),
      ),
    ).toBe(next.history.manifestSha256);
    for (const input of next.inputs) {
      expect(input.path).toMatch(
        /^apps\/api\/(migrations|self-host-migrations|authorization-proposals)\/[a-zA-Z0-9_.-]+$/u,
      );
      expect(
        digest(await readFile(new URL(input.path, root))),
        input.path,
      ).toBe(input.sha256);
    }
  });

  it("pins current source inputs without claiming native or optional-runtime admission", async () => {
    const acl = await matrix();
    const next = await successor();
    expect(Object.keys(next.changes).sort()).toEqual([
      "apps/api/src/adapters/persistence/beta-ai-credit-meter.ts",
      "apps/api/src/adapters/persistence/staff-accounts.ts",
      "apps/api/src/beta-infrastructure-worker.ts",
      "apps/api/src/production-cleanup-admission.test.ts",
      "apps/api/src/production-cleanup-schema.ts",
      "apps/api/src/production-commercial-reads.ts",
      "apps/api/src/production-composition.ts",
    ]);
    expect(Object.keys(acl.sources).length).toBeGreaterThan(150);
    for (const [path, hash] of Object.entries(acl.sources)) {
      expect(path).toMatch(/^apps\/api\/(src|migrations)\/[a-zA-Z0-9_./-]+$/);
      expect(path).not.toContain("..");
      const change = next.changes[path];
      if (change) {
        expect(change.before, path).toBe(hash);
        expect(change.reason.length).toBeGreaterThan(20);
      }
      expect(digest(await readFile(new URL(path, root))), path).toBe(
        change?.after ?? hash,
      );
    }
    expect(Object.keys(next.additions).length).toBeGreaterThan(5);
    for (const [path, hash] of Object.entries(next.additions)) {
      expect(path).toMatch(/^apps\/api\/(src|migrations)\/[a-zA-Z0-9_./-]+$/u);
      expect(path).not.toContain("..");
      expect(acl.sources[path]).toBeUndefined();
      expect(digest(await readFile(new URL(path, root))), path).toBe(hash);
    }
  });

  it("specifies every registered fixed helper only for its source host allowlist", async () => {
    const acl = await matrix();
    expect(acl.helperMatrix).toHaveLength(25);
    expect(acl.helperMatrix.reduce((n, h) => n + h.hosts.length, 0)).toBe(50);
    for (const h of acl.helperMatrix) {
      expect(h.PUBLIC).toBe(false);
      for (const [host, c] of Object.entries(acl.consumers))
        expect(c.functions.includes(h.signature)).toBe(h.hosts.includes(host));
    }
    expect(acl.consumers["api"]?.functions).toContain(
      "cloudmarkup_ordinary_private.verify_preview_ack_canonical(text,text,text,text,text,jsonb,text,text,jsonb)",
    );
    for (const host of ["proposal", "export", "cleanup", "billing"])
      expect(
        acl.consumers[host]?.functions.some((f) =>
          f.includes("verify_preview_ack_canonical"),
        ),
      ).toBe(false);
  });

  it("keeps private producer data and immutable locks outside ordinary business grants", async () => {
    const acl = await matrix();
    for (const c of Object.values(acl.consumers))
      for (const [table, rights] of Object.entries(c.tables)) {
        expect(table).not.toMatch(/^model_|private|native|gitlab/);
        expect(new Set(rights.SELECT).size).toBe(rights.SELECT.length);
        if (table === "credit_grants")
          expect(rights.UPDATE).not.toContain("credit_grant_id");
        if (table === "usage_ledger_entries")
          expect(rights.UPDATE).not.toContain("ledger_entry_id");
      }
    expect(acl.consumers["api"]?.tables["ai_intent_previews"]?.UPDATE).toEqual([
      "acknowledged_at",
      "delivery_state",
    ]);
    expect(
      acl.consumers["api"]?.tables["organization_subscription_projections"]
        ?.UPDATE,
    ).toEqual([]);
    expect(
      acl.consumers["billing"]?.tables["usage_ledger_entry_allocations"]
        ?.INSERT,
    ).toEqual([]);
    for (const c of Object.values(acl.consumers))
      expect(c.tables["usage_ledger_entries"]?.UPDATE ?? []).toEqual([]);
  });

  it("emits only exact column/function grants on the five fixed identities", async () => {
    const acl = await matrix();
    const grants = (await read("ordinary-local-business-acl.sql"))
      .split("\n")
      .filter((line) => line.startsWith("GRANT "));
    expect(grants).toHaveLength(461);
    const expected: string[] = [];
    for (const c of Object.values(acl.consumers)) {
      for (const [table, rights] of Object.entries(c.tables)) {
        for (const op of ["SELECT", "INSERT", "UPDATE"] as const)
          if (rights[op].length)
            expected.push(
              `GRANT ${op} (${rights[op].join(",")}) ON TABLE public.${table} TO ${c.login};`,
            );
        if (rights.DELETE)
          expected.push(`GRANT DELETE ON TABLE public.${table} TO ${c.login};`);
      }
      for (const f of c.functions)
        expected.push(`GRANT EXECUTE ON FUNCTION ${f} TO ${c.login};`);
    }
    expect(grants.sort()).toEqual(expected.sort());
    expect(await read("ordinary-local-business-acl.sql")).not.toMatch(
      /\bWITH GRANT OPTION\b|\bGRANT ALL\b|\bSET ROLE\b|\bCREATE ROLE\b/i,
    );
  });

  it("isolates exactly fourteen lock permissions behind installed invariant guards", async () => {
    const acl = await matrix();
    expect(acl.protectedColumns).toHaveLength(14);
    expect(new Set(acl.protectedColumns.map((c) => c.table)).size).toBe(11);
    const sql = await read("ordinary-local-protected-columns.sql");
    const grants = sql.split("\n").filter((line) => line.startsWith("GRANT "));
    expect(grants.sort()).toEqual(
      acl.protectedColumns
        .map(
          (c) =>
            `GRANT UPDATE (${c.column}) ON TABLE public.${c.table} TO ${c.login};`,
        )
        .sort(),
    );
    for (const c of acl.protectedColumns) {
      expect(c.enabled).toBe(false);
      expect(
        acl.consumers[c.host]?.tables[c.table]?.UPDATE ?? [],
      ).not.toContain(c.column);
    }
    expect(sql).toContain("tr.tgenabled IN ('O','A')");
    expect(sql).toContain("(tr.tgtype::integer & 19)=19");
    expect(sql).toContain("tr.tgattr::text='' AND tr.tgqual IS NULL");
    expect(sql).toContain("p.prosrc");
    expect(sql).toContain(
      "Exact task-owned synthetic PG16 setup actor required",
    );
  });

  it("has bounded parsable proposals and distinct installed ACL readbacks", async () => {
    expect(
      splitPostgresStatements(await read("ordinary-local-business-acl.sql")),
    ).toHaveLength(462);
    expect(
      splitPostgresStatements(
        await read("ordinary-local-protected-columns.sql"),
      ),
    ).toHaveLength(16);
    for (const file of [
      "ordinary-local-business-catalog.sql",
      "ordinary-local-qualified-catalog.sql",
      "ordinary-local-helper-catalog.sql",
    ]) {
      const sql = await read(file);
      expect(splitPostgresStatements(sql)).toHaveLength(1);
      expect(sql).not.toMatch(
        /^\s*(GRANT|REVOKE|ALTER|INSERT|UPDATE|DELETE)\b/m,
      );
      expect(sql).toContain("SELECT failure");
      expect(sql).toContain("schema-acl:");
      expect(sql).toContain("has_schema_privilege");
      expect(sql).toContain("USAGE WITH GRANT OPTION,CREATE WITH GRANT OPTION");
    }
    const before = await read("ordinary-local-business-catalog.sql");
    const after = await read("ordinary-local-qualified-catalog.sql");
    expect(before).toContain("NULL::text,NULL::text,NULL::text");
    expect(after).toContain("'architecture_revisions','revision_id'");
  });
});
