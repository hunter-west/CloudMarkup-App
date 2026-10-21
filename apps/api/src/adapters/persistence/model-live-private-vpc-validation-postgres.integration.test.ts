import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "./migrations.js";
import { sql } from "./sql.js";
import { PostgresModelLiveCommercialAccounting } from "./model-live-commercial-accounting.js";
import { readProductionModelLiveObservationV2 } from "../../production-model-live-observation.js";
import { awsCatalogV1 } from "@cloudmarkup/provider-aws/catalog";
import { assessModelLivePrivateVpcCaseV2 } from "../../model-live-private-vpc-case-assessment.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  frozenFullBetaEvaluationDatasetV1,
  validateModelResponseAuthority,
  inspectModelValueForSecretCandidatesV1,
} from "@cloudmarkup/model-gateway";
import { modelOperationProposalResponseV1Schema } from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import { createProductionModelLiveCaseRequest } from "../../production-model-live-case-request.js";
import { createSyntheticPrivateVpcGraph } from "../../model-live-private-vpc-test-helpers.js";
import { prepareProductionModelLiveProposalValidation } from "../../production-model-live-proposal-validation.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Synthetic provider responses through actual PostgreSQL, fixed production
 * rules, command previews and both review flows. No hosted-quality evidence. */
integration("durable actual private-network case assessment", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 120000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture(completeNetwork = true) {
    const evaluationCase = frozenFullBetaEvaluationDatasetV1.cases.find(
      (c) => c.caseKind === "private-vpc-application",
    );
    if (!evaluationCase) throw Error("Missing private-network source");
    const request = createProductionModelLiveCaseRequest({
      caseId: evaluationCase.caseId,
      requestedMode: "guided",
    });
    if (request.operation !== "operations.propose") throw Error("Wrong source");
    const f = await createLiveHostEvidencePgFixture(
      harness,
      "candidate",
      true,
      true,
      "standard",
      { request, caseId: evaluationCase.caseId, fullBeta: true },
    );
    const response = modelOperationProposalResponseV1Schema.parse(
      f.gatewayResult.response,
    );
    if (completeNetwork) {
      const { doc } = createSyntheticPrivateVpcGraph(true);
      for (const node of doc.nodes) {
        node.semantic.lifecycle = { origin: "ai-accepted", ownership: "user" };
        const values = node.semantic.configuration.values;
        for (const [key, value] of Object.entries(values))
          if (
            key === "policyKind" &&
            value.kind === "string" &&
            value.value === "generated-permission"
          )
            value.value = "identity-inline";
        if (
          node.semantic.parent?.relationshipType ===
          "aws.iam.role-owns-generated-permission"
        )
          node.semantic.parent.relationshipType =
            "aws.iam.role-owns-inline-policy" as NonNullable<
              typeof node.semantic.parent
            >["relationshipType"];
      }
      for (const edge of doc.edges) {
        edge.semantic.lifecycle = { origin: "ai-accepted", ownership: "user" };
        if (
          edge.semantic.relationshipType ===
          "aws.iam.role-owns-generated-permission"
        ) {
          const rule = awsCatalogV1
            .listConnectionRules()
            .find(
              (r) => r.relationshipType === "aws.iam.role-owns-inline-policy",
            );
          if (!rule) throw Error("Missing real inline-policy rule");
          edge.semantic.relationshipType = rule.relationshipType;
          edge.semantic.source.port = rule.source.portId;
          edge.semantic.target.port = rule.target.portId;
          edge.semantic.configuration = {
            schemaId: rule.configuration.schemaId,
            schemaVersion: rule.configuration.schemaVersion,
            values: {},
          };
        }
      }
      // New model proposals declare explicit user-owned policies. They cannot
      // claim connection-generated ownership. Parent/reference dependencies
      // must exist before each real add-node command is validated.
      const ordered: typeof doc.nodes = [],
        remaining = doc.nodes.filter((n) => n.id !== "region_evaluation");
      const seen = new Set<string>(["region_evaluation"]);
      while (remaining.length) {
        const index = remaining.findIndex(
          (n) =>
            (!n.semantic.parent || seen.has(n.semantic.parent.nodeId)) &&
            Object.values(n.semantic.configuration.values).every(
              (v) => v.kind !== "node-reference" || seen.has(v.nodeId),
            ),
        );
        if (index < 0) throw Error("Synthetic graph dependency cycle");
        const node = remaining.splice(index, 1)[0];
        if (!node) throw Error("Missing synthetic node");
        ordered.push(node);
        seen.add(node.id);
      }
      const target = {
        architectureId: request.architecture.architectureId,
        documentId: request.architecture.documentId,
        revisionId: request.architecture.revision.revisionId,
      };
      const envelope = (id: string) => ({
        schemaVersion: 1,
        commandId: id,
        inverseCommandId: id + "_inverse",
        origin: "ai-accepted",
        target,
      });
      response.batches =
        modelOperationProposalResponseV1Schema.shape.batches.parse([
          {
            kind: "graph",
            batch: {
              ...envelope("batch_private_network"),
              kind: "batch",
              commands: [
                ...ordered.map((node, i) => ({
                  ...envelope("add_node_" + String(i)),
                  kind: "add-node",
                  node,
                })),
                ...doc.edges.map((edge, i) => ({
                  ...envelope("add_edge_" + String(i)),
                  kind: "add-edge",
                  edge,
                })),
              ],
            },
          },
        ]);
    }
    Object.assign(f.gatewayResult.response, response);
    if (!f.liveRouting || !f.executionInput)
      throw Error("Missing scoped execution");
    const context = f.liveRouting.context;
    const solutionRevisionId = context.scope.solutionRevisionId;
    if (!solutionRevisionId) throw Error("Missing scoped solution revision");
    const host = await prepareProductionModelLiveProposalValidation({
      invocation: f.hostInput.invocation,
      context: f.liveRouting.context,
      execution: f.executionInput,
      allowedApprovalPathIds: [],
    });
    if (!host) throw Error("Missing fixed validator");
    const issue = (overrides: Partial<Parameters<typeof host.issue>[0]> = {}) =>
      host.issue({
        plans: f.plans,
        evidence: f.issuer,
        journal: f.journal,
        result: f.gatewayResult,
        signal: new AbortController().signal,
        authorize: () => Promise.resolve(),
        ...overrides,
      });
    const assess = async () => {
      expect(
        inspectModelValueForSecretCandidatesV1(f.gatewayResult.response)
          .detectedValueCount,
      ).toBe(0);
      validateModelResponseAuthority({
        allowedApprovalPathIds: new Set(),
        descriptor: f.gatewayResult.descriptor,
        request: f.hostInput.invocation.request,
        response: f.gatewayResult.response,
      });
      expect(
        new TextEncoder().encode(JSON.stringify(f.gatewayResult.response))
          .byteLength,
      ).toBeLessThanOrEqual(f.hostInput.invocation.maximumOutputBytes);
      await f.issuer.issueOutput({
        invocation: f.hostInput.invocation,
        result: f.gatewayResult,
        journal: f.journal,
      });
      const commercialWorkflow = await f.journal.withCompletedOutputMetadata(
        f.gatewayResult,
        ({ commercialWorkflow }) => Promise.resolve(commercialWorkflow),
      );
      return assessModelLivePrivateVpcCaseV2({
        evaluationCase,
        proposal: {
          input: {
            createdAt: f.hostInput.plan.issuedAt,
            gatewayContext: context,
            modelRequest: request,
            solutionRevisionId,
            validationEnvironment: "production",
          },
          result: {
            ...f.gatewayResult,
            response: modelOperationProposalResponseV1Schema.parse(
              f.gatewayResult.response,
            ),
          },
          dependencies: { allowedApprovalPathIds: new Set() },
        },
        commercialWorkflow,
        authorization: {
          authorizeStart: () =>
            Promise.resolve({
              allowed: true,
              decisionId: "synthetic_private_vpc",
              evaluatedAt: f.hostInput.plan.issuedAt,
              principalId: f.scope.userId,
              reason: null,
            }),
          authorizeReview: () =>
            Promise.reject(Error("No synthetic review application")),
        },
      });
    };
    const accounting = new PostgresModelLiveCommercialAccounting({
      database: f.database,
      scope: f.scope,
      binding: f.binding,
      plans: f.plans,
      ...f.identity,
    });
    const observe = () =>
      readProductionModelLiveObservationV2({
        journal: f.journal,
        accounting,
        request: f.record.request,
        admissionRequest: f.runtime.request,
        authorize: () => Promise.resolve(),
      });
    const receipts = () =>
      harness.database.query(
        sql(
          "SELECT receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1",
          [f.scope.organizationId],
        ),
      );
    return { ...f, issue, assess, observe, receipts };
  }
  it.each([false, true])(
    "records completeNetwork=%s from real validator work without granting quality",
    async (completeNetwork) => {
      const f = await fixture(completeNetwork);
      await f.complete();
      if (completeNetwork) {
        const value = await f.assess();
        expect(
          value.preferences.assessment.validationOutcome,
          JSON.stringify({
            states: value.preferences.workflows.map((w) => w.state),
            issues: value.preferences.assessment.activeIssues.map((i) => ({
              severity: i.severity,
              affected: i.affected.length,
              summary: i.summary,
              detailLength: i.technicalDetail.length,
            })),
            measurements: value.metadata.measurements.map((m) => ({
              dimension: m.dimension,
              numerator: m.numerator,
            })),
          }),
        ).toBe("passed");
        expect(
          value.preferences.workflows.map((w) => w.state),
          JSON.stringify(
            value.preferences.assessment.modelResult.response.proposalContext,
          ),
        ).toEqual(["review-ready", "review-ready"]);
      }
      const receipt = await f.issue();
      expect(receipt.assessment.validatorVersion).toBe("2.3.0");
      expect(receipt.assessment.measurements).toHaveLength(8);
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        )?.numerator,
      ).toBe(completeNetwork ? 13 : 1);
      expect(await f.issue()).toEqual(receipt);
      expect((await f.journal.readValidatedUsage()).receipt).toEqual(receipt);
      const observation = await f.observe();
      expect(observation.observation.measurements).toHaveLength(12);
      expect(observation.caseResult.outputDigest).toBe(
        receipt.assessment.outputDigest,
      );
      expect(
        receipt.assessment.measurements.find(
          (m) => m.dimension === "issue-clarity-correct-severity",
        )?.numerator,
      ).toBe(completeNetwork ? 1 : 0);
      if (!completeNetwork)
        expect(observation.caseResult.deterministicPassed).toBe(false);
      expect(JSON.stringify(await f.receipts())).not.toContain(
        "PrivateTableEndpoint",
      );
    },
    120000,
  );
  it.each([
    "cancelled",
    "withdrawn",
    "output-replaced",
    "unauthenticated",
  ] as const)(
    "denies %s without issuing a receipt",
    async (kind) => {
      const f = await fixture();
      await f.complete();
      const controller = new AbortController();
      if (kind === "cancelled") controller.abort();
      if (kind === "withdrawn") f.removeOperators();
      if (kind === "output-replaced")
        Reflect.set(f.gatewayResult.response, "unexpectedGrade", true);
      await expect(
        f.issue({
          signal: controller.signal,
          ...(kind === "unauthenticated"
            ? {
                authorize: () =>
                  Promise.reject(Error("Synthetic denied authority")),
              }
            : {}),
        }),
      ).rejects.toThrow();
      expect((await f.receipts()).rowCount).toBe(0);
    },
    120000,
  );
  it("issues one immutable receipt under concurrent validation", async () => {
    const f = await fixture();
    await f.complete();
    const receipts = await Promise.all([f.issue(), f.issue()]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect((await f.receipts()).rowCount).toBe(1);
  }, 120000);
  it("denies cross-tenant completed journal substitution", async () => {
    const f = await fixture(),
      other = await fixture();
    await f.complete();
    await other.complete();
    await expect(f.issue({ journal: other.journal })).rejects.toThrow();
    await expect(other.issue({ result: f.gatewayResult })).rejects.toThrow();
    expect((await f.receipts()).rowCount).toBe(0);
    expect((await other.receipts()).rowCount).toBe(0);
  }, 120000);
  it.each(["before-receipt", "before-settlement"] as const)(
    "rechecks current tenant membership %s",
    async (phase) => {
      const f = await fixture();
      await f.complete();
      if (phase === "before-settlement") await f.issue();
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      if (phase === "before-receipt") await expect(f.issue()).rejects.toThrow();
      else await expect(f.observe()).rejects.toThrow();
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT 1 FROM usage_ledger_entries WHERE organization_id=$1 AND entry_kind='settlement'",
              [f.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
    },
    120000,
  );
  it("rejects missing, altered and externally graded assessment metadata at the SQL boundary", async () => {
    const f = await fixture();
    await f.complete();
    const receipt = await f.issue();
    for (const mutate of [
      (v: typeof receipt.assessment) => {
        v.measurements.pop();
      },
      (v: typeof receipt.assessment) => {
        const coverage = v.measurements.find(
          (m) => m.dimension === "capability-requirement-coverage",
        );
        if (coverage) coverage.denominator = 12;
      },
      (v: typeof receipt.assessment) => {
        Reflect.set(v, "passed", true);
      },
    ]) {
      const candidate = structuredClone(receipt.assessment);
      mutate(candidate);
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT cloudmarkup_live_proposal_assessment_shape($1::jsonb) AS valid",
              [JSON.stringify(candidate)],
            ),
          )
        ).rows[0]?.["valid"],
      ).toBe(false);
    }
  }, 120000);
  it("preserves all 47 historical migrations byte-for-byte", async () => {
    const migrations = await loadMigrations(
      fileURLToPath(new URL("../../../migrations", import.meta.url)),
    );
    expect(migrations).toHaveLength(120);
    expect(migrations.reduce((n, m) => n + m.statements.length, 0)).toBe(1367);
    const prior = {
      storageContractVersion: 1,
      migrations: migrations
        .slice(0, 47)
        .map(({ version, file, checksumSha256 }) => ({
          version,
          file,
          checksumSha256,
        })),
    };
    expect(
      createHash("sha256")
        .update(JSON.stringify(prior, null, 2) + "\n")
        .digest("hex"),
    ).toBe("3e1098b55f47cd19a4be88147557b48ac189a9d6156880e74a67cb1b5d23b46a");
    expect(
      migrations.find(({ version }) => version === "0048")?.statements,
    ).toHaveLength(2);
  });
});
