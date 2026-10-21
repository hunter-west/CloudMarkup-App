import { randomUUID } from "node:crypto";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import type { BetaConverseUsage } from "@cloudmarkup/model-gateway";
import type { PrincipalContext } from "../../application/ports.js";
import type { PreparedBetaInfrastructureInput } from "../../application/beta-infrastructure.js";
import type { ObjectStore } from "../../application/persistence.js";
import { betaAiEstimate } from "../../application/beta-ai-pricing.js";
import { exportRunBytes, exportRunSha } from "./solution-export-run-codec.js";
import { ActiveProjectRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportProducerObjects } from "./solution-export-producer-objects.js";
import {
  PostgresBetaAiCreditMeter,
  type BetaAiCreditIdentity,
} from "./beta-ai-credit-meter.js";
import type { SqlDatabase } from "./sql.js";

/** The legacy synchronous route still has a durable reservation and output
 * receipt. Each HTTP POST is a separate paid generation request. */
export function createBetaAiSyncCredits(options: {
  readonly database: SqlDatabase;
  readonly objectStore: ObjectStore;
}) {
  return {
    async execute<T>(input: {
      readonly principal: PrincipalContext;
      readonly organizationId: string;
      readonly projectId: string;
      readonly request: PreparedBetaInfrastructureInput;
      readonly run: (
        onUsage: (usage: BetaConverseUsage) => Promise<void>,
      ) => Promise<T>;
    }): Promise<T> {
      const identity: BetaAiCreditIdentity = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        jobId: "beta-sync." + randomUUID(),
        purpose: "proposal",
        requestSha256: digestCanonicalValue(input.request).slice(7),
      };
      const authority = new ActiveProjectRequestAuthority(
        options.database,
        input.principal,
        {
          organizationId: identity.organizationId,
          projectId: identity.projectId,
        },
        "projects.mutate",
      );
      const scope = await authority.scope();
      const meter = new PostgresBetaAiCreditMeter(authority, options.database);
      const estimate = betaAiEstimate(
        input.request.modelInputBytes ?? exportRunBytes(input.request).length,
        input.request.proposalVersion >= 3 ? 6144 : 4096,
      );
      await meter.reserve(
        scope,
        identity,
        estimate.estimatedCreditUnits,
        estimate.reservedCreditUnits,
        new Date(Date.now() + 300_000).toISOString(),
      );
      let recorded = false;
      try {
        if ((await meter.claim(identity)) !== "dispatch")
          throw new Error("The synchronous AI dispatch is unavailable.");
        let usage: BetaConverseUsage | undefined;
        const result = await input.run((actual) => {
          usage = actual;
          return Promise.resolve();
        });
        if (!usage) throw new Error("Model usage is unavailable.");
        await authority.scope();
        const objects = new SolutionExportProducerObjects(
          authority,
          options.objectStore,
        );
        const bytes = exportRunBytes(result);
        const output = await objects.put(
          bytes,
          "proposal",
          objects.identity(
            "beta-sync-proposal",
            "sha256:" + exportRunSha(bytes),
          ),
        );
        await meter.record(identity, {
          outputObjectId: output.objectId,
          outputSha256: output.contentSha256,
          usage,
        });
        recorded = true;
        await meter.settle(identity);
        return result;
      } catch (error) {
        if (!recorded) await meter.release(identity);
        throw error;
      }
    },
  };
}
