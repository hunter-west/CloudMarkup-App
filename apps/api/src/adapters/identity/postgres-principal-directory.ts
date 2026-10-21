import type {
  ExternalPrincipalReference,
  PrincipalDirectory,
} from "../../application/identity.js";
import type { SqlDatabase, SqlRow } from "../persistence/sql.js";
import { sql } from "../persistence/sql.js";

type PrincipalRow = SqlRow & { readonly principal_id: unknown };

export class PostgresPrincipalDirectory implements PrincipalDirectory {
  readonly #database: SqlDatabase;

  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async resolveActivePrincipal(
    reference: ExternalPrincipalReference,
  ): Promise<{ readonly principalId: string } | null> {
    const result = await this.#database.query<PrincipalRow>(
      sql(
        `SELECT p.principal_id
           FROM principal_identity_references AS identity_reference
           INNER JOIN principals AS p
             ON p.principal_id = identity_reference.principal_id
          WHERE identity_reference.identity_provider = $1
            AND identity_reference.issuer = $2
            AND identity_reference.subject_reference = $3
            AND p.lifecycle_status = 'active'
          LIMIT 1`,
        [reference.provider, reference.issuer, reference.subject],
      ),
    );

    const principalId = result.rows[0]?.principal_id;
    return typeof principalId === "string" ? { principalId } : null;
  }
}
