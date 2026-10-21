import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadMigrations } from "./migrations.js";

describe("additive CloudFormation export migration", () => {
  it("extends CloudFormation progress and media without widening access or changing stored rows", async () => {
    const source = await readFile(
      new URL(
        "../../../migrations/0054_solution_export_cloudformation_compatibility.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("cloudmarkup.export.cloudformation-nodejs24-v1");
    expect(source).toContain(
      "application/vnd.amazon.cloudformation.template+json",
    );
    expect(source).not.toMatch(
      /DROP TABLE|DISABLE TRIGGER|CREATE POLICY|GRANT |UPDATE |DELETE FROM|INSERT INTO/iu,
    );
  });
  it("replaces the actual 0030 constraint names and retains every predecessor stage and media value", async () => {
    const directory = new URL("../../../migrations/", import.meta.url);
    const previous = await readFile(
      new URL("0030_solution_export_terminal_compatibility.sql", directory),
      "utf8",
    );
    const current = await readFile(
      new URL(
        "0054_solution_export_cloudformation_compatibility.sql",
        directory,
      ),
      "utf8",
    );
    for (const name of [
      "solution_export_runs_progress_stage",
      "solution_export_artifact_files_media_type",
    ]) {
      expect(previous).toContain("ADD CONSTRAINT " + name + "_v2_check");
      expect(current).toContain("DROP CONSTRAINT " + name + "_v2_check");
      expect(current).toContain("ADD CONSTRAINT " + name + "_v3_check");
      expect(current).not.toContain("DROP CONSTRAINT " + name + "_check");
    }
    const quoted = (value: string) =>
      [...value.matchAll(/'([^']+)'/gu)].map((match) => match[0]);
    for (const marker of [
      "CHECK (progress_stage IS NULL OR progress_stage IN (",
      "CHECK (media_type IN (",
    ]) {
      const begin = previous.indexOf(marker);
      const close = previous.indexOf("));", begin);
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(close).toBeGreaterThan(begin);
      for (const value of quoted(previous.slice(begin, close)))
        expect(current).toContain(value);
    }
    expect(current).not.toContain(
      "DROP CONSTRAINT solution_export_runs_progress_count_v2_check",
    );
  });
  it("retains the original Terraform-only migration checksum and body", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations/", import.meta.url)),
    );
    const historical = migrations.find((entry) => entry.version === "0012");
    expect(historical?.statements.join("\n")).toContain(
      "target_profile_id = 'cloudmarkup.export.terraform-nodejs24-v1'",
    );
    expect(historical?.statements.join("\n")).not.toContain(
      "cloudmarkup.export.cloudformation-nodejs24-v1",
    );
  });
});
