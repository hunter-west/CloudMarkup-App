import type { EditorCatalogService } from "@cloudmarkup/graph-preparation/editor-catalog";

const fsx = [
  "aws.fsx.lustre-file-system",
  "aws.fsx.windows-file-system",
  "aws.fsx.openzfs-file-system",
  "aws.fsx.ontap-file-system",
];
const related: Readonly<Record<string, readonly string[]>> = {
  "aws.fsx.ontap-file-system": ["aws.fsx.ontap-storage-virtual-machine"],
  "aws.fsx.ontap-storage-virtual-machine": ["aws.fsx.ontap-volume"],
  "aws.cognito.user-pool": ["aws.cognito.user-pool-client"],
  "aws.eventbridge.event-bus": ["aws.eventbridge.rule"],
};
const inside = new Set(Object.values(related).flat());
/** Navigation only: historical service schemas, types, ports, and compiler bindings remain exact. */
export function presentAwsCatalogService(
  service: EditorCatalogService,
): EditorCatalogService {
  const catalogGroup = fsx.includes(service.serviceType)
    ? {
        id: "fsx",
        displayName: "Amazon FSx",
        primaryServiceType: "aws.fsx.lustre-file-system",
        variantLabel: "File system",
        summary:
          "Managed file storage with Lustre, Windows, OpenZFS, or ONTAP.",
      }
    : service.serviceType.startsWith("aws.cloudwatch.")
      ? {
          id: "cloudwatch",
          displayName: "CloudWatch",
          primaryServiceType: "aws.cloudwatch.log-group",
          variantLabel: "Resource type",
          summary: "Collect application logs or define metric alarms.",
        }
      : undefined;
  return {
    ...service,
    ...(catalogGroup ? { catalogGroup } : {}),
    ...(inside.has(service.serviceType)
      ? { catalogVisibility: "configuration" as const }
      : {}),
    ...(related[service.serviceType]
      ? { relatedServiceTypes: related[service.serviceType] }
      : {}),
  };
}
