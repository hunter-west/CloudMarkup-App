import { parseIpv4Cidr } from "./networking-rules.js";
import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { fsxReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/fsx-validation.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  nodeLocation,
  nodeConfigurationLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
} from "./rule-helpers.js";
export function createFsxReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const document = context.document;
      if (!document) return [];
      const findings: ValidationFindingCandidate[] = [];
      const nodes = new Map(document.nodes.map((n) => [n.id, n]));
      const related = (id: string, relation: string) =>
        document.edges
          .filter(
            (e) =>
              e.semantic.source.nodeId === id &&
              e.semantic.relationshipType === relation,
          )
          .flatMap((e) => {
            const n = nodes.get(e.semantic.target.nodeId);
            return n ? [n] : [];
          });
      const value = (n: AwsValidationNode, key: string) => {
        const v = configurationValue(n.semantic.configuration.values, key);
        return v && "value" in v ? v.value : undefined;
      };
      const vpc = (n: AwsValidationNode): string | undefined => {
        const seen = new Set<string>();
        let current: AwsValidationNode | undefined = n;
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          if (current.semantic.serviceType === "aws.ec2.vpc") return current.id;
          if (current.semantic.serviceType === "aws.ec2.security-group") {
            const e = document.edges.find(
              (e) =>
                e.semantic.relationshipType ===
                  "aws.ec2.vpc-associates-security-group" &&
                e.semantic.target.nodeId === current?.id,
            );
            return e?.semantic.source.nodeId;
          }
          current = current.semantic.parent
            ? nodes.get(current.semantic.parent.nodeId)
            : undefined;
        }
        return undefined;
      };
      const physicalZone = (subnet: AwsValidationNode): string | undefined => {
        let current = subnet;
        let zoneName: unknown;
        for (const [childType, parentType, relationship] of [
          [
            "aws.ec2.subnet",
            "aws.ec2.availability-zone",
            "aws.ec2.availability-zone-contains-subnet",
          ],
          [
            "aws.ec2.availability-zone",
            "aws.ec2.vpc",
            "aws.ec2.vpc-contains-availability-zone",
          ],
          ["aws.ec2.vpc", "aws.region.boundary", "aws.region.contains-vpc"],
        ] as const) {
          const parent = current.semantic.parent
            ? nodes.get(current.semantic.parent.nodeId)
            : undefined;
          const backing = document.edges.filter(
            (edge) =>
              edge.semantic.relationshipType === relationship &&
              edge.semantic.target.nodeId === current.id,
          );
          if (
            current.semantic.serviceType !== childType ||
            parent?.semantic.serviceType !== parentType ||
            current.semantic.parent?.relationshipType !== relationship ||
            backing.length !== 1 ||
            backing[0]?.semantic.source.nodeId !== parent.id
          )
            return undefined;
          if (parentType === "aws.ec2.availability-zone")
            zoneName = value(parent, "zoneName");
          current = parent;
        }
        const region = document.provider.region;
        return current.semantic.parent === undefined &&
          value(current, "regionName") === region &&
          typeof zoneName === "string" &&
          zoneName.startsWith(region) &&
          /^[a-z]$/u.test(zoneName.slice(region.length))
          ? zoneName
          : undefined;
      };
      document.nodes.forEach((node, index) => {
        const id = String(node.semantic.serviceType);
        if (!id.startsWith("aws.fsx.")) return;
        const add = (
          code: string,
          title: string,
          message: string,
          severity: "error" | "warning" = "error",
          suffix = ".semantic.configuration",
        ) =>
          findings.push(
            finding(descriptor, {
              code: "aws.validation.fsx-" + code,
              severity,
              title,
              beginnerExplanation: message,
              technicalExplanation: message,
              affected: [
                code === "ontap-throughput"
                  ? nodeConfigurationLocation(node, index, "throughputCapacity")
                  : nodeLocation(node, index, suffix),
              ],
            }),
          );
        if (id.endsWith("-file-system")) {
          const subnets = related(node.id, id + "-uses-subnet"),
            groups = related(node.id, id + "-uses-security-group");
          const multi =
            id === "aws.fsx.windows-file-system" &&
            value(node, "deploymentType") === "MULTI_AZ_1";
          if (subnets.length !== (multi ? 2 : 1))
            add(
              "subnets-required",
              "Select file-system subnets",
              multi
                ? "Multi-AZ Windows FSx requires two subnets in different Availability Zones of one VPC."
                : "This file-system mode requires exactly one subnet.",
              "error",
              ".semantic.serviceType",
            );
          if (groups.length < 1 || groups.length > 5)
            add(
              "security-groups-required",
              "Select file-system security groups",
              "Choose one to five security groups in the same VPC as the selected subnets.",
              "error",
              ".semantic.serviceType",
            );
          const networks = [...subnets, ...groups].map(vpc);
          if (
            networks.some((n) => n === undefined) ||
            new Set(networks).size > 1
          )
            add(
              "vpc-mismatch",
              "Use one VPC for FSx networking",
              "Every selected subnet and security group must resolve to the same VPC.",
            );
          const zones = multi ? subnets.map(physicalZone) : [];
          if (
            multi &&
            (zones.some((zone) => zone === undefined) ||
              new Set(zones).size !== 2)
          )
            add(
              "zones-required",
              "Use two Availability Zones",
              "Multi-AZ Windows FSx requires canonical subnets in two distinct physical Availability Zones of the architecture's AWS Region.",
            );
          if (
            id === "aws.fsx.lustre-file-system" &&
            subnets.length === 1 &&
            subnets[0] &&
            groups.length > 0
          ) {
            const subnetCidr = parseIpv4Cidr(
              String(value(subnets[0], "cidrBlock") ?? ""),
              1,
            );
            for (const direction of ["ingress", "egress"]) {
              const traffic = document.edges
                .filter(
                  (e) =>
                    e.semantic.relationshipType ===
                      "aws.ec2.security-group-owns-" + direction + "-rule" &&
                    groups.some((g) => g.id === e.semantic.target.nodeId),
                )
                .flatMap((e) => {
                  const rule = nodes.get(e.semantic.source.nodeId);
                  return rule ? [rule] : [];
                });
              const covers = (port: number) =>
                traffic.some((rule) => {
                  const cidr = parseIpv4Cidr(
                    String(
                      value(
                        rule,
                        direction === "ingress"
                          ? "sourceIpv4Cidr"
                          : "destinationIpv4Cidr",
                      ) ?? "",
                    ),
                    direction === "ingress" ? 1 : 0,
                  );
                  const protocol = value(rule, "protocol");
                  return (
                    !!subnetCidr &&
                    !!cidr &&
                    cidr.start <= subnetCidr.start &&
                    cidr.end >= subnetCidr.end &&
                    (protocol === "-1" ||
                      (protocol === "tcp" &&
                        Number(value(rule, "fromPort")) <= port &&
                        Number(value(rule, "toPort")) >= port))
                  );
                });
              if (![988, 1018, 1019, 1020, 1021, 1022, 1023].every(covers))
                add(
                  "lustre-" + direction,
                  "Allow Lustre file-server traffic",
                  "Add explicit TCP " +
                    direction +
                    " rules for 988 and 1018–1023 covering the entire selected subnet. Lustre file servers need to communicate with each other before clients can mount the file system.",
                );
            }
          }
          const capacity = value(node, "storageCapacity");
          if (
            id === "aws.fsx.lustre-file-system" &&
            (typeof capacity !== "number" || capacity % 1200 !== 0)
          )
            add(
              "lustre-capacity",
              "Use a supported Lustre capacity",
              "Persistent SSD Lustre capacity must be a multiple of 1,200 GiB.",
            );
          if (id === "aws.fsx.ontap-file-system") {
            const throughput = value(node, "throughputCapacity");
            if (
              typeof throughput !== "number" ||
              ![1536, 3072, 6144].includes(throughput)
            )
              add(
                "ontap-throughput",
                "Choose supported ONTAP throughput",
                "SINGLE_AZ_2 with one HA pair requires 1536, 3072 or 6144 MBps. Review cost and choose explicitly; saved 384/768 values are not upgraded automatically.",
                "error",
                ".semantic.configuration.values.throughputCapacity",
              );
          }
          if (
            id === "aws.fsx.windows-file-system" &&
            !/^d-[a-f0-9]{10}$/u.test(
              String(value(node, "activeDirectoryId") ?? ""),
            )
          )
            add(
              "directory-required",
              "Specify a managed Active Directory",
              "Enter an existing AWS Managed Microsoft AD directory ID in the same VPC. Do not enter credentials.",
            );
          if (id === "aws.fsx.openzfs-file-system") {
            const cidr = String(value(node, "clientCidr") ?? "");
            const [ip, prefix] = cidr.split("/");
            if (
              !ip ||
              !/^\d+$/u.test(prefix ?? "") ||
              Number(prefix) < 1 ||
              Number(prefix) > 32 ||
              ip.split(".").length !== 4 ||
              ip
                .split(".")
                .some(
                  (v) =>
                    !/^\d+$/u.test(v) ||
                    Number(v) > 255 ||
                    String(Number(v)) !== v,
                ) ||
              (Number(prefix) !== 32 &&
                ip
                  .split(".")
                  .reduce((sum, part) => sum * 256 + Number(part), 0) %
                  2 ** (32 - Number(prefix)) !==
                  0)
            )
              add(
                "nfs-clients-required",
                "Specify the NFS client network",
                "Choose a valid, bounded IPv4 CIDR for NFS clients. An unrestricted 0.0.0.0/0 export is not accepted.",
              );
          }
          if (
            id === "aws.fsx.ontap-file-system" &&
            !document.edges.some(
              (e) =>
                e.semantic.relationshipType ===
                  "aws.fsx.ontap-svm-uses-file-system" &&
                e.semantic.target.nodeId === node.id,
            )
          )
            add(
              "svm-required",
              "Add a storage virtual machine",
              "An ONTAP file system needs a storage virtual machine and volume before clients can access a share.",
              "warning",
            );
          if (id !== "aws.fsx.lustre-file-system")
            add(
              "transfer-client",
              "Review the file-transfer client",
              "Lambda has no native FSx mount. Use a compatible SMB/NFS client or an explicitly configured transfer service; do not treat the file-system connection as executable transfer code.",
              "warning",
            );
        } else {
          const relation =
            id === "aws.fsx.ontap-volume"
              ? "aws.fsx.ontap-volume-uses-svm"
              : "aws.fsx.ontap-svm-uses-file-system";
          if (related(node.id, relation).length !== 1)
            add(
              "owner-required",
              "Select the owning storage resource",
              "Connect this ONTAP resource to exactly one owning file system or storage virtual machine.",
            );
        }
      });
      return findings;
    },
  });
}
