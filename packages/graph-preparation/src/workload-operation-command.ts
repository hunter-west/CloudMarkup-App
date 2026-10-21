import {
  applyGraphCommand,
  getApplicationContractRecordContentHash,
  getArchitectureDocumentHashes,
  hashCanonicalValue,
  type ArchitectureDocument,
  type ArchitectureDocumentHashes,
} from "@cloudmarkup/domain";
import {
  applicationContractRecordV1Schema,
  applicationContractsV1Schema,
  contractFieldNameSchema,
  normalizeApplicationContractsV1,
  normalizeWorkloadBehaviorV2,
  parseGraphCommandV1,
  workloadBehaviorV2Schema,
  workloadOperationV1Schema,
  type WorkloadV2,
  type ApplicationContractRecordV1,
  type ReplaceWorkloadAndApplicationContractsCommandV1,
} from "@cloudmarkup/schemas";

const MAX_FIELD_LINES = 32;
const MAX_FIELD_TEXT_LENGTH = 4_096;
const MAX_PURPOSE_LENGTH = 8_000;
const NEWLINE = String.fromCharCode(10);
const WINDOWS_NEWLINE = String.fromCharCode(13, 10);
const CREDENTIAL_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /AKIA[A-Z0-9]{16}/u,
  /Bearer +[^ ]{8,}/iu,
  /(?:api(?:-|_| )?key|credential|password|private(?:-|_| )?key|secret|token) *[:=] *[^ ]{4,}/iu,
] as const;
const EDITOR_CONTRACT_OWNER_REFERENCE_IDS = {
  behavior: "cloudmarkup.editor.workload-operation.behavior.v1",
  input: "cloudmarkup.editor.workload-operation.input.v1",
  output: "cloudmarkup.editor.workload-operation.output.v1",
} as const;
type EditorContractRole = keyof typeof EDITOR_CONTRACT_OWNER_REFERENCE_IDS;
type ContractScalarTypeV1 =
  | "binary-reference"
  | "boolean"
  | "date"
  | "integer"
  | "number"
  | "string"
  | "timestamp"
  | "uuid";
const SCALAR_TYPES = new Set<ContractScalarTypeV1>([
  "binary-reference",
  "boolean",
  "date",
  "integer",
  "number",
  "string",
  "timestamp",
  "uuid",
]);
const CLASSIFICATIONS = new Set([
  "confidential",
  "internal",
  "public",
  "regulated",
  "restricted",
] as const);

type FieldClassification =
  "confidential" | "internal" | "public" | "regulated" | "restricted";

export interface WorkloadOperationDraft {
  readonly description: string;
  readonly displayName: string;
  readonly inputFields: string;
  readonly outputFields: string;
}

export interface WorkloadOperationFieldDraft {
  readonly classification: FieldClassification;
  readonly name: string;
  readonly required: boolean;
  readonly scalarType: ContractScalarTypeV1;
}

export interface PreparedWorkloadOperationCommand {
  readonly command: ReplaceWorkloadAndApplicationContractsCommandV1;
  readonly inputFieldCount: number;
  readonly operationId: string;
  readonly outputFieldCount: number;
  readonly previewDocument: ArchitectureDocument;
  readonly previewHashes: ArchitectureDocumentHashes;
  readonly workloadId: string;
}

export type WorkloadOperationDraftResolution =
  | {
      readonly draft: WorkloadOperationDraft;
      readonly editable: true;
    }
  | {
      readonly editable: false;
      readonly reason: string;
    };

export type WorkloadOperationPreparationIssueCode =
  | "credential-value-forbidden"
  | "duplicate-field"
  | "existing-contract-not-editable"
  | "field-count-exceeded"
  | "field-syntax-invalid"
  | "invalid-text"
  | "operation-unavailable"
  | "purpose-required"
  | "workload-unavailable";

export interface WorkloadOperationPreparationIssue {
  readonly code: WorkloadOperationPreparationIssueCode;
  readonly message: string;
  readonly path: string;
}

export class WorkloadOperationPreparationError extends Error {
  public readonly issues: readonly WorkloadOperationPreparationIssue[];

  public constructor(issues: readonly WorkloadOperationPreparationIssue[]) {
    super(
      issues[0]?.message ??
        "The workload operation could not be prepared safely.",
    );
    this.issues = Object.freeze([...issues]);
    this.name = "WorkloadOperationPreparationError";
  }
}

