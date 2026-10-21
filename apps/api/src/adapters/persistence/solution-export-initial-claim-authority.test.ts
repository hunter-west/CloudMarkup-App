import { describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "../../application/authorization.js";
import { solutionExportCanonicalExecutionRole } from "./solution-export-canonical-execution-role.js";
import {
  authorizeSolutionExportInitialClaim,
  parseSolutionExportInitialEnvelope,
} from "./solution-export-initial-claim-authority.js";
import type { SqlExecutor, SqlResult, SqlRow, SqlStatement } from "./sql.js";

const valid = {
  attemptNumber: 1,
  availableAt: "2026-09-07T00:00:00.000Z",
  contractVersion: 1,
  correlationId: "correlation.initial-claim",
  family: "solution-export-orchestration",
  inputDigest: `sha256:${"a".repeat(64)}`,
  jobId: "job.initial-claim",
  ownership: { organizationId: "org.initial", projectId: "project.initial" },
  recordVersion: 1,
};
function deniedExecutor() {
  const query = vi.fn<(statement: SqlStatement) => void>();
  const tx: SqlExecutor = {
    query<TRow extends SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      query(statement);
      return Promise.resolve({ rowCount: 0, rows: [] });
    },
  };
  return { tx, query };
}

describe("initial-only solution export claim authority", () => {
  it("clones the exact initial envelope without inventing actor/session/attempt authority", () => {
    const input = structuredClone(valid);
    const parsed = parseSolutionExportInitialEnvelope(input);
    expect(parsed).toEqual(valid);
    input.ownership.projectId = "project.changed";
    expect(parsed.ownership.projectId).toBe("project.initial");
    expect(parsed).not.toHaveProperty("principal");
    expect(parsed).not.toHaveProperty("sessionId");
    expect(parsed).not.toHaveProperty("workerId");
  });
  it.each([
    { ...valid, attemptNumber: 2 },
    { ...valid, recordVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, recordVersion: Number.MAX_SAFE_INTEGER },
    { ...valid, recordVersion: 0 },
    { ...valid, family: "iac-compilation" },
    { ...valid, ownership: { organizationId: "org.initial" } },
    { ...valid, inputDigest: "sha256:invalid" },
    { ...valid, principal: { principalId: "principal.forged" } },
    { ...valid, availableAt: "tomorrow" },
  ])(
    "rejects malformed, nonexport and retry envelopes before SQL: %j",
    async (input) => {
      const f = deniedExecutor();
      await expect(
        authorizeSolutionExportInitialClaim(f.tx, input),
      ).rejects.toThrow();
      expect(f.query).not.toHaveBeenCalled();
    },
  );
  it("takes the exact project SHARE lock before loading any root or identity", async () => {
    const f = deniedExecutor();
    await expect(
      authorizeSolutionExportInitialClaim(f.tx, valid),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls[0]?.[0]).toEqual({
      text: "SELECT project_id FROM projects WHERE organization_id=$1 AND project_id=$2 AND lifecycle_status='active' FOR SHARE",
      values: ["org.initial", "project.initial"],
    });
  });
  it.each(["owner", "administrator", "editor"] as const)(
    "preserves the existing canonical %s execution projection",
    (role) => {
      expect(
        solutionExportCanonicalExecutionRole([
          {
            role_key: role,
            capabilities_json: JSON.stringify(
              [...permissionsForRole(role)].reverse(),
            ),
          },
        ]),
      ).toBe(role);
    },
  );
  it("preserves viewer access denial and closed capability validation", () => {
    expect(() =>
      solutionExportCanonicalExecutionRole([
        {
          role_key: "viewer",
          capabilities_json: JSON.stringify(permissionsForRole("viewer")),
        },
      ]),
    ).toThrow(expect.objectContaining({ code: "access_denied" }));
    for (const capabilities of [
      null,
      {},
      ["exports.run"],
      [...permissionsForRole("owner"), "exports.run"],
    ]) {
      expect(() =>
        solutionExportCanonicalExecutionRole([
          {
            role_key: "owner",
            capabilities_json: JSON.stringify(capabilities),
          },
        ]),
      ).toThrow(expect.objectContaining({ code: "service_unavailable" }));
    }
    expect(() => solutionExportCanonicalExecutionRole([])).toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});
