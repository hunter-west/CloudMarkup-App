import { HTTP_NO_CONTENT_RELEASE_V1 } from "./http-no-content-release.js";
import { NOTES_IDENTIFIER_RELEASE_V1_1 } from "./notes-identifier-release.js";
import {
  APPLICATION_RUNTIME_DIGEST,
  APPLICATION_RUNTIME_ID,
  APPLICATION_RUNTIME_VERSION,
  APPLICATION_GENERATOR_DIGEST,
  APPLICATION_GENERATOR_ID,
  EVENT_APPLICATION_GENERATOR_DIGEST,
  EVENT_APPLICATION_GENERATOR_ID,
  EVENT_APPLICATION_GENERATOR_VERSION,
  EVENT_APPLICATION_PATTERN_DIGEST,
  EVENT_APPLICATION_PATTERN_ID,
  EVENT_APPLICATION_PATTERN_VERSION,
  EVENT_APPLICATION_TEMPLATE_DIGEST,
  EVENT_APPLICATION_TEMPLATE_ID,
  EVENT_APPLICATION_TEMPLATE_VERSION,
  APPLICATION_GENERATOR_VERSION,
  LAMBDA_HANDLER,
  LAMBDA_RUNTIME,
  NODE_RUNTIME_FAMILY,
  NOTES_PATTERN_DIGEST,
  NOTES_PATTERN_ID,
  NOTES_PATTERN_VERSION,
  NOTES_TEMPLATE_DIGEST,
  NOTES_TEMPLATE_ID,
  SUPPORTED_EVENT_PATTERN_KINDS,
  NOTES_TEMPLATE_VERSION,
  TYPESCRIPT_LANGUAGE_FAMILY,
  canonicalJson,
  sha256Digest,
} from "./constants.js";
export type SupportedDataOperation = "create" | "read" | "update" | "delete";

export interface ResolvedField {
  readonly name: string;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly minimumItems?: number;
  readonly maximumItems?: number;
  readonly scalarType:
    | "string"
    | "integer"
    | "number"
    | "boolean"
    | "timestamp"
    | "date"
    | "uuid"
    | "binary-reference"
    | "string-list"
    | "integer-list"
    | "number-list"
    | "boolean-list";
}

export interface ResolvedEntity {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly digest: string;
  readonly typeName: string;
  readonly partitionKey: string;
  readonly fields: readonly ResolvedField[];
}
export type SupportedEventPattern =
  (typeof SUPPORTED_EVENT_PATTERN_KINDS)[number];

export interface ResolvedEventBinding {
  readonly pattern: SupportedEventPattern;
  readonly bindingId: string;
  readonly transportKind: "event" | "message";
  readonly eventContractId: string;
  readonly eventContractVersion: string;
  readonly eventContractDigest: string;
  readonly delivery: {
    readonly ordering: "not-guaranteed" | "partition-ordered" | "total";
    readonly duplicates: "possible" | "not-expected";
    readonly delivery: "at-most-once" | "at-least-once" | "exactly-once";
  };
  readonly batchSize: number;
  readonly partialBatchFailure: boolean;
  readonly timeoutMilliseconds: number;
  readonly maximumAttempts: number;
  readonly deadLetterTargetKey?: string;
  readonly filterPrefix?: string;
  readonly filterSuffix?: string;
  readonly scheduleExpression?: string;
  readonly idempotency:
    | { readonly mode: "not-required" }
    | {
        readonly mode: "required";
        readonly retentionSeconds: number;
        readonly concurrentDuplicateBehavior:
          "reject" | "join" | "return-recorded";
      };
}

export interface ResolvedOperation {
  readonly id: string;
  readonly pathKey: string;
  readonly capability: string;
  readonly dataOperation: SupportedDataOperation;
  readonly consistentRead?: boolean;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly pathTemplate: string;
  readonly routeKey: string;
  readonly routeContractId: string;
  readonly routeContractVersion: string;
  readonly routeContractDigest: string;
  readonly triggerEdgeId: string;
  readonly dataEdgeId: string;
  readonly tableEnvironmentName: string;
  readonly entity: ResolvedEntity;
  readonly successStatus: number;
  readonly validationStatus: number;
  readonly notFoundStatus?: number;
  readonly event?: ResolvedEventBinding;
  readonly authorizationStatus: number;
  readonly behaviorContractId: string;
  readonly behaviorContractVersion: string;
  readonly behaviorContractDigest: string;
  readonly permittedRoleIds: readonly string[];
}

export interface ResolvedEnvironmentBinding {
  readonly bindingId: string;
  readonly name: string;
  readonly kind: "variable" | "resource" | "secret";
  readonly nodeId?: string;
  readonly targetKey?: string;
  readonly attribute?: string;
  readonly variableId?: string;
  readonly secretReference?: string;
}

export interface ResolvedAuth {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly digest: string;
  readonly claimNames: readonly string[];
  readonly roles: readonly {
    readonly roleId: string;
    readonly claimRequirements: readonly {
      readonly claimName: string;
      readonly match: "present";
    }[];
  }[];
}

export interface ResolvedTest {
  readonly bindingId: string;
  readonly level: "unit" | "contract";
  readonly testCaseContractId: string;
  readonly testCaseContractVersion: string;
  readonly testCaseContractDigest: string;
  readonly targetBehaviorContractId: string;
  readonly targetBehaviorContractVersion: string;
  readonly targetBehaviorContractDigest: string;
  readonly operationId: string;
  readonly preconditions: readonly unknown[];
  readonly expectations: readonly unknown[];
}

export interface ResolvedWorkload {
  readonly workloadId: string;
  readonly deploymentKey: string;
  readonly mode:
    "generated-starter" | "complete-supported-pattern" | "ai-assisted-custom";
  readonly operations: readonly ResolvedOperation[];
  readonly eventPattern?: SupportedEventPattern;
  readonly environment: readonly ResolvedEnvironmentBinding[];
  readonly auth?: ResolvedAuth;
  readonly tests: readonly ResolvedTest[];
  readonly unresolvedRequirementIds: readonly string[];
  readonly extensionPointIds: readonly string[];
  readonly extensionPath?: string;
}

