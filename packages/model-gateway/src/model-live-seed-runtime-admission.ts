import type {
  ModelLiveSequenceRuntimeAdmissionRequestV3,
  ModelLiveSequenceRuntimeAdmissionRequestV4,
  ModelLiveSequenceRuntimeAdmissionDecisionV4,
  ModelLiveSequenceRuntimeAdmissionDecisionV3,
} from "@cloudmarkup/schemas";
import type {
  ModelRuntimeAdmissionClaimV1,
  ModelRuntimeAdmissionClaimResultV1,
  ModelRuntimeAdmissionStoreV1,
  ModelRuntimeAdmissionTerminalV1,
  ModelRuntimeLiveAuthorityReservationV1,
  ModelRuntimeStateSnapshotRequestV1,
} from "./model-runtime-controls.js";

/** Host-private first-seed V3 runtime metadata. These ports do not authenticate a plan,
 * reserve canonical credits, issue a report or activate a normal route. */
export interface ModelLiveSeedRuntimeAdmissionTerminalV3 extends Omit<
  ModelRuntimeAdmissionTerminalV1,
  "admission"
> {
  readonly admission: ModelLiveSequenceRuntimeAdmissionDecisionV3;
}
export interface ModelLiveSeedRuntimeStateSnapshotRequestV3 extends ModelRuntimeStateSnapshotRequestV1 {
  readonly liveAuthorityReservation: ModelRuntimeLiveAuthorityReservationV1;
}
export interface ModelLiveSeedRuntimeAdmissionClaimV3 extends Omit<
  ModelRuntimeAdmissionClaimV1,
  "admissionDecision" | "admissionRequest" | "deniedTerminal"
> {
  readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV3;
  readonly admissionRequest: ModelLiveSequenceRuntimeAdmissionRequestV3;
  readonly deniedTerminal?: ModelLiveSeedRuntimeAdmissionTerminalV3;
  readonly liveAuthorityReservation: ModelRuntimeLiveAuthorityReservationV1;
}
export type ModelLiveSeedRuntimeAdmissionClaimResultV3 =
  | (Omit<
      Extract<ModelRuntimeAdmissionClaimResultV1, { kind: "claimed" }>,
      "admissionDecision" | "pending"
    > & {
      readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV3;
      readonly pending: ModelLiveSeedRuntimeAdmissionTerminalV3 | null;
    })
  | (Omit<
      Extract<ModelRuntimeAdmissionClaimResultV1, { kind: "denied" }>,
      "terminal"
    > & {
      readonly terminal: ModelLiveSeedRuntimeAdmissionTerminalV3;
    })
  | {
      readonly kind: "duplicate-terminal";
      readonly terminal: ModelLiveSeedRuntimeAdmissionTerminalV3;
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
  readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV3;
  readonly admissionRequest: ModelLiveSequenceRuntimeAdmissionRequestV3;
};
export interface ModelLiveSeedRuntimeAdmissionStoreV3 extends Omit<
  ModelRuntimeAdmissionStoreV1,
  | "inspect"
  | "claim"
  | "checkpointPendingAndRelease"
  | "completeAndRelease"
  | "readOperationalExecutionBinding"
  | "appendOperationalOutbox"
> {
  inspect(
    request: ModelLiveSeedRuntimeStateSnapshotRequestV3,
  ): ReturnType<ModelRuntimeAdmissionStoreV1["inspect"]>;
  claim(
    claim: ModelLiveSeedRuntimeAdmissionClaimV3,
  ): Promise<ModelLiveSeedRuntimeAdmissionClaimResultV3>;
  checkpointPendingAndRelease(
    input: Omit<InputOf<"checkpointPendingAndRelease">, "pending"> & {
      readonly pending: ModelLiveSeedRuntimeAdmissionTerminalV3;
    },
  ): Promise<void>;
  completeAndRelease(
    input: Omit<InputOf<"completeAndRelease">, "terminal"> & {
      readonly terminal: ModelLiveSeedRuntimeAdmissionTerminalV3;
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

/** Two-slot successor ports. State and lease mechanics retain their V1 shape;
 * request/decision/terminal metadata is explicitly V4. */
export interface ModelLiveSeedRuntimeAdmissionTerminalV4 extends Omit<
  ModelLiveSeedRuntimeAdmissionTerminalV3,
  "admission"
> {
  readonly admission: ModelLiveSequenceRuntimeAdmissionDecisionV4;
}
export interface ModelLiveSeedRuntimeAdmissionClaimV4 extends Omit<
  ModelLiveSeedRuntimeAdmissionClaimV3,
  "admissionDecision" | "admissionRequest" | "deniedTerminal"
> {
  readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV4;
  readonly admissionRequest: ModelLiveSequenceRuntimeAdmissionRequestV4;
  readonly deniedTerminal?: ModelLiveSeedRuntimeAdmissionTerminalV4;
}
type SequenceClaimResultV4<Result> = Result extends { readonly kind: "claimed" }
  ? Omit<Result, "admissionDecision" | "pending"> & {
      readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV4;
      readonly pending: ModelLiveSeedRuntimeAdmissionTerminalV4 | null;
    }
  : Result extends { readonly kind: "denied" | "duplicate-terminal" }
    ? Omit<Result, "terminal"> & {
        readonly terminal: ModelLiveSeedRuntimeAdmissionTerminalV4;
      }
    : Result;
export type ModelLiveSeedRuntimeAdmissionClaimResultV4 =
  SequenceClaimResultV4<ModelLiveSeedRuntimeAdmissionClaimResultV3>;
type SequenceEvaluationBindingV4<T> = Omit<
  T,
  "admissionDecision" | "admissionRequest"
> & {
  readonly admissionDecision: ModelLiveSequenceRuntimeAdmissionDecisionV4;
  readonly admissionRequest: ModelLiveSequenceRuntimeAdmissionRequestV4;
};
export interface ModelLiveSeedRuntimeAdmissionStoreV4 extends Omit<
  ModelLiveSeedRuntimeAdmissionStoreV3,
  | "claim"
  | "checkpointPendingAndRelease"
  | "completeAndRelease"
  | "readOperationalExecutionBinding"
  | "appendOperationalOutbox"
> {
  claim(
    claim: ModelLiveSeedRuntimeAdmissionClaimV4,
  ): Promise<ModelLiveSeedRuntimeAdmissionClaimResultV4>;
  checkpointPendingAndRelease(
    input: Omit<InputOf<"checkpointPendingAndRelease">, "pending"> & {
      readonly pending: ModelLiveSeedRuntimeAdmissionTerminalV4;
    },
  ): Promise<void>;
  completeAndRelease(
    input: Omit<InputOf<"completeAndRelease">, "terminal"> & {
      readonly terminal: ModelLiveSeedRuntimeAdmissionTerminalV4;
    },
  ): Promise<void>;
  readOperationalExecutionBinding(
    input: SequenceEvaluationBindingV4<
      InputOf<"readOperationalExecutionBinding">
    >,
  ): ReturnType<
    ModelRuntimeAdmissionStoreV1["readOperationalExecutionBinding"]
  >;
  appendOperationalOutbox(
    input: SequenceEvaluationBindingV4<InputOf<"appendOperationalOutbox">>,
  ): Promise<void>;
}