function fail(
  code: WorkloadOperationPreparationIssueCode,
  message: string,
  path: string,
): never {
  throw new WorkloadOperationPreparationError([{ code, message, path }]);
}

function requireSafeText(
  value: string,
  path: string,
  maximumLength: number,
): string {
  const normalized = value.replaceAll(WINDOWS_NEWLINE, NEWLINE).trim();
  if (
    normalized.length > maximumLength ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint <= 9 ||
        (codePoint >= 11 && codePoint <= 31) ||
        (codePoint >= 127 && codePoint <= 159) ||
        (codePoint >= 8_234 && codePoint <= 8_238) ||
        (codePoint >= 8_294 && codePoint <= 8_297)
      );
    })
  ) {
    return fail(
      "invalid-text",
      "Use bounded plain text without control or bidirectional formatting characters.",
      path,
    );
  }
  if (CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return fail(
      "credential-value-forbidden",
      "Credential or secret values are not accepted. Describe the behavior without sensitive values.",
      path,
    );
  }
  return normalized;
}

function parseFieldLines(
  value: string,
  path: "$.inputFields" | "$.outputFields",
): readonly WorkloadOperationFieldDraft[] {
  const normalized = requireSafeText(value, path, MAX_FIELD_TEXT_LENGTH);
  if (normalized === "") {
    return [];
  }
  const lines = normalized
    .split(NEWLINE)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length > MAX_FIELD_LINES) {
    return fail(
      "field-count-exceeded",
      `Declare no more than ${String(MAX_FIELD_LINES)} fields per contract.`,
      path,
    );
  }

  const seen = new Set<string>();
  return lines.map((line, index) => {
    const parts = line.split(":").map((part) => part.trim());
    const [name, scalarType, classification, requirement, ...extra] = parts;
    if (
      name === undefined ||
      scalarType === undefined ||
      classification === undefined ||
      requirement === undefined ||
      extra.length > 0 ||
      !contractFieldNameSchema.safeParse(name).success ||
      !SCALAR_TYPES.has(scalarType as ContractScalarTypeV1) ||
      !CLASSIFICATIONS.has(classification as FieldClassification) ||
      (requirement !== "required" && requirement !== "optional")
    ) {
      return fail(
        "field-syntax-invalid",
        "Use one field per line: name:type:classification:required|optional. Values and executable syntax are not accepted.",
        `${path}[${String(index)}]`,
      );
    }
    if (seen.has(name)) {
      return fail(
        "duplicate-field",
        "Field names must be unique within each input or output contract.",
        `${path}[${String(index)}]`,
      );
    }
    seen.add(name);
    return {
      classification: classification as FieldClassification,
      name,
      required: requirement === "required",
      scalarType: scalarType as ContractScalarTypeV1,
    };
  });
}

function contractIds(workloadId: string, operationId: string) {
  const scopeDigest = hashCanonicalValue({
    namespace: "cloudmarkup.user.workload-operation-contract",
    operationId,
    workloadId,
  }).slice("sha256:".length);
  const base = `cloudmarkup.user.workload-operation-${scopeDigest}`;
  return {
    behavior: `${base}.behavior`,
    input: `${base}.input`,
    output: `${base}.output`,
  } as const;
}

type WorkloadOperationContractIds = ReturnType<typeof contractIds>;

function editorContractSourceReferenceIds(
  role: EditorContractRole,
  workloadId: string,
  operationId: string,
): readonly string[] {
  return [EDITOR_CONTRACT_OWNER_REFERENCE_IDS[role], workloadId, operationId];
}

function managedContractRole(
  contractId: string,
  ids: WorkloadOperationContractIds,
): EditorContractRole | null {
  if (contractId === ids.behavior) {
    return "behavior";
  }
  if (contractId === ids.input) {
    return "input";
  }
  if (contractId === ids.output) {
    return "output";
  }
  return null;
}

function hasExactSourceReferences(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const actualReferences = new Set(actual);
  return (
    actualReferences.size === expected.length &&
    expected.every((reference) => actualReferences.has(reference))
  );
}

function isEditorOwnedManagedContract(
  contract: ApplicationContractRecordV1,
  role: EditorContractRole,
  workloadId: string,
  operationId: string,
): boolean {
  const expectedKind =
    role === "behavior" ? "behavior-operation" : "data-entity";
  return (
    contract.contractKind === expectedKind &&
    contract.contractVersion === "1.0.0" &&
    contract.provenance.source === "designed" &&
    hasExactSourceReferences(
      contract.provenance.sourceReferenceIds,
      editorContractSourceReferenceIds(role, workloadId, operationId),
    )
  );
}

