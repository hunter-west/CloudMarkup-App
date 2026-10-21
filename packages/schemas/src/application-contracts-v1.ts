import { z } from "zod";

import {
  actorIdSchema,
  documentIdSchema,
  namespacedIdentifierSchema,
  revisionIdSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  workloadContractIdSchema,
  workloadContractReferenceV1Schema,
  workloadOperationCapabilitySchema,
} from "./workload-behavior-v1.js";

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fieldNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const fieldPathPattern = /^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const mediaTypePattern =
  /^[a-z][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const httpPathPattern = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{}-]*$/;
const headerNamePattern = /^[A-Za-z0-9][A-Za-z0-9-]{0,126}$/;

const shortTextSchema = z.string().trim().min(1).max(512);
const longTextSchema = z.string().trim().min(1).max(8_000);
const boundedOpaqueIdSchema = z
  .string()
  .regex(opaqueIdPattern, "Must be a stable opaque identifier.");

export const applicationContractSetIdSchema =
  boundedOpaqueIdSchema.brand<"ApplicationContractSetId">();
export const applicationContractTestFixtureIdSchema =
  boundedOpaqueIdSchema.brand<"ApplicationContractTestFixtureId">();
export const applicationContractExpectationIdSchema =
  boundedOpaqueIdSchema.brand<"ApplicationContractExpectationId">();
export const dataEntityIndexIdSchema =
  boundedOpaqueIdSchema.brand<"DataEntityIndexId">();
export const authRoleIdSchema = boundedOpaqueIdSchema.brand<"AuthRoleId">();

export const applicationContractKindV1Schema = z.enum([
  "http-api",
  "event-message",
  "data-entity",
  "auth",
  "behavior-operation",
  "test-case",
]);

export const applicationContractReferenceV1Schema =
  workloadContractReferenceV1Schema
    .extend({
      contractKind: applicationContractKindV1Schema,
    })
    .strict();

export const dataEntityContractReferenceV1Schema =
  workloadContractReferenceV1Schema
    .extend({ contractKind: z.literal("data-entity") })
    .strict();

export const authContractReferenceV1Schema = workloadContractReferenceV1Schema
  .extend({ contractKind: z.literal("auth") })
  .strict();

export const behaviorOperationContractReferenceV1Schema =
  workloadContractReferenceV1Schema
    .extend({ contractKind: z.literal("behavior-operation") })
    .strict();

export const testCaseContractReferenceV1Schema =
  workloadContractReferenceV1Schema
    .extend({ contractKind: z.literal("test-case") })
    .strict();

export const applicationContractProvenanceV1Schema = z
  .object({
    source: z.enum([
      "designed",
      "repository-observation",
      "deterministic-generator",
      "ai-accepted",
      "migration",
    ]),
    sourceReferenceIds: z.array(boundedOpaqueIdSchema).max(64),
    recordedAt: utcTimestampSchema,
    recordedBy: actorIdSchema.optional(),
  })
  .strict();

const applicationContractRecordBaseV1Schema = z
  .object({
    contractId: workloadContractIdSchema,
    contractVersion: semanticVersionSchema,
    displayName: shortTextSchema,
    description: longTextSchema.optional(),
    provenance: applicationContractProvenanceV1Schema,
  })
  .strict();

export const contractFieldNameSchema = z
  .string()
  .regex(fieldNamePattern, "Must be a portable field name.")
  .brand<"ContractFieldName">();
export const contractFieldPathSchema = z
  .string()
  .regex(fieldPathPattern, "Must be a bounded root-relative contract path.")
  .max(512)
  .brand<"ContractFieldPath">();
export const contractMediaTypeSchema = z
  .string()
  .regex(mediaTypePattern, "Must be a lowercase media type without parameters.")
  .brand<"ContractMediaType">();

export const contractScalarTypeV1Schema = z.enum([
  "string",
  "integer",
  "number",
  "boolean",
  "timestamp",
  "date",
  "uuid",
  "binary-reference",
]);

export const contractFieldTypeV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scalar"),
      scalarType: contractScalarTypeV1Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("scalar-list"),
      itemType: contractScalarTypeV1Schema,
      minimumItems: z.number().int().nonnegative().max(10_000).optional(),
      maximumItems: z.number().int().nonnegative().max(10_000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.minimumItems !== undefined &&
        value.maximumItems !== undefined &&
        value.minimumItems > value.maximumItems
      ) {
        context.addIssue({
          code: "custom",
          message: "minimumItems cannot exceed maximumItems.",
        });
      }
    }),
  z
    .object({
      kind: z.literal("entity-reference"),
      reference: dataEntityContractReferenceV1Schema,
      cardinality: z.enum(["one", "many"]),
    })
    .strict(),
]);

export const contractFieldV1Schema = z
  .object({
    name: contractFieldNameSchema,
    fieldType: contractFieldTypeV1Schema,
    required: z.boolean(),
    nullable: z.boolean(),
    classification: z.enum([
      "public",
      "internal",
      "confidential",
      "restricted",
      "regulated",
    ]),
    description: shortTextSchema.optional(),
  })
  .strict();

