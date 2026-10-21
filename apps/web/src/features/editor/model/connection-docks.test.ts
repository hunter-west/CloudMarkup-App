import { awsConnectionResolverV1 } from "@cloudmarkup/provider-aws";
import { describe, expect, it } from "vitest";

import { awsEditorCatalog } from "../../../provider-catalog/aws-editor-catalog.js";
import { loadAwsEditorArchitectureDocument } from "../../../provider-catalog/aws-editor-fixture.js";
import { foundationEditorCatalog } from "./foundation-editor-fixture.js";
import {
  deriveEditorConnectionGroups,
  editorConnectionGroupForPort,
  editorConnectionDockSide,
  editorDockHandleId,
  inspectEditorConnectionDock,
  resolveEditorConnectionGroups,
  validateEditorConnectionGroups,
} from "./connection-docks.js";

function computeService() {
  const service = foundationEditorCatalog.services.find(
    (candidate) => candidate.serviceType === "example.compute",
  );
  if (service === undefined) {
    throw new Error("The foundation compute service is required.");
  }
  return service;
}

describe("connection docks", () => {
  it("derives deterministic provider-neutral groups from exact catalog ports", () => {
    const service = computeService();
    const expected = [
      {
        direction: "input",
        exclusivePortIds: [],
        id: "invokes-another-workload",
        label: "Invocations",
        portIds: ["example.port.request"],
        side: "left",
      },
      {
        direction: "output",
        exclusivePortIds: ["example.port.network-client"],
        id: "network-and-security",
        label: "Identity & network",
        portIds: ["example.port.network-client"],
        side: "right",
      },
    ];

    expect(deriveEditorConnectionGroups(service.ports)).toMatchObject(expected);
    expect(
      deriveEditorConnectionGroups([...service.ports].reverse()),
    ).toMatchObject(expected);
    expect(
      editorConnectionGroupForPort(service, "example.port.network-client")?.id,
    ).toBe("network-and-security");
    expect(editorDockHandleId("network-and-security", "output")).toBe(
      "dock:network-and-security:output",
    );
    expect(editorConnectionDockSide("input")).toBe("left");
    expect(editorConnectionDockSide("output")).toBe("right");
  });

  it("accepts complete validated declarations and normalizes exact port order", () => {
    const service = computeService();
    const groups = deriveEditorConnectionGroups(service.ports).map((group) => ({
      ...group,
      portIds: [...group.portIds].reverse(),
    }));

    expect(validateEditorConnectionGroups(service.ports, groups)).toEqual(
      deriveEditorConnectionGroups(service.ports),
    );
  });

  it("fails closed when declared groups omit or duplicate an exact port", () => {
    const service = computeService();
    const groups = deriveEditorConnectionGroups(service.ports);
    const omitted = groups.slice(1);
    const duplicated = groups.map((group, index) =>
      index === 1
        ? { ...group, portIds: groups[0]?.portIds ?? group.portIds }
        : group,
    );

    expect(validateEditorConnectionGroups(service.ports, omitted)).toBeNull();
    expect(
      validateEditorConnectionGroups(service.ports, duplicated),
    ).toBeNull();
    expect(
      resolveEditorConnectionGroups({
        connectionGroups: omitted,
        ports: service.ports,
      }),
    ).toEqual([]);
  });

  it("maps actual AWS Lambda read and write ports to one stable data dock handle", () => {
    const lambda = awsEditorCatalog.services.find(
      (service) => service.serviceType === "aws.lambda.function",
    );
    if (lambda === undefined) {
      throw new TypeError("The exact AWS Lambda catalog service is required.");
    }

    const readGroup = editorConnectionGroupForPort(
      lambda,
      "aws.lambda.function.data-read",
    );
    const writeGroup = editorConnectionGroupForPort(
      lambda,
      "aws.lambda.function.data-write",
    );
    expect(readGroup?.id).toBe("aws.lambda.function.dock.data");
    expect(writeGroup?.id).toBe(readGroup?.id);
    expect(editorDockHandleId(readGroup?.id ?? "missing", "output")).toBe(
      "dock:aws.lambda.function.dock.data:output",
    );
    expect(editorDockHandleId(writeGroup?.id ?? "missing", "output")).toBe(
      "dock:aws.lambda.function.dock.data:output",
    );
  });

  it("projects only exact resolver-compatible resources before opening a workflow", () => {
    const document = loadAwsEditorArchitectureDocument();
    const inspection = inspectEditorConnectionDock(
      document,
      awsEditorCatalog,
      awsConnectionResolverV1,
      "node_api_handler",
      ["aws.lambda.function.data-read", "aws.lambda.function.data-write"],
    );

    expect(inspection.unavailableReason).toBeNull();
    expect(
      inspection.purposes.map((purpose) => ({
        choices: purpose.choices.map((choice) => ({
          available: choice.available,
          label: choice.remoteNodeLabel,
          recommendation: choice.recommendation?.professional,
          relationship: choice.relationshipLabel,
          service: choice.remoteServiceName,
          source: choice.source,
          target: choice.target,
        })),
        portId: purpose.portId,
      })),
    ).toEqual([
      {
        choices: [
          {
            available: true,
            label: "Notes data",
            recommendation:
              "Sole exact implemented resolver candidate for this semantic port with no compatibility findings.",
            relationship: "Reads from",
            service: "DynamoDB table",
            source: {
              nodeId: "node_api_handler",
              portId: "aws.lambda.function.data-read",
            },
            target: {
              nodeId: "node_notes_table",
              portId: "aws.dynamodb.table.table-api",
            },
          },
        ],
        portId: "aws.lambda.function.data-read",
      },
      {
        choices: [
          {
            available: true,
            label: "Notes data",
            recommendation:
              "Sole exact implemented resolver candidate for this semantic port with no compatibility findings.",
            relationship: "Writes to",
            service: "DynamoDB table",
            source: {
              nodeId: "node_api_handler",
              portId: "aws.lambda.function.data-write",
            },
            target: {
              nodeId: "node_notes_table",
              portId: "aws.dynamodb.table.table-api",
            },
          },
        ],
        portId: "aws.lambda.function.data-write",
      },
    ]);
    expect(JSON.stringify(inspection)).not.toContain("People sign-in");
    expect(JSON.stringify(inspection)).not.toContain("Imported resource");
  });

  it("fails dock inspection closed with a precise unavailable reason", () => {
    const document = loadAwsEditorArchitectureDocument();
    const inspection = inspectEditorConnectionDock(
      document,
      awsEditorCatalog,
      undefined,
      "node_api_handler",
      ["aws.lambda.function.data-read"],
    );

    expect(inspection.purposes[0]?.choices).toEqual([]);
    expect(inspection.purposes[0]?.unavailableReason?.professional).toBe(
      "No ProviderConnectionResolver v1 is bound to this editor session.",
    );
  });
});