export interface SourceProvenance {
  readonly workloadIds: readonly string[];
  readonly operationIds: readonly string[];
  readonly contractIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly environmentBindingIds: readonly string[];
  readonly resourceTargetKeys: readonly string[];
  readonly extensionPointIds: readonly string[];
}

export interface EmittedSourceFile {
  readonly path: string;
  readonly mediaType: "application/json" | "text/markdown" | "text/typescript";
  readonly content: string;
  readonly digest: `sha256:${string}`;
  readonly ownership: "generated" | "user-owned";
  readonly regeneration: "never" | "replace-when-baseline-matches";
  readonly semanticDiff:
    "byte-exact" | "canonical-json" | "structured-language";
  readonly provenance: SourceProvenance;
}

const generatedHeader =
  "// @generated by cloudmarkup.application-generator@1.0.0; do not edit.\n";
const extensionHeader =
  "// @user-owned CloudMarkup extension point; regeneration never overwrites this file.\n";

function compareUtf16(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeText(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function emptyProvenance(workloadId: string): SourceProvenance {
  return {
    workloadIds: [workloadId],
    operationIds: [],
    contractIds: [],
    edgeIds: [],
    environmentBindingIds: [],
    resourceTargetKeys: [],
    extensionPointIds: [],
  };
}

function sourceFile(
  path: string,
  mediaType: EmittedSourceFile["mediaType"],
  content: string,
  ownership: EmittedSourceFile["ownership"],
  semanticDiff: EmittedSourceFile["semanticDiff"],
  provenance: SourceProvenance,
): EmittedSourceFile {
  const normalized = normalizeText(content);
  return {
    path,
    mediaType,
    content: normalized,
    digest: sha256Digest(normalized),
    ownership,
    regeneration:
      ownership === "user-owned" ? "never" : "replace-when-baseline-matches",
    semanticDiff,
    provenance,
  };
}

export function emitDeterministicFile(input: {
  readonly path: string;
  readonly mediaType: EmittedSourceFile["mediaType"];
  readonly content: string;
  readonly ownership: EmittedSourceFile["ownership"];
  readonly semanticDiff: EmittedSourceFile["semanticDiff"];
  readonly provenance: SourceProvenance;
}): EmittedSourceFile {
  return sourceFile(
    input.path,
    input.mediaType,
    input.content,
    input.ownership,
    input.semanticDiff,
    input.provenance,
  );
}

function identifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
}

function typeForField(field: ResolvedField): string {
  switch (field.scalarType) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string-list":
      return "string[]";
    case "integer-list":
    case "number-list":
      return "number[]";
    case "boolean-list":
      return "boolean[]";
    default:
      return "string";
  }
}

function renderEntity(entity: ResolvedEntity): string {
  const fields = [...entity.fields]
    .sort((left, right) => compareUtf16(left.name, right.name))
    .map((field) => {
      const optional = field.required ? "" : "?";
      const nullable = field.nullable ? " | null" : "";
      return `  ${JSON.stringify(field.name)}${optional}: ${typeForField(field)}${nullable};`;
    })
    .join("\n");
  const descriptors = canonicalJson(
    [...entity.fields]
      .sort((left, right) => compareUtf16(left.name, right.name))
      .map((field) => ({
        name: field.name,
        nullable: field.nullable,
        required: field.required,
        ...(field.minimumItems === undefined
          ? {}
          : { minimumItems: field.minimumItems }),
        ...(field.maximumItems === undefined
          ? {}
          : { maximumItems: field.maximumItems }),
        scalarType: field.scalarType,
      })),
  ).trim();
  return `export interface ${entity.typeName} {\n${fields}\n}\n\nexport const ${identifier(entity.typeName)}Contract = ${descriptors} as const;\n`;
}

function renderTypes(workload: ResolvedWorkload): string {
  const entities = new Map<string, ResolvedEntity>();
  for (const operation of workload.operations) {
    entities.set(operation.entity.digest, operation.entity);
  }
  const entitySource = [...entities.values()]
    .sort((left, right) => compareUtf16(left.contractId, right.contractId))
    .map(renderEntity)
    .join("\n");
  return `${generatedHeader}${entitySource}
export interface ApiGatewayV2Event {
  readonly body?: string | null;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly pathParameters?: Readonly<Record<string, string | undefined>>;
  readonly requestContext: {
    readonly requestId: string;
    readonly http: { readonly method: string; readonly path: string };
    readonly authorizer?: { readonly jwt?: { readonly claims?: Readonly<Record<string, unknown>> } };
  };
  readonly routeKey: string;
}

export interface ApiGatewayV2Result {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

interface FieldDescriptor {
  readonly name: string;
  readonly nullable: boolean;
  readonly required: boolean;
  readonly minimumItems?: number;
  readonly maximumItems?: number;
  readonly scalarType: string;
}

function matchesScalar(value: unknown, scalarType: string): boolean {
  if (value === null) return false;
  if (scalarType.endsWith("-list")) {
    if (!Array.isArray(value)) return false;
    const itemType = scalarType.slice(0, -5);
    return value.every((item) => matchesScalar(item, itemType));
  }
  if (scalarType === "integer") return Number.isInteger(value);
  if (scalarType === "number") return typeof value === "number" && Number.isFinite(value);
  if (scalarType === "boolean") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  if (scalarType === "uuid") return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  if (scalarType === "date") return /^\\d{4}-\\d{2}-\\d{2}$/.test(value);
  if (scalarType === "timestamp") return !Number.isNaN(Date.parse(value));
  return true;
}

export function validateEntity(value: unknown, fields: readonly FieldDescriptor[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Expected a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(fields.map((field) => field.name));
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ValidationError("Request contains an unknown field.");
  }
  for (const field of fields) {
    const fieldValue = record[field.name];
    if (fieldValue === undefined) {
      if (field.required) throw new ValidationError(\`Missing required field: \${field.name}.\`);
      continue;
    }
    if (fieldValue === null) {
      if (!field.nullable) throw new ValidationError(\`Field is not nullable: \${field.name}.\`);
      continue;
    }
    if (!matchesScalar(fieldValue, field.scalarType)) {
      throw new ValidationError(\`Field has the wrong type: \${field.name}.\`);
    }
    if (
      Array.isArray(fieldValue) &&
      ((field.minimumItems !== undefined && fieldValue.length < field.minimumItems) ||
        (field.maximumItems !== undefined && fieldValue.length > field.maximumItems))
    ) {
      throw new ValidationError(\`Field has an invalid item count: \${field.name}.\`);
    }
  }
  return record;
}

export class ValidationError extends Error {
  public readonly category = "application.validation";
}

export class AuthorizationError extends Error {
  public readonly category = "application.authorization";
}

export class NotFoundError extends Error {
  public readonly category = "application.not-found";
}
`;
}

