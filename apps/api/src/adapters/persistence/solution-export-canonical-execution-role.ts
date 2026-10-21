import {
  isOrganizationRole,
  permissionsForRole,
  type OrganizationRole,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import {
  exportRunEqual,
  exportRunText,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import type { SqlRow } from "./sql.js";

/** Shared, unchanged canonical capability check for export execution authority. */
export function solutionExportCanonicalExecutionRole(
  rows: readonly SqlRow[],
): OrganizationRole {
  const row = rows[0];
  const role = row?.["role_key"];
  if (
    rows.length !== 1 ||
    typeof role !== "string" ||
    !isOrganizationRole(role)
  )
    throw new ApplicationError(
      "not_found",
      "The export execution is unavailable.",
    );
  let capabilities: unknown;
  try {
    capabilities = JSON.parse(
      exportRunText(row?.["capabilities_json"]),
    ) as unknown;
  } catch {
    exportRunUnavailable();
  }
  if (
    !Array.isArray(capabilities) ||
    !capabilities.every((value: unknown) => typeof value === "string") ||
    !exportRunEqual(
      [...capabilities].sort(),
      [...permissionsForRole(role)].sort(),
    )
  )
    exportRunUnavailable();
  if (!permissionsForRole(role).includes("exports.run"))
    throw new ApplicationError(
      "access_denied",
      "The export is not available for this account.",
    );
  return role;
}
