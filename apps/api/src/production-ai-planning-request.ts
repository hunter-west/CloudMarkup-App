import { parseIntentDocument } from "@cloudmarkup/domain";
import { inspectModelValueForSecretCandidatesV1 } from "@cloudmarkup/model-gateway";
import {
  AWS_CURRENT_CATALOG_BINDING_V1,
  awsValidationRuleRegistrationsV1,
  resolveAwsCurrentCatalogV1,
  type AwsCatalogBindingV1,
} from "@cloudmarkup/provider-aws";
import {
  architectureDocumentV3Schema,
  digestCanonicalValue,
  modelOperationProposalRequestV1Schema,
  modelSolutionPlanningContextV1Schema,
  type ArchitectureDocumentV3,
  type IntentDocumentV1,
} from "@cloudmarkup/schemas";
import { createProductionAiCatalogGrounding } from "./production-ai-catalog.js";

type PlanningContext = ReturnType<
  typeof modelSolutionPlanningContextV1Schema.parse
>;
const ruleKinds: Readonly<
  Record<string, PlanningContext["validationRules"][number]["kind"]>
> = {
  "aws.cloudmarkup.validation.api-route-authentication": "security",
  "aws.cloudmarkup.validation.iam-wildcards": "security",
  "aws.cloudmarkup.validation.iam-policy-safety": "policy",
  "aws.cloudmarkup.validation.lambda-execution-role": "connection",
  "aws.cloudmarkup.validation.connection-cardinality": "connection",
  "aws.cloudmarkup.validation.lambda-trigger-compatibility": "connection",
  "aws.cloudmarkup.validation.lambda-dynamodb-actions": "policy",
  "aws.cloudmarkup.validation.dynamodb-protection": "security",
  "aws.cloudmarkup.validation.log-retention": "cost-sensitive",
  "aws.cloudmarkup.validation.lambda-runtime-bounds": "cost-sensitive",
  "aws.cloudmarkup.validation.connection-questions": "connection",
  "aws.cloudmarkup.validation.region-availability": "placement",
  "aws.cloudmarkup.validation.compiler-readiness": "target-readiness",
  "aws.cloudmarkup.validation.network-placement": "placement",
  "aws.cloudmarkup.validation.network-routing": "connection",
  "aws.cloudmarkup.validation.event-topology": "connection",
  "aws.cloudmarkup.validation.event-delivery": "coverage",
  "aws.cloudmarkup.validation.security-group-policy": "security",
  "aws.cloudmarkup.validation.lambda-vpc-access": "connection",
  "aws.cloudmarkup.validation.fsx-readiness": "target-readiness",
  "aws.cloudmarkup.validation.fsx-storage-capacity": "target-readiness",
  "aws.cloudmarkup.validation.s3-bucket-name": "target-readiness",
  "aws.cloudmarkup.validation.s3-notification-filters": "target-readiness",
  "aws.cloudmarkup.validation.kms-key-readiness": "target-readiness",
  "aws.cloudmarkup.validation.secret-readiness": "target-readiness",
  "aws.cloudmarkup.validation.ec2-readiness": "target-readiness",
  "aws.cloudmarkup.validation.ecs-fargate-readiness": "target-readiness",
  "aws.cloudmarkup.validation.rds-postgres-readiness": "target-readiness",
  "aws.cloudmarkup.validation.aurora-postgres-readiness": "target-readiness",
  "aws.cloudmarkup.validation.dns-certificate-readiness": "target-readiness",
  "aws.cloudmarkup.validation.cloudfront-readiness": "target-readiness",
  "aws.cloudmarkup.validation.elb-readiness": "target-readiness",
  "aws.cloudmarkup.validation.ebs-readiness": "target-readiness",
};
function requirePlanning(value: boolean): asserts value {
  if (!value)
    throw new Error("Current production planning context is unavailable.");
}

/** Installed catalog metadata, not a compiler execution receipt or entitlement.
 * Ambient Region/AZ nodes have no standalone output; their exact reviewed
 * placement semantics are accepted by both compilers. No other not-applicable
 * service is silently promoted to ready. */
