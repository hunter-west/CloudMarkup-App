import {
  COMMERCIAL_FEATURE_KEYS,
  COMMERCIAL_LIMIT_KEYS,
  COMMERCIAL_LIMIT_PERIOD_KINDS,
  ENTITLEMENT_POLICY_VERSION,
  STAFF_TRIAL_PLAN_VERSION,
  STAFF_TRIAL_POLICY_VERSION,
  evaluateEntitlementV1,
  validatePlanVersionV1,
  type EntitlementDecisionInputV1,
} from "@cloudmarkup/domain";
import {
  solutionExportWorkflowTargetSettingsV1Schema,
  type SolutionExportWorkflowTargetSettingsV1,
} from "@cloudmarkup/solution-export-workflow";
import type { SolutionExportTargetPolicy } from "../../application/solution-exports.js";
import { ApplicationError } from "../../application/errors.js";
import {
  isOrganizationRole,
  permissionsForRole,
} from "../../application/authorization.js";
import { exportAdmissionHash } from "./solution-export-admission-codec.js";
import {
  exportRunEqual,
  exportRunInteger,
  exportRunText,
  exportRunTargetProfile,
  exportRunTimestamp,
  exportRunUnavailable,
} from "./solution-export-run-codec.js";
import type { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import { sql, type SqlExecutor } from "./sql.js";

type ExportPolicyInput = Parameters<SolutionExportTargetPolicy["evaluate"]>[0];
type ExportPolicyAuthority =
  SolutionExportRequestAuthority | SolutionExportWorkerAuthority;

function member<T extends string>(value: unknown, values: readonly T[]): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) exportRunUnavailable();
  return found;
}
function unsigned(value: unknown): number {
  if (value === 0 || value === 0n || value === "0") return 0;
  return exportRunInteger(value);
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") exportRunUnavailable();
  return value;
}
async function creditsOnlyAccess(
  tx: SqlExecutor,
  organizationId: string,
): Promise<boolean> {
  const found = await tx.query(
    sql(
      `SELECT cloudmarkup_staff_credit_access_v1(a.organization_id,a.billing_account_id) AS staff_credit_current
       FROM organization_billing_accounts a
       WHERE a.organization_id=$1 AND a.lifecycle_status='active'`,
      [organizationId],
    ),
  );
  return (
    found.rows.length === 1 && found.rows[0]?.["staff_credit_current"] === true
  );
}
function creditsOnlyExportDenied(): never {
  throw new ApplicationError(
    "access_denied",
    "Complimentary credits fund AI workflows, not exports.",
    {
      fieldIssues: [
        {
          code: "solution-export.staff-credits-ai-only.v1",
          path: ["targetProfileId"],
          message: "Exports require an eligible paid plan or trial.",
        },
      ],
    },
  );
}
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export type ExportInactiveSubscriptionPolicy = NonNullable<
  EntitlementDecisionInputV1["inactiveSubscriptionAccessPolicy"]
>;

