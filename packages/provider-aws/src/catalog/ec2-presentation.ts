import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";
import { ec2Instance, iamInstanceProfile } from "./services/ec2-compute.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Explicit private Linux instance/profile identities and typed launch dependencies.",
  },
  configuration: {
    status: "supported",
    reason:
      "Strict image provenance, private network, IMDSv2 and encrypted gp3 baseline root fields.",
  },
  validation: {
    status: "supported",
    reason:
      "Deterministic image/type/root-minimum, VPC, profile/trust, metadata and ownership checks with separate external readiness warnings.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed exact aws_instance/aws_iam_instance_profile renderers; no secret/bootstrap or inferred grants.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed native instance/profile renderers, explicit primary interface and root mapping; throughput restricted to gp3 baseline.",
  },
  generatedCode: {
    status: "not-applicable",
    reason:
      "This instance slice generates no application or boot-script artifacts.",
  },
};
export const awsEc2ServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  [ec2Instance, iamInstanceProfile].map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots: [],
  }));
function dock(
  port: string,
  label: string,
  input: boolean,
  one: boolean,
  order: number,
  required = false,
): ProviderServiceConnectionPresentationV1Input["docks"][number] {
  return {
    id: port.replace(/\.([^.]*)$/u, ".dock.$1"),
    category: "identity",
    label,
    description:
      "Explicit launch dependency; no resource or permission is inferred.",
    placement: input ? "left" : "right",
    order,
    directionPolicy: input ? "input-only" : "output-only",
    portIds: [port],
    cardinality: {
      minimum: required ? 1 : 0,
      maximum: one ? 1 : "many",
      enforcement: "provider-rule",
    },
    allowsMultipleEdges: !one,
    containsExclusiveRelationships: one,
    guidedExplanation:
      "Select reviewed resources and inspect the launch implications before export.",
    professionalExplanation:
      "Exact typed references preserve launch meaning; placement and permissions remain validated independently of layout.",
  };
}
export const awsEc2ServicePresentations: ProviderServiceConnectionPresentationV1Input[] =
  [ec2Instance, iamInstanceProfile].map((s) => ({
    serviceId: s.id,
    docks: s.ports.map((p, index) =>
      dock(
        p.id,
        p.displayName,
        p.direction === "input",
        p.cardinality === "one",
        index,
        p.required,
      ),
    ),
  }));
export function extendEc2Presentation(
  s: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  const ports: Record<string, [string, string, boolean]> = {
    "aws.ec2.subnet": ["aws.ec2.subnet.instance", "Instances", true],
    "aws.ec2.security-group": [
      "aws.ec2.security-group.instance",
      "Instances",
      true,
    ],
    "aws.kms.key": [
      "aws.kms.key.root-volume-encryption",
      "Root volume encryption",
      false,
    ],
  };
  const p = ports[s.serviceId];
  return p
    ? {
        ...s,
        docks: [...s.docks, dock(p[0], p[1], p[2], false, s.docks.length)],
      }
    : s;
}