function renderBindings(workload: ResolvedWorkload): string {
  const rows = [...workload.environment]
    .sort((left, right) => compareUtf16(left.name, right.name))
    .map(
      (binding) =>
        `  ${JSON.stringify(binding.name)}: requiredEnvironment(${JSON.stringify(binding.name)}),`,
    )
    .join("\n");
  const provenance = canonicalJson(
    [...workload.environment]
      .sort((left, right) => compareUtf16(left.bindingId, right.bindingId))
      .map((binding) => ({
        attribute: binding.attribute,
        bindingId: binding.bindingId,
        kind: binding.kind,
        name: binding.name,
        nodeId: binding.nodeId,
        targetKey: binding.targetKey,
        variableId: binding.variableId,
      })),
  ).trim();
  return `${generatedHeader}function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(\`Missing required environment binding: \${name}.\`);
  }
  return value;
}

export const environment = Object.freeze({
${rows}
});

export const bindingProvenance = ${provenance} as const;
`;
}

export function sourceMemberAccess(base: string, name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)
    ? `${base}.${name}`
    : `${base}[${JSON.stringify(name)}]`;
}

function renderOperation(operation: ResolvedOperation): string {
  const entityType = operation.entity.typeName;
  const entityContract = `${identifier(entityType)}Contract`;
  const tableName = sourceMemberAccess(
    "environment",
    operation.tableEnvironmentName,
  );
  const partitionKey = JSON.stringify(operation.entity.partitionKey);
  const command = {
    create: "PutItemCommand",
    read: "GetItemCommand",
    update: "UpdateItemCommand",
    delete: "DeleteItemCommand",
  }[operation.dataOperation];
  const sdkImports = [
    command,
    "type AttributeValue",
    "type DynamoDBClient",
    ...(operation.dataOperation === "create" ||
    operation.dataOperation === "update"
      ? ["ConditionalCheckFailedException"]
      : []),
  ].sort(compareUtf16);
  const attributeSource = `function attribute(value: unknown): AttributeValue {
  if (value === null) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(attribute) };
  throw new ValidationError("Unsupported DynamoDB value.");
}`;
  const itemSource = `function item(value: ${entityType}): Record<string, AttributeValue> {
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, attribute(child)]));
}`;
  const fromSource = `function fromList(value: readonly AttributeValue[] | undefined): unknown[] {
  return value?.map(fromAttribute) ?? [];
}

function fromAttribute(value: AttributeValue): unknown {
  if ("S" in value) return value.S;
  if ("N" in value) return Number(value.N);
  if ("BOOL" in value) return value.BOOL;
  if ("NULL" in value) return null;
  if ("L" in value) return fromList(value.L);
  throw new ValidationError("Unsupported DynamoDB response value.");
}

function fromItem(value: Record<string, AttributeValue>): ${entityType} {
  return validateEntity(
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, fromAttribute(child)])),
    ${entityContract},
  ) as unknown as ${entityType};
}`;
  const imports = `${generatedHeader}import { ${sdkImports.join(", ")} } from "@aws-sdk/client-dynamodb";

import { environment } from "../bindings.js";
import { ${operation.dataOperation === "create" ? "" : "NotFoundError, "}ValidationError, ${entityContract}, validateEntity, type ${entityType} } from "../types.js";

${operation.dataOperation === "create" || operation.dataOperation === "update" ? attributeSource : ""}
${operation.dataOperation === "create" ? itemSource : ""}
${operation.dataOperation === "create" ? "" : fromSource}
`;
  switch (operation.dataOperation) {
    case "create":
      return `${imports}
export async function execute(client: DynamoDBClient, input: unknown): Promise<${entityType}> {
  const value = validateEntity(input, ${entityContract}) as unknown as ${entityType};
  await client.send(new PutItemCommand({
    TableName: ${tableName},
    Item: item(value),
    ConditionExpression: "attribute_not_exists(#partitionKey)",
    ExpressionAttributeNames: { "#partitionKey": ${partitionKey} },
  })).catch((error: unknown) => {
    if (error instanceof ConditionalCheckFailedException) {
      throw new ValidationError("Entity already exists.");
    }
    throw error;
  });
  return value;
}
`;
    case "read":
      return `${imports}
export async function execute(client: DynamoDBClient, partitionValue: string): Promise<${entityType}> {
  if (partitionValue.length === 0) throw new ValidationError("Missing partition key.");
  const response = await client.send(new GetItemCommand({
    TableName: ${tableName},
    ConsistentRead: ${operation.consistentRead === true ? "true" : "false"},
    Key: { [${partitionKey}]: { S: partitionValue } },
  }));
  if (response.Item === undefined) throw new NotFoundError("Entity not found.");
  return fromItem(response.Item);
}
`;
    case "update":
      return `${imports}
export async function execute(client: DynamoDBClient, input: unknown, pathPartitionValue: string): Promise<${entityType}> {
  const value = validateEntity(input, ${entityContract}) as unknown as ${entityType};
  const bodyPartitionValue = value[${partitionKey} as keyof ${entityType}];
  if (typeof bodyPartitionValue !== "string" || bodyPartitionValue.length === 0) throw new ValidationError("Missing partition key.");
  if (pathPartitionValue.length === 0 || bodyPartitionValue !== pathPartitionValue) {
    throw new ValidationError("Path and request-body partition keys must match.");
  }
  const partitionValue = pathPartitionValue;
  const entries = Object.entries(value).filter(([key]) => key !== ${partitionKey});
  if (entries.length === 0) throw new ValidationError("No fields to update.");
  const names = { "#partitionKey": ${partitionKey}, ...Object.fromEntries(entries.map(([key], index) => [\`#field\${String(index)}\`, key])) };
  const values = Object.fromEntries(entries.map(([, child], index) => [\`:value\${String(index)}\`, attribute(child)]));
  const response = await client.send(new UpdateItemCommand({
    TableName: ${tableName},
    Key: { [${partitionKey}]: { S: partitionValue } },
    UpdateExpression: \`SET \${entries.map((_, index) => \`#field\${String(index)} = :value\${String(index)}\`).join(", ")}\`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ConditionExpression: "attribute_exists(#partitionKey)",
    ReturnValues: "ALL_NEW",
  })).catch((error: unknown) => {
    if (error instanceof ConditionalCheckFailedException) {
      throw new NotFoundError("Entity not found.");
    }
    throw error;
  });
  if (response.Attributes === undefined) throw new NotFoundError("Entity not found.");
  return fromItem(response.Attributes);
}
`;
    case "delete":
      return `${imports}
export async function execute(client: DynamoDBClient, partitionValue: string): Promise<${entityType}> {
  if (partitionValue.length === 0) throw new ValidationError("Missing partition key.");
  const response = await client.send(new DeleteItemCommand({
    TableName: ${tableName},
    Key: { [${partitionKey}]: { S: partitionValue } },
    ReturnValues: "ALL_OLD",
  }));
  if (response.Attributes === undefined) throw new NotFoundError("Entity not found.");
  return fromItem(response.Attributes);
}
`;
  }
}

