import { awsCatalogSourceV1 } from "./catalog/source.js";
import { createAwsConnectionPresentationSourceV1 } from "./catalog/connection-presentation.js";
import { createAwsProviderServiceExtensionSourceV1 } from "./catalog/service-extension.js";
import { readFileSync } from "node:fs";
import {
  applyGraphCommand,
  parseArchitectureDocument,
  executeArchitectureValidationRules,
  type ArchitectureDocument,
} from "@cloudmarkup/domain";
import { createProviderCatalogAccessorsV1 } from "@cloudmarkup/provider-sdk";
import {
  compileProviderCatalogV1,
  compileProviderConnectionPresentationV1,
  compileProviderServiceExtensionV1,
} from "@cloudmarkup/provider-sdk/compiler";
import { adaptProviderCatalogForEditor } from "@cloudmarkup/graph-preparation/provider-catalog-adapter";
import { editorConnectionGroupForPort } from "@cloudmarkup/graph-preparation/connection-docks";
import { createAddServiceCommand } from "@cloudmarkup/graph-preparation/add-service-command";
import { elbFixture } from "./elb-fixture.test-support.js";
import { describe, expect, it } from "vitest";
import {
  WAF_WEB_ACL,
  WAF_ASSOCIATION,
  WAF_ALB,
  WAF_PROTECTS,
  WAF_OWNER,
} from "./catalog/services/regional-waf.js";
import { createRegionalWafReadinessRule } from "./validation/regional-waf-rule.js";
import {
  regionalWafFixture,
  regionalWafResolver,
} from "./regional-waf-fixture.test-support.js";
import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";
import { resolveAwsCurrentCatalogV1 } from "./current-catalog.js";

const compilation = compileProviderCatalogV1(awsCatalogSourceV1);
const artifact = compilation.artifact;
const catalog = createProviderCatalogAccessorsV1(artifact);
const presentation = compileProviderConnectionPresentationV1(
  createAwsConnectionPresentationSourceV1(artifact),
  artifact,
);
const extension = compileProviderServiceExtensionV1(
  createAwsProviderServiceExtensionSourceV1(artifact),
  artifact,
);
const errors = (d: ArchitectureDocument) =>
  executeArchitectureValidationRules(
    { document: d, target: "draft", environment: "development" },
    [createRegionalWafReadinessRule(artifact)],
  ).findings.filter((f) => f.severity !== "warning");
const change = (d: ArchitectureDocument, key: string, value: unknown) =>
  parseArchitectureDocument({
    ...d,
    nodes: d.nodes.map((n) =>
      n.id === "web_waf"
        ? {
            ...n,
            semantic: {
              ...n.semantic,
              configuration: {
                ...n.semantic.configuration,
                values: { ...n.semantic.configuration.values, [key]: value },
              },
            },
          }
        : n,
    ),
  });

