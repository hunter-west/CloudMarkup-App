import { createHash, randomUUID } from "node:crypto";
import {
  accountWorkspaceV1Schema,
  createAccountOrganizationV1Schema,
  type AccountWorkspaceV1,
} from "@cloudmarkup/api-contract";
import type { AccountWorkspacesApplication } from "../../application/account-workspaces.js";
import { ApplicationError } from "../../application/errors.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import type { PrincipalContext } from "../../application/ports.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function denied(): never {
  throw new ApplicationError("not_found", "The workspace is unavailable.");
}
function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "The workspace request is invalid.",
  );
}
function map(row: SqlRow | undefined, principalId: string): AccountWorkspaceV1 {
  if (row === undefined) return denied();
  return accountWorkspaceV1Schema.parse({
    contractVersion: 1,
    principalId,
    id: row["organization_id"],
    displayName: row["display_name"],
    kind: row["workspace_kind"],
    role: row["role_key"],
  });
}
const projection =
  "o.organization_id,o.display_name,o.workspace_kind,m.role_key";
const authorizedJoin = `FROM organizations o JOIN memberships m ON m.organization_id=o.organization_id AND m.lifecycle_status='active'
 JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
 WHERE m.principal_id=$1 AND o.lifecycle_status='active'
 AND (o.workspace_kind='organization' OR o.personal_owner_principal_id=$1)`;