export function productionAiPlanningCatalogAuthority(
  target: PlanningContext["target"],
  binding: AwsCatalogBindingV1 = AWS_CURRENT_CATALOG_BINDING_V1,
) {
  const { catalog: awsCatalogV1, serviceExtension: awsServiceExtensionV1 } =
    resolveAwsCurrentCatalogV1(binding);
  const grounding = createProductionAiCatalogGrounding(binding);
  requirePlanning(
    digestCanonicalValue(awsServiceExtensionV1.artifact.catalog) ===
      digestCanonicalValue(grounding.catalog),
  );
  const targetReadiness = awsCatalogV1.listServices().map((service) => {
    const entry = awsServiceExtensionV1.requireServiceExtension(service.id)
      .targetReadiness[target];
    const ambient =
      service.nodeKind.kind === "boundary" &&
      ["aws.region.boundary", "aws.ec2.availability-zone"].includes(service.id);
    return {
      serviceType: service.id,
      target,
      rationale: entry.reason,
      status:
        entry.status === "supported" ||
        (ambient && entry.status === "not-applicable")
          ? ("ready" as const)
          : entry.status === "pending"
            ? ("pending" as const)
            : ("unsupported" as const),
    };
  });
  // Preserve the reviewed registration order, for deterministic request hashes.
  const validationRules = awsValidationRuleRegistrationsV1.flatMap(
    ({ descriptor: installed }) => {
      const descriptor = awsCatalogV1.getValidationRule(installed.id);
      if (descriptor === undefined) return [];
      const kind = ruleKinds[descriptor.id];
      requirePlanning(kind !== undefined);
      return [{ ruleId: descriptor.id, kind }];
    },
  );
  requirePlanning(
    validationRules.length === awsCatalogV1.listValidationRules().length,
  );
  const allowedPolicyKinds = [
    ...new Set(
      awsServiceExtensionV1.artifact.services.flatMap((service) =>
        service.ownedConfigurationSlots
          .filter((slot) => slot.policyKinds.length > 0)
          .map((slot) => slot.configurationKind),
      ),
    ),
  ].sort();
  return { grounding, targetReadiness, validationRules, allowedPolicyKinds };
}

/** Exact RAM request from host-authorized content and host-resolved limits.
 * The authenticated caller must obtain the saved baseline and explicit Intent
 * approval before calling, and recheck them at dispatch. This pure projection
 * cannot issue consent, tenant authority, credits, routing or model admission. */
export function createProductionAiPlanningRequest(input: {
  readonly architecture: ArchitectureDocumentV3;
  readonly approvedIntent: IntentDocumentV1;
  readonly requestedMode: "guided" | "professional";
  readonly target: PlanningContext["target"];
  readonly limits: PlanningContext["limits"];
  readonly assistantLimits: NonNullable<PlanningContext["assistantLimits"]>;
  readonly approvedRepositoryEvidence?: PlanningContext["approvedRepositoryEvidence"];
}) {
  const architecture = architectureDocumentV3Schema.parse(input.architecture);
  const approvedIntent = parseIntentDocument(input.approvedIntent);
  const catalog = productionAiPlanningCatalogAuthority(
    input.target,
    architecture.catalog,
  );
  requirePlanning(
    architecture.provider.id === "aws.cloudmarkup" &&
      digestCanonicalValue(architecture.catalog) ===
        digestCanonicalValue(catalog.grounding.catalog),
  );
  const request = modelOperationProposalRequestV1Schema.parse({
    contractVersion: 1,
    operation: "operations.propose",
    requestedMode: input.requestedMode,
    architecture,
    catalogGrounding: catalog.grounding,
    planningContext: {
      approvedIntent,
      ...(input.approvedRepositoryEvidence === undefined
        ? {}
        : { approvedRepositoryEvidence: input.approvedRepositoryEvidence }),
      allowedGraphCommandKinds: [
        "add-edge",
        "add-node",
        "adopt-generated-resource",
        "move-node",
        "remove-edge",
        "remove-node",
        "reparent-node",
        "update-edge-configuration",
        "update-node-configuration",
      ],
      allowedAssistantOperationKinds: [
        "add-external-resource",
        "add-workload-operation",
        "edit-application-contract",
        "edit-external-resource",
        "edit-test-scenario",
        "edit-workload",
        "edit-workload-operation",
        "request-clarification",
        "review-repository-difference",
        "set-source-ownership",
        "upsert-ai-extension-request",
      ],
      allowedPolicyKinds: catalog.allowedPolicyKinds,
      limits: input.limits,
      assistantLimits: input.assistantLimits,
      target: input.target,
      targetReadiness: catalog.targetReadiness,
      validationRules: catalog.validationRules,
    },
  });
  requirePlanning(
    architecture.nodes.length <= input.limits.maximumNodes &&
      architecture.edges.length <= input.limits.maximumEdges &&
      architecture.externalResources.resources.length <=
        input.limits.maximumExternalResources &&
      inspectModelValueForSecretCandidatesV1(request).detectedValueCount === 0,
  );
  return request;
}