function renderHandler(workload: ResolvedWorkload): string {
  const operations = [...workload.operations].sort((left, right) =>
    compareUtf16(left.routeKey, right.routeKey),
  );
  const imports = operations
    .map(
      (operation, index) =>
        `import { execute as executeOperation${String(index)} } from "./generated/operations/${operation.pathKey}.js";`,
    )
    .join("\n");
  const authClaims = canonicalJson(workload.auth?.claimNames ?? []).trim();
  const authRoles = canonicalJson(workload.auth?.roles ?? []).trim();
  const cases = operations
    .map((operation, index) => {
      const operationArguments =
        operation.dataOperation === "read" ||
        operation.dataOperation === "delete"
          ? `requiredPath(event, ${JSON.stringify(operation.entity.partitionKey)})`
          : operation.dataOperation === "update"
            ? `parseBody(event.body), requiredPath(event, ${JSON.stringify(operation.entity.partitionKey)})`
            : "parseBody(event.body)";
      const permittedRoles = canonicalJson(operation.permittedRoleIds).trim();
      return `    case ${JSON.stringify(operation.routeKey)}: {
      authorize(event, ${permittedRoles});
      const result = await executeOperation${String(index)}(client, ${operationArguments});
      return response(${String(operation.successStatus)}, result, correlationId);
    }`;
    })
    .join("\n");
  const validationStatus =
    operations.length === 0
      ? 400
      : Math.min(...operations.map((operation) => operation.validationStatus));
  const authorizationStatus =
    operations.length === 0
      ? 403
      : Math.min(
          ...operations.map((operation) => operation.authorizationStatus),
        );
  const notFoundStatuses = operations
    .map((operation) => operation.notFoundStatus)
    .filter((value): value is number => value !== undefined);
  const notFoundStatus =
    notFoundStatuses.length > 0 ? Math.min(...notFoundStatuses) : 404;
  return `${generatedHeader}import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

${imports}
import { AuthorizationError, NotFoundError, ValidationError, type ApiGatewayV2Event, type ApiGatewayV2Result } from "./generated/types.js";

const client = new DynamoDBClient({});
const configuredClaims = ${authClaims} as readonly string[];

interface RoleDefinition {
  readonly roleId: string;
  readonly claimRequirements: readonly {
    readonly claimName: string;
    readonly match: string;
  }[];
}

const authRoles = ${authRoles} as readonly RoleDefinition[];

function correlation(event: ApiGatewayV2Event): string {
  const supplied = event.headers?.["x-correlation-id"] ?? event.headers?.["X-Correlation-Id"];
  return supplied !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : event.requestContext.requestId;
}

function claims(event: ApiGatewayV2Event): Readonly<Record<string, string>> {
  const available = event.requestContext.authorizer?.jwt?.claims ?? {};
  const selected: Record<string, string> = {};
  for (const name of configuredClaims) {
    const value = available[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new AuthorizationError("A required authenticated claim is unavailable.");
    }
    selected[name] = value;
  }
  return selected;
}

function authorize(event: ApiGatewayV2Event, permittedRoleIds: readonly string[]): void {
  const available = claims(event);
  const permitted = new Set(permittedRoleIds);
  const allowed = authRoles.some(
    (role) =>
      permitted.has(role.roleId) &&
      role.claimRequirements.every((requirement) => {
        const value = available[requirement.claimName];
        return (
          requirement.match === "present" &&
          typeof value === "string" &&
          value.length > 0
        );
      }),
  );
  if (!allowed) throw new AuthorizationError("The authenticated principal is not permitted.");
}

${
  operations.some(
    (operation) =>
      operation.dataOperation === "create" ||
      operation.dataOperation === "update",
  )
    ? `function parseBody(body: string | null | undefined): unknown {
  if (body === undefined || body === null || body.length === 0) throw new ValidationError("Request body is required.");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}`
    : ""
}

${
  operations.some((operation) => operation.dataOperation !== "create")
    ? `function requiredPath(event: ApiGatewayV2Event, name: string): string {
  const value = event.pathParameters?.[name];
  if (value === undefined || value.length === 0) throw new ValidationError("A required path parameter is missing.");
  return value;
}`
    : ""
}

function response(statusCode: number, body: unknown, correlationId: string): ApiGatewayV2Result {
  return {
    statusCode,
    headers: { "content-type": "application/json", "x-correlation-id": correlationId },
    ...(statusCode === 204 ? {} : { body: JSON.stringify(body) }),
  };
}

function log(level: "info" | "error", fields: Readonly<Record<string, unknown>>): void {
  console.log(JSON.stringify({ level, ...fields }));
}

export async function handler(event: ApiGatewayV2Event): Promise<ApiGatewayV2Result> {
  const correlationId = correlation(event);
  try {
    log("info", { correlationId, routeKey: event.routeKey, workloadId: ${JSON.stringify(workload.workloadId)} });
    switch (event.routeKey) {
${cases}
      default:
        return response(404, { error: "route-not-found" }, correlationId);
    }
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) return response(${String(authorizationStatus)}, { error: error.category }, correlationId);
    if (error instanceof ValidationError) return response(${String(validationStatus)}, { error: error.category }, correlationId);
    if (error instanceof NotFoundError) return response(${String(notFoundStatus)}, { error: error.category }, correlationId);
    log("error", { correlationId, errorCategory: "application.internal", routeKey: event.routeKey });
    throw error;
  }
}
`;
}

