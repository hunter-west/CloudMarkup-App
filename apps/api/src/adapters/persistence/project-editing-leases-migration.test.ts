import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations, splitPostgresStatements } from "./migrations.js";

describe("project editing lease migration", () => {
  it("adds only checksum-bound0025 after the unchanged metadata issuer", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    const source = await readFile(
      new URL(
        "../../../migrations/0025_project_editing_leases.sql",
        import.meta.url,
      ),
    );
    expect(migrations.find((entry) => entry.version === "0025")).toMatchObject({
      version: "0025",
      file: "0025_project_editing_leases.sql",
      checksumSha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(
      migrations.find((entry) => entry.version === "0024")?.checksumSha256,
    ).toBe("f679f21b5e03fda2b26cedd44731f2880655b7a5e36b9618de7ce6e9ba22e466");
    expect(splitPostgresStatements(source.toString("utf8"))).toHaveLength(4);
  });
  it("bounds metadata and rechecks the canonical active holder using the database wall clock at COMMIT", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0025_project_editing_leases.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("PRIMARY KEY (organization_id, project_id)");
    expect(source).toContain("expires_at <= authentication_expires_at");
    expect(source).toContain(
      "expires_at <= updated_at + INTERVAL '60 seconds'",
    );
    expect(source).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(source).toContain(
      "r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)",
    );
    expect(source).toContain("holder_expires_at <= clock_timestamp()");
    expect(source).toContain(
      "required_lease_id := OLD.pending_editing_lease_id",
    );
    expect(source).toContain("PERFORM 1 FROM projects p");
    expect(source).toContain("FOR SHARE OF p;");
    expect(source).toContain("IF NOT FOUND OR EXISTS (");
    expect(source).toContain(
      "project editing lease proof is required after first acquisition",
    );
    expect(source).not.toMatch(
      /\b(?:DELETE|TRUNCATE|DROP|UPDATE\s+(?:principals|memberships|organization_roles))\b/u,
    );
    expect(source).not.toMatch(
      /\b(?:token|prompt|architecture_document)\s+(?:TEXT|JSONB)\b/u,
    );
  });
});
