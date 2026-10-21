import type { CurrentPlanEntitlementsV1 } from "@cloudmarkup/api-contract";
import { ApplicationError } from "./errors.js";
import type { CloudMarkupApplication, PrincipalContext } from "./ports.js";

export interface RepositoryExportEntitlementPolicy {
  authorize(input: {
    readonly organizationId: string;
    readonly principal: PrincipalContext;
    readonly projectId: string;
  }): Promise<void>;
}

/** Version 1 application alias: the released github-export feature admits repository export for both providers. Historical commercial keys remain unchanged. */
export class CurrentPlanRepositoryExportEntitlementPolicy implements RepositoryExportEntitlementPolicy {
  readonly #commercial: Pick<
    CloudMarkupApplication,
    "getCurrentPlanEntitlements"
  >;
  readonly #provider: "GitHub" | "GitLab";
  constructor(
    commercial: Pick<CloudMarkupApplication, "getCurrentPlanEntitlements">,
    provider: "GitHub" | "GitLab",
  ) {
    this.#commercial = commercial;
    this.#provider = provider;
  }
  async authorize(
    input: Parameters<RepositoryExportEntitlementPolicy["authorize"]>[0],
  ): Promise<void> {
    let summary: CurrentPlanEntitlementsV1;
    try {
      summary = await this.#commercial.getCurrentPlanEntitlements(
        input.principal,
        input.organizationId,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        "service_unavailable",
        "The current export entitlement could not be verified.",
      );
    }
    const features = summary.entitlements.filter(
      (candidate) => candidate.feature === "github-export",
    );
    if (
      summary.organizationId !== input.organizationId ||
      features.length > 1
    ) {
      throw new ApplicationError(
        "service_unavailable",
        "The current export entitlement could not be verified.",
      );
    }
    if (
      summary.billingAccountState !== "active" ||
      summary.organizationState !== "active" ||
      !(
        summary.subscription.state === "active" ||
        (summary.plan.versionId === "planver_staff_trial_2026_10_06_v1" &&
          summary.trial?.state === "active" &&
          Date.parse(summary.trial.expiresAt) > Date.parse(summary.asOf))
      ) ||
      !summary.expensiveOperationsEnabled ||
      features[0]?.enabled !== true
    ) {
      throw new ApplicationError(
        "access_denied",
        this.#provider +
          " export is not available under the current organization plan or policy.",
      );
    }
  }
}