function hasUnsafeManagedContractCollision(
  contracts: readonly ApplicationContractRecordV1[],
  ids: WorkloadOperationContractIds,
  workloadId: string,
  operationId: string,
): boolean {
  return contracts.some((contract) => {
    const role = managedContractRole(contract.contractId, ids);
    return (
      role !== null &&
      !isEditorOwnedManagedContract(contract, role, workloadId, operationId)
    );
  });
}

function contractReference(contract: ApplicationContractRecordV1) {
  return {
    contractId: contract.contractId,
    contractKind: contract.contractKind,
    contractVersion: contract.contractVersion,
    digest: getApplicationContractRecordContentHash(contract),
  } as const;
}

function formatFields(
  contract: Extract<
    ApplicationContractRecordV1,
    { contractKind: "data-entity" }
  >,
): string | null {
  const lines: string[] = [];
  for (const field of contract.fields) {
    if (field.fieldType.kind !== "scalar") {
      return null;
    }
    lines.push(
      `${field.name}:${field.fieldType.scalarType}:${field.classification}:${field.required ? "required" : "optional"}`,
    );
  }
  return lines.join(NEWLINE);
}

/** An infrastructure-only workload may record intent without declaring executable code. */
export function defaultPurposeOperationId(workload: WorkloadV2): string {
  return "purpose_" + workload.owningNodeId;
}
function editableOperation(
  workload: WorkloadV2 | undefined,
  operationId: string,
) {
  const operation = workload?.operations.find(
    (candidate) => candidate.id === operationId,
  );
  if (operation) return operation;
  if (
    workload?.implementation.mode === "infrastructure-only" &&
    workload.operations.length === 0 &&
    operationId === defaultPurposeOperationId(workload)
  )
    return workloadOperationV1Schema.parse({
      id: operationId,
      capability: "cloudmarkup.application.describe-purpose",
      inputContract: { kind: "none" },
      outputContract: { kind: "none" },
    });
  return undefined;
}

export function resolveWorkloadOperationDraft(input: {
  readonly document: ArchitectureDocument;
  readonly fallbackDisplayName: string;
  readonly operationId: string;
  readonly workloadId: string;
}): WorkloadOperationDraftResolution {
  const workload = input.document.workloadBehavior.workloads.find(
    (candidate) => candidate.id === input.workloadId,
  );
  const operation = editableOperation(workload, input.operationId);
  if (workload === undefined || operation === undefined) {
    return {
      editable: false,
      reason: "The selected workload operation is no longer available.",
    };
  }
  const ids = contractIds(workload.id, operation.id);
  if (
    hasUnsafeManagedContractCollision(
      input.document.applicationContracts.contracts,
      ids,
      workload.id,
      operation.id,
    )
  ) {
    return {
      editable: false,
      reason:
        "A reserved compact-editor contract identity is already owned by another source. Review that contract in the architecture source before changing it.",
    };
  }

  const referencedContracts = workload.behaviorContracts.flatMap((reference) =>
    input.document.applicationContracts.contracts.filter(
      (
        contract,
      ): contract is Extract<
        ApplicationContractRecordV1,
        { contractKind: "behavior-operation" }
      > =>
        contract.contractKind === "behavior-operation" &&
        contract.contractId === reference.contractId &&
        contract.contractVersion === reference.contractVersion &&
        contract.capability === operation.capability,
    ),
  );
  const foreignContract = referencedContracts.find(
    (contract) => contract.contractId !== ids.behavior,
  );
  if (foreignContract !== undefined) {
    return {
      editable: false,
      reason:
        "This operation uses an independently owned Application Contract. Review that contract in the architecture source before changing it.",
    };
  }
  const behaviorContract = referencedContracts.find(
    (contract) => contract.contractId === ids.behavior,
  );
  if (behaviorContract === undefined) {
    return {
      draft: {
        description: "",
        displayName: input.fallbackDisplayName,
        inputFields: "",
        outputFields: "",
      },
      editable: true,
    };
  }
  const fieldsFor = (io: typeof behaviorContract.input): string | null => {
    if (io.kind === "none") {
      return "";
    }
    if (io.reference.contractKind !== "data-entity") {
      return null;
    }
    const contract = input.document.applicationContracts.contracts.find(
      (
        candidate,
      ): candidate is Extract<
        ApplicationContractRecordV1,
        { contractKind: "data-entity" }
      > =>
        candidate.contractKind === "data-entity" &&
        candidate.contractId === io.reference.contractId &&
        candidate.contractVersion === io.reference.contractVersion,
    );
    return contract === undefined ? null : formatFields(contract);
  };
  const inputFields = fieldsFor(behaviorContract.input);
  const outputFields = fieldsFor(behaviorContract.output);
  if (inputFields === null || outputFields === null) {
    return {
      editable: false,
      reason:
        "This operation uses nested or non-entity contracts that the compact field editor cannot represent safely.",
    };
  }
  return {
    draft: {
      description: behaviorContract.description ?? "",
      displayName: behaviorContract.displayName,
      inputFields,
      outputFields,
    },
    editable: true,
  };
}

