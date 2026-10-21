import {
  executeArchitectureValidationRules,
  parseArchitectureDocument,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";
import { elbFixture } from "./elb-fixture.test-support.js";
import { awsValidationRulesV1 } from "./validation/index.js";

const findings = (document: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document, target: "draft", environment: "development" },
    awsValidationRulesV1,
  ).findings;
const errors = (document: ArchitectureDocument) =>
  findings(document).filter((finding) => finding.severity.includes("error"));

function unrelatedConsumer(
  document: ArchitectureDocument,
  ecs: boolean,
  sourceGroup: boolean,
) {
  const originalId = ecs ? "service" : "instance";
  const original = document.nodes.find((node) => node.id === originalId);
  if (!original) throw Error("Missing synthetic backend");
  const id = "bystander_backend";
  const bystander = {
    ...original,
    id,
    presentation: { ...original.presentation, label: "Unrelated workload" },
    semantic: {
      ...original.semantic,
      deploymentKey: id,
      configuration: {
        ...original.semantic.configuration,
        values: {
          ...original.semantic.configuration.values,
          ...(ecs
            ? { name: { kind: "string" as const, value: "SyntheticBystander" } }
            : {}),
        },
      },
    },
  };
  const bindings = document.edges
    .filter(
      (edge) =>
        !edge.semantic.relationshipType.startsWith("aws.elb.") &&
        (edge.semantic.source.nodeId === originalId ||
          edge.semantic.target.nodeId === originalId),
    )
    .map((edge) => ({
      ...edge,
      id: "bystander_" + edge.id,
      semantic: {
        ...edge.semantic,
        source: {
          ...edge.semantic.source,
          nodeId:
            edge.semantic.source.nodeId === originalId
              ? id
              : edge.semantic.source.nodeId,
        },
        target: {
          ...edge.semantic.target,
          nodeId:
            edge.semantic.target.nodeId === originalId
              ? id
              : edge.semantic.relationshipType.endsWith(
                    "uses-security-group",
                  ) && sourceGroup
                ? "alb_group"
                : edge.semantic.target.nodeId,
        },
      },
    }));
  return parseArchitectureDocument({
    ...document,
    nodes: [...document.nodes, bystander],
    edges: [...document.edges, ...bindings],
  });
}

describe("dedicated ALB group consumer isolation", () => {
  {
    it(`preserves multiple tasks in one selected Fargate service for current`, () => {
      const base = elbFixture(true);
      const document = parseArchitectureDocument({
        ...base,
        nodes: base.nodes.map((node) => ({
          ...node,
          semantic: {
            ...node.semantic,
            configuration: {
              ...node.semantic.configuration,
              values: {
                ...node.semantic.configuration.values,
                ...(node.id === "service"
                  ? { desiredCount: { kind: "integer", value: 3 } }
                  : {}),
                ...(node.id === "image"
                  ? {
                      publicationStatus: {
                        kind: "string",
                        value: "externally-confirmed",
                      },
                    }
                  : {}),
              },
            },
          },
        })),
        edges: base.edges.map((edge) => ({
          ...edge,
          semantic: {
            ...edge.semantic,
            configuration: {
              ...edge.semantic.configuration,
              values: {
                ...edge.semantic.configuration.values,
                ...("populationStatus" in edge.semantic.configuration.values
                  ? {
                      populationStatus: {
                        kind: "string",
                        value: "externally-confirmed",
                      },
                    }
                  : {}),
              },
            },
          },
        })),
      });
      const before = structuredClone(document);
      expect(errors(document)).toEqual([]);
      expect(document).toEqual(before);
    });
  }
  {
    for (const ecs of [false, true]) {
      for (const sourceGroup of [false, true]) {
        const name = `current/${ecs ? "Fargate" : "EC2"}/${sourceGroup ? "source" : "backend"}`;
        it(`rejects an unrelated workload sharing ${name}`, () => {
          const current = elbFixture(ecs);
          const document = current;
          expect(errors(document)).toEqual([]);
          const changed = unrelatedConsumer(document, ecs, sourceGroup);
          const before = structuredClone(changed);
          const rejected = errors(changed);
          expect(rejected.map((finding) => finding.code)).toEqual([
            "aws.validation.elb-shared-access",
          ]);
          expect(rejected[0]?.severity).toBe("security-error");
          expect(rejected[0]?.affected).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ nodeId: "target" }),
            ]),
          );
          expect(findings(changed)).toEqual(findings(changed));
          expect(changed).toEqual(before);
        });
      }
    }
  }
});
