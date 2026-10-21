import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelTestContext } from "@cloudmarkup/model-gateway/testing";
import {
  digestStructuredValue,
  ModelRuntimeControlError,
} from "@cloudmarkup/model-gateway";
import { modelAccountingFixture } from "./adapters/persistence/model-commercial-accounting-test-helpers.js";
import { seedModelCommercialReadPriceFixture } from "./adapters/persistence/model-commercial-read-host-test-helpers.js";
import { parseModelCommercialReadSelectors } from "./adapters/persistence/model-commercial-read-host-codec.js";
import { namespacedIdentifierSchema } from "@cloudmarkup/schemas";
import { createPreviewAuthorityFixture } from "./adapters/persistence/ai-intent-preview-authority-test-helpers.js";
import { aiPreviewFixture } from "./adapters/persistence/ai-intent-preview-test-helpers.js";
import type { AiIntentPreviewResolvedV1 } from "./application/ai-intent-preview.js";
import { createProductionAiIntentPreview } from "./production-ai-intent-preview.js";
import { deniedPreviewFactoryFixture } from "./production-ai-intent-preview-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./adapters/persistence/model-commercial-accounting-pg-test-helpers.js";
import { sql } from "./adapters/persistence/sql.js";
import { AiIntentPreviewError } from "./application/ai-intent-preview-journal.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
/** Component-only PG acceptance. Normal model evaluation authority is missing;
 * no fixture relabels evaluation or pretends this is a usable AI end-to-end. */