export const httpParameterV1Schema = z
  .object({
    name: contractFieldNameSchema,
    location: z.enum(["path", "query", "header"]),
    valueType: contractScalarTypeV1Schema,
    required: z.boolean(),
    sensitive: z.boolean(),
    description: shortTextSchema.optional(),
  })
  .strict();

export const httpBodyContractV1Schema = z
  .object({
    mediaType: contractMediaTypeSchema,
    entity: dataEntityContractReferenceV1Schema,
    required: z.boolean(),
  })
  .strict();

export const httpResponseContractV1Schema = z
  .object({
    statusCode: z.number().int().min(100).max(599),
    mediaType: contractMediaTypeSchema.optional(),
    entity: dataEntityContractReferenceV1Schema.optional(),
    headers: z
      .array(
        z
          .object({
            name: z.string().regex(headerNamePattern),
            valueType: contractScalarTypeV1Schema,
            required: z.boolean(),
          })
          .strict(),
      )
      .max(64),
    description: shortTextSchema,
  })
  .strict();

export const httpApiContractV1Schema = applicationContractRecordBaseV1Schema
  .extend({
    contractKind: z.literal("http-api"),
    method: z.enum([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]),
    pathTemplate: z.string().max(512).regex(httpPathPattern),
    request: z
      .object({
        parameters: z.array(httpParameterV1Schema).max(128),
        body: httpBodyContractV1Schema.optional(),
      })
      .strict(),
    responses: z.array(httpResponseContractV1Schema).min(1).max(64),
    authentication: authContractReferenceV1Schema.optional(),
  })
  .strict();

export const eventMessageContractV1Schema =
  applicationContractRecordBaseV1Schema
    .extend({
      contractKind: z.literal("event-message"),
      transportKind: z.enum(["event", "message"]),
      semanticName: namespacedIdentifierSchema,
      payload: dataEntityContractReferenceV1Schema,
      headers: z.array(contractFieldV1Schema).max(64),
      delivery: z
        .object({
          ordering: z.enum(["not-guaranteed", "partition-ordered", "total"]),
          duplicates: z.enum(["possible", "not-expected"]),
          delivery: z.enum(["at-most-once", "at-least-once", "exactly-once"]),
        })
        .strict(),
    })
    .strict();

export const dataEntityIndexV1Schema = z
  .object({
    indexId: dataEntityIndexIdSchema,
    name: contractFieldNameSchema,
    kind: z.enum(["primary", "unique", "secondary"]),
    partitionFields: z.array(contractFieldNameSchema).min(1).max(16),
    sortFields: z.array(contractFieldNameSchema).max(16),
  })
  .strict();

export const dataEntityContractV1Schema = applicationContractRecordBaseV1Schema
  .extend({
    contractKind: z.literal("data-entity"),
    semanticName: namespacedIdentifierSchema,
    storageIntent: z.enum(["transient", "persistent", "external"]),
    fields: z.array(contractFieldV1Schema).min(1).max(512),
    indexes: z.array(dataEntityIndexV1Schema).max(64),
    supportedOperations: z
      .array(
        z.enum([
          "create",
          "read",
          "update",
          "delete",
          "list",
          "query",
          "publish",
          "consume",
        ]),
      )
      .max(16),
  })
  .strict();

export const authClaimV1Schema = z
  .object({
    name: contractFieldNameSchema,
    source: z.enum([
      "identity-token",
      "access-token",
      "request",
      "runtime-context",
    ]),
    valueType: z.enum(["string", "string-list", "boolean", "integer"]),
    required: z.boolean(),
    sensitive: z.boolean(),
  })
  .strict();

