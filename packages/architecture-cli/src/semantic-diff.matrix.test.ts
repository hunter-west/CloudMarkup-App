import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import { describe, expect, it } from "vitest";

import {
  architectureCliSemanticSnapshotV1Schema,
  type ArchitectureCliSemanticSnapshotV1,
} from "./contracts.js";
import {
  diffArchitectureCliSemanticSnapshots,
  semanticSnapshotDigest,
} from "./semantic-diff.js";
import { architectureCliFixtureSnapshot } from "./test-fixtures.js";

function snapshot(
  input: Record<string, unknown>,
): ArchitectureCliSemanticSnapshotV1 {
  const candidate = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "snapshotDigest"),
  );
  const projection = architectureCliSemanticSnapshotV1Schema
    .omit({ snapshotDigest: true })
    .parse(candidate);
  return architectureCliSemanticSnapshotV1Schema.parse({
    ...projection,
    snapshotDigest: semanticSnapshotDigest(projection),
  });
}

function digest(value: unknown) {
  return sha256Digest(serializeCanonicalJson(value));
}

describe("semantic diff required change matrix", () => {
  it("identifies a Terraform-to-CloudFormation target difference", () => {
    const base = architectureCliFixtureSnapshot();
    const before = snapshot({ ...base, target: "terraform" });
    const after = snapshot({ ...base, target: "cloudformation" });

    expect(diffArchitectureCliSemanticSnapshots(before, after)).toEqual([
      expect.objectContaining({
        factId: "iac-target",
        kind: "target-changed",
        summary: "Infrastructure target changed.",
      }),
    ]);
  });

  it("reports services, connections, permissions, routes, events, contracts, operations, coverage, readiness, cost, exposure, and requirements", () => {
    const base = architectureCliFixtureSnapshot();
    const baseService = base.services[0];
    if (baseService === undefined)
      throw new Error("Fixture requires one service.");
    const before = snapshot({
      ...base,
      connections: [
        {
          digest: digest("old-edge"),
          id: "edge_old",
          relationshipType: "aws.lambda.reads-table",
          sourceId: "node_a",
          targetId: "node_b",
        },
      ],
      contracts: [
        {
          contractKind: "data",
          digest: digest("old-contract"),
          id: "contract_old",
          version: "1.0.0",
        },
      ],
      events: [
        {
          digest: digest("old-event"),
          eventType: "aws.event.api",
          id: "event_old",
          workloadId: "workload_notes",
        },
      ],
      permissions: [
        {
          action: "dynamodb:GetItem",
          digest: digest("old-permission"),
          effect: "allow",
          id: "permission_old",
          resource: "table:notes",
        },
      ],
      readiness: { reasons: [], state: "ready" },
      routes: [
        {
          digest: digest("old-route"),
          id: "route_old",
          method: "GET",
          pathTemplate: "/notes",
          workloadId: "workload_notes",
        },
      ],
      services: [
        {
          ...baseService,
          costSensitive: false,
          publicExposure: "private",
        },
      ],
      unresolvedRequirements: ["requirement_old"],
      workloadOperations: [
        {
          digest: digest("old-operation"),
          id: "operation_old",
          operationKind: "query",
          workloadId: "workload_notes",
        },
      ],
    });
    const after = snapshot({
      ...base,
      connections: [
        {
          digest: digest("new-edge"),
          id: "edge_new",
          relationshipType: "aws.lambda.writes-table",
          sourceId: "node_a",
          targetId: "node_b",
        },
      ],
      contracts: [
        {
          contractKind: "data",
          digest: digest("new-contract"),
          id: "contract_new",
          version: "1.0.0",
        },
      ],
      coverage: {
        ...base.coverage,
        missingRequirements: ["application-tests"],
      },
      events: [
        {
          digest: digest("new-event"),
          eventType: "aws.event.api",
          id: "event_new",
          workloadId: "workload_notes",
        },
      ],
      permissions: [
        {
          action: "dynamodb:PutItem",
          digest: digest("new-permission"),
          effect: "allow",
          id: "permission_new",
          resource: "table:notes",
        },
      ],
      readiness: { reasons: ["target-policy-review"], state: "blocked" },
      routes: [
        {
          digest: digest("new-route"),
          id: "route_new",
          method: "POST",
          pathTemplate: "/notes",
          workloadId: "workload_notes",
        },
      ],
      services: [
        {
          ...baseService,
          costSensitive: true,
          digest: digest("public-service"),
          publicExposure: "public",
        },
        {
          costSensitive: true,
          digest: digest("added-service"),
          generated: true,
          id: "node_table",
          publicExposure: "private",
          serviceType: "aws.dynamodb.table",
        },
      ],
      unresolvedRequirements: ["requirement_new"],
      workloadOperations: [
        {
          digest: digest("new-operation"),
          id: "operation_new",
          operationKind: "command",
          workloadId: "workload_notes",
        },
      ],
    });

    const kinds = new Set(
      diffArchitectureCliSemanticSnapshots(before, after).map(
        ({ kind }) => kind,
      ),
    );
    for (const kind of [
      "service-added",
      "service-changed",
      "connection-added",
      "connection-removed",
      "permission-expanded",
      "permission-reduced",
      "route-added",
      "route-removed",
      "event-added",
      "event-removed",
      "data-contract-added",
      "data-contract-removed",
      "workload-operation-added",
      "workload-operation-removed",
      "coverage-changed",
      "target-readiness-changed",
      "public-exposure-changed",
      "cost-sensitive-resource-changed",
      "unresolved-requirement-added",
      "unresolved-requirement-resolved",
    ]) {
      expect(kinds).toContain(kind);
    }
  });

  it("reports event contract, retry, DLQ, filter, batch, and handler changes explicitly", () => {
    const base = architectureCliFixtureSnapshot();
    const before = snapshot({
      ...base,
      contracts: [
        {
          contractKind: "event",
          digest: digest("event-contract-before"),
          id: "contract_event",
          version: "1.0.0",
        },
      ],
      eventPolicies: [
        {
          digest: digest("batch-before"),
          eventId: "event_orders",
          id: "policy_batch",
          policyKind: "batch",
          workloadId: "workload_orders",
        },
        {
          digest: digest("dlq-before"),
          eventId: "event_orders",
          id: "policy_dlq",
          policyKind: "dlq",
          workloadId: "workload_orders",
        },
        {
          digest: digest("filter-before"),
          eventId: "event_orders",
          id: "policy_filter",
          policyKind: "filter",
          workloadId: "workload_orders",
        },
        {
          digest: digest("retry-before"),
          eventId: "event_orders",
          id: "policy_retry",
          policyKind: "retry",
          workloadId: "workload_orders",
        },
      ],
      handlers: [
        {
          digest: digest("handler-before"),
          handlerKind: "aws.lambda.sqs-batch-handler",
          id: "handler_orders",
          workloadId: "workload_orders",
        },
      ],
    });
    const after = snapshot({
      ...before,
      contracts: before.contracts.map((contract) => ({
        ...contract,
        digest: digest("event-contract-after"),
      })),
      eventPolicies: before.eventPolicies?.map((policy) => ({
        ...policy,
        digest: digest(`${policy.policyKind}-after`),
      })),
      handlers: before.handlers?.map((handler) => ({
        ...handler,
        digest: digest("handler-after"),
      })),
    });

    expect(
      diffArchitectureCliSemanticSnapshots(before, after).map(
        ({ kind }) => kind,
      ),
    ).toEqual([
      "event-batch-changed",
      "event-contract-changed",
      "event-dlq-changed",
      "event-filter-changed",
      "event-retry-changed",
      "handler-changed",
    ]);

    const empty = snapshot({
      ...base,
      contracts: [],
      eventPolicies: [],
      handlers: [],
    });
    expect(
      diffArchitectureCliSemanticSnapshots(empty, before).map(
        ({ kind }) => kind,
      ),
    ).toEqual([
      "event-batch-added",
      "event-contract-added",
      "event-dlq-added",
      "event-filter-added",
      "event-retry-added",
      "handler-added",
    ]);
    expect(
      diffArchitectureCliSemanticSnapshots(before, empty).map(
        ({ kind }) => kind,
      ),
    ).toEqual([
      "event-batch-removed",
      "event-contract-removed",
      "event-dlq-removed",
      "event-filter-removed",
      "event-retry-removed",
      "handler-removed",
    ]);
  });

  it("never copies a malicious display label into semantic output", () => {
    const base = architectureCliFixtureSnapshot();
    const baseService = base.services[0];
    if (baseService === undefined)
      throw new Error("Fixture requires one service.");
    const malicious = snapshot({
      ...base,
      services: [
        {
          ...baseService,
          digest: digest("changed"),
          label:
            "](https://attacker.invalid/?token=secret) C:\\Users\\operator",
        },
      ],
    });
    const serialized = serializeCanonicalJson(
      diffArchitectureCliSemanticSnapshots(base, malicious),
    );
    expect(serialized).not.toMatch(/(?:attacker|token|secret|C:\\Users)/iu);
  });
});