function renderUnitTests(workload: ResolvedWorkload): string {
  const entities = new Map<string, ResolvedEntity>();
  for (const operation of workload.operations) {
    entities.set(operation.entity.digest, operation.entity);
  }
  const contractNames = [...entities.values()]
    .sort((left, right) => compareUtf16(left.contractId, right.contractId))
    .map((entity) => `${identifier(entity.typeName)}Contract`);
  const contractImports =
    contractNames.length === 0 ? "" : `, ${contractNames.join(", ")}`;
  const canonicalTests = canonicalJson(
    workload.tests
      .filter((test) => test.level === "unit")
      .map((test) => ({
        bindingId: test.bindingId,
        expectations: test.expectations,
        operationId: test.operationId,
        preconditions: test.preconditions,
        target: {
          contractId: test.targetBehaviorContractId,
          contractVersion: test.targetBehaviorContractVersion,
          digest: test.targetBehaviorContractDigest,
        },
        testCase: {
          contractId: test.testCaseContractId,
          contractVersion: test.testCaseContractVersion,
          digest: test.testCaseContractDigest,
        },
      }))
      .sort((left, right) => compareUtf16(left.bindingId, right.bindingId)),
  ).trim();
  return `${generatedHeader}import { describe, expect, it } from "vitest";

import { ValidationError, validateEntity${contractImports} } from "../../../src/functions/${workload.deploymentKey}/generated/types.js";

interface CanonicalUnitTestMetadata {
  readonly bindingId: string;
  readonly expectations: readonly unknown[];
  readonly operationId: string;
  readonly preconditions: readonly unknown[];
  readonly target: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly digest: string;
  };
  readonly testCase: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly digest: string;
  };
}

const canonicalEntityContracts = [${contractNames.join(", ")}] as const;
const canonicalUnitTests = ${canonicalTests} as readonly CanonicalUnitTestMetadata[];

describe(${JSON.stringify(`${workload.workloadId} generated validators`)}, () => {
  it("pins every represented canonical unit-test target and digest", () => {
    expect(canonicalUnitTests).toHaveLength(${String(workload.tests.filter((test) => test.level === "unit").length)});
    expect(canonicalUnitTests.every((test) => test.testCase.digest.startsWith("sha256:"))).toBe(true);
    expect(canonicalUnitTests.every((test) => test.target.digest.startsWith("sha256:"))).toBe(true);
  });

  it("implements the declared validation-category expectations", () => {
    expect(canonicalEntityContracts).toHaveLength(${String(entities.size)});
    for (const contract of canonicalEntityContracts) {
      try {
        validateEntity({ __cloudmarkupUnknown: true }, contract);
        throw new Error("Expected canonical validation to fail.");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).category).toBe("application.validation");
      }
    }
  });
});
`;
}