/** All writes use current actor authority and one transaction; caller-selected IDs never grant scope. */
export class PostgresAccountWorkspaces implements AccountWorkspacesApplication {
  readonly database: SqlDatabase;
  readonly now: () => Date;
  constructor(database: SqlDatabase, now: () => Date = () => new Date()) {
    this.database = database;
    this.now = now;
  }
  async #actor(
    tx: SqlExecutor,
    principal: PrincipalContext,
    write: boolean,
  ): Promise<void> {
    const time = this.now().getTime();
    if (
      !Number.isFinite(Date.parse(principal.expiresAt)) ||
      Date.parse(principal.expiresAt) <= time
    )
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    if (write) requireRecentAuthentication(principal, new Date(time));
    const result = await tx.query(
      sql(
        "SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active' FOR " +
          (write ? "UPDATE" : "SHARE"),
        [principal.principalId],
      ),
    );
    const afterLock = this.now();
    if (Date.parse(principal.expiresAt) <= afterLock.getTime())
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    if (write) requireRecentAuthentication(principal, afterLock);
    if (result.rows.length !== 1)
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
  }
  async #read(
    tx: SqlExecutor,
    principalId: string,
    id: string,
  ): Promise<AccountWorkspaceV1> {
    const result = await tx.query(
      sql(
        "SELECT " +
          projection +
          " " +
          authorizedJoin +
          " AND o.organization_id=$2",
        [principalId, id],
      ),
    );
    return map(result.rows[0], principalId);
  }
  async #count(tx: SqlExecutor, principalId: string): Promise<number> {
    const result = await tx.query(
      sql(
        "SELECT count(*) AS count FROM memberships m JOIN organizations o ON o.organization_id=m.organization_id WHERE m.principal_id=$1 AND m.lifecycle_status='active' AND o.lifecycle_status='active'",
        [principalId],
      ),
    );
    const count = Number(result.rows[0]?.["count"]);
    if (!Number.isSafeInteger(count) || count < 0)
      throw Error("Invalid workspace count");
    return count;
  }
  async #insert(
    tx: SqlExecutor,
    principal: PrincipalContext,
    id: string,
    name: string,
    kind: AccountWorkspaceV1["kind"],
  ): Promise<AccountWorkspaceV1> {
    const suffix = id.slice(id.lastIndexOf("_") + 1);
    await tx.query(
      sql(
        `INSERT INTO organizations(organization_id,display_name,slug,workspace_kind,personal_owner_principal_id)
      VALUES($1,$2,$3,$4,$5)`,
        [
          id,
          name,
          "workspace-" + suffix,
          kind,
          kind === "personal" ? principal.principalId : null,
        ],
      ),
    );
    await tx.query(
      sql(
        `INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities)
      SELECT $1,role_key,'authorization-v2',role_key='owner',cloudmarkup_authorization_v2_permissions(role_key)
      FROM (VALUES ('owner'),('administrator'),('editor'),('viewer')) AS roles(role_key)`,
        [id],
      ),
    );
    await tx.query(
      sql(
        "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
        [
          "membership_" + randomUUID().replaceAll("-", ""),
          id,
          principal.principalId,
        ],
      ),
    );
    await tx.query(
      sql(
        `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
      VALUES($1,$2,$3,'account.workspace.create','organization',$2,'succeeded','Created a workspace with its verified owner.',$4)`,
        [
          "audit_" + randomUUID(),
          id,
          principal.principalId,
          principal.correlationId,
        ],
      ),
    );
    return this.#read(tx, principal.principalId, id);
  }
  async #personal(
    tx: SqlExecutor,
    principal: PrincipalContext,
  ): Promise<AccountWorkspaceV1> {
    const result = await tx.query(
      sql(
        "SELECT organization_id FROM organizations WHERE personal_owner_principal_id=$1",
        [principal.principalId],
      ),
    );
    if (result.rows[0])
      return this.#read(
        tx,
        principal.principalId,
        String(result.rows[0]["organization_id"]),
      );
    if ((await this.#count(tx, principal.principalId)) >= 100)
      throw new ApplicationError(
        "conflict",
        "Leave an organization before creating a personal workspace; the account supports 100 workspaces.",
      );
    return this.#insert(
      tx,
      principal,
      "org_personal_" + digest(principal.principalId).slice(0, 32),
      "Personal",
      "personal",
    );
  }
  get: AccountWorkspacesApplication["get"] = (principal, organizationId) => {
    principal = Object.freeze({ ...principal });
    return this.database.transaction(async (tx) => {
      await this.#actor(tx, principal, false);
      return this.#read(tx, principal.principalId, organizationId);
    });
  };
  createPersonal: AccountWorkspacesApplication["createPersonal"] = (
    principal,
  ) => {
    principal = Object.freeze({ ...principal });
    return this.database.transaction(async (tx) => {
      await this.#actor(tx, principal, true);
      return this.#personal(tx, principal);
    });
  };
  createOrganization: AccountWorkspacesApplication["createOrganization"] = (
    principal,
    input,
    idempotencyKey,
  ) => {
    principal = Object.freeze({ ...principal });
    const parsed = createAccountOrganizationV1Schema.safeParse(input);
    return this.database.transaction(async (tx) => {
      if (
        !parsed.success ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(idempotencyKey)
      )
        return invalid();
      await this.#actor(tx, principal, true);
      const key = digest(idempotencyKey),
        request = digest(JSON.stringify(parsed.data));
      const previous = await tx.query(
        sql(
          "SELECT organization_id,request_sha256 FROM workspace_creation_receipts WHERE principal_id=$1 AND request_key_sha256=$2",
          [principal.principalId, key],
        ),
      );
      const receipt = previous.rows[0];
      if (receipt) {
        if (receipt["request_sha256"] !== request)
          throw new ApplicationError(
            "conflict",
            "This creation request was already used with another name.",
          );
        return this.#read(
          tx,
          principal.principalId,
          String(receipt["organization_id"]),
        );
      }
      await this.#personal(tx, principal);
      if ((await this.#count(tx, principal.principalId)) >= 100)
        throw new ApplicationError(
          "conflict",
          "Leave an organization before creating another; the account supports 100 workspaces.",
        );
      const value = await this.#insert(
        tx,
        principal,
        "org_" + randomUUID().replaceAll("-", ""),
        parsed.data.displayName,
        "organization",
      );
      await tx.query(
        sql(
          "INSERT INTO workspace_creation_receipts(principal_id,request_key_sha256,request_sha256,organization_id) VALUES($1,$2,$3,$4)",
          [principal.principalId, key, request, value.id],
        ),
      );
      return value;
    });
  };
  list: AccountWorkspacesApplication["list"] = (principal, options) => {
    principal = Object.freeze({ ...principal });
    options = { ...options };
    return this.database.transaction(async (tx) => {
      await this.#actor(tx, principal, false);
      const cursor = options.cursor;
      const offset =
        cursor === undefined
          ? 0
          : /^workspace-offset-[0-9]+$/u.test(cursor)
            ? Number(cursor.slice(17))
            : -1;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 100
      )
        return invalid();
      const result = await tx.query(
        sql(
          "SELECT " +
            projection +
            " " +
            authorizedJoin +
            " ORDER BY (o.workspace_kind='personal') DESC,o.organization_id LIMIT $2 OFFSET $3",
          [principal.principalId, options.limit + 1, offset],
        ),
      );
      const more = result.rows.length > options.limit;
      return {
        items: result.rows
          .slice(0, options.limit)
          .map((row) => map(row, principal.principalId)),
        ...(more
          ? { nextCursor: "workspace-offset-" + String(offset + options.limit) }
          : {}),
      };
    });
  };
}