describe("current regional WAF proof with an existing public ALB", () => {
  it("extends one exact current catalog with honest CloudFormation proof readiness", () => {
    expect(awsCatalogArtifactV1).toEqual(artifact);
    expect(artifact.services).toHaveLength(73);
    expect(resolveAwsCurrentCatalogV1().catalog.artifact).toEqual(artifact);
    for (const id of [WAF_WEB_ACL, WAF_ASSOCIATION]) {
      const service = artifact.services.find((s) => s.id === id);
      expect(service?.supportLevel).toBe("proof");
      expect(service?.mappings.map((m) => m.target)).toEqual([
        "cloudformation",
      ]);
    }
  });
  it("reproduces current artifacts independently of source order", () => {
    expect(
      JSON.parse(
        readFileSync(
          new URL("./compiled/catalog-v1.json", import.meta.url),
          "utf8",
        ),
      ),
    ).toEqual(artifact);
    expect(
      compileProviderCatalogV1({
        ...awsCatalogSourceV1,
        services: [...awsCatalogSourceV1.services].reverse(),
        connectionRules: [...awsCatalogSourceV1.connectionRules].reverse(),
      }).canonicalJson,
    ).toBe(compilation.canonicalJson);
  });
  it("uses real graph commands, exact canvas docks and immutable save/reload", () => {
    const d = regionalWafFixture(artifact);
    expect(errors(d)).toEqual([]);
    const loaded = parseArchitectureDocument(JSON.parse(JSON.stringify(d)));
    expect(loaded).toEqual(d);
    const editor = adaptProviderCatalogForEditor(
      catalog,
      presentation,
      extension,
    );
    for (const id of [WAF_WEB_ACL, WAF_ASSOCIATION, WAF_ALB])
      expect(editor.services.some((s) => s.serviceType === id)).toBe(true);
    const association = editor.services.find(
      (s) => s.serviceType === WAF_ASSOCIATION,
    );
    const alb = editor.services.find((s) => s.serviceType === WAF_ALB);
    if (association === undefined || alb === undefined)
      throw new Error("Missing staged ALB/WAF service.");
    expect(
      editorConnectionGroupForPort(association, WAF_ASSOCIATION + ".alb")?.side,
    ).toBe("right");
    expect(editorConnectionGroupForPort(alb, WAF_ALB + ".waf")?.side).toBe(
      "left",
    );
    expect(association.targetReadiness?.terraform.status).toBe("pending");

    // Use the ordinary service-creation path with catalog-owned parent edges.
    // The ALB protection edge still requires a separate explicit connection.
    let nextId = 0;
    const createId = () => `waf_creation_${String(++nextId)}`;
    const currentEditor = { ...editor, parentEdges: "catalog" as const };
    const sourceWaf = d.nodes.find((node) => node.id === "web_waf");
    if (sourceWaf === undefined)
      throw Error("Missing WAF configuration fixture");
    const sourceBase = elbFixture(false, true);
    // Export fixtures do not promise editor layout. Put synthetic children in
    // the existing boundary content area before exercising normal creation.
    const base = parseArchitectureDocument({
      ...sourceBase,
      nodes: sourceBase.nodes.map((node) => ({
        ...node,
        presentation: {
          ...node.presentation,
          position: { x: 64, y: 192 },
        },
      })),
    });
    const addAcl = createAddServiceCommand({
      document: base,
      catalog: currentEditor,
      createId,
      serviceId: WAF_WEB_ACL,
      position: { x: 1200, y: 0 },
      configurationValues: sourceWaf.semantic.configuration.values,
    });
    const withAcl = applyGraphCommand(base, addAcl.command).document;
    const addAssociation = createAddServiceCommand({
      document: withAcl,
      catalog: currentEditor,
      createId,
      serviceId: WAF_ASSOCIATION,
      parentNodeId: addAcl.nodeId,
      position: { x: 1440, y: 0 },
    });
    const withAssociation = applyGraphCommand(
      withAcl,
      addAssociation.command,
    ).document;
    expect(
      withAssociation.edges.some(
        (edge) =>
          edge.semantic.relationshipType === WAF_OWNER &&
          edge.semantic.source.nodeId === addAssociation.nodeId &&
          edge.semantic.target.nodeId === addAcl.nodeId,
      ),
    ).toBe(true);
    expect(
      withAssociation.edges.some(
        (edge) => edge.semantic.relationshipType === WAF_PROTECTS,
      ),
    ).toBe(false);
    const protection = regionalWafResolver(artifact).resolve({
      document: withAssociation,
      operationId: createId(),
      ruleId: WAF_PROTECTS,
      source: {
        nodeId: addAssociation.nodeId,
        portId: WAF_ASSOCIATION + ".alb",
      },
      target: { nodeId: "alb", portId: WAF_ALB + ".waf" },
      configuration: {},
    });
    if (!protection.success) throw Error("Explicit WAF/ALB connection refused");
    expect(
      errors(applyGraphCommand(withAssociation, protection.batch).document),
    ).toEqual([]);
  });
  it.each([
    ["scope", "CLOUDFRONT"],
    ["defaultAction", "block"],
    ["managedRuleGroup", "AWSManagedRulesBotControlRuleSet"],
    ["requestLogging", "enabled"],
    ["rateWindowSeconds", 90],
    ["rateLimit", 9],
    ["rateLimit", 2000000001],
    ["ratePriority", -1],
    ["webAclRegion", "eu-west-1"],
  ])("rejects unsupported %s=%s", (key, value) => {
    const d = regionalWafFixture(artifact);
    const type = typeof value === "number" ? "integer" : "string";
    expect(
      errors(change(d, key, { kind: type, value })).length,
    ).toBeGreaterThan(0);
  });
  it("rejects duplicate priorities, missing and duplicate associations and non-ALB targets", () => {
    const d = regionalWafFixture(artifact);
    expect(
      errors(change(d, "ratePriority", { kind: "integer", value: 10 })).some(
        (f) => f.code === "aws.validation.waf-priorities",
      ),
    ).toBe(true);
    for (const rel of [WAF_OWNER, WAF_PROTECTS])
      expect(
        errors(
          parseArchitectureDocument({
            ...d,
            edges: d.edges.filter((e) => e.semantic.relationshipType !== rel),
          }),
        ).length,
      ).toBeGreaterThan(0);
    const e = d.edges.find((e) => e.semantic.relationshipType === WAF_PROTECTS);
    if (e === undefined) throw new Error("Missing WAF ALB binding.");
    expect(
      errors(
        parseArchitectureDocument({
          ...d,
          edges: [...d.edges, { ...e, id: "duplicate_association" }],
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      errors(
        parseArchitectureDocument({
          ...d,
          edges: d.edges.map((x) =>
            x.id === e.id
              ? {
                  ...x,
                  semantic: {
                    ...x.semantic,
                    target: {
                      nodeId: "certificate",
                      port: "aws.acm.public-dns-certificate.alb-listener",
                    },
                  },
                }
              : x,
          ),
        }),
      ).length,
    ).toBeGreaterThan(0);
  });
  it("cleans only the chosen relationship and retains ACL/ALB/association resources", () => {
    const d = regionalWafFixture(artifact),
      resolver = regionalWafResolver(artifact);
    const e = d.edges.find((e) => e.semantic.relationshipType === WAF_PROTECTS);
    if (e === undefined) throw new Error("Missing WAF ALB binding.");
    const cleanup = resolver.cleanup({
      document: d,
      connectionEdgeId: e.id,
      operationId: "waf_cleanup",
    });
    if (!cleanup.success) throw Error(JSON.stringify(cleanup));
    const result = applyGraphCommand(d, cleanup.batch);
    expect(result.document.nodes).toEqual(d.nodes);
    expect(result.document.edges).toHaveLength(d.edges.length - 1);
    if (result.inversion.kind !== "available")
      throw Error("Missing WAF inverse");
    expect(
      applyGraphCommand(result.document, result.inversion.command).document,
    ).toEqual(d);
  });
});
