import { digestCanonicalValue } from "@cloudmarkup/schemas";
import {
  solutionExportWorkflowTargetSettingsV1Schema,
  type SolutionExportWorkflowTargetSettingsV1,
} from "@cloudmarkup/solution-export-workflow/contracts";
import type { SolutionExportTargetPolicy } from "../application/solution-exports.js";
import { ApplicationError } from "../application/errors.js";
import { providerDirectExportFundingReferenceV1 } from "../application/provider-direct-export-funding.js";
import type { SolutionExportRequestAuthority } from "../adapters/persistence/solution-export-authority.js";
import { exportRunEqual } from "../adapters/persistence/solution-export-run-codec.js";
import { assertProductionInfrastructureBinding } from "../production-solution-export-host.js";

function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "The standalone export admission is unavailable.",
  );
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** A bound decision identity, never a permission. The producer and each worker
 * stage independently require current authenticated request/attempt authority. */
export function selfHostNativeExportAdmissionReference(input: {
  readonly ownership: {
    readonly organizationId: string;
    readonly projectId: string;
  };
  readonly principalId: string;
  readonly manifestDigest: string;
  readonly targetSettingsDigest: string;
  readonly targetProfileId: string;
  readonly environment: unknown;
}) {
  return providerDirectExportFundingReferenceV1(
    `native-admission.${digestCanonicalValue({ contractVersion: 1, ...input }).slice(7)}`,
  );
}
/** Genuine request authority plus current native pin admission replace only the
 * hosted commercial policy. A funding reference is never permission by itself. */
export function createSelfHostDirectExportTargetPolicy(options: {
  readonly authority: SolutionExportRequestAuthority;
  readonly targetSettings: SolutionExportWorkflowTargetSettingsV1;
  /** Production factory must reverify the actual configured native tools/bytes. */
  readonly assertNativeReady: () => Promise<void>;
}): SolutionExportTargetPolicy {
  const settings = freeze(
    solutionExportWorkflowTargetSettingsV1Schema.parse(
      structuredClone(options.targetSettings),
    ),
  );
  const authority = options.authority;
  const assertNativeReady: () => Promise<unknown> = options.assertNativeReady;
  if (typeof assertNativeReady !== "function") unavailable();
  return {
    async evaluate(input) {
      if (
        input.principal.principalId !== authority.principal.principalId ||
        input.organizationId !== authority.ownership.organizationId ||
        input.binding.organizationId !== authority.ownership.organizationId ||
        input.binding.projectId !== authority.ownership.projectId ||
        input.targetProfileId !==
          `cloudmarkup.export.${settings.target}-nodejs24-v1`
      )
        unavailable();
      await authority.scope();
      if ((await assertNativeReady()) !== undefined) unavailable();
      assertProductionInfrastructureBinding(input.binding);
      const tools = settings.stageDescriptors;
      if (
        input.binding.selectedTools === undefined ||
        !exportRunEqual(input.binding.selectedTools, {
          compiler: { state: "pinned", tool: tools.compiler.adapter },
          diagramRenderer: {
            state: "pinned",
            tool: tools.diagramRenderer.adapter,
          },
        })
      )
        throw new ApplicationError(
          "unsupported_version",
          "Save a revision with the configured export tools before exporting.",
        );
      await authority.scope();
      return {
        targetSettings: settings,
        entitlementDecisionReference: selfHostNativeExportAdmissionReference({
          ownership: authority.ownership,
          principalId: authority.principal.principalId,
          manifestDigest: input.binding.manifestDigest,
          targetSettingsDigest: settings.digest,
          targetProfileId: input.targetProfileId,
          environment: input.environment,
        }),
      };
    },
  };
}
