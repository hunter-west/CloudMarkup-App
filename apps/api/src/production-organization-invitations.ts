import { PostgresOrganizationInvitationRepository } from "./adapters/persistence/organization-invitations.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { OrganizationInvitationApplication } from "./application/organization-invitations.js";

/** Real database authority only. Missing migration/current sharing plan fails closed. */
export function createProductionOrganizationInvitations(
  database: SqlDatabase,
  now?: () => Date,
): OrganizationInvitationApplication {
  return new OrganizationInvitationApplication({
    repository: new PostgresOrganizationInvitationRepository(database),
    ...(now === undefined ? {} : { now }),
  });
}
