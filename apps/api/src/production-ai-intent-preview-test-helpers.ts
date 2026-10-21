import { vi, type Mock } from "vitest";
import {
  deterministicFakeProviderProfileV1,
  deterministicFakeRoutingV1,
} from "@cloudmarkup/model-gateway/testing";
import {
  sha256Text,
  type ModelCommercialVerifiedScopeV1,
} from "@cloudmarkup/model-gateway";
import { parseModelCommercialReadSelectors } from "./adapters/persistence/model-commercial-read-host-codec.js";
import { aiPreviewFixture } from "./adapters/persistence/ai-intent-preview-test-helpers.js";
import { commercialScope } from "./adapters/persistence/model-commercial-workflow-test-helpers.js";
import type { SqlDatabase } from "./adapters/persistence/sql.js";
import { AiIntentPreviewError } from "./application/ai-intent-preview-journal.js";
import type { ProductionAiIntentPreviewInputV1 } from "./production-ai-intent-preview.js";

/** Synthetic denial fixture only. No evaluation admission or positive provider
 * authority is fabricated; the reviewed normal resolver deliberately refuses. */
export function deniedPreviewFactoryFixture(
  input: {
    readonly database?: SqlDatabase;
    readonly scope?: ModelCommercialVerifiedScopeV1;
  } = {},
): {
  readonly input: ProductionAiIntentPreviewInputV1;
  readonly unexpected: Mock<() => Promise<never>>;
  readonly authorize: Mock<
    ProductionAiIntentPreviewInputV1["host"]["assertCurrentAuthority"]
  >;
  readonly resolve: Mock<ProductionAiIntentPreviewInputV1["host"]["resolve"]>;
} {
  const scope = input.scope ?? commercialScope();
  const f = aiPreviewFixture({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    userId: scope.userId,
    jobId: "job_factory",
  });
  const unexpected = vi.fn(() =>
    Promise.reject(new Error("Unexpected synthetic boundary.")),
  );
  const authorize = vi.fn<
    ProductionAiIntentPreviewInputV1["host"]["assertCurrentAuthority"]
  >(() =>
    Promise.resolve({ expiresAt: new Date(Date.now() + 300000).toISOString() }),
  );
  const resolve = vi.fn<ProductionAiIntentPreviewInputV1["host"]["resolve"]>(
    () => Promise.reject(new AiIntentPreviewError()),
  );
  return {
    unexpected,
    authorize,
    resolve,
    input: {
      database: input.database ?? {
        query: unexpected,
        transaction: unexpected,
        close: unexpected,
      },
      scope,
      requestAuthority: {
        principal: {
          principalId: scope.userId,
          sessionId: "synthetic-preview-session",
          correlationId: "correlation_preview_factory",
          // Synthetic hosted descriptor only; no real token or provider authority.
          authenticationSource: "cognito",
          authenticatedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
        baseline: {
          draftEtag: '"draft:draft_factory:v1"',
          editingLeaseId: "projectlease_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
        editingProof: {
          leaseId: "projectlease_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          token: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      },
      invocation: f.invocation,
      host: { assertCurrentAuthority: authorize, resolve },
      commercial: {
        attestations: { verifyPreDispatchNoUsage: unexpected },
        selectors: parseModelCommercialReadSelectors({
          contractVersion: 1,
          pricingVersionId: "pricing.synthetic.unissued",
          pricingVersionDigest: sha256Text("synthetic price not inserted"),
          normalizationPolicyVersionId: "normalization.synthetic.unissued",
          normalizationPolicyDigest: sha256Text(
            "synthetic normalization not inserted",
          ),
          runtimePolicyId: "policy.synthetic.unissued",
          runtimePolicyVersion: "1.0.0",
          runtimePolicyDigest: sha256Text("synthetic runtime not admitted"),
          routeId: "standard-design",
          routeDefinitionDigest: sha256Text("synthetic route not approved"),
          modelConfigurationReference: "model.synthetic.unissued",
        }),
      },
      runtime: {
        authorityResolver: { resolve: unexpected },
        telemetry: { publish: unexpected },
      },
      costs: { resolve: unexpected },
      httpHandler: { handle: unexpected },
      bedrock: {
        profile: {
          ...deterministicFakeProviderProfileV1,
          enabled: false,
          providerFamily: "amazon-bedrock",
          providerId: "cloudmarkup.amazon-bedrock",
        },
        routes: [],
      },
      gateway: {
        logger: {
          write: () => {
            throw new Error("Unexpected synthetic log.");
          },
        },
        routing: deterministicFakeRoutingV1,
        maximumInputBytes: 100000,
      },
    },
  };
}
