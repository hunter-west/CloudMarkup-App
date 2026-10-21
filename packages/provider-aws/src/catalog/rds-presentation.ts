import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";
import { dock } from "./database-port-dock.js";
import { awsRdsServices, rdsPorts } from "./services/rds-postgres.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason: "Exact user-owned root RDS instance/subnet/parameter identities.",
  },
  configuration: {
    status: "supported",
    reason:
      "Strict private PostgreSQL 16, managed credentials, encrypted storage, backup/maintenance and TLS intent.",
  },
  validation: {
    status: "supported",
    reason:
      "Closed schemas, two-AZ/same-VPC topology, managed ownership and bounded windows; actual availability remains external.",
  },
  terraform: {
    status: "supported",
    reason: "Reviewed native typed RDS resources; no provider execution.",
  },
  cloudformation: {
    status: "supported",
    reason: "Reviewed structured native RDS resources; no provider execution.",
  },
  generatedCode: {
    status: "not-applicable",
    reason:
      "No clients, queries, schema/data, migrations or business behavior are generated.",
  },
};

export const awsRdsServicePresentations = awsRdsServices.map((s) => ({
  serviceId: s.id,
  docks: s.ports.map(dock),
}));
export function extendRdsPresentation(
  s: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  return {
    ...s,
    docks: [
      ...s.docks,
      ...rdsPorts(s.serviceId)
        .filter((p) => !s.docks.some((d) => d.portIds.includes(p.id)))
        .map((p, i) => dock(p, s.docks.length + i)),
    ],
  };
}
export const awsRdsServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsRdsServices.map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots: [],
  }));
