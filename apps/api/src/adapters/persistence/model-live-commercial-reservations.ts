import type {
  ModelCommercialAccountingPort,
  ModelCommercialVerifiedScopeV1,
} from "@cloudmarkup/model-gateway";
import {
  sha256DigestSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import { PostgresModelCommercialAccountingEngine } from "./model-commercial-accounting-engine.js";
import {
  modelAccountingBindingSchema,
  verifyModelAccountingCommonBinding,
} from "./model-commercial-accounting-codec.js";
import {
  MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
  modelLiveAccountingBindingSchema,
  verifyModelLiveAccountingRuntime,
  type ModelLiveAccountingBinding,
} from "./model-live-commercial-accounting-codec.js";
import {
  parseLiveRuntimeRecord,
  type LiveRuntimeAdmissionRecord,
} from "./model-live-runtime-admission-codec.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { parseWorkflowScope } from "./model-commercial-workflow-codec.js";
import type { SqlDatabase } from "./sql.js";

type LiveReservations = Pick<
  ModelCommercialAccountingPort,
  "reserve" | "recoverExistingReservation"
>;
export interface ModelLiveAccountingOptions {
  readonly database: SqlDatabase;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly binding: ModelLiveAccountingBinding;
  readonly plans: PostgresModelLiveEvaluationPlans;
  readonly definitionId: string;
  readonly planDigest: string;
}
export function createModelLiveAccountingEngine(
  input: ModelLiveAccountingOptions,
) {
  const scope = parseWorkflowScope(input.scope);
  const binding = modelLiveAccountingBindingSchema.parse(input.binding);
  const { routingDecision, ...metadata } = binding;
  void routingDecision;
  const commonBinding = modelAccountingBindingSchema.parse(metadata);
  const plans = input.plans;
  const identity = {
    definitionId: solutionStableIdSchema.parse(input.definitionId),
    planDigest: sha256DigestSchema.parse(input.planDigest),
  };
  return new PostgresModelCommercialAccountingEngine({
    database: input.database,
    scope,
    binding: commonBinding,
    liveBinding: binding,
    mapping: MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
    parseRuntime: parseLiveRuntimeRecord,
    verifyRuntime: verifyModelAccountingCommonBinding,
    authorityTransactions: {
      run: (work) =>
        plans.withIssuedMetadata(identity, (context) =>
          work(context.transaction, {
            requireCurrent: context.requireCurrentApproval,
            bind: (workflow, runtime) => {
              verifyModelLiveAccountingRuntime(
                workflow,
                runtime,
                binding,
                context.plan,
              );
            },
          }),
        ),
    },
  });
}
/** Joins an authenticated issued evaluation plan to the existing canonical
 * reservation algorithm. No settlement, credit grant or provider authority.
 * This historical wrapper retains its reservation-only surface. The explicit
 * V2 accounting adapter separately exposes authenticated failure recovery. */
export class PostgresModelLiveCommercialReservations implements LiveReservations {
  readonly #engine: PostgresModelCommercialAccountingEngine<LiveRuntimeAdmissionRecord>;
  constructor(input: ModelLiveAccountingOptions) {
    this.#engine = createModelLiveAccountingEngine(input);
  }

  reserve(
    input: Parameters<LiveReservations["reserve"]>[0],
  ): ReturnType<LiveReservations["reserve"]> {
    return this.#engine.reserve(input);
  }
  recoverExistingReservation(
    input: Parameters<LiveReservations["recoverExistingReservation"]>[0],
  ): ReturnType<LiveReservations["recoverExistingReservation"]> {
    return this.#engine.recoverExistingReservation(input);
  }
}
