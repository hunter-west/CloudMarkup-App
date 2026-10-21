import {
  digestStructuredValue,
  type ModelLiveRuntimeAdmissionStoreV2,
  type ModelLiveRuntimeAdmissionTerminalV2,
  type ModelRuntimeStateSnapshotRequestV1,
} from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveRuntimeAdmissionRequestV2,
  type ModelLiveRuntimeAdmissionDecisionV2,
} from "@cloudmarkup/schemas";
import {
  admissionAssert,
  admissionScopeSchema,
  type RuntimeAdmissionScope,
} from "./model-runtime-admission-codec.js";
import {
  parseLiveRuntimeClaim,
  parseLiveRuntimeRecord,
  parseLiveRuntimeStateRequest,
  parseLiveRuntimeTerminal,
} from "./model-live-runtime-admission-codec.js";
import {
  PostgresRuntimeAdmissionEngine,
  type RuntimeAdmissionTransactionPort,
} from "./model-runtime-admission-engine.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { sql, type SqlDatabase } from "./sql.js";
const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);

function bindState(
  plan: ModelLiveEvaluationPlanV2,
  input: ModelRuntimeStateSnapshotRequestV1,
) {
  const { scope, policy, limits } = plan.definition;
  admissionAssert(
    input.organizationId === scope.organizationId &&
      input.projectId === scope.projectId &&
      input.userId === scope.userId &&
      input.runtimePolicyDigest === policy.policyDigest &&
      input.organizationWindowSeconds ===
        policy.requestWindows.organization.windowSeconds &&
      input.userWindowSeconds === policy.requestWindows.user.windowSeconds &&
      input.liveAuthorityReservation?.authorityDigest ===
        plan.approval.approvalDigest &&
      same(input.liveAuthorityReservation.limits, limits),
  );
}
function bindRequest(
  plan: ModelLiveEvaluationPlanV2,
  request: ModelLiveRuntimeAdmissionRequestV2,
) {
  const { scope, policy } = plan.definition;
  const binding = plan.definition.cases.find(
    (item) => item.caseId === request.evaluationCaseId,
  );
  admissionAssert(binding !== undefined);
  const tuple = binding.authorityBinding.authorityTuple;
  admissionAssert(
    request.liveEvaluationPlanDigest === plan.planDigest &&
      request.liveEvaluationAuthorityDigest === plan.approval.approvalDigest &&
      request.organizationId === scope.organizationId &&
      request.projectId === scope.projectId &&
      request.userId === scope.userId &&
      request.plan === scope.plan &&
      request.runtimePolicyDigest === policy.policyDigest &&
      same(request.cacheKeyAuthority, policy.cacheKeyAuthority) &&
      request.evaluationCaseDigest === binding.caseDigest &&
      request.inputDigest === binding.invocationInputDigest &&
      request.evaluationAuthorityTupleDigest ===
        binding.authorityBinding.authorityTupleDigest &&
      request.capabilityRegistryDigest === tuple.capabilityRegistryDigest &&
      request.routeRegistryDigest === tuple.routeRegistryDigest &&
      request.catalogDigest === tuple.catalogDigest &&
      request.operation === tuple.operation &&
      request.role === tuple.role &&
      request.promptTemplateDigest === tuple.promptTemplateDigest &&
      request.responseSchemaDigest === tuple.responseSchemaDigest,
  );
}

/** Evaluation-only, scoped to one actual issued plan. New admission and usable
 * execution leases require current approval in the same organization transaction.
 * Exact recovery is fenced and consumes no new cumulative evaluation capacity.
 * This store cannot authenticate input/output evidence, reserve credits or invoke AI. */
export class PostgresModelLiveRuntimeAdmissionStore
  extends PostgresRuntimeAdmissionEngine<
    ModelLiveRuntimeAdmissionRequestV2,
    ModelLiveRuntimeAdmissionDecisionV2,
    ModelLiveRuntimeAdmissionTerminalV2
  >
  implements ModelLiveRuntimeAdmissionStoreV2
{
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: RuntimeAdmissionScope;
    readonly plans: PostgresModelLiveEvaluationPlans;
    readonly definitionId: string;
    readonly planDigest: string;
  }) {
    const scope = admissionScopeSchema.parse(input.scope);
    const plans = input.plans;
    const identity = {
      definitionId: solutionStableIdSchema.parse(input.definitionId),
      planDigest: sha256DigestSchema.parse(input.planDigest),
    };
    const authorityTransactions: RuntimeAdmissionTransactionPort<
      ModelLiveRuntimeAdmissionRequestV2,
      ModelLiveRuntimeAdmissionDecisionV2,
      ModelLiveRuntimeAdmissionTerminalV2
    > = {
      run: (work) =>
        plans.withIssuedMetadata(identity, async (context) => {
          const plan = context.plan;
          admissionAssert(
            plan.definition.scope.organizationId === scope.organizationId &&
              plan.definition.scope.projectId === scope.projectId &&
              plan.definition.scope.userId === scope.userId,
          );
          const time = await context.transaction.query(
            sql(
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
            ),
          );
          const now = utcTimestampSchema.parse(time.rows[0]?.["now"]);
          return work(context.transaction, now, {
            requireCurrent: context.requireCurrentApproval,
            bindState: (state) => {
              bindState(plan, state);
            },
            bindClaim: (claim) => {
              bindState(plan, claim);
              bindRequest(plan, claim.admissionRequest);
              const { requestWindows } = plan.definition.policy;
              admissionAssert(
                same(claim.limits, {
                  maximumConcurrentOrganizationJobs:
                    requestWindows.organization.maximumConcurrentJobs,
                  maximumConcurrentUserJobs:
                    requestWindows.user.maximumConcurrentJobs,
                  maximumOrganizationRequests:
                    requestWindows.organization.maximumRequests,
                  maximumUserRequests: requestWindows.user.maximumRequests,
                }) &&
                  Date.parse(claim.commercialExpiresAt) <=
                    Date.parse(plan.expiresAt) &&
                  (claim.admissionDecision.expiresAt === undefined ||
                    Date.parse(claim.admissionDecision.expiresAt) <=
                      Date.parse(plan.expiresAt)) &&
                  Date.parse(claim.admissionDecision.decidedAt) <=
                    Date.parse(claim.decidedAt),
              );
            },
          });
        }),
    };
    super({
      database: input.database,
      scope,
      authorityTransactions,
      codec: {
        version: 2,
        parseState: parseLiveRuntimeStateRequest,
        parseTerminal: parseLiveRuntimeTerminal,
        parseClaim: (value, expectedScope) => {
          const claim = parseLiveRuntimeClaim(value, expectedScope);
          admissionAssert(
            claim.admissionRequest.liveEvaluationPlanDigest ===
              identity.planDigest,
          );
          return claim;
        },
        parseRecord: (value, expectedScope) => {
          const record = parseLiveRuntimeRecord(value, expectedScope);
          admissionAssert(
            record.request.liveEvaluationPlanDigest === identity.planDigest,
          );
          return record;
        },
      },
    });
  }
}
