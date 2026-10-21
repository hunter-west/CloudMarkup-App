import { createHash, randomUUID } from "node:crypto";
import {
  organizationMemberV1Schema,
  organizationMemberStateV1Schema,
  organizationMembershipReceiptV1Schema,
  changeOrganizationMembershipV1Schema,
  consequentialMutationHeadersV1Schema,
  organizationIdSchema,
  membershipIdSchema,
  type OrganizationMemberV1,
  type OrganizationMembershipReceiptV1,
} from "@cloudmarkup/api-contract";
import type { OrganizationMembersApplication } from "../../application/organization-members.js";
import type { PrincipalContext } from "../../application/ports.js";
import { ApplicationError } from "../../application/errors.js";
import { requireRecentAuthentication } from "../../application/identity.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";
const missing = (): never => {
  throw new ApplicationError("not_found", "The membership is unavailable.");
};
const denied = (): never => {
  throw new ApplicationError(
    "access_denied",
    "This membership action is not permitted.",
  );
};
const conflict = (message: string): never => {
  throw new ApplicationError("conflict", message);
};
const invalid = (): never => {
  throw new ApplicationError(
    "invalid_request",
    "The membership request is invalid.",
  );
};
const hash = (values: readonly unknown[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");
const projection = `m.*,p.display_name,p.public_username,p.lifecycle_status AS principal_status,
  to_char(m.joined_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS joined_iso,
  to_char(m.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ended_iso`;
const memberJoin = `FROM memberships m JOIN principals p ON p.principal_id=m.principal_id
  JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key`;
const canonical = `r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)`;
function view(row: SqlRow): OrganizationMemberV1 {
  const version = Number(row["record_version"]);
  return organizationMemberV1Schema.parse({
    contractVersion: 1,
    organizationId: row["organization_id"],
    membershipId: row["membership_id"],
    principalId: row["principal_id"],
    role: row["role_key"],
    status: row["end_reason"] !== null ? "removed" : row["lifecycle_status"],
    version,
    displayName: row["display_name"],
    username: row["public_username"],
    joinedAt: row["joined_iso"],
    endedAt: row["ended_iso"],
    endReason: row["end_reason"],
    etag:
      '"member:' +
      hash([row["organization_id"], row["membership_id"]]).slice(0, 32) +
      ":" +
      String(version) +
      '"',
  });
}
const state = (member: OrganizationMemberV1) =>
  organizationMemberStateV1Schema.parse({
    membershipId: member.membershipId,
    principalId: member.principalId,
    role: member.role,
    status: member.status,
    version: member.version,
  });

/** Current database authority, conditional writes and immutable replay evidence.
 * Account locking precedes principal/member locks to serialize invitation admission. */
export class PostgresOrganizationMembers implements OrganizationMembersApplication {
  readonly database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.database = database;
  }
  async #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(work);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "Membership changes are temporarily unavailable. Retry the same attempt.",
      );
    }
  }
  #time(principal: PrincipalContext, write: boolean) {
    const now = new Date();
    if (
      !Number.isFinite(Date.parse(principal.expiresAt)) ||
      Date.parse(principal.expiresAt) <= now.getTime()
    )
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
    if (write) requireRecentAuthentication(principal, now);
  }
  async #principal(
    tx: SqlExecutor,
    principal: PrincipalContext,
    write: boolean,
    lock = false,
  ) {
    this.#time(principal, write);
    const result = await tx.query(
      sql(
        `SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active' AND $2::timestamptz>clock_timestamp() ${lock ? "FOR SHARE" : ""}`,
        [principal.principalId, principal.expiresAt],
      ),
    );
    this.#time(principal, write);
    if (result.rowCount !== 1)
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
  }
  async #lock(tx: SqlExecutor, organizationId: string) {
    if (!organizationIdSchema.safeParse(organizationId).success)
      return invalid();
    await tx.query(
      sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "organization-members-v1:" + organizationId,
      ]),
    );
    await tx.query(
      sql(
        "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1 FOR UPDATE",
        [organizationId],
      ),
    );
  }
  async #organization(tx: SqlExecutor, organizationId: string) {
    const row = (
      await tx.query(
        sql(
          "SELECT workspace_kind FROM organizations WHERE organization_id=$1 AND lifecycle_status='active' FOR SHARE",
          [organizationId],
        ),
      )
    ).rows[0];
    if (!row) return missing();
    return row["workspace_kind"];
  }
  async #member(tx: SqlExecutor, organizationId: string, principalId: string) {
    const row = (
      await tx.query(
        sql(
          `SELECT ${projection} ${memberJoin} WHERE m.organization_id=$1 AND m.principal_id=$2 AND ${canonical} FOR SHARE OF m,r`,
          [organizationId, principalId],
        ),
      )
    ).rows[0];
    if (!row) return missing();
    return view(row);
  }
  #manager(member: OrganizationMemberV1) {
    if (member.status !== "active") return missing();
    if (!["owner", "administrator"].includes(member.role)) return denied();
  }
  own: OrganizationMembersApplication["own"] = (principal, organizationId) => {
    principal = Object.freeze({ ...principal });
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal, false);
      await this.#lock(tx, organizationId);
      await this.#principal(tx, principal, false, true);
      await this.#organization(tx, organizationId);
      const value = await this.#member(
        tx,
        organizationId,
        principal.principalId,
      );
      await this.#principal(tx, principal, false);
      return { value, etag: value.etag };
    });
  };
  list: OrganizationMembersApplication["list"] = (
    principal,
    organizationId,
    options,
  ) => {
    principal = Object.freeze({ ...principal });
    const limit = options.limit,
      cursor = options.cursor ?? "";
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== "" && !membershipIdSchema.safeParse(cursor).success)
    )
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The membership page is invalid.",
        ),
      );
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal, false);
      await this.#lock(tx, organizationId);
      await this.#principal(tx, principal, false, true);
      const kind = await this.#organization(tx, organizationId);
      this.#manager(
        await this.#member(tx, organizationId, principal.principalId),
      );
      if (kind !== "organization") return denied();
      const result = await tx.query(
        sql(
          `SELECT ${projection} ${memberJoin} WHERE m.organization_id=$1 AND m.membership_id>$2 AND ${canonical} ORDER BY m.membership_id LIMIT $3`,
          [organizationId, cursor, limit + 1],
        ),
      );
      const items = result.rows.slice(0, limit).map(view),
        nextCursor = items.at(-1)?.membershipId;
      await this.#principal(tx, principal, false);
      return {
        items,
        ...(result.rows.length > limit && nextCursor ? { nextCursor } : {}),
      };
    });
  };
  change: OrganizationMembersApplication["change"] = (
    principal,
    organizationId,
    input,
    etag,
    key,
  ) => {
    principal = Object.freeze({ ...principal });
    const parsed = changeOrganizationMembershipV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !organizationIdSchema.safeParse(organizationId).success ||
      !consequentialMutationHeadersV1Schema.safeParse({
        "if-match": etag,
        "idempotency-key": key,
      }).success
    )
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The membership request is invalid.",
        ),
      );
    const request = parsed.data;
    const keyHash = hash([
      "organization-members-v1",
      organizationId,
      principal.principalId,
      key,
    ]);
    const requestHash = hash([
      "organization-members-v1",
      organizationId,
      principal.principalId,
      request,
      etag,
    ]);
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal, true);
      await this.#lock(tx, organizationId);
      // Lock all involved principals in stable order before membership updates.
      await tx.query(
        sql(
          `SELECT principal_id FROM principals WHERE principal_id=$1 OR principal_id IN
        (SELECT principal_id FROM memberships WHERE organization_id=$2 AND membership_id IN ($3,$4)) ORDER BY principal_id FOR SHARE`,
          [
            principal.principalId,
            organizationId,
            request.membershipId,
            request.action === "transfer-ownership"
              ? request.targetMembershipId
              : request.membershipId,
          ],
        ),
      );
      await this.#principal(tx, principal, true);
      const kind = await this.#organization(tx, organizationId);
      const replay = (
        await tx.query(
          sql(
            "SELECT request_sha256,receipt_json FROM organization_membership_change_receipts WHERE organization_id=$1 AND actor_principal_id=$2 AND idempotency_key_sha256=$3",
            [organizationId, principal.principalId, keyHash],
          ),
        )
      ).rows[0];
      if (replay) {
        if (kind !== "organization") return denied();
        if (replay["request_sha256"] !== requestHash)
          throw new ApplicationError(
            "idempotency_key_reused",
            "This attempt no longer matches. Reload membership details before starting a new change.",
          );
        const receipt = organizationMembershipReceiptV1Schema.parse(
          replay["receipt_json"],
        );
        await this.#principal(tx, principal, true);
        return receipt;
      }
      const rows = (
        await tx.query(
          sql(
            `SELECT ${projection} ${memberJoin} WHERE m.organization_id=$1
        AND (m.principal_id=$2 OR m.membership_id IN ($3,$4)) AND ${canonical} ORDER BY m.membership_id FOR UPDATE OF m`,
            [
              organizationId,
              principal.principalId,
              request.membershipId,
              request.action === "transfer-ownership"
                ? request.targetMembershipId
                : request.membershipId,
            ],
          ),
        )
      ).rows;
      await this.#principal(tx, principal, true);
      const actorRow = rows.find(
        (row) => row["principal_id"] === principal.principalId,
      );
      const selectedRow = rows.find(
        (row) => row["membership_id"] === request.membershipId,
      );
      if (!actorRow || !selectedRow) return missing();
      const actor = view(actorRow),
        selected = view(selectedRow);
      if (actor.status !== "active") return missing();
      if (kind !== "organization") return denied();
      if (request.action === "set-role" || request.action === "remove")
        this.#manager(actor);
      if (selected.etag !== etag)
        throw new ApplicationError(
          "precondition_failed",
          "This membership changed. Reload before trying again.",
        );
      const changedIds: string[] = [];
      const updateRole = async (
        member: OrganizationMemberV1,
        nextRole: string,
      ) => {
        if (member.role === nextRole) return;
        await tx.query(
          sql(
            "UPDATE memberships SET role_key=$3 WHERE organization_id=$1 AND membership_id=$2",
            [organizationId, member.membershipId, nextRole],
          ),
        );
        changedIds.push(member.membershipId);
      };
      if (request.action === "set-role" || request.action === "remove") {
        if (
          selected.principalId === principal.principalId ||
          selected.role === "owner" ||
          selected.status === "removed"
        )
          return denied();
        if (
          actor.role !== "owner" &&
          (selected.role === "administrator" ||
            (request.action === "set-role" && request.role === "administrator"))
        )
          return denied();
        if (request.action === "set-role") {
          if (
            selected.status !== "active" ||
            selectedRow["principal_status"] !== "active"
          )
            return missing();
          await updateRole(selected, request.role);
        }
      } else {
        if (selected.principalId !== principal.principalId) return denied();
        if (request.action === "leave" && actor.role === "owner") {
          const owners = await tx.query(
            sql(
              "SELECT m.membership_id FROM memberships m JOIN principals p ON p.principal_id=m.principal_id WHERE m.organization_id=$1 AND m.role_key='owner' AND m.lifecycle_status='active' AND p.lifecycle_status='active' AND m.membership_id<>$2",
              [organizationId, actor.membershipId],
            ),
          );
          if (owners.rowCount === 0)
            return conflict(
              "Transfer ownership to an active member before leaving.",
            );
        }
      }
      const outcomeIds = [selected.membershipId];
      if (request.action === "transfer-ownership") {
        if (actor.role !== "owner") return denied();
        const targetRow = rows.find(
          (row) => row["membership_id"] === request.targetMembershipId,
        );
        if (!targetRow) return missing();
        const target = view(targetRow);
        if (
          target.membershipId === actor.membershipId ||
          target.role === "owner" ||
          target.status !== "active" ||
          targetRow["principal_status"] !== "active"
        )
          return conflict(
            "Choose another active member who is not already an owner.",
          );
        if (target.version !== request.targetVersion)
          throw new ApplicationError(
            "precondition_failed",
            "The new owner's membership changed. Reload before trying again.",
          );
        await updateRole(target, "owner");
        await updateRole(actor, "administrator");
        outcomeIds.push(target.membershipId);
      }
      if (request.action === "remove" || request.action === "leave") {
        await tx.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended',ended_at=clock_timestamp(),end_reason=$3 WHERE organization_id=$1 AND membership_id=$2",
            [
              organizationId,
              selected.membershipId,
              request.action === "leave" ? "left" : "removed",
            ],
          ),
        );
        changedIds.push(selected.membershipId);
      }
      // An older issued offer must not revive when its issuer later rejoins/promotes.
      for (const membershipId of changedIds) {
        await tx.query(
          sql(
            `UPDATE organization_invitations SET lifecycle_state='revoked',revoked_at=clock_timestamp()
          WHERE organization_id=$1 AND lifecycle_state='pending' AND (issuer_membership_id=$2
          OR ($3::boolean AND recipient_principal_id=(SELECT principal_id FROM memberships WHERE organization_id=$1 AND membership_id=$2)))`,
            [
              organizationId,
              membershipId,
              request.action === "remove" || request.action === "leave",
            ],
          ),
        );
      }
      const members = [];
      for (const membershipId of outcomeIds) {
        const row = (
          await tx.query(
            sql(
              `SELECT ${projection} ${memberJoin} WHERE m.organization_id=$1 AND m.membership_id=$2 AND ${canonical}`,
              [organizationId, membershipId],
            ),
          )
        ).rows[0];
        if (!row) return missing();
        members.push(state(view(row)));
      }
      const receipt: OrganizationMembershipReceiptV1 =
        organizationMembershipReceiptV1Schema.parse({
          contractVersion: 1,
          organizationId,
          actorPrincipalId: principal.principalId,
          action: request.action,
          members,
          occurredAt: new Date().toISOString(),
        });
      await tx.query(
        sql(
          "INSERT INTO organization_membership_change_receipts(organization_id,actor_principal_id,idempotency_key_sha256,request_sha256,receipt_json) VALUES($1,$2,$3,$4,$5::jsonb)",
          [
            organizationId,
            principal.principalId,
            keyHash,
            requestHash,
            JSON.stringify(receipt),
          ],
        ),
      );
      await tx.query(
        sql(
          `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
        VALUES($1,$2,$3,$4,'organization',$2,'succeeded',$5,$6)`,
          [
            "audit_" + randomUUID(),
            organizationId,
            principal.principalId,
            "organization.membership-" + request.action,
            "Organization membership change recorded for " +
              selected.membershipId +
              ".",
            principal.correlationId,
          ],
        ),
      );
      await this.#principal(tx, principal, true);
      return receipt;
    });
  };
}