function renderContractTests(workload: ResolvedWorkload): string {
  const routes = canonicalJson(
    [...workload.operations]
      .sort((left, right) => compareUtf16(left.routeKey, right.routeKey))
      .map((operation) => ({
        authorizationStatus: operation.authorizationStatus,
        behavior: {
          contractId: operation.behaviorContractId,
          contractVersion: operation.behaviorContractVersion,
          digest: operation.behaviorContractDigest,
        },
        contractDigest: operation.routeContractDigest,
        dataOperation: operation.dataOperation,
        inputKind:
          operation.dataOperation === "read" ||
          operation.dataOperation === "delete"
            ? "path"
            : operation.dataOperation === "update"
              ? "body-and-path"
              : "body",
        method: operation.method,
        pathTemplate: operation.pathTemplate,
        permittedRoleIds: operation.permittedRoleIds,
        routeKey: operation.routeKey,
        tests: workload.tests
          .filter(
            (test) =>
              test.level === "contract" && test.operationId === operation.id,
          )
          .map((test) => ({
            bindingId: test.bindingId,
            expectations: test.expectations,
            preconditions: test.preconditions,
            testCase: {
              contractId: test.testCaseContractId,
              contractVersion: test.testCaseContractVersion,
              digest: test.testCaseContractDigest,
            },
          }))
          .sort((left, right) => compareUtf16(left.bindingId, right.bindingId)),
        validationStatus: operation.validationStatus,
      })),
  ).trim();
  const environmentNames = canonicalJson(
    workload.environment.map((binding) => binding.name).sort(compareUtf16),
  ).trim();
  const claimNames = canonicalJson(workload.auth?.claimNames ?? []).trim();
  const handlerModule = JSON.stringify(
    `../../../src/functions/${workload.deploymentKey}/index.js`,
  );
  return `${generatedHeader}import { beforeAll, describe, expect, it } from "vitest";

type GeneratedHandler = typeof import(${handlerModule}).handler;

interface EventFixture {
  readonly inputKind: "body" | "body-and-path" | "path";
  readonly method: string;
  readonly pathTemplate: string;
  readonly routeKey: string;
}

interface RouteContractMetadata extends EventFixture {
  readonly authorizationStatus: number;
  readonly behavior: {
    readonly contractId: string;
    readonly contractVersion: string;
    readonly digest: string;
  };
  readonly contractDigest: string;
  readonly dataOperation: "create" | "read" | "update" | "delete";
  readonly permittedRoleIds: readonly string[];
  readonly tests: readonly {
    readonly bindingId: string;
    readonly expectations: readonly unknown[];
    readonly preconditions: readonly unknown[];
    readonly testCase: {
      readonly contractId: string;
      readonly contractVersion: string;
      readonly digest: string;
    };
  }[];
  readonly validationStatus: number;
}

const routeContracts = ${routes} as readonly RouteContractMetadata[];
const environmentNames = ${environmentNames} as readonly string[];
const configuredClaimNames = ${claimNames} as readonly string[];
let generatedHandler: GeneratedHandler;

function eventFor(route: EventFixture, authenticated = true) {
  const claims = authenticated
    ? Object.fromEntries(configuredClaimNames.map((name) => [name, "contract-test-claim"]))
    : {};
  const base = {
    headers: { "x-correlation-id": "contract-test-correlation" },
    requestContext: {
      requestId: "contract-test-request",
      http: { method: route.method, path: route.pathTemplate },
      authorizer: { jwt: { claims } },
    },
    routeKey: route.routeKey,
  };
  if (route.inputKind === "body") return { ...base, body: "" };
  if (route.inputKind === "body-and-path") return { ...base, body: "", pathParameters: {} };
  return { ...base, pathParameters: {} };
}

beforeAll(async () => {
  for (const name of environmentNames) process.env[name] = "cloudmarkup-test-reference";
  const loaded = await import(${handlerModule});
  generatedHandler = loaded.handler;
});

describe(${JSON.stringify(`${workload.workloadId} generated request/response contracts`)}, () => {
  it("pins every represented route, behavior, and canonical test digest", () => {
    expect(routeContracts).toHaveLength(${String(workload.operations.length)});
    expect(new Set(routeContracts.map((route) => route.routeKey)).size).toBe(routeContracts.length);
    expect(routeContracts.every((route) => route.contractDigest.startsWith("sha256:"))).toBe(true);
    expect(routeContracts.every((route) => route.behavior.digest.startsWith("sha256:"))).toBe(true);
    expect(routeContracts.flatMap((route) => route.tests)).toHaveLength(${String(workload.tests.filter((test) => test.level === "contract").length)});
    expect(routeContracts.flatMap((route) => route.tests).every((test) => test.testCase.digest.startsWith("sha256:"))).toBe(true);
  });

  it("implements the declared validation status and category expectations", async () => {
    for (const route of routeContracts) {
      const result = await generatedHandler(eventFor(route));
      expect(result.statusCode).toBe(route.validationStatus);
      expect(result.headers["x-correlation-id"]).toBe("contract-test-correlation");
      expect(JSON.parse(result.body ?? "{}")).toEqual({ error: "application.validation" });
    }
  });

  it("enforces permitted roles with the canonical denied response", async () => {
    for (const route of routeContracts) {
      const result = await generatedHandler(eventFor(route, false));
      expect(result.statusCode).toBe(route.authorizationStatus);
      expect(result.headers["x-correlation-id"]).toBe("contract-test-correlation");
      expect(JSON.parse(result.body ?? "{}")).toEqual({ error: "application.authorization" });
    }
  });

  it("rejects an undispatched route without guessing an event shape", async () => {
    const result = await generatedHandler(
      eventFor({
        inputKind: "path",
        method: "GET",
        pathTemplate: "/__cloudmarkup_unsupported",
        routeKey: "GET /__cloudmarkup_unsupported",
      }),
    );
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body ?? "{}")).toEqual({ error: "route-not-found" });
  });
});
`;
}

function renderExtension(workload: ResolvedWorkload): string {
  const extensionPoints = canonicalJson(workload.extensionPointIds).trim();
  return `${extensionHeader}export const extensionPointIds = ${extensionPoints} as const;

export interface CustomNotesBehavior {
  readonly implementation: "user-required";
}

export function customNotesBehavior(): CustomNotesBehavior {
  return { implementation: "user-required" };
}
`;
}

function workloadProvenance(workload: ResolvedWorkload): SourceProvenance {
  return {
    workloadIds: [workload.workloadId],
    operationIds: workload.operations
      .map((operation) => operation.id)
      .sort(compareUtf16),
    contractIds: [
      ...new Set([
        ...(workload.auth === undefined ? [] : [workload.auth.contractId]),
        ...workload.operations.flatMap((operation) => [
          operation.behaviorContractId,
          operation.routeContractId,
          operation.entity.contractId,
        ]),
        ...workload.tests.map((test) => test.testCaseContractId),
      ]),
    ].sort(compareUtf16),
    edgeIds: workload.operations
      .flatMap((operation) => [operation.triggerEdgeId, operation.dataEdgeId])
      .sort(compareUtf16),
    environmentBindingIds: workload.environment
      .map((binding) => binding.bindingId)
      .sort(compareUtf16),
    resourceTargetKeys: workload.environment
      .flatMap((binding) =>
        binding.targetKey === undefined ? [] : [binding.targetKey],
      )
      .sort(compareUtf16),
    extensionPointIds: [...workload.extensionPointIds].sort(compareUtf16),
  };
}

