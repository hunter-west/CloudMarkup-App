import { describe, expect, it } from "vitest";

import {
  applicationContractsV1Schema,
  applicationContractReferenceV1Schema,
  generateApplicationContractsV1JsonSchema,
} from "./application-contracts-v1.js";
import { normalizeApplicationContractsV1 } from "./solution-normalization.js";

const digest =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const timestamp = "2026-08-14T12:00:00Z";

const provenance = {
  source: "designed",
  sourceReferenceIds: ["requirement_notes"],
  recordedAt: timestamp,
  recordedBy: "actor_owner",
} as const;

const reference = (
  contractKind:
    | "http-api"
    | "event-message"
    | "data-entity"
    | "auth"
    | "behavior-operation"
    | "test-case",
  contractId: string,
) => ({ contractKind, contractId, contractVersion: "1.0.0", digest });

function representativeContracts() {
  const entityReference = reference("data-entity", "contracts.notes.entity");
  const authReference = reference("auth", "contracts.notes.auth");
  const operationReference = reference(
    "behavior-operation",
    "contracts.notes.create-operation",
  );

  return {
    kind: "cloudmarkup.application-contracts",
    schemaVersion: 1,
    contractSetId: "contract_set_notes",
    documentId: "document_contracts_notes",
    revision: {
      revisionId: "revision_contracts_notes_1",
      revisionNumber: 1,
      createdAt: timestamp,
      createdBy: "actor_owner",
    },
    contracts: [
      {
        contractKind: "data-entity",
        contractId: "contracts.notes.entity",
        contractVersion: "1.0.0",
        displayName: "Note",
        provenance,
        semanticName: "application.notes.entity",
        storageIntent: "persistent",
        fields: [
          {
            name: "noteId",
            fieldType: { kind: "scalar", scalarType: "uuid" },
            required: true,
            nullable: false,
            classification: "internal",
          },
          {
            name: "body",
            fieldType: { kind: "scalar", scalarType: "string" },
            required: true,
            nullable: false,
            classification: "confidential",
          },
        ],
        indexes: [
          {
            indexId: "index_notes_primary",
            name: "primary",
            kind: "primary",
            partitionFields: ["noteId"],
            sortFields: [],
          },
        ],
        supportedOperations: ["create", "read", "list"],
      },
      {
        contractKind: "auth",
        contractId: "contracts.notes.auth",
        contractVersion: "1.0.0",
        displayName: "Notes authorization",
        provenance,
        authenticationMethod: "oidc",
        claims: [
          {
            name: "subject",
            source: "identity-token",
            valueType: "string",
            required: true,
            sensitive: false,
          },
        ],
        roles: [
          {
            roleId: "role_member",
            displayName: "Member",
            claimRequirements: [
              {
                claimName: "subject",
                match: "present",
              },
            ],
          },
        ],
      },
      {
        contractKind: "http-api",
        contractId: "contracts.notes.create-route",
        contractVersion: "1.0.0",
        displayName: "Create note",
        provenance,
        method: "POST",
        pathTemplate: "/notes",
        request: {
          parameters: [],
          body: {
            mediaType: "application/json",
            entity: entityReference,
            required: true,
          },
        },
        responses: [
          {
            statusCode: 201,
            mediaType: "application/json",
            entity: entityReference,
            headers: [],
            description: "The note was created.",
          },
        ],
        authentication: authReference,
      },
      {
        contractKind: "event-message",
        contractId: "contracts.notes.created-event",
        contractVersion: "1.0.0",
        displayName: "Note created",
        provenance,
        transportKind: "event",
        semanticName: "application.notes.created",
        payload: entityReference,
        headers: [],
        delivery: {
          ordering: "not-guaranteed",
          duplicates: "possible",
          delivery: "at-least-once",
        },
      },
      {
        contractKind: "behavior-operation",
        contractId: "contracts.notes.create-operation",
        contractVersion: "1.0.0",
        displayName: "Create a note",
        provenance,
        capability: "application.notes.create",
        input: { kind: "contract-reference", reference: entityReference },
        output: { kind: "contract-reference", reference: entityReference },
        authorization: {
          authContract: authReference,
          permittedRoleIds: ["role_member"],
        },
        failureOutcomes: [
          {
            category: "application.validation.failed",
            retryable: false,
            description: "The request does not satisfy the contract.",
          },
        ],
      },
      {
        contractKind: "test-case",
        contractId: "contracts.notes.create-contract-test",
        contractVersion: "1.0.0",
        displayName: "Create note contract test",
        provenance,
        level: "contract",
        target: operationReference,
        preconditions: [
          {
            kind: "authenticated-role",
            authContract: authReference,
            roleId: "role_member",
          },
        ],
        fixtureReferences: [{ fixtureId: "fixture_note", digest }],
        expectations: [
          {
            expectationId: "expectation_status",
            kind: "http-status",
            statusCode: 201,
          },
          {
            expectationId: "expectation_contract",
            kind: "contract-conformance",
            contract: entityReference,
          },
        ],
      },
    ],
  } as const;
}