export const authRoleV1Schema = z
  .object({
    roleId: authRoleIdSchema,
    displayName: shortTextSchema,
    claimRequirements: z
      .array(
        z
          .object({
            claimName: contractFieldNameSchema,
            match: z.enum(["present", "equals", "contains"]),
            expectedValue: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export const authContractV1Schema = applicationContractRecordBaseV1Schema
  .extend({
    contractKind: z.literal("auth"),
    authenticationMethod: z.enum([
      "none",
      "api-key-reference",
      "oauth2",
      "oidc",
      "signed-request",
      "mutual-tls-reference",
      "runtime-identity",
    ]),
    claims: z.array(authClaimV1Schema).max(128),
    roles: z.array(authRoleV1Schema).max(64),
  })
  .strict();

export const behaviorOperationIoV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("contract-reference"),
      reference: applicationContractReferenceV1Schema,
    })
    .strict(),
]);

export const behaviorOperationContractV1Schema =
  applicationContractRecordBaseV1Schema
    .extend({
      contractKind: z.literal("behavior-operation"),
      capability: workloadOperationCapabilitySchema,
      input: behaviorOperationIoV1Schema,
      output: behaviorOperationIoV1Schema,
      authorization: z
        .object({
          authContract: authContractReferenceV1Schema,
          permittedRoleIds: z.array(authRoleIdSchema).max(64),
        })
        .strict()
        .optional(),
      failureOutcomes: z
        .array(
          z
            .object({
              category: namespacedIdentifierSchema,
              retryable: z.boolean(),
              description: shortTextSchema,
            })
            .strict(),
        )
        .max(64),
    })
    .strict();

export const applicationTestExpectationV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("http-status"),
      statusCode: z.number().int().min(100).max(599),
    })
    .strict(),
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("contract-conformance"),
      contract: applicationContractReferenceV1Schema,
    })
    .strict(),
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("event-emitted"),
      event: applicationContractReferenceV1Schema.extend({
        contractKind: z.literal("event-message"),
      }),
      minimumCount: z.number().int().nonnegative().max(10_000),
      maximumCount: z.number().int().nonnegative().max(10_000),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.minimumCount > value.maximumCount) {
        context.addIssue({
          code: "custom",
          message: "minimumCount cannot exceed maximumCount.",
        });
      }
    }),
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("data-operation"),
      entity: dataEntityContractReferenceV1Schema,
      operation: z.enum([
        "create",
        "read",
        "update",
        "delete",
        "list",
        "query",
      ]),
    })
    .strict(),
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("error-category"),
      category: namespacedIdentifierSchema,
    })
    .strict(),
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("latency-bound"),
      percentile: z.number().int().min(1).max(100),
      maximumMilliseconds: z.number().int().positive().max(86_400_000),
    })
    .strict(),
  z
    .object({
      expectationId: applicationContractExpectationIdSchema,
      kind: z.literal("health"),
      state: z.enum(["healthy", "degraded", "unhealthy"]),
    })
    .strict(),
]);

export const applicationTestPreconditionV1Schema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("contract-available"),
        contract: applicationContractReferenceV1Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("fixture-available"),
        fixtureId: applicationContractTestFixtureIdSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("authenticated-role"),
        authContract: authContractReferenceV1Schema,
        roleId: authRoleIdSchema,
      })
      .strict(),
  ],
);

export const applicationTestCaseContractV1Schema =
  applicationContractRecordBaseV1Schema
    .extend({
      contractKind: z.literal("test-case"),
      level: z.enum(["unit", "contract", "integration", "smoke"]),
      target: applicationContractReferenceV1Schema,
      preconditions: z.array(applicationTestPreconditionV1Schema).max(64),
      fixtureReferences: z
        .array(
          z
            .object({
              fixtureId: applicationContractTestFixtureIdSchema,
              digest: sha256DigestSchema,
            })
            .strict(),
        )
        .max(64),
      expectations: z.array(applicationTestExpectationV1Schema).min(1).max(128),
    })
    .strict();

export const applicationContractRecordV1Schema = z.discriminatedUnion(
  "contractKind",
  [
    httpApiContractV1Schema,
    eventMessageContractV1Schema,
    dataEntityContractV1Schema,
    authContractV1Schema,
    behaviorOperationContractV1Schema,
    applicationTestCaseContractV1Schema,
  ],
);

export const applicationContractsV1Schema = z
  .object({
    kind: z.literal("cloudmarkup.application-contracts"),
    schemaVersion: z.literal(1),
    contractSetId: applicationContractSetIdSchema,
    documentId: documentIdSchema,
    revision: z
      .object({
        revisionId: revisionIdSchema,
        revisionNumber: z.number().int().positive(),
        createdAt: utcTimestampSchema,
        createdBy: actorIdSchema,
        previousRevisionId: revisionIdSchema.optional(),
      })
      .strict(),
    contracts: z.array(applicationContractRecordV1Schema).max(2_048),
  })
  .strict();

export type ApplicationContractsV1 = z.output<
  typeof applicationContractsV1Schema
>;
export type ApplicationContractRecordV1 = z.output<
  typeof applicationContractRecordV1Schema
>;
export type ApplicationContractReferenceV1 = z.output<
  typeof applicationContractReferenceV1Schema
>;
export type HttpApiContractV1 = z.output<typeof httpApiContractV1Schema>;
export type EventMessageContractV1 = z.output<
  typeof eventMessageContractV1Schema
>;
export type DataEntityContractV1 = z.output<typeof dataEntityContractV1Schema>;
export type AuthContractV1 = z.output<typeof authContractV1Schema>;
export type BehaviorOperationContractV1 = z.output<
  typeof behaviorOperationContractV1Schema
>;
export type ApplicationTestCaseContractV1 = z.output<
  typeof applicationTestCaseContractV1Schema
>;

export function generateApplicationContractsV1JsonSchema() {
  const generated = z.toJSONSchema(applicationContractsV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });

  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/application-contracts/v1.schema.json",
    title: "Cloud Markup Application Contracts v1",
  };
}