function renderPackageJson(): string {
  return canonicalJson({
    name: "@cloudmarkup/generated-application",
    version: "0.0.0",
    private: true,
    type: "module",
    engines: { node: ">=24.0.0 <25" },
    packageManager: "pnpm@11.16.0",
    dependencies: { "@aws-sdk/client-dynamodb": "3.1101.0" },
    devDependencies: {
      "@types/node": "24.13.3",
      typescript: "6.0.3",
      vitest: "4.1.10",
    },
  });
}

function renderTsconfig(): string {
  return canonicalJson({
    compilerOptions: {
      exactOptionalPropertyTypes: true,
      lib: ["ES2024"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noUncheckedIndexedAccess: true,
      outDir: "dist",
      rootDir: ".",
      strict: true,
      target: "ES2024",
      types: ["node"],
    },
    include: ["src/**/*.ts", "tests/**/*.ts"],
  });
}

export interface ApplicationReadmeMetadata {
  readonly solutionRevisionId: string;
  readonly catalog: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly generator: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly template: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly runtime: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly pattern: {
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
}

function renderReadme(
  workloads: readonly ResolvedWorkload[],
  metadata: ApplicationReadmeMetadata,
): string {
  const rows = [...workloads]
    .sort((left, right) =>
      compareUtf16(left.deploymentKey, right.deploymentKey),
    )
    .map(
      (workload) =>
        `- \`${workload.deploymentKey}\`: ${workload.mode}; ${String(workload.operations.length)} represented operation(s).`,
    )
    .join("\n");
  const extensions = [...workloads]
    .filter((workload) => workload.extensionPath !== undefined)
    .sort((left, right) =>
      compareUtf16(left.deploymentKey, right.deploymentKey),
    )
    .map((workload) => {
      const ids = [...workload.extensionPointIds].sort(compareUtf16);
      return `- \`${String(workload.extensionPath)}\` is user-owned and never regenerated; declared extension IDs: ${ids.length === 0 ? "none" : ids.join(", ")}.`;
    })
    .join("\n");
  const unresolved = [...workloads]
    .flatMap((workload) => workload.unresolvedRequirementIds)
    .sort(compareUtf16);
  return `# Generated Cloud Markup application

This source tree was generated deterministically from an immutable Solution Revision. Generated files are replaceable only when their exact baseline digest matches. Files marked user-owned are never overwritten.

## Generation metadata

- Solution Revision: \`${metadata.solutionRevisionId}\`
- Generator: \`${metadata.generator.id}@${metadata.generator.version}\` (\`${metadata.generator.digest}\`)
- Template: \`${metadata.template.id}@${metadata.template.version}\` (\`${metadata.template.digest}\`)
- Pattern: \`${metadata.pattern.id}@${metadata.pattern.version}\` (\`${metadata.pattern.digest}\`)
- Runtime: \`${metadata.runtime.id}@${metadata.runtime.version}\` (\`${metadata.runtime.digest}\`)
- Catalog: \`${metadata.catalog.id}@${metadata.catalog.version}\` (\`${metadata.catalog.digest}\`)

## Workloads

${rows || "- No source-emitting workload."}

## User-owned extension paths

${extensions || "No user-owned extension file is required by this source artifact."}

## Unresolved behavior

${unresolved.length === 0 ? "None represented by this source artifact." : unresolved.map((id) => `- \`${id}\``).join("\n")}

## Build boundary

Prompt 29A does not install, compile, test, package, fetch, or deploy this source. The files under \`application/build-contracts/\` are the exact handoff to the isolated Prompt 32A builder. IAM remains derived from Architecture edges by the Terraform compiler, never from source scanning.
`;
}

