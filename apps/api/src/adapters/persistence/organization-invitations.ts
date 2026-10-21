import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  organizationInvitationV1Schema,
  organizationInvitationIdV1Schema,
  organizationIdSchema,
  idempotencyKeySchema,
  createRecipientOrganizationInvitationV1Schema,
  recipientOrganizationInvitationV1Schema,
  type RecipientOrganizationInvitationV1,
  type AcceptedOrganizationInvitationV1,
  type OrganizationInvitationV1,
} from "@cloudmarkup/api-contract";
import {
  sharingPlanConfigurationVersionV1,
  canIssueOrganizationInvitationV1,
  evaluateOrganizationSeatAdmissionV1,
  includedMembersForSharingPlanV1,
  type InvitableOrganizationRoleV1,
  type MembershipSeatRecordV1,
} from "@cloudmarkup/domain";
import {
  isOrganizationRole,
  permissionsForRole,
  type OrganizationRole,
} from "../../application/authorization.js";
import { ApplicationError } from "../../application/errors.js";
import type {
  CreateOrganizationInvitationRecordV1,
  OrganizationInvitationRepository,
} from "../../application/organization-invitations.js";
import type { PrincipalContext } from "../../application/ports.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const unavailable = (): never => {
  throw new ApplicationError("not_found", "The invitation is unavailable.");
};
const denied = (): never => {
  throw new ApplicationError(
    "access_denied",
    "This invitation action is not permitted.",
  );
};
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new ApplicationError(
      "service_unavailable",
      "Membership information is unavailable.",
    );
  return value;
}
function role(value: unknown): OrganizationRole {
  const candidate = string(value);
  if (!isOrganizationRole(candidate)) return denied();
  return candidate;
}
function targetRole(value: unknown): InvitableOrganizationRoleV1 {
  const candidate = role(value);
  if (candidate === "owner") return denied();
  return candidate;
}
function integer(value: unknown): number {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    value = Number(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ApplicationError(
      "service_unavailable",
      "Membership information is unavailable.",
    );
  return value;
}
const invitationProjection = `i.*, to_char(i.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_iso,
  (i.expires_at>clock_timestamp()) AS unexpired`;

function capturePrincipal(input: PrincipalContext): PrincipalContext {
  return Object.freeze({
    principalId: input.principalId,
    sessionId: input.sessionId,
    authenticatedAt: input.authenticatedAt,
    expiresAt: input.expiresAt,
    authenticationSource: input.authenticationSource,
    correlationId: input.correlationId,
  });
}

/** No provider calls or object I/O. Account serialization precedes all other locks,
 * matching canonical commercial mutations; it serializes last-seat admission. */
export class PostgresOrganizationInvitationRepository implements OrganizationInvitationRepository {
  readonly #database: SqlDatabase;
  constructor(database: SqlDatabase) {
    this.#database = database;
  }

  async #transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await this.#database.transaction(work);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      // Driver errors may contain SQL parameters. Never expose/log them here.
      throw new ApplicationError(
        "service_unavailable",
        "The invitation request could not be completed. Try again.",
      );
    }
  }
  async #principal(
    tx: SqlExecutor,
    principal: PrincipalContext,
    lock = false,
  ): Promise<void> {
    const result = await tx.query(
      sql(
        `SELECT principal_id FROM principals
      WHERE principal_id=$1 AND lifecycle_status='active'
        AND $2::timestamptz>clock_timestamp()
        AND $3::timestamptz>=clock_timestamp()-INTERVAL '10 minutes'
        AND $3::timestamptz<=clock_timestamp()+INTERVAL '1 minute'
      ${lock ? "FOR SHARE" : ""}`,
        [principal.principalId, principal.expiresAt, principal.authenticatedAt],
      ),
    );
    if (result.rowCount !== 1)
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
  }
  async #account(tx: SqlExecutor, organizationId: string): Promise<void> {
    const result = await tx.query(
      sql(
        "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1 FOR UPDATE",
        [organizationId],
      ),
    );
    if (result.rowCount !== 1) return unavailable();
  }
  async #issuer(
    tx: SqlExecutor,
    organizationId: string,
    principalId: string,
    lock: boolean,
    expectedMembershipId?: string,
  ): Promise<{ membershipId: string; role: OrganizationRole }> {
    const result = await tx.query(
      sql(
        `SELECT m.membership_id,m.role_key,r.capabilities,o.workspace_kind
      FROM memberships m JOIN principals p ON p.principal_id=m.principal_id
      JOIN organizations o ON o.organization_id=m.organization_id
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      WHERE m.organization_id=$1 AND m.principal_id=$2 AND m.lifecycle_status='active'
        AND p.lifecycle_status='active' AND o.lifecycle_status='active'
        AND r.policy_version='authorization-v2'
        AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      ${lock ? "FOR SHARE OF m,p,o,r" : ""}`,
        [organizationId, principalId],
      ),
    );
    const record = result.rows[0];
    if (record === undefined) return unavailable();
    if (record["workspace_kind"] === "personal") return denied();
    const issuerRole = role(record["role_key"]);
    if (!permissionsForRole(issuerRole).includes("memberships.manage"))
      return denied();
    const membershipId = string(record["membership_id"]);
    if (
      expectedMembershipId !== undefined &&
      membershipId !== expectedMembershipId
    )
      return unavailable();
    return { membershipId, role: issuerRole };
  }
  async #plan(
    tx: SqlExecutor,
    organizationId: string,
  ): Promise<{ planVersionId: string; at: string }> {
    const result = await tx.query(
      sql(
        `SELECT plan.plan_version_id,plan.configuration_version,
        seats.included_billable_seats,seats.maximum_billable_seats,seats.maximum_nonbillable_viewers,seats.additional_seat_enabled,
        limits.limit_value, to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
      FROM organization_billing_accounts account
      JOIN organization_entitlement_snapshots snapshot ON snapshot.organization_id=account.organization_id AND snapshot.billing_account_id=account.billing_account_id
      LEFT JOIN organization_subscription_projections subscription ON subscription.organization_id=snapshot.organization_id AND subscription.billing_account_id=account.billing_account_id AND subscription.subscription_projection_id=snapshot.subscription_projection_id
      JOIN commercial_plan_versions plan ON plan.plan_version_id=snapshot.plan_version_id
      JOIN commercial_plan_seat_rules seats ON seats.plan_version_id=plan.plan_version_id
      JOIN commercial_plan_numeric_limits limits ON limits.plan_version_id=plan.plan_version_id AND limits.limit_key='active-members' AND limits.limit_scope='organization' AND limits.period_kind='none'
      WHERE account.organization_id=$1 AND account.lifecycle_status='active'
        AND ((subscription.normalized_status='active' AND subscription.billable_seat_quantity=1
        AND subscription.current_period_start<=clock_timestamp() AND subscription.current_period_end>clock_timestamp()
        AND subscription.effective_at<=clock_timestamp() AND snapshot.source_record_version=subscription.record_version AND snapshot.plan_version_id=subscription.plan_version_id)
        OR (snapshot.subscription_projection_id IS NULL AND cloudmarkup_staff_trial_current_v1(account.organization_id,account.billing_account_id)))
        AND snapshot.effective_at<=clock_timestamp()
        AND plan.configuration_status='proposed-beta-example' AND plan.effective_from<=clock_timestamp()
        AND (plan.effective_until IS NULL OR plan.effective_until>clock_timestamp())
        AND snapshot.entitlement_policy_version='cloudmarkup-entitlements-v1'
        AND (SELECT count(*) FROM commercial_plan_feature_entitlements feature WHERE feature.plan_version_id=plan.plan_version_id AND feature.feature_key IN ('shared-projects','organization-roles') AND feature.entitlement_state='enabled')=2
      FOR SHARE OF snapshot,plan,seats,limits`,
        [organizationId],
      ),
    );
    const record = result.rows[0];
    if (record === undefined)
      throw new ApplicationError(
        "access_denied",
        "An active sharing plan is required to add members.",
      );
    const planVersionId = string(record["plan_version_id"]);
    const expected = includedMembersForSharingPlanV1(planVersionId);
    if (
      expected === null ||
      record["configuration_version"] !==
        sharingPlanConfigurationVersionV1(planVersionId) ||
      [
        record["included_billable_seats"],
        record["maximum_billable_seats"],
        record["maximum_nonbillable_viewers"],
        record["limit_value"],
      ].some((value) => integer(value) !== expected) ||
      record["additional_seat_enabled"] !== false
    ) {
      throw new ApplicationError(
        "access_denied",
        "An active sharing plan is required to add members.",
      );
    }
    return { planVersionId, at: string(record["at"]) };
  }
  async #load(
    tx: SqlExecutor,
    invitationId: string,
    organizationId: string,
  ): Promise<SqlRow> {
    const result = await tx.query(
      sql(
        `SELECT ${invitationProjection} FROM organization_invitations i WHERE i.invitation_id=$1 AND i.organization_id=$2 FOR UPDATE`,
        [invitationId, organizationId],
      ),
    );
    return result.rows[0] ?? unavailable();
  }
  #view(row: SqlRow): OrganizationInvitationV1 {
    return organizationInvitationV1Schema.parse({
      contractVersion: 1,
      id: row["invitation_id"],
      organizationId: row["organization_id"],
      role: row["target_role"],
      expiresAt: row["expires_iso"],
      status:
        row["lifecycle_state"] === "pending" && row["unexpired"] !== true
          ? "expired"
          : row["lifecycle_state"],
    });
  }
  async #audit(
    tx: SqlExecutor,
    principal: PrincipalContext,
    organizationId: string,
    invitationId: string,
    action: "created" | "revoked" | "accepted" | "declined",
  ): Promise<void> {
    await tx.query(
      sql(
        `INSERT INTO audit_events(audit_event_id,organization_id,actor_principal_id,action,target_kind,target_id,outcome,safe_summary,correlation_id)
      VALUES($1,$2,$3,$4,'organization',$2,'succeeded',$5,$6)`,
        [
          `audit_${randomUUID()}`,
          organizationId,
          principal.principalId,
          `organization.invitation-${action}`,
          `Organization invitation ${invitationId} ${action}.`,
          principal.correlationId,
        ],
      ),
    );
  }
  async create(
    principal: PrincipalContext,
    input: CreateOrganizationInvitationRecordV1,
  ): Promise<OrganizationInvitationV1> {
    principal = capturePrincipal(principal);
    const captured = Object.freeze({ ...input });
    if (
      !/^[a-f0-9]{64}$/.test(captured.tokenSha256) ||
      !/^[a-f0-9]{64}$/.test(captured.requestSha256) ||
      !/^[a-f0-9]{64}$/.test(captured.idempotencyKeySha256)
    )
      throw new ApplicationError(
        "invalid_request",
        "The invitation request is invalid.",
      );
    return this.#transaction((tx) => this.#create(tx, principal, captured));
  }
  async #create(
    tx: SqlExecutor,
    principal: PrincipalContext,
    captured: CreateOrganizationInvitationRecordV1,
  ): Promise<OrganizationInvitationV1> {
    await this.#principal(tx, principal);
    await this.#issuer(
      tx,
      captured.organizationId,
      principal.principalId,
      false,
    );
    await this.#account(tx, captured.organizationId);
    await this.#principal(tx, principal, true);
    const issuer = await this.#issuer(
      tx,
      captured.organizationId,
      principal.principalId,
      true,
    );
    if (!canIssueOrganizationInvitationV1(issuer.role, captured.role))
      return denied();
    const replay = (
      await tx.query(
        sql(
          `SELECT ${invitationProjection} FROM organization_invitations i
        WHERE i.organization_id=$1 AND i.issuer_principal_id=$2 AND i.idempotency_key_sha256=$3 FOR UPDATE`,
          [
            captured.organizationId,
            principal.principalId,
            captured.idempotencyKeySha256,
          ],
        ),
      )
    ).rows[0];
    if (replay !== undefined) {
      if (
        (replay["recipient_principal_id"] ?? null) !==
          (captured.recipientPrincipalId ?? null) ||
        replay["request_sha256"] !== captured.requestSha256 ||
        replay["token_sha256"] !== captured.tokenSha256 ||
        replay["target_role"] !== captured.role ||
        replay["issuer_membership_id"] !== issuer.membershipId
      ) {
        throw new ApplicationError(
          "idempotency_key_reused",
          "This invitation attempt no longer matches. Start a new invitation.",
        );
      }
      await this.#principal(tx, principal);
      return this.#view(replay);
    }
    await this.#plan(tx, captured.organizationId);
    const invitationId = `invitation_${randomUUID()}`;
    const inserted = await tx.query(
      sql(
        `WITH instant AS (SELECT clock_timestamp() AS at)
        INSERT INTO organization_invitations(invitation_id,organization_id,issuer_principal_id,issuer_membership_id,target_role,token_sha256,request_sha256,idempotency_key_sha256,created_at,expires_at${captured.recipientPrincipalId === undefined ? "" : ",recipient_principal_id"})
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,at,at+INTERVAL '24 hours'${captured.recipientPrincipalId === undefined ? "" : ",$9"} FROM instant`,
        [
          invitationId,
          captured.organizationId,
          principal.principalId,
          issuer.membershipId,
          captured.role,
          captured.tokenSha256,
          captured.requestSha256,
          captured.idempotencyKeySha256,
          ...(captured.recipientPrincipalId === undefined
            ? []
            : [captured.recipientPrincipalId]),
        ],
      ),
    );
    if (inserted.rowCount !== 1)
      throw new ApplicationError(
        "service_unavailable",
        "The invitation could not be created.",
      );
    await this.#audit(
      tx,
      principal,
      captured.organizationId,
      invitationId,
      "created",
    );
    await this.#principal(tx, principal);
    return this.#view(
      await this.#load(tx, invitationId, captured.organizationId),
    );
  }
  async revoke(
    principal: PrincipalContext,
    organizationId: string,
    invitationId: string,
  ): Promise<OrganizationInvitationV1> {
    principal = capturePrincipal(principal);
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal);
      await this.#issuer(tx, organizationId, principal.principalId, false);
      await this.#account(tx, organizationId);
      await this.#principal(tx, principal, true);
      const actor = await this.#issuer(
        tx,
        organizationId,
        principal.principalId,
        true,
      );
      const current = await this.#load(tx, invitationId, organizationId);
      if (
        !canIssueOrganizationInvitationV1(
          actor.role,
          targetRole(current["target_role"]),
        )
      )
        return denied();
      if (current["lifecycle_state"] === "accepted")
        throw new ApplicationError(
          "conflict",
          "This invitation was already accepted. Existing membership is unchanged.",
        );
      if (current["lifecycle_state"] === "pending") {
        const changed = await tx.query(
          sql(
            "UPDATE organization_invitations SET lifecycle_state='revoked',revoked_at=clock_timestamp() WHERE invitation_id=$1 AND organization_id=$2 AND lifecycle_state='pending'",
            [invitationId, organizationId],
          ),
        );
        if (changed.rowCount !== 1) return unavailable();
        await this.#audit(
          tx,
          principal,
          organizationId,
          invitationId,
          "revoked",
        );
      }
      await this.#principal(tx, principal);
      return this.#view(await this.#load(tx, invitationId, organizationId));
    });
  }
  async #member(
    tx: SqlExecutor,
    organizationId: string,
    principalId: string,
  ): Promise<SqlRow | undefined> {
    return (
      await tx.query(
        sql(
          `SELECT m.membership_id,m.role_key,m.lifecycle_status,to_jsonb(m)->>'end_reason' AS end_reason FROM memberships m
      JOIN organization_roles role ON role.organization_id=m.organization_id AND role.role_key=m.role_key
      WHERE m.organization_id=$1 AND m.principal_id=$2 AND role.policy_version='authorization-v2'
        AND role.capabilities=cloudmarkup_authorization_v2_permissions(role.role_key)
      FOR SHARE OF m,role`,
          [organizationId, principalId],
        ),
      )
    ).rows[0];
  }
  async accept(
    principal: PrincipalContext,
    invitationId: string,
    tokenSha256: string,
  ): Promise<AcceptedOrganizationInvitationV1> {
    principal = capturePrincipal(principal);
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal);
      const selected = (
        await tx.query(
          sql(
            "SELECT organization_id,issuer_principal_id FROM organization_invitations WHERE invitation_id=$1 AND token_sha256=$2",
            [invitationId, tokenSha256],
          ),
        )
      ).rows[0];
      if (selected === undefined) return unavailable();
      const organizationId = string(selected["organization_id"]);
      await this.#account(tx, organizationId);
      // Serialize the recipient across different organizations and workspace creation.
      // Lock issuer/recipient in one stable order so reciprocal invitations cannot deadlock.
      await tx.query(
        sql(
          "SELECT principal_id FROM principals WHERE principal_id IN ($1,$2) ORDER BY principal_id FOR UPDATE",
          [principal.principalId, string(selected["issuer_principal_id"])],
        ),
      );
      await this.#principal(tx, principal);
      const current = await this.#load(tx, invitationId, organizationId);
      if (current["issuer_principal_id"] !== selected["issuer_principal_id"])
        return unavailable();
      if (current["token_sha256"] !== tokenSha256) return unavailable();
      if (
        current["recipient_principal_id"] !== null &&
        current["recipient_principal_id"] !== undefined &&
        current["recipient_principal_id"] !== principal.principalId
      )
        return unavailable();
      const issuer = await this.#issuer(
        tx,
        organizationId,
        string(current["issuer_principal_id"]),
        true,
        string(current["issuer_membership_id"]),
      );
      const requestedRole = targetRole(current["target_role"]);
      if (!canIssueOrganizationInvitationV1(issuer.role, requestedRole))
        return denied();
      let member = await this.#member(
        tx,
        organizationId,
        principal.principalId,
      );
      const rejoining =
        member !== undefined &&
        member["lifecycle_status"] !== "active" &&
        ["removed", "left"].includes(String(member["end_reason"])) &&
        current["lifecycle_state"] === "pending" &&
        current["recipient_principal_id"] === principal.principalId;
      if (
        member !== undefined &&
        member["lifecycle_status"] !== "active" &&
        !rejoining
      )
        return unavailable();
      if (current["lifecycle_state"] === "accepted") {
        if (
          current["accepted_principal_id"] !== principal.principalId ||
          member === undefined ||
          current["accepted_membership_id"] !== member["membership_id"]
        )
          return unavailable();
        await this.#principal(tx, principal);
        return {
          contractVersion: 1,
          organizationId,
          membershipId: string(member["membership_id"]),
          role: role(member["role_key"]),
          status: "accepted",
        };
      }
      if (
        current["lifecycle_state"] !== "pending" ||
        current["unexpired"] !== true
      )
        return unavailable();
      const plan = await this.#plan(tx, organizationId);
      if (member === undefined || rejoining) {
        const count = (
          await tx.query(
            sql(
              "SELECT count(*) AS workspace_count FROM memberships m JOIN organizations o ON o.organization_id=m.organization_id WHERE m.principal_id=$1 AND m.lifecycle_status='active' AND o.lifecycle_status='active'",
              [principal.principalId],
            ),
          )
        ).rows[0]?.["workspace_count"];
        const workspaceCount = Number(count);
        if (!Number.isSafeInteger(workspaceCount) || workspaceCount < 0)
          return unavailable();
        if (workspaceCount >= 100)
          throw new ApplicationError(
            "conflict",
            "Leave an organization before joining another; the account supports 100 workspaces.",
          );
        const rows = (
          await tx.query(
            sql(
              "SELECT membership_id,role_key,lifecycle_status FROM memberships WHERE organization_id=$1 AND lifecycle_status='active' ORDER BY membership_id LIMIT 11",
              [organizationId],
            ),
          )
        ).rows;
        const memberships: MembershipSeatRecordV1[] = rows.map((row) => ({
          membershipId: string(row["membership_id"]),
          role: role(row["role_key"]),
          status: "active",
        }));
        if (
          !evaluateOrganizationSeatAdmissionV1({ ...plan, memberships }).allowed
        ) {
          throw new ApplicationError(
            "conflict",
            "Your organization has reached its included member limit.",
            {
              fieldIssues: [
                {
                  code: "organization-membership.member-limit.v1",
                  path: ["organization", "members"],
                  message: "No included member place is available.",
                },
              ],
            },
          );
        }
        const membershipId =
          member === undefined
            ? `membership_${randomUUID()}`
            : string(member["membership_id"]);
        const inserted = rejoining
          ? await tx.query(
              sql(
                "UPDATE memberships SET lifecycle_status='active',role_key=$4,ended_at=NULL,end_reason=NULL WHERE membership_id=$1 AND organization_id=$2 AND principal_id=$3 AND lifecycle_status='suspended' AND end_reason IN ('left','removed') AND ended_at<(SELECT created_at FROM organization_invitations WHERE invitation_id=$5)",
                [
                  membershipId,
                  organizationId,
                  principal.principalId,
                  requestedRole,
                  invitationId,
                ],
              ),
            )
          : await tx.query(
              sql(
                "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,$4)",
                [
                  membershipId,
                  organizationId,
                  principal.principalId,
                  requestedRole,
                ],
              ),
            );
        if (inserted.rowCount !== 1) return unavailable();
        member = {
          membership_id: membershipId,
          role_key: requestedRole,
          lifecycle_status: "active",
        };
      }
      const membershipId = string(member["membership_id"]);
      const accepted = await tx.query(
        sql(
          `UPDATE organization_invitations SET lifecycle_state='accepted',accepted_principal_id=$3,
        accepted_membership_id=$4,accepted_at=clock_timestamp(),accepted_auth_expires_at=$5::timestamptz
        WHERE invitation_id=$1 AND organization_id=$2 AND lifecycle_state='pending' AND expires_at>clock_timestamp() AND $5::timestamptz>clock_timestamp()`,
          [
            invitationId,
            organizationId,
            principal.principalId,
            membershipId,
            principal.expiresAt,
          ],
        ),
      );
      if (accepted.rowCount !== 1) return unavailable();
      await this.#audit(
        tx,
        principal,
        organizationId,
        invitationId,
        "accepted",
      );
      await this.#principal(tx, principal);
      return {
        contractVersion: 1,
        organizationId,
        membershipId,
        role: role(member["role_key"]),
        status: "accepted",
      };
    });
  }
  async #recipientView(
    tx: SqlExecutor,
    invitationId: string,
  ): Promise<RecipientOrganizationInvitationV1> {
    const row = (
      await tx.query(
        sql(
          `SELECT ${invitationProjection},o.display_name AS organization_name,p.principal_id AS recipient_id,p.display_name AS recipient_name,p.public_username AS recipient_username
      FROM organization_invitations i JOIN organizations o ON o.organization_id=i.organization_id
      JOIN principals p ON p.principal_id=i.recipient_principal_id WHERE i.invitation_id=$1`,
          [invitationId],
        ),
      )
    ).rows[0];
    if (!row) return unavailable();
    return this.#recipientRecord(row);
  }
  #recipientRecord(row: SqlRow): RecipientOrganizationInvitationV1 {
    const base = this.#view(row);
    return recipientOrganizationInvitationV1Schema.parse({
      ...base,
      status: row["declined_by_recipient"] === true ? "declined" : base.status,
      organizationName: row["organization_name"],
      recipient: {
        principalId: row["recipient_id"],
        displayName: row["recipient_name"],
        username: row["recipient_username"],
      },
    });
  }
  createForRecipient(
    principal: PrincipalContext,
    organizationId: string,
    input: unknown,
    key: string,
  ): Promise<RecipientOrganizationInvitationV1> {
    principal = capturePrincipal(principal);
    const parsed =
      createRecipientOrganizationInvitationV1Schema.safeParse(input);
    if (
      !parsed.success ||
      !organizationIdSchema.safeParse(organizationId).success ||
      !idempotencyKeySchema.safeParse(key).success
    )
      return Promise.reject(
        new ApplicationError(
          "invalid_request",
          "The invitation request is invalid.",
        ),
      );
    const request = parsed.data;
    const hash = (kind: string, values: readonly unknown[]) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            "recipient-organization-invitation-v1",
            kind,
            ...values,
          ]),
        )
        .digest("hex");
    const requestSha256 = hash("create", [
      organizationId,
      principal.principalId,
      request.role,
      request.recipient,
    ]);
    const idempotencyKeySha256 = hash("idempotency", [
      organizationId,
      principal.principalId,
      key,
    ]);
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal);
      await this.#issuer(tx, organizationId, principal.principalId, false);
      await this.#account(tx, organizationId);
      const replay = (
        await tx.query(
          sql(
            "SELECT recipient_principal_id,request_sha256,token_sha256 FROM organization_invitations WHERE organization_id=$1 AND issuer_principal_id=$2 AND idempotency_key_sha256=$3",
            [organizationId, principal.principalId, idempotencyKeySha256],
          ),
        )
      ).rows[0];
      // Verify sharing eligibility before resolving or disclosing a new recipient.
      if (replay === undefined) await this.#plan(tx, organizationId);
      const found =
        replay ??
        (
          await tx.query(
            sql(
              "SELECT principal_id AS recipient_principal_id FROM principals WHERE lifecycle_status='active' AND " +
                (request.recipient.kind === "user-id"
                  ? "principal_id=$1"
                  : "public_username=$1"),
              [
                request.recipient.kind === "user-id"
                  ? request.recipient.userId
                  : request.recipient.username,
              ],
            ),
          )
        ).rows[0];
      if (
        !found ||
        typeof found["recipient_principal_id"] !== "string" ||
        found["recipient_principal_id"] === principal.principalId
      )
        return unavailable();
      const recipientId = found["recipient_principal_id"];
      // The account lock comes first. Stable principal ordering avoids reciprocal-invitation cycles.
      await tx.query(
        sql(
          "SELECT principal_id FROM principals WHERE principal_id IN ($1,$2) ORDER BY principal_id FOR SHARE",
          [principal.principalId, recipientId],
        ),
      );
      await this.#principal(tx, principal);
      const issuer = await this.#issuer(
        tx,
        organizationId,
        principal.principalId,
        true,
      );
      if (!canIssueOrganizationInvitationV1(issuer.role, request.role))
        return denied();
      if (replay && replay["request_sha256"] !== requestSha256)
        throw new ApplicationError(
          "idempotency_key_reused",
          "This invitation attempt no longer matches. Start a new invitation.",
        );
      const target = (
        await tx.query(
          sql(
            "SELECT public_username FROM principals WHERE principal_id=$1 AND lifecycle_status='active'",
            [recipientId],
          ),
        )
      ).rows[0];
      if (
        !target ||
        (!replay &&
          request.recipient.kind === "username" &&
          target["public_username"] !== request.recipient.username)
      )
        return unavailable();
      if (!replay) {
        const member = await tx.query(
          sql(
            "SELECT membership_id,lifecycle_status,to_jsonb(memberships)->>'end_reason' AS end_reason FROM memberships WHERE organization_id=$1 AND principal_id=$2",
            [organizationId, recipientId],
          ),
        );
        if (
          member.rowCount !== 0 &&
          !(
            member.rows[0]?.["lifecycle_status"] === "suspended" &&
            ["removed", "left"].includes(String(member.rows[0]["end_reason"]))
          )
        )
          throw new ApplicationError(
            "conflict",
            "This account already has a membership in the organization.",
          );
        const pending = await tx.query(
          sql(
            "SELECT recipient_principal_id FROM organization_invitations WHERE organization_id=$1 AND lifecycle_state='pending' AND expires_at>clock_timestamp() LIMIT 101",
            [organizationId],
          ),
        );
        if (
          pending.rows.some(
            (row) => row["recipient_principal_id"] === recipientId,
          )
        )
          throw new ApplicationError(
            "conflict",
            "An invitation is already pending for this account.",
          );
        if (pending.rowCount >= 100)
          throw new ApplicationError(
            "conflict",
            "Resolve pending invitations before inviting more people.",
          );
      }
      const result = await this.#create(tx, principal, {
        organizationId,
        role: request.role,
        recipientPrincipalId: recipientId,
        requestSha256,
        idempotencyKeySha256,
        tokenSha256: replay
          ? string(replay["token_sha256"])
          : createHash("sha256").update(randomBytes(32)).digest("hex"),
      });
      const value = await this.#recipientView(tx, result.id);
      await this.#principal(tx, principal);
      return value;
    });
  }
  async #readActor(
    tx: SqlExecutor,
    principal: PrincipalContext,
  ): Promise<void> {
    const current = await tx.query(
      sql(
        "SELECT principal_id FROM principals WHERE principal_id=$1 AND lifecycle_status='active' AND $2::timestamptz>clock_timestamp() FOR SHARE",
        [principal.principalId, principal.expiresAt],
      ),
    );
    if (
      current.rowCount !== 1 ||
      !Number.isFinite(Date.parse(principal.expiresAt)) ||
      Date.parse(principal.expiresAt) <= Date.now()
    )
      throw new ApplicationError(
        "authentication_required",
        "Sign in again to continue.",
      );
  }
  #page(input: { readonly limit: number; readonly cursor?: string }) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.cursor !== undefined &&
        !organizationInvitationIdV1Schema.safeParse(input.cursor).success)
    )
      throw new ApplicationError(
        "invalid_request",
        "The invitation page is invalid.",
      );
    return { limit: input.limit, cursor: input.cursor ?? "" };
  }
  async listForRecipient(
    principal: PrincipalContext,
    input: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly RecipientOrganizationInvitationV1[];
    readonly nextCursor?: string;
  }> {
    principal = capturePrincipal(principal);
    const page = this.#page(input);
    return this.#transaction(async (tx) => {
      await this.#readActor(tx, principal);
      const result = await tx.query(
        sql(
          `SELECT ${invitationProjection},o.display_name AS organization_name,p.principal_id AS recipient_id,p.display_name AS recipient_name,p.public_username AS recipient_username
        FROM organization_invitations i JOIN organizations o ON o.organization_id=i.organization_id JOIN principals p ON p.principal_id=i.recipient_principal_id
        WHERE i.recipient_principal_id=$1 AND i.invitation_id>$2 AND o.lifecycle_status='active' AND o.workspace_kind='organization' ORDER BY i.invitation_id LIMIT $3`,
          [principal.principalId, page.cursor, page.limit + 1],
        ),
      );
      const items = result.rows
        .slice(0, page.limit)
        .map((row) => this.#recipientRecord(row));
      await this.#readActor(tx, principal);
      const nextCursor = items.at(-1)?.id;
      return {
        items,
        ...(result.rows.length > page.limit && nextCursor !== undefined
          ? { nextCursor }
          : {}),
      };
    });
  }
  async listForOrganization(
    principal: PrincipalContext,
    organizationId: string,
    input: { readonly limit: number; readonly cursor?: string },
  ): Promise<{
    readonly items: readonly RecipientOrganizationInvitationV1[];
    readonly nextCursor?: string;
  }> {
    principal = capturePrincipal(principal);
    const page = this.#page(input);
    return this.#transaction(async (tx) => {
      await this.#readActor(tx, principal);
      await this.#issuer(tx, organizationId, principal.principalId, true);
      const result = await tx.query(
        sql(
          `SELECT ${invitationProjection},o.display_name AS organization_name,p.principal_id AS recipient_id,p.display_name AS recipient_name,p.public_username AS recipient_username
        FROM organization_invitations i JOIN organizations o ON o.organization_id=i.organization_id JOIN principals p ON p.principal_id=i.recipient_principal_id
        WHERE i.organization_id=$1 AND i.invitation_id>$2 AND i.recipient_principal_id IS NOT NULL ORDER BY i.invitation_id LIMIT $3`,
          [organizationId, page.cursor, page.limit + 1],
        ),
      );
      const items = result.rows
        .slice(0, page.limit)
        .map((row) => this.#recipientRecord(row));
      await this.#readActor(tx, principal);
      const nextCursor = items.at(-1)?.id;
      return {
        items,
        ...(result.rows.length > page.limit && nextCursor !== undefined
          ? { nextCursor }
          : {}),
      };
    });
  }
  async acceptForRecipient(
    principal: PrincipalContext,
    invitationId: string,
  ): Promise<AcceptedOrganizationInvitationV1> {
    principal = capturePrincipal(principal);
    const token = await this.#transaction(async (tx) => {
      await this.#readActor(tx, principal);
      const found = (
        await tx.query(
          sql(
            "SELECT token_sha256 FROM organization_invitations WHERE invitation_id=$1 AND recipient_principal_id=$2",
            [invitationId, principal.principalId],
          ),
        )
      ).rows[0];
      return found ? string(found["token_sha256"]) : unavailable();
    });
    // Canonical acceptance rechecks authority and immutable recipient binding in its own atomic transaction.
    return this.accept(principal, invitationId, token);
  }
  declineForRecipient(
    principal: PrincipalContext,
    invitationId: string,
  ): Promise<RecipientOrganizationInvitationV1> {
    principal = capturePrincipal(principal);
    return this.#transaction(async (tx) => {
      await this.#principal(tx, principal);
      const initial = (
        await tx.query(
          sql(
            "SELECT organization_id FROM organization_invitations WHERE invitation_id=$1 AND recipient_principal_id=$2",
            [invitationId, principal.principalId],
          ),
        )
      ).rows[0];
      if (!initial) return unavailable();
      const organizationId = string(initial["organization_id"]);
      await this.#account(tx, organizationId);
      await this.#principal(tx, principal, true);
      const current = await this.#load(tx, invitationId, organizationId);
      if (current["recipient_principal_id"] !== principal.principalId)
        return unavailable();
      if (current["lifecycle_state"] === "accepted")
        throw new ApplicationError(
          "conflict",
          "This invitation was already accepted. Manage the existing membership instead.",
        );
      if (
        current["lifecycle_state"] === "pending" &&
        current["unexpired"] === true
      ) {
        const changed = await tx.query(
          sql(
            "UPDATE organization_invitations SET lifecycle_state='revoked',declined_by_recipient=TRUE,revoked_at=clock_timestamp() WHERE invitation_id=$1 AND recipient_principal_id=$2 AND lifecycle_state='pending' AND expires_at>clock_timestamp()",
            [invitationId, principal.principalId],
          ),
        );
        if (changed.rowCount !== 1) return unavailable();
        await this.#audit(
          tx,
          principal,
          organizationId,
          invitationId,
          "declined",
        );
      }
      const value = await this.#recipientView(tx, invitationId);
      await this.#principal(tx, principal);
      return value;
    });
  }
}
