import type {
  ModelLiveRuntimeAdmissionRequestV2,
  ModelLiveRuntimeAdmissionDecisionV2,
} from "@cloudmarkup/schemas";
import type {
  ModelRuntimeAdmissionClaimV1,
  ModelRuntimeAdmissionClaimResultV1,
  ModelRuntimeAdmissionStoreV1,
  ModelRuntimeAdmissionTerminalV1,
  ModelRuntimeLiveAuthorityReservationV1,
  ModelRuntimeStateSnapshotRequestV1,
} from "./model-runtime-controls.js";

/** Host-private evaluation metadata. These ports do not authenticate a plan,
 * reserve canonical credits, issue a report or activate a normal route. */
export interface ModelLiveRuntimeAdmissionTerminalV2 extends Omit<
  ModelRuntimeAdmissionTerminalV1,
  "admission"
> {
  readonly admission: ModelLiveRuntimeAdmissionDecisionV2;
}
export interface ModelLiveRuntimeStateSnapshotRequestV2 extends ModelRuntimeStateSnapshotRequestV1 {
  readonly liveAuthorityReservation: ModelRuntimeLiveAuthorityReservationV1;
}
export interface ModelLiveRuntimeAdmissionClaimV2 extends Omit<
  ModelRuntimeAdmissionClaimV1,
  "admissionDecision" | "admissionRequest" | "deniedTerminal"
> {
  readonly admissionDecision: ModelLiveRuntimeAdmissionDecisionV2;
  readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
  readonly deniedTerminal?: ModelLiveRuntimeAdmissionTerminalV2;
  readonly liveAuthorityReservation: ModelRuntimeLiveAuthorityReservationV1;
}
export type ModelLiveRuntimeAdmissionClaimResultV2 =
  | (Omit<
      Extract<ModelRuntimeAdmissionClaimResultV1, { kind: "claimed" }>,
      "admissionDecision" | "pending"
    > & {
      readonly admissionDecision: ModelLiveRuntimeAdmissionDecisionV2;
      readonly pending: ModelLiveRuntimeAdmissionTerminalV2 | null;
    })
  | (Omit<
      Extract<ModelRuntimeAdmissionClaimResultV1, { kind: "denied" }>,
      "terminal"
    > & {
      readonly terminal: ModelLiveRuntimeAdmissionTerminalV2;
    })
  | {
      readonly kind: "duplicate-terminal";
      readonly terminal: ModelLiveRuntimeAdmissionTerminalV2;
    }
  | Exclude<
      ModelRuntimeAdmissionClaimResultV1,
      { kind: "claimed" | "denied" | "duplicate-terminal" }
    >;

type InputOf<K extends keyof ModelRuntimeAdmissionStoreV1> = Parameters<
  ModelRuntimeAdmissionStoreV1[K]
>[0];
type EvaluationBinding<T> = Omit<
  T,
  "admissionDecision" | "admissionRequest"
> & {
  readonly admissionDecision: ModelLiveRuntimeAdmissionDecisionV2;
  readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
};
export interface ModelLiveRuntimeAdmissionStoreV2 extends Omit<
  ModelRuntimeAdmissionStoreV1,
  | "inspect"
  | "claim"
  | "checkpointPendingAndRelease"
  | "completeAndRelease"
  | "readOperationalExecutionBinding"
  | "appendOperationalOutbox"
> {
  inspect(
    request: ModelLiveRuntimeStateSnapshotRequestV2,
  ): ReturnType<ModelRuntimeAdmissionStoreV1["inspect"]>;
  claim(
    claim: ModelLiveRuntimeAdmissionClaimV2,
  ): Promise<ModelLiveRuntimeAdmissionClaimResultV2>;
  checkpointPendingAndRelease(
    input: Omit<InputOf<"checkpointPendingAndRelease">, "pending"> & {
      readonly pending: ModelLiveRuntimeAdmissionTerminalV2;
    },
  ): Promise<void>;
  completeAndRelease(
    input: Omit<InputOf<"completeAndRelease">, "terminal"> & {
      readonly terminal: ModelLiveRuntimeAdmissionTerminalV2;
    },
  ): Promise<void>;
  readOperationalExecutionBinding(
    input: EvaluationBinding<InputOf<"readOperationalExecutionBinding">>,
  ): ReturnType<
    ModelRuntimeAdmissionStoreV1["readOperationalExecutionBinding"]
  >;
  appendOperationalOutbox(
    input: EvaluationBinding<InputOf<"appendOperationalOutbox">>,
  ): Promise<void>;
}