function dataEntityContract(
  contractId: string,
  displayName: string,
  semanticName: string,
  fields: readonly WorkloadOperationFieldDraft[],
  document: ArchitectureDocument,
  sourceReferenceIds: readonly string[],
): ApplicationContractRecordV1 {
  return applicationContractRecordV1Schema.parse({
    contractKind: "data-entity",
    contractId,
    contractVersion: "1.0.0",
    displayName,
    provenance: {
      source: "designed",
      sourceReferenceIds,
      recordedAt: document.revision.createdAt,
      recordedBy: document.revision.createdBy,
    },
    semanticName,
    storageIntent: "transient",
    fields: fields.map((field) => ({
      name: field.name,
      fieldType: { kind: "scalar", scalarType: field.scalarType },
      required: field.required,
      nullable: false,
      classification: field.classification,
    })),
    indexes: [],
    supportedOperations: [],
  });
}

export function prepareWorkloadOperationCommand(input: {
  readonly commandId: string;
  readonly document: ArchitectureDocument;
  readonly draft: WorkloadOperationDraft;
  readonly inverseCommandId: string;
  readonly operationId: string;
  readonly workloadId: string;
}): PreparedWorkloadOperationCommand {
  const workload = input.document.workloadBehavior.workloads.find(
    (candidate) => candidate.id === input.workloadId,
  );
  if (workload === undefined) {
    return fail(
      "workload-unavailable",
      "The selected workload is no longer available.",
      "$.workloadId",
    );
  }
  const operation = editableOperation(workload, input.operationId);
  if (operation === undefined) {
    return fail(
      "operation-unavailable",
      "The selected operation is no longer available.",
      "$.operationId",
    );
  }

  const displayName = requireSafeText(
    input.draft.displayName,
    "$.displayName",
    512,
  );
  const description = requireSafeText(
    input.draft.description,
    "$.description",
    MAX_PURPOSE_LENGTH,
  );
  if (displayName === "" || description === "") {
    return fail(
      "purpose-required",
      "Provide a short operation name and a plain-language purpose before previewing.",
      displayName === "" ? "$.displayName" : "$.description",
    );
  }

  const inputFields = parseFieldLines(input.draft.inputFields, "$.inputFields");
  const outputFields = parseFieldLines(
    input.draft.outputFields,
    "$.outputFields",
  );
  const ids = contractIds(workload.id, operation.id);
  if (
    hasUnsafeManagedContractCollision(
      input.document.applicationContracts.contracts,
      ids,
      workload.id,
      operation.id,
    )
  ) {
    return fail(
      "existing-contract-not-editable",
      "A reserved compact-editor contract identity is already owned by another source. Review that contract instead of replacing it here.",
      "$.applicationContracts",
    );
  }

  const managedIds: ReadonlySet<string> = new Set<string>([
    ids.behavior,
    ids.input,
    ids.output,
  ]);
  const referencedBehaviorContracts = workload.behaviorContracts.flatMap(
    (reference) =>
      input.document.applicationContracts.contracts.filter(
        (contract) =>
          contract.contractKind === "behavior-operation" &&
          contract.contractId === reference.contractId &&
          contract.contractVersion === reference.contractVersion &&
          contract.capability === operation.capability,
      ),
  );
  if (
    referencedBehaviorContracts.some(
      (contract) => contract.contractId !== ids.behavior,
    )
  ) {
    return fail(
      "existing-contract-not-editable",
      "This operation already uses an independently owned Application Contract. Review that contract instead of replacing it here.",
      "$.applicationContracts",
    );
  }

  const inputContract =
    inputFields.length === 0
      ? null
      : dataEntityContract(
          ids.input,
          `${displayName} input`,
          `${ids.input}.entity`,
          inputFields,
          input.document,
          editorContractSourceReferenceIds("input", workload.id, operation.id),
        );
  const outputContract =
    outputFields.length === 0
      ? null
      : dataEntityContract(
          ids.output,
          `${displayName} output`,
          `${ids.output}.entity`,
          outputFields,
          input.document,
          editorContractSourceReferenceIds("output", workload.id, operation.id),
        );
  const inputReference =
    inputContract === null ? null : contractReference(inputContract);
  const outputReference =
    outputContract === null ? null : contractReference(outputContract);
  const behaviorContract = applicationContractRecordV1Schema.parse({
    contractKind: "behavior-operation",
    contractId: ids.behavior,
    contractVersion: "1.0.0",
    displayName,
    description,
    provenance: {
      source: "designed",
      sourceReferenceIds: editorContractSourceReferenceIds(
        "behavior",
        workload.id,
        operation.id,
      ),
      recordedAt: input.document.revision.createdAt,
      recordedBy: input.document.revision.createdBy,
    },
    capability: operation.capability,
    input:
      inputReference === null
        ? { kind: "none" }
        : { kind: "contract-reference", reference: inputReference },
    output:
      outputReference === null
        ? { kind: "none" }
        : { kind: "contract-reference", reference: outputReference },
    failureOutcomes: [],
  });
  const behaviorReference = contractReference(behaviorContract);
  const nextContracts = [
    ...input.document.applicationContracts.contracts.filter(
      (contract) => !managedIds.has(contract.contractId),
    ),
    ...(inputContract === null ? [] : [inputContract]),
    ...(outputContract === null ? [] : [outputContract]),
    behaviorContract,
  ];
  const applicationContracts = normalizeApplicationContractsV1(
    applicationContractsV1Schema.parse({
      ...input.document.applicationContracts,
      contracts: nextContracts,
    }),
  );
  const workloadBehavior = normalizeWorkloadBehaviorV2(
    workloadBehaviorV2Schema.parse({
      ...input.document.workloadBehavior,
      workloads: input.document.workloadBehavior.workloads.map((candidate) =>
        candidate.id !== workload.id
          ? candidate
          : {
              ...candidate,
              operations: (candidate.operations.length === 0
                ? [operation]
                : candidate.operations
              ).map((candidateOperation) =>
                candidateOperation.id !== operation.id
                  ? candidateOperation
                  : {
                      ...candidateOperation,
                      inputContract:
                        inputReference === null
                          ? { kind: "none" }
                          : {
                              kind: "contract-reference",
                              reference: {
                                contractId: inputReference.contractId,
                                contractVersion: inputReference.contractVersion,
                                digest: inputReference.digest,
                              },
                            },
                      outputContract:
                        outputReference === null
                          ? { kind: "none" }
                          : {
                              kind: "contract-reference",
                              reference: {
                                contractId: outputReference.contractId,
                                contractVersion:
                                  outputReference.contractVersion,
                                digest: outputReference.digest,
                              },
                            },
                    },
              ),
              behaviorContracts: [
                ...candidate.behaviorContracts.filter(
                  (reference) => reference.contractId !== ids.behavior,
                ),
                behaviorReference,
              ],
            },
      ),
    }),
  );
  const command = parseGraphCommandV1({
    schemaVersion: 1,
    commandId: input.commandId,
    inverseCommandId: input.inverseCommandId,
    origin: "user",
    target: {
      documentId: input.document.documentId,
      architectureId: input.document.architectureId,
      revisionId: input.document.revision.revisionId,
    },
    kind: "replace-workload-and-application-contracts",
    expectedWorkloadBehavior: input.document.workloadBehavior,
    workloadBehavior,
    expectedApplicationContracts: input.document.applicationContracts,
    applicationContracts,
  });
  if (command.kind !== "replace-workload-and-application-contracts") {
    throw new TypeError("Expected a workload operation replacement command.");
  }
  const preview = applyGraphCommand(input.document, command);
  return {
    command,
    inputFieldCount: inputFields.length,
    operationId: operation.id,
    outputFieldCount: outputFields.length,
    previewDocument: preview.document,
    previewHashes: getArchitectureDocumentHashes(preview.document),
    workloadId: workload.id,
  };
}