/** Canonical decision reads under exports.run; no summary permission, reservation or invented plan. */
export class PostgresSolutionExportTargetPolicy implements SolutionExportTargetPolicy {
  readonly authority: ExportPolicyAuthority;
  readonly settings: SolutionExportWorkflowTargetSettingsV1;
  readonly inactivePolicy: ExportInactiveSubscriptionPolicy | undefined;
  constructor(
    authority: ExportPolicyAuthority,
    settings: SolutionExportWorkflowTargetSettingsV1,
    inactivePolicy?: ExportInactiveSubscriptionPolicy,
  ) {
    this.authority = authority;
    this.settings =
      solutionExportWorkflowTargetSettingsV1Schema.parse(settings);
    this.inactivePolicy =
      inactivePolicy === undefined
        ? undefined
        : structuredClone(inactivePolicy);
    if (authority.permission !== "exports.run") exportRunUnavailable();
  }
  async evaluate(
    input: Parameters<SolutionExportTargetPolicy["evaluate"]>[0],
  ): ReturnType<SolutionExportTargetPolicy["evaluate"]> {
    const authority = this.authority;
    if (authority instanceof SolutionExportWorkerAuthority)
      exportRunUnavailable();
    if (
      input.principal.principalId !== authority.principal.principalId ||
      input.principal.sessionId !== authority.principal.sessionId
    )
      exportRunUnavailable();
    return this.evaluateCurrent(input);
  }
  /** Rechecks current commercial access under the actual claimed worker lease. */
  async evaluateForWorker(
    input: Omit<ExportPolicyInput, "principal">,
  ): ReturnType<SolutionExportTargetPolicy["evaluate"]> {
    if (
      !(this.authority instanceof SolutionExportWorkerAuthority) ||
      this.authority.mode !== "execution"
    )
      exportRunUnavailable();
    return this.evaluateCurrent(input);
  }
  private async evaluateCurrent(
    input: Omit<ExportPolicyInput, "principal">,
  ): ReturnType<SolutionExportTargetPolicy["evaluate"]> {
    const authority = this.authority;
    const worker = authority instanceof SolutionExportWorkerAuthority;
    if (
      input.organizationId !== authority.ownership.organizationId ||
      input.binding.organizationId !== input.organizationId ||
      input.binding.projectId !== authority.ownership.projectId ||
      input.targetProfileId !== exportRunTargetProfile(this.settings.target)
    )
      exportRunUnavailable();
    const scope = await authority.scope();
    const result = await authority.database.transaction(async (tx) => {
      await tx.query(
        sql(
          worker
            ? "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
            : "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        ),
      );
      if (authority instanceof SolutionExportWorkerAuthority)
        await authority.authorize(tx);
      else await authority.currentAuthentication(tx);
      const found = await tx.query(
        sql(
          `SELECT a.billing_account_id,a.lifecycle_status AS account_state,a.expensive_operations_enabled AS account_expensive,a.record_version AS account_version,
        e.entitlement_snapshot_id,e.entitlement_policy_version,e.record_version AS snapshot_version,e.expensive_operations_enabled AS snapshot_expensive,
        s.subscription_projection_id,s.record_version AS subscription_version,s.normalized_status,
        t.trial_id,${utc("t.starts_at")} AS trial_starts_at,${utc("t.expires_at")} AS trial_expires_at,cloudmarkup_staff_trial_current_v1(a.organization_id,a.billing_account_id) AS trial_current,
        v.plan_version_id,v.plan_id,v.configuration_version,v.proposed_monthly_price_micros,v.price_currency,${utc("v.effective_from")} AS effective_from,${utc("v.effective_until")} AS effective_until,
        seats.included_billable_seats,seats.additional_seat_enabled,seats.additional_seat_monthly_price_micros,seats.additional_seat_price_currency,seats.additional_seat_credit_units,
        to_json(r.capabilities)::text AS capabilities,${utc("clock_timestamp()")} AS evaluated_at
        FROM organization_billing_accounts a
        JOIN organization_entitlement_snapshots e ON e.organization_id=a.organization_id AND e.billing_account_id=a.billing_account_id
        LEFT JOIN platform_staff_trials t ON t.organization_id=e.organization_id AND t.billing_account_id=e.billing_account_id
        LEFT JOIN organization_subscription_projections s ON s.organization_id=e.organization_id AND s.subscription_projection_id=e.subscription_projection_id AND s.billing_account_id=a.billing_account_id
        JOIN commercial_plan_versions v ON v.plan_version_id=e.plan_version_id
        JOIN commercial_plan_seat_rules seats ON seats.plan_version_id=v.plan_version_id
        JOIN memberships m ON m.organization_id=a.organization_id AND m.membership_id=$3 AND m.principal_id=$2 AND m.role_key=$4 AND m.lifecycle_status='active'
        JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
        JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
        JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key AND r.policy_version='authorization-v2'
        JOIN projects project ON project.organization_id=o.organization_id AND project.project_id=$5 AND project.lifecycle_status='active'
        WHERE a.organization_id=$1 AND ((e.source_record_version=s.record_version AND v.plan_version_id=s.plan_version_id)
          OR (e.subscription_projection_id IS NULL AND cloudmarkup_staff_trial_current_v1(a.organization_id,a.billing_account_id))) AND e.effective_at<=clock_timestamp()
        AND v.configuration_status='proposed-beta-example' AND v.effective_from<=clock_timestamp() AND (v.effective_until IS NULL OR v.effective_until>clock_timestamp())`,
          [
            scope.organizationId,
            scope.principalId,
            scope.membershipId,
            scope.roleKey,
            authority.ownership.projectId,
          ],
        ),
      );
      const row = found.rows[0];
      if (found.rows.length !== 1 || row === undefined) {
        if (await creditsOnlyAccess(tx, scope.organizationId))
          creditsOnlyExportDenied();
        throw new ApplicationError(
          "service_unavailable",
          "A current billing account and approved paid or trial export plan are required.",
        );
      }
      if (row["entitlement_policy_version"] !== ENTITLEMENT_POLICY_VERSION)
        exportRunUnavailable();
      const capabilities: unknown = JSON.parse(
        exportRunText(row["capabilities"]),
      );
      if (
        !isOrganizationRole(scope.roleKey) ||
        !Array.isArray(capabilities) ||
        capabilities.some((value: unknown) => typeof value !== "string") ||
        !exportRunEqual(
          capabilities.map((value: unknown) => exportRunText(value)).sort(),
          [...permissionsForRole(scope.roleKey)].sort(),
        )
      )
        exportRunUnavailable();
      const planId = exportRunText(row["plan_version_id"]);
      const features = await tx.query(
        sql(
          "SELECT feature_key,entitlement_state FROM commercial_plan_feature_entitlements WHERE plan_version_id=$1 ORDER BY feature_key",
          [planId],
        ),
      );
      const limits = await tx.query(
        sql(
          "SELECT limit_key,limit_scope,period_kind,limit_value FROM commercial_plan_numeric_limits WHERE plan_version_id=$1 ORDER BY limit_key,limit_scope",
          [planId],
        ),
      );
      const grants = await tx.query(
        sql(
          "SELECT grant_kind,credit_units FROM commercial_plan_included_credit_grants WHERE plan_version_id=$1 ORDER BY grant_kind",
          [planId],
        ),
      );
      const additional =
        row["additional_seat_monthly_price_micros"] === null
          ? null
          : {
              enabled: boolean(row["additional_seat_enabled"]),
              additionalSharedCreditUnits: unsigned(
                row["additional_seat_credit_units"],
              ),
              proposedMonthlyPrice: {
                currencyCode: exportRunText(
                  row["additional_seat_price_currency"],
                ),
                unitAmountMicros: unsigned(
                  row["additional_seat_monthly_price_micros"],
                ),
              },
            };
      if (row["additional_seat_enabled"] !== false) exportRunUnavailable();
      const plan = {
        commercialDomainVersion: 1,
        configurationVersion: exportRunText(row["configuration_version"]),
        effectiveFrom: exportRunTimestamp(row["effective_from"]),
        effectiveUntil:
          row["effective_until"] === null
            ? null
            : exportRunTimestamp(row["effective_until"]),
        planDefinitionId: exportRunText(row["plan_id"]),
        planVersionId: planId,
        proposedMonthlyPrice: {
          currencyCode: exportRunText(row["price_currency"]),
          unitAmountMicros: unsigned(row["proposed_monthly_price_micros"]),
        },
        includedBillableSeats: unsigned(row["included_billable_seats"]),
        futureAdditionalEditorConcept: additional,
        includedCreditGrants: grants.rows.map((grant) => ({
          kind: member(grant["grant_kind"], ["one-time", "monthly"] as const),
          units: exportRunInteger(grant["credit_units"]),
        })),
        entitlements: features.rows.map((feature) => ({
          feature: member(feature["feature_key"], COMMERCIAL_FEATURE_KEYS),
          enabled: ["enabled", "limited"].includes(
            member(feature["entitlement_state"], [
              "enabled",
              "limited",
              "disabled",
              "unavailable",
            ] as const),
          ),
        })),
        limits: limits.rows.map((limit) => ({
          key: member(limit["limit_key"], COMMERCIAL_LIMIT_KEYS),
          scope: member(limit["limit_scope"], [
            "organization",
            "member",
            "project",
          ] as const),
          period: member(limit["period_kind"], COMMERCIAL_LIMIT_PERIOD_KINDS),
          value: unsigned(limit["limit_value"]),
        })),
      };
      validatePlanVersionV1(plan);
      const accountState = member(row["account_state"], [
        "active",
        "suspended",
        "closed",
      ] as const);
      const trial = planId === STAFF_TRIAL_PLAN_VERSION;
      if (trial && row["trial_current"] !== true)
        throw new ApplicationError(
          "access_denied",
          "Trial export access has expired or been revoked.",
        );
      const status = trial
        ? null
        : member(row["normalized_status"], [
            "pending",
            "active",
            "past-due",
            "paused",
            "canceled",
            "incomplete",
          ] as const);
      const active = status === "active";
      const accessActive = active || trial;
      if (!accessActive && this.inactivePolicy === undefined) {
        if (await creditsOnlyAccess(tx, scope.organizationId))
          creditsOnlyExportDenied();
        throw new ApplicationError(
          "service_unavailable",
          "The inactive-subscription export policy is unavailable.",
          {
            fieldIssues: [
              {
                code: "solution-export.inactive-subscription-policy-unavailable.v1",
                path: ["targetProfileId"],
                message:
                  "Export access after subscription changes is not configured.",
              },
            ],
          },
        );
      }
      const decisions = (
        ["zip-export", this.settings.target, "diagram-export"] as const
      ).map((feature) =>
        evaluateEntitlementV1({
          at: exportRunTimestamp(row["evaluated_at"]),
          organizationId: scope.organizationId,
          memberId: scope.principalId,
          projectId: authority.ownership.projectId,
          billingAccountId: exportRunText(row["billing_account_id"]),
          billingAccountRecordVersion: exportRunInteger(row["account_version"]),
          commercialState: accountState === "active" ? "active" : "unavailable",
          organizationStatus: "active",
          subscriptionProjectionVersion: trial
            ? null
            : exportRunInteger(row["subscription_version"]),
          subscriptionState: trial
            ? "not-required"
            : active
              ? "active"
              : "inactive",
          ...(trial
            ? {
                trialAccess: {
                  contractVersion: 1 as const,
                  trialId: exportRunText(row["trial_id"]),
                  policyVersion: STAFF_TRIAL_POLICY_VERSION,
                  startsAt: exportRunTimestamp(row["trial_starts_at"]),
                  expiresAt: exportRunTimestamp(row["trial_expires_at"]),
                  revoked: false,
                  superseded: false,
                },
              }
            : {}),
          ...(accessActive || this.inactivePolicy === undefined
            ? {}
            : { inactiveSubscriptionAccessPolicy: this.inactivePolicy }),
          expensiveOperationsEnabled:
            accountState === "active" &&
            accessActive &&
            boolean(row["account_expensive"]) &&
            boolean(row["snapshot_expensive"]),
          feature,
          operationKind: "data-export",
          plan,
          limitUsage: [],
          scopedLimitExtensions: [],
          targetRole: null,
          // Data-export decisions do not consume credits. Expensive stages remain the real root hook's responsibility.
          pricingAvailable: false,
          availableCreditUnits: 0,
          requestedCreditUnits: 0,
        }),
      );
      if (decisions.some((decision) => !decision.allowed))
        throw new ApplicationError(
          "access_denied",
          "This export is not available under the current plan.",
        );
      const required =
        input.binding.applicationCodeRequired &&
        input.applicationDelivery === undefined
          ? ["validation-jobs", "complete-application-generation"]
          : ["validation-jobs"];
      if (
        required.some(
          (feature) =>
            !plan.entitlements.some(
              (entry) => entry.feature === feature && entry.enabled,
            ),
        )
      )
        throw new ApplicationError(
          "access_denied",
          "The required export stages are not enabled by the current plan.",
        );
      if (
        accountState !== "active" ||
        !accessActive ||
        !boolean(row["account_expensive"]) ||
        !boolean(row["snapshot_expensive"])
      )
        throw new ApplicationError(
          "access_denied",
          "The required export execution stages are currently disabled.",
        );
      if (authority instanceof SolutionExportWorkerAuthority)
        await authority.authorize(tx);
      else await authority.currentAuthentication(tx);
      const decisionBindings = decisions.map(
        ({ evaluatedAt: _evaluatedAt, ...decision }) => {
          void _evaluatedAt;
          return decision;
        },
      );
      return {
        reference: `export-decision.${exportAdmissionHash({ contractVersion: 1, decisions: decisionBindings, snapshotId: row["entitlement_snapshot_id"], snapshotVersion: exportRunInteger(row["snapshot_version"]), policy: row["entitlement_policy_version"], required, ...(input.applicationDelivery === undefined ? {} : { applicationDelivery: input.applicationDelivery }), manifestDigest: input.binding.manifestDigest, environment: input.environment, targetSettings: this.settings.digest }).slice(7)}`,
        effectiveUntil: trial
          ? new Date(
              Math.min(
                Date.parse(exportRunTimestamp(row["trial_expires_at"])),
                plan.effectiveUntil === null
                  ? Infinity
                  : Date.parse(plan.effectiveUntil),
              ),
            ).toISOString()
          : plan.effectiveUntil,
      };
    });
    await authority.scope();
    const now =
      authority instanceof SolutionExportWorkerAuthority
        ? Date.now()
        : authority.clock().getTime();
    if (
      !Number.isFinite(now) ||
      (result.effectiveUntil !== null &&
        Date.parse(result.effectiveUntil) <= now)
    )
      exportRunUnavailable();
    return {
      entitlementDecisionReference: result.reference,
      targetSettings: structuredClone(this.settings),
    };
  }
}
