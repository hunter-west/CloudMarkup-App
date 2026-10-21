import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_ROLES,
  permissionsForRole,
  roleAllows,
  type OrganizationRole,
} from "../../application/authorization.js";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";

const migrationUrl = new URL(
  "../../../migrations/0023_editor_integration_read_policy.sql",
  import.meta.url,
);
const priorPolicyUrl = new URL(
  "../../../migrations/0007_commercial_domain_foundation.sql",
  import.meta.url,
);
function rolePermissions(source: string, role: OrganizationRole): string[] {
  const expression = new RegExp(
    "WHEN '" + role + "' THEN ARRAY\\[([\\s\\S]+?)\\]::TEXT\\[\\]",
    "u",
  );
  const match = expression.exec(source)?.[1];
  if (match === undefined) throw new Error("Missing canonical role SQL.");
  return [...match.matchAll(/'([^']+)'/gu)].map((entry) => entry[1] ?? "");
}
function canonicalCheck(source: string): string {
  const matched =
    /ADD CONSTRAINT organization_roles_authorization_v2_canonical_check\s+(CHECK \([\s\S]+?\n {2}\))/u.exec(
      source,
    )?.[1];
  if (matched === undefined) throw new Error("Missing canonical role check.");
  return matched.replaceAll(/\s+/gu, " ");
}

describe("editor integration-read SQL mirror migration", () => {
  it("appends checksum-bound 0023 without modifying the prior policy or corrected 0022", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const policy = migrations.find((migration) => migration.version === "0023");
    expect(policy).toMatchObject({
      file: "0023_editor_integration_read_policy.sql",
      version: "0023",
    });
    expect(
      migrations.findIndex((migration) => migration.version === "0023"),
    ).toBe(
      migrations.findIndex((migration) => migration.version === "0022") + 1,
    );
    const [source, priorPolicy, priorWorkflow] = await Promise.all([
      readFile(migrationUrl),
      readFile(priorPolicyUrl),
      readFile(
        new URL(
          "../../../migrations/0022_model_commercial_workflows.sql",
          import.meta.url,
        ),
      ),
    ]);
    expect(policy?.checksumSha256).toBe(
      createHash("sha256").update(source).digest("hex"),
    );
    expect(createHash("sha256").update(priorPolicy).digest("hex")).toBe(
      "2bc14e1f57d31ce774fbdbbec791f1d001e4809f32bd55422740c6f1a346e4b9",
    );
    expect(createHash("sha256").update(priorWorkflow).digest("hex")).toBe(
      "327cf097c260d78cf872387d50cc63dcfd42e9a75a42c1c327079f0c94d2fab6",
    );
  });

  it("matches every existing runtime role set while changing only the old editor mirror", async () => {
    const [source, prior] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(priorPolicyUrl, "utf8"),
    ]);
    for (const role of ORGANIZATION_ROLES) {
      const actual = rolePermissions(source, role);
      expect([...actual].sort()).toEqual([...permissionsForRole(role)].sort());
      expect(new Set(actual).size).toBe(actual.length);
      if (role !== "editor")
        expect(actual).toEqual(rolePermissions(prior, role));
      else
        expect(
          actual.filter((permission) => permission !== "integrations.read"),
        ).toEqual(rolePermissions(prior, role));
    }
    expect(roleAllows("editor", "integrations.read")).toBe(true);
    for (const permission of [
      "integrations.manage",
      "billing.manage",
      "memberships.read",
      "memberships.manage",
      "memberships.assign-owner",
      "projects.delete",
      "organizations.delete",
      "audit.read",
    ] as const)
      expect(roleAllows("editor", permission)).toBe(false);
    expect(source).toContain("LANGUAGE SQL\nIMMUTABLE\nSTRICT");
    expect(source).toContain("    ELSE NULL\n  END");
  });

  it("locks and preflights before replacing the function and revalidates the identical canonical check", async () => {
    const [source, prior] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(priorPolicyUrl, "utf8"),
    ]);
    const statements = splitPostgresStatements(source);
    expect(statements).toHaveLength(7);
    expect(statements[0]).toContain(
      "LOCK TABLE organization_roles IN ACCESS EXCLUSIVE MODE",
    );
    expect(statements[1]).toContain("AND contype = 'c' AND convalidated");
    expect(statements[1]).toContain("IS DISTINCT FROM expected_permissions");
    expect(statements[1]).toContain(
      "AND capabilities = expected_permissions) IS NOT TRUE",
    );
    expect(statements[1]).toContain("USING ERRCODE = '55000'");
    expect(statements[2]).toContain(
      "DROP CONSTRAINT organization_roles_authorization_v2_canonical_check",
    );
    expect(statements[3]).toContain(
      "CREATE OR REPLACE FUNCTION cloudmarkup_authorization_v2_permissions(role_key TEXT)",
    );
    expect(statements[4]).toBe(
      "UPDATE organization_roles\n" +
        "SET capabilities = cloudmarkup_authorization_v2_permissions(role_key),\n" +
        "    updated_at = CURRENT_TIMESTAMP\n" +
        "WHERE role_key = 'editor'\n" +
        "  AND policy_version = 'authorization-v2'\n" +
        "  AND is_owner = FALSE",
    );
    expect(statements[5]).toContain(") NOT VALID");
    expect(statements[6]).toContain(
      "VALIDATE CONSTRAINT organization_roles_authorization_v2_canonical_check",
    );
    expect(canonicalCheck(source)).toBe(canonicalCheck(prior));
    expect(source.match(/\bUPDATE\b/gu)).toHaveLength(1);
    expect(source).not.toMatch(
      /\b(?:INSERT|DELETE|TRUNCATE|COMMIT|ROLLBACK)\b/u,
    );
    expect(source).not.toMatch(
      /\b(?:UPDATE|INTO|FROM|TABLE)\s+(?:memberships|principals)\b/u,
    );
  });
});