describe("Application Contracts v1 schema", () => {
  it("accepts canonical API, event, data, auth, behavior, and test records", () => {
    const parsed = applicationContractsV1Schema.parse(
      representativeContracts(),
    );

    expect(parsed.contracts.map(({ contractKind }) => contractKind)).toEqual([
      "data-entity",
      "auth",
      "http-api",
      "event-message",
      "behavior-operation",
      "test-case",
    ]);
    expect(generateApplicationContractsV1JsonSchema().$id).toContain(
      "application-contracts/v1",
    );
  });

  it("keeps references versioned, typed, and digest-bound", () => {
    expect(
      applicationContractReferenceV1Schema.parse(
        reference("data-entity", "contracts.notes.entity"),
      ),
    ).toMatchObject({
      contractKind: "data-entity",
      contractVersion: "1.0.0",
      digest,
    });

    expect(() =>
      applicationContractReferenceV1Schema.parse({
        contractKind: "data-entity",
        contractId: "contracts.notes.entity",
        contractVersion: "latest",
        digest: "not-a-digest",
      }),
    ).toThrow();
  });

  it.each(["rawCode", "secretValue"])(
    "rejects prohibited executable or secret field %s",
    (field) => {
      const document = representativeContracts();
      const [first, ...rest] = document.contracts;
      expect(first).toBeDefined();

      expect(() =>
        applicationContractsV1Schema.parse({
          ...document,
          contracts: [{ ...first, [field]: "must-not-be-retained" }, ...rest],
        }),
      ).toThrow();
    },
  );

  it("rejects arbitrary test payloads and executable test steps", () => {
    const document = representativeContracts();
    const test = document.contracts.find(
      ({ contractKind }) => contractKind === "test-case",
    );
    expect(test).toBeDefined();

    expect(() =>
      applicationContractsV1Schema.parse({
        ...document,
        contracts: document.contracts.map((contract) =>
          contract === test
            ? {
                ...contract,
                preconditions: ["npm test"],
              }
            : contract,
        ),
      }),
    ).toThrow();
  });

  it("rejects an HTTP body whose reference claims the wrong contract kind", () => {
    const document = representativeContracts();
    const route = document.contracts.find(
      ({ contractKind }) => contractKind === "http-api",
    );
    if (route?.contractKind !== "http-api") {
      throw new Error("Representative contracts must contain an HTTP body.");
    }

    expect(() =>
      applicationContractsV1Schema.parse({
        ...document,
        contracts: document.contracts.map((contract) =>
          contract === route
            ? {
                ...route,
                request: {
                  ...route.request,
                  body: {
                    ...route.request.body,
                    entity: {
                      ...route.request.body.entity,
                      contractKind: "auth",
                    },
                  },
                },
              }
            : contract,
        ),
      }),
    ).toThrow();
  });
});

describe("Application Contracts v1 canonical normalization", () => {
  it("sorts contract records and nested unordered fields without mutating input", () => {
    const parsed = applicationContractsV1Schema.parse(
      representativeContracts(),
    );
    const reordered = applicationContractsV1Schema.parse({
      ...parsed,
      contracts: [...parsed.contracts].reverse().map((contract) => {
        const base = {
          ...contract,
          provenance: {
            ...contract.provenance,
            sourceReferenceIds: [
              ...contract.provenance.sourceReferenceIds,
            ].reverse(),
          },
        };
        switch (contract.contractKind) {
          case "http-api":
            return {
              ...base,
              request: {
                ...contract.request,
                parameters: [...contract.request.parameters].reverse(),
              },
              responses: [...contract.responses].reverse().map((response) => ({
                ...response,
                headers: [...response.headers].reverse(),
              })),
            };
          case "event-message":
            return { ...base, headers: [...contract.headers].reverse() };
          case "data-entity":
            return {
              ...base,
              fields: [...contract.fields].reverse(),
              indexes: [...contract.indexes].reverse(),
              supportedOperations: [...contract.supportedOperations].reverse(),
            };
          case "auth":
            return {
              ...base,
              claims: [...contract.claims].reverse(),
              roles: [...contract.roles].reverse().map((role) => ({
                ...role,
                claimRequirements: [...role.claimRequirements].reverse(),
              })),
            };
          case "behavior-operation":
            return {
              ...base,
              authorization:
                contract.authorization === undefined
                  ? undefined
                  : {
                      ...contract.authorization,
                      permittedRoleIds: [
                        ...contract.authorization.permittedRoleIds,
                      ].reverse(),
                    },
              failureOutcomes: [...contract.failureOutcomes].reverse(),
            };
          case "test-case":
            return {
              ...base,
              preconditions: [...contract.preconditions].reverse(),
              fixtureReferences: [...contract.fixtureReferences].reverse(),
              expectations: [...contract.expectations].reverse(),
            };
        }
      }),
    });
    const before = JSON.stringify(reordered);

    expect(normalizeApplicationContractsV1(reordered)).toEqual(
      normalizeApplicationContractsV1(parsed),
    );
    expect(JSON.stringify(reordered)).toBe(before);
  });
});