export function emitApplicationSource(
  inputWorkloads: readonly ResolvedWorkload[],
  metadata: ApplicationReadmeMetadata,
): readonly EmittedSourceFile[] {
  const successor =
    metadata.generator.id === NOTES_IDENTIFIER_RELEASE_V1_1.generator.id &&
    metadata.generator.version ===
      NOTES_IDENTIFIER_RELEASE_V1_1.generator.version;
  const workloads = successor
    ? inputWorkloads.map((workload) => ({
        ...workload,
        operations: workload.operations.map((operation) => ({
          ...operation,
          entity: {
            ...operation.entity,
            typeName:
              "Entity_" +
              sha256Digest(
                canonicalJson({
                  contractId: operation.entity.contractId,
                  contractVersion: operation.entity.contractVersion,
                }),
              ).slice(7),
          },
        })),
      }))
    : inputWorkloads;
  const files: EmittedSourceFile[] = [];
  const rootProvenance: SourceProvenance = {
    workloadIds: workloads
      .map((workload) => workload.workloadId)
      .sort(compareUtf16),
    operationIds: [],
    contractIds: [],
    edgeIds: [],
    environmentBindingIds: [],
    resourceTargetKeys: [],
    extensionPointIds: [],
  };
  files.push(
    sourceFile(
      "application/README.md",
      "text/markdown",
      renderReadme(workloads, metadata),
      "generated",
      "byte-exact",
      rootProvenance,
    ),
    sourceFile(
      "application/package.json",
      "application/json",
      renderPackageJson(),
      "generated",
      "canonical-json",
      rootProvenance,
    ),
    sourceFile(
      "application/tsconfig.json",
      "application/json",
      renderTsconfig(),
      "generated",
      "canonical-json",
      rootProvenance,
    ),
    sourceFile(
      "application/lockfile.contract.json",
      "application/json",
      canonicalJson({
        contractVersion: 1,
        packageManager: { id: "pnpm", version: "11.16.0" },
        policy: "resolve-only-in-prompt-32a-isolated-builder",
        packageManifestDigest: sha256Digest(renderPackageJson()),
      }),
      "generated",
      "canonical-json",
      rootProvenance,
    ),
  );

  for (const workload of [...workloads].sort((left, right) =>
    compareUtf16(left.deploymentKey, right.deploymentKey),
  )) {
    const provenance = workloadProvenance(workload);
    const root = `application/src/functions/${workload.deploymentKey}`;
    files.push(
      sourceFile(
        `${root}/index.ts`,
        "text/typescript",
        renderHandler(workload),
        "generated",
        "structured-language",
        provenance,
      ),
      sourceFile(
        `${root}/generated/bindings.ts`,
        "text/typescript",
        renderBindings(workload),
        "generated",
        "structured-language",
        provenance,
      ),
      sourceFile(
        `${root}/generated/types.ts`,
        "text/typescript",
        renderTypes(workload),
        "generated",
        "structured-language",
        provenance,
      ),
      sourceFile(
        `application/tests/functions/${workload.deploymentKey}/contracts.test.ts`,
        "text/typescript",
        renderContractTests(workload),
        "generated",
        "structured-language",
        provenance,
      ),
      sourceFile(
        `application/tests/functions/${workload.deploymentKey}/unit.test.ts`,
        "text/typescript",
        renderUnitTests(workload),
        "generated",
        "structured-language",
        provenance,
      ),
    );
    for (const operation of [...workload.operations].sort((left, right) =>
      compareUtf16(left.pathKey, right.pathKey),
    )) {
      files.push(
        sourceFile(
          `${root}/generated/operations/${operation.pathKey}.ts`,
          "text/typescript",
          renderOperation(operation),
          "generated",
          "structured-language",
          {
            ...provenance,
            operationIds: [operation.id],
            contractIds: [
              operation.behaviorContractId,
              operation.routeContractId,
              operation.entity.contractId,
            ].sort(compareUtf16),
            edgeIds: [operation.triggerEdgeId, operation.dataEdgeId].sort(
              compareUtf16,
            ),
          },
        ),
      );
    }
    if (workload.extensionPath !== undefined) {
      files.push(
        sourceFile(
          workload.extensionPath,
          "text/typescript",
          renderExtension(workload),
          "user-owned",
          "structured-language",
          {
            ...emptyProvenance(workload.workloadId),
            extensionPointIds: [...workload.extensionPointIds].sort(
              compareUtf16,
            ),
          },
        ),
      );
    }
  }
  const result = successor
    ? files.map((file) => {
        if (
          file.ownership !== "generated" ||
          !file.content.startsWith(generatedHeader)
        )
          return file;
        return emitDeterministicFile({
          ...file,
          content:
            "// @generated by cloudmarkup.application-generator@1.1.0; do not edit.\n" +
            file.content.slice(generatedHeader.length),
        });
      })
    : files;
  return result.sort((left, right) => compareUtf16(left.path, right.path));
}

export function sourceDescriptor(
  generatorId: string = APPLICATION_GENERATOR_ID,
  generatorVersion: string = APPLICATION_GENERATOR_VERSION,
) {
  if (generatorId === EVENT_APPLICATION_GENERATOR_ID) {
    return {
      generator: {
        id: EVENT_APPLICATION_GENERATOR_ID,
        version: EVENT_APPLICATION_GENERATOR_VERSION,
        digest: EVENT_APPLICATION_GENERATOR_DIGEST,
      },
      template: {
        id: EVENT_APPLICATION_TEMPLATE_ID,
        version: EVENT_APPLICATION_TEMPLATE_VERSION,
        digest: EVENT_APPLICATION_TEMPLATE_DIGEST,
      },
      pattern: {
        id: EVENT_APPLICATION_PATTERN_ID,
        version: EVENT_APPLICATION_PATTERN_VERSION,
        digest: EVENT_APPLICATION_PATTERN_DIGEST,
      },
      runtime: {
        id: APPLICATION_RUNTIME_ID,
        version: APPLICATION_RUNTIME_VERSION,
        digest: APPLICATION_RUNTIME_DIGEST,
        runtimeFamily: NODE_RUNTIME_FAMILY,
        languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
        runtime: LAMBDA_RUNTIME,
        handler: LAMBDA_HANDLER,
        moduleFormat: "esm" as const,
      },
    };
  }
  const legacy = {
    generator: {
      id: APPLICATION_GENERATOR_ID,
      version: APPLICATION_GENERATOR_VERSION,
      digest: APPLICATION_GENERATOR_DIGEST,
    },
    template: {
      id: NOTES_TEMPLATE_ID,
      version: NOTES_TEMPLATE_VERSION,
      digest: NOTES_TEMPLATE_DIGEST,
    },
    pattern: {
      id: NOTES_PATTERN_ID,
      version: NOTES_PATTERN_VERSION,
      digest: NOTES_PATTERN_DIGEST,
    },
    runtime: {
      id: APPLICATION_RUNTIME_ID,
      version: APPLICATION_RUNTIME_VERSION,
      digest: APPLICATION_RUNTIME_DIGEST,
      runtimeFamily: NODE_RUNTIME_FAMILY,
      languageFamily: TYPESCRIPT_LANGUAGE_FAMILY,
      runtime: LAMBDA_RUNTIME,
      handler: LAMBDA_HANDLER,
      moduleFormat: "esm" as const,
    },
  };
  if (generatorId === HTTP_NO_CONTENT_RELEASE_V1.generator.id)
    return { ...legacy, ...HTTP_NO_CONTENT_RELEASE_V1 };
  return generatorId === APPLICATION_GENERATOR_ID &&
    generatorVersion === NOTES_IDENTIFIER_RELEASE_V1_1.generator.version
    ? { ...legacy, ...NOTES_IDENTIFIER_RELEASE_V1_1 }
    : legacy;
}