integration("real preview factory metadata and denied normal admission", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(() => harness.setup(), 60000);
  afterAll(() => harness.teardown(), 30000);
  async function fixture() {
    const tenant = await harness.tenant();
    const f = deniedPreviewFactoryFixture({
      database: harness.database,
      scope: tenant.scope,
    });
    const scope = f.input.invocation.descriptor.scope;
    if (scope.projectId === undefined || scope.jobId === undefined)
      throw new Error("Missing synthetic factory scope.");
    const authorityFixture = await createPreviewAuthorityFixture(
      harness.database,
      {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
        jobId: scope.jobId,
      },
    );
    const accounting = await modelAccountingFixture(
      new Date().toISOString(),
      tenant.scope,
      "",
      undefined,
      {
        ...authorityFixture.preview,
        pricing: {
          pricingVersionId: f.input.commercial.selectors.pricingVersionId,
        },
      },
    );
    const pin =
      accounting.record.resolvedContext?.estimateResult.pricingAuthority
        .routePins[0];
    if (pin === undefined)
      throw new Error("Missing synthetic canonical price pin.");
    await seedModelCommercialReadPriceFixture(
      harness.database,
      tenant.administration,
      pin.pricingVersion,
      pin.normalizationPolicy,
    );
    const selectors = parseModelCommercialReadSelectors({
      ...f.input.commercial.selectors,
      pricingVersionDigest: digestStructuredValue(pin.pricingVersion),
      normalizationPolicyVersionId:
        pin.normalizationPolicy.normalizationPolicyVersionId,
      normalizationPolicyDigest: digestStructuredValue(pin.normalizationPolicy),
    });
    return {
      tenant,
      ...f,
      authorityFixture,
      input: {
        ...f.input,
        requestAuthority: authorityFixture.authority,
        commercial: { ...f.input.commercial, selectors },
      },
    };
  }
  async function state(organizationId: string) {
    const result = await harness.database.query(
      sql(
        `SELECT
      (SELECT count(*)::int FROM model_runtime_host_evidence WHERE organization_id=$1) AS evidence,
      (SELECT count(*)::int FROM model_runtime_admissions WHERE organization_id=$1) AS admissions,
      (SELECT count(*)::int FROM model_commercial_workflows WHERE organization_id=$1) AS workflows,
      (SELECT count(*)::int FROM credit_reservations WHERE organization_id=$1) AS credits,
      (SELECT count(*)::int FROM model_platform_spend_reservations WHERE organization_id=$1) AS spending`,
        [organizationId],
      ),
    );
    return result.rows[0];
  }
  it("issues only real bounded deterministic metadata before the missing normal authority denies", async () => {
    const f = await fixture();
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.resolve).toHaveBeenCalledOnce();
    const argument = f.resolve.mock.calls[0]?.[0];
    expect(argument?.commercialSnapshot).toMatchObject({
      contractVersion: 1,
      featureEnabled: true,
      balance: {
        organizationId: f.tenant.scope.organizationId,
        availableCreditUnits: "100",
      },
      selectors: f.input.commercial.selectors,
    });
    expect(argument?.commercialSnapshot).not.toHaveProperty(
      "maximumInputUnits",
    );
    expect(argument?.commercialSnapshot).not.toHaveProperty("estimateAccepted");
    expect(argument?.commercialSnapshot).not.toHaveProperty(
      "admissionDecision",
    );
    expect(argument?.inputEvidence).toMatchObject({
      recordKind: "model-runtime-input-evidence",
      operation: "intent.extract",
      organizationId: f.tenant.scope.organizationId,
    });
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 1,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
    const rows = await harness.database.query(
      sql(
        "SELECT evidence_record::text AS record FROM model_runtime_host_evidence WHERE organization_id=$1",
        [f.tenant.scope.organizationId],
      ),
    );
    const serialized = JSON.stringify(rows.rows);
    if (f.input.invocation.request.operation !== "intent.extract")
      throw new Error("Synthetic Intent missing.");
    expect(serialized).not.toContain(f.input.invocation.request.source.content);
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("rejects a returned unapproved normal candidate at the actual strict runtime metadata boundary", async () => {
    const f = await fixture();
    const candidate = aiPreviewFixture(f.input.invocation.descriptor.scope);
    f.resolve.mockImplementationOnce(({ inputEvidence }) => {
      const routingDecision = {
        routeId: "standard-design",
        outcome: "selected",
        feature: "intent.extract",
        requestedMode: "guided",
      };
      const routingRequest = { environment: "production" };
      // Deliberately no evaluation report/policy/admission decision. A returned
      // host candidate is comparison input, not normal runtime authority.
      const unapproved = {
        baseline: {
          draftEtag: '"synthetic-head"',
          editingLeaseId: "projectlease_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
        modelRequest: candidate.modelRequest,
        context: {
          ...modelTestContext(candidate.binding.invocationId),
          scope: candidate.scope,
          invocationId: candidate.binding.invocationId,
          idempotencyKeyDigest: candidate.binding.idempotencyKeyDigest,
          routingDecision,
          routingRequest,
        },
        runtime: {
          commercialRequest: candidate.request,
          routingDecision,
          routingRequest,
          inputEvidence,
          admissionRequest: {
            executionClass: "normal",
            inputDigest: candidate.binding.inputDigest,
          },
        },
      };
      return Promise.resolve(
        unapproved as unknown as AiIntentPreviewResolvedV1,
      );
    });
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(ModelRuntimeControlError);
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 1,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("current database actor revocation prevents evidence issuance despite a stale host closure", async () => {
    const f = await fixture();
    await harness.database.query(
      sql(
        "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
        [f.tenant.scope.organizationId, f.tenant.scope.userId],
      ),
    );
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toMatchObject({
      code: "ai-preview.unavailable",
    });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 0,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("rejects a different model before issuing metadata or consulting normal authority", async () => {
    const f = await fixture();
    const invocation = {
      ...f.input.invocation,
      descriptor: {
        ...f.input.invocation.descriptor,
        modelId: namespacedIdentifierSchema.parse("unapproved.synthetic-model"),
      },
    };
    await expect(
      createProductionAiIntentPreview({ ...f.input, invocation }),
    ).rejects.toMatchObject({
      code: "model-runtime.host-evidence-unavailable",
    });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 0,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
  });
  it.each(["released-lease", "stale-draft"] as const)(
    "denies the first %s before evidence or capacity is created",
    async (kind) => {
      const f = await fixture();
      if (kind === "released-lease")
        await f.authorityFixture.leases.release(
          f.input.requestAuthority.principal,
          f.authorityFixture.preview.scope.projectId,
          f.input.requestAuthority.editingProof,
        );
      else await f.authorityFixture.advanceDraft(true);
      await expect(
        createProductionAiIntentPreview(f.input),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.unexpected).not.toHaveBeenCalled();
      expect(await state(f.tenant.scope.organizationId)).toEqual({
        evidence: 0,
        admissions: 0,
        workflows: 0,
        credits: 0,
        spending: 0,
      });
    },
  );
  it("revocation observed after input metadata prevents resolver/admission/provider work", async () => {
    const f = await fixture();
    f.authorize
      .mockResolvedValueOnce({
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      })
      .mockRejectedValueOnce(new AiIntentPreviewError());
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 1,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
    expect(f.unexpected).not.toHaveBeenCalled();
  });
  it("rejects missing canonical pricing before host resolution without fabricating a bootstrap admission", async () => {
    const f = await fixture();
    await expect(
      createProductionAiIntentPreview({
        ...f.input,
        commercial: {
          ...f.input.commercial,
          selectors: {
            ...f.input.commercial.selectors,
            pricingVersionId: namespacedIdentifierSchema.parse(
              "pricing.synthetic.missing",
            ),
          },
        },
      }),
    ).rejects.toThrow();
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 1,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
  });
  it("refreshes current host authority after canonical preflight before consulting the resolver", async () => {
    const f = await fixture();
    const proof = { expiresAt: new Date(Date.now() + 300000).toISOString() };
    f.authorize
      .mockResolvedValueOnce(proof)
      .mockResolvedValueOnce(proof)
      .mockRejectedValueOnce(new AiIntentPreviewError());
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.authorize).toHaveBeenCalledTimes(3);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.unexpected).not.toHaveBeenCalled();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 1,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
  });
  it("does not pass original authentication credentials or mutable input aliases with the commercial observation", async () => {
    const f = await fixture();
    const selectors = structuredClone(f.input.commercial.selectors);
    f.resolve.mockImplementationOnce(({ commercialSnapshot }) => {
      expect(commercialSnapshot).not.toHaveProperty("requestAuthority");
      expect(commercialSnapshot).not.toHaveProperty("principal");
      expect(commercialSnapshot).not.toHaveProperty("editingProof");
      expect(JSON.stringify(commercialSnapshot)).not.toContain(
        f.input.requestAuthority.editingProof.token,
      );
      expect(JSON.stringify(commercialSnapshot)).not.toContain(
        f.input.requestAuthority.principal.sessionId,
      );
      Object.assign(commercialSnapshot.selectors, {
        pricingVersionId: "pricing.synthetic.mutated-copy",
      });
      return Promise.reject(new AiIntentPreviewError());
    });
    await expect(
      createProductionAiIntentPreview(f.input),
    ).rejects.toBeInstanceOf(AiIntentPreviewError);
    expect(f.resolve).toHaveBeenCalledOnce();
    expect(f.input.commercial.selectors).toEqual(selectors);
    expect(f.unexpected).not.toHaveBeenCalled();
    expect(await state(f.tenant.scope.organizationId)).toEqual({
      evidence: 1,
      admissions: 0,
      workflows: 0,
      credits: 0,
      spending: 0,
    });
  });
});
