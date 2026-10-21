import { betaApplicationSourceModelRequest } from "@cloudmarkup/model-gateway";
import type {
  BetaApplicationSource,
  BetaConverseUsage,
} from "@cloudmarkup/model-gateway";
import { betaAiEstimate } from "../../application/beta-ai-pricing.js";
import {
  PostgresBetaAiCreditMeter,
  betaAiReservationId,
  type BetaAiCreditIdentity,
} from "./beta-ai-credit-meter.js";
import type { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import { sql } from "./sql.js";

export function createBetaAiSourceCredits(
  authority: SolutionExportWorkerAuthority,
) {
  const meter = new PostgresBetaAiCreditMeter(authority, authority.database);
  const identityFor = (key: string): BetaAiCreditIdentity => ({
    organizationId: authority.identity.organizationId,
    projectId: authority.identity.projectId,
    jobId: authority.identity.jobId,
    purpose: "application-source",
    requestSha256: key.slice(7),
  });
  return {
    async generate(input: {
      readonly cacheKey: string;
      readonly context: unknown;
      readonly invoke: (
        onUsage: (usage: BetaConverseUsage) => Promise<void>,
      ) => Promise<BetaApplicationSource>;
      readonly persist: (value: BetaApplicationSource) => Promise<{
        readonly objectId: string;
        readonly contentSha256: string;
      }>;
    }) {
      const identity = identityFor(input.cacheKey);
      const estimate = betaAiEstimate(
        new TextEncoder().encode(
          JSON.stringify(
            betaApplicationSourceModelRequest({
              context: input.context,
              reviewed:
                typeof input.context === "object" &&
                input.context !== null &&
                "contextVersion" in input.context &&
                input.context.contextVersion === 2,
              semantic:
                input.context !== null &&
                typeof input.context === "object" &&
                "contextVersion" in input.context &&
                input.context.contextVersion === 3,
            }),
          ),
        ).length,
        12_000,
      );
      await meter.reserve(
        await authority.scope(),
        identity,
        estimate.estimatedCreditUnits,
        estimate.reservedCreditUnits,
        new Date(Date.now() + 3_600_000).toISOString(),
      );
      let recorded = false;
      try {
        if ((await meter.claim(identity)) !== "dispatch")
          throw new Error(
            "The prior source model dispatch needs reconciliation.",
          );
        let usage: BetaConverseUsage | undefined;
        const output = await input.invoke((actual) => {
          usage = actual;
          return Promise.resolve();
        });
        if (!usage) throw new Error("Source model usage is unavailable.");
        const receipt = await input.persist(output);
        await meter.record(identity, {
          outputObjectId: receipt.objectId,
          outputSha256: receipt.contentSha256,
          usage,
        });
        recorded = true;
        await meter.settle(identity);
        return output;
      } catch (error) {
        if (!recorded) await meter.release(identity);
        throw error;
      }
    },
    async onCacheHit(cacheKey: string) {
      const identity = identityFor(cacheKey);
      const rows = await authority.query(
        sql(
          `SELECT state FROM beta_ai_invocations WHERE organization_id=$1 AND reservation_id=$2 AND project_id=$3 AND job_id=$4 AND purpose='application-source' AND request_sha256=$5`,
          [
            identity.organizationId,
            betaAiReservationId(identity),
            identity.projectId,
            identity.jobId,
            identity.requestSha256,
          ],
        ),
      );
      const state = rows.rows[0]?.["state"];
      if (state === "usage-recorded" || state === "settled")
        await meter.settle(identity);
      else if (state === "reserved" || state === "dispatched") {
        await meter.release(identity);
        throw new Error("The source credit receipt needs reconciliation.");
      } else if (state === "released") {
        throw new Error("The source credit reservation was released.");
      }
    },
  };
}
