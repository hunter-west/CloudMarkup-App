import {
  getArchitectureDocumentContentHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { resolveAwsCurrentCatalogV1 } from "@cloudmarkup/provider-aws";
import {
  digestCanonicalValue,
  type ArchitectureDocumentV3,
} from "@cloudmarkup/schemas";

type Node = ArchitectureDocumentV3["nodes"][number];
const services = {
  lambda: "aws.lambda.function",
  access: "aws.lambda.vpc-access-configuration",
  subnet: "aws.ec2.subnet",
  zone: "aws.ec2.availability-zone",
  vpc: "aws.ec2.vpc",
  table: "aws.ec2.route-table",
  association: "aws.ec2.route-table-association",
  endpoint: "aws.ec2.gateway-vpc-endpoint",
  group: "aws.ec2.security-group",
  data: "aws.dynamodb.table",
} as const;
const relations = {
  owner: "aws.lambda.owns-vpc-access-configuration",
  subnet: "aws.lambda.vpc-access-uses-subnet",
  group: "aws.lambda.vpc-access-uses-security-group",
  groupVpc: "aws.ec2.vpc-associates-security-group",
  zone: "aws.ec2.availability-zone-contains-subnet",
  zoneVpc: "aws.ec2.vpc-contains-availability-zone",
  association: "aws.ec2.route-table-association-targets-subnet",
  associationOwner: "aws.ec2.route-table-owns-subnet-association",
  tableVpc: "aws.ec2.vpc-contains-route-table",
  endpointVpc: "aws.ec2.vpc-contains-gateway-endpoint",
  endpointTable: "aws.ec2.gateway-endpoint-associates-route-table",
  endpointPolicy: "aws.ec2.gateway-endpoint-owns-policy",
  read: "aws.lambda.reads-dynamodb-table",
  write: "aws.lambda.writes-dynamodb-table",
  role: "aws.iam.role-assumed-by-lambda",
} as const;
function configurationValue(node: Node | undefined, key: string) {
  return Object.entries(node?.semantic.configuration.values ?? {}).find(
    ([candidate]) => candidate === key,
  )?.[1];
}
function literal(node: Node | undefined, key: string) {
  const value = configurationValue(node, key);
  return value?.kind === "string" ||
    value?.kind === "boolean" ||
    value?.kind === "integer"
    ? value.value
    : undefined;
}

function privateIpv4Cidr(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/(?:[0-9]|[12][0-9]|3[0-2])$/u.test(value)
  )
    return false;
  const [address, prefixText] = value.split("/");
  const octets = address?.split(".").map(Number);
  if (octets?.length !== 4 || octets.some((n) => n > 255)) return false;
  const size = 2 ** (32 - Number(prefixText));
  const start =
    Math.floor(octets.reduce((n, part) => n * 256 + part, 0) / size) * size;
  const end = start + size - 1;
  return [
    [0x0a000000, 0x0affffff],
    [0xac100000, 0xac1fffff],
    [0xc0a80000, 0xc0a8ffff],
  ].some(
    ([low, high]) =>
      low !== undefined && high !== undefined && start >= low && end <= high,
  );
}

/** Read actual candidate graph relationships and literal settings for the frozen
 * private-Lambda/DynamoDB requirement. This is coverage only: the full case must
 * independently execute the installed rules, schema/ownership checks and both
 * real review flows before receipt issuance. These counts grant no safety,
 * compiler, runtime, settlement or promotion authority. No supplied grades or
 * caller predicates, and labels/positions do not influence a criterion. */
export function inspectModelLivePrivateVpcCoverage(value: unknown) {
  const document = parseArchitectureDocument(value);
  const awsCatalogV1 = (() => {
    try {
      return resolveAwsCurrentCatalogV1(document.catalog).catalog;
    } catch {
      throw Error(
        "The current private-network evaluation catalog is unavailable.",
      );
    }
  })();
  if (
    document.provider.id !== "aws.cloudmarkup" ||
    document.catalog.digest !== awsCatalogV1.artifact.digest ||
    document.catalog.id !== awsCatalogV1.artifact.catalog.id ||
    document.catalog.version !== awsCatalogV1.artifact.catalog.version
  )
    throw Error(
      "The current private-network evaluation catalog is unavailable.",
    );
  const nodes = new Map<string, Node>(document.nodes.map((n) => [n.id, n]));
  const ofType = (kind: string) =>
    document.nodes.filter((n) => n.semantic.serviceType === kind);
  const rules = new Map(
    awsCatalogV1
      .listConnectionRules()
      .map((r) => [String(r.relationshipType), r]),
  );
  const edges = document.edges.filter((e) => {
    const rule = rules.get(e.semantic.relationshipType);
    return (
      rule !== undefined &&
      nodes.get(e.semantic.source.nodeId)?.semantic.serviceType ===
        rule.source.serviceId &&
      nodes.get(e.semantic.target.nodeId)?.semantic.serviceType ===
        rule.target.serviceId &&
      e.semantic.source.port === rule.source.portId &&
      e.semantic.target.port === rule.target.portId &&
      e.semantic.configuration.schemaId === rule.configuration.schemaId &&
      e.semantic.configuration.schemaVersion ===
        rule.configuration.schemaVersion
    );
  });
  const targets = (id: string, relation: string) =>
    edges
      .filter(
        (e) =>
          e.semantic.source.nodeId === id &&
          e.semantic.relationshipType === relation,
      )
      .flatMap((e) => {
        const n = nodes.get(e.semantic.target.nodeId);
        return n ? [n] : [];
      });
  const sources = (id: string, relation: string) =>
    edges
      .filter(
        (e) =>
          e.semantic.target.nodeId === id &&
          e.semantic.relationshipType === relation,
      )
      .flatMap((e) => {
        const n = nodes.get(e.semantic.source.nodeId);
        return n ? [n] : [];
      });
  const unique = (items: readonly Node[]) => [
    ...new Map(items.map((n) => [n.id, n])).values(),
  ];
  const one = (items: readonly Node[]) =>
    items.length === 1 ? items[0] : undefined;
  const backedParent = (
    child: Node,
    kind: string,
    relation: string,
    childIsSource = false,
  ) => {
    const parent = one(
      childIsSource ? targets(child.id, relation) : sources(child.id, relation),
    );
    return parent?.semantic.serviceType === kind &&
      child.semantic.parent?.nodeId === parent.id &&
      child.semantic.parent.relationshipType === relation
      ? parent
      : undefined;
  };
  const zone = (subnet: Node) =>
    backedParent(subnet, services.zone, relations.zone);
  const vpc = (subnet: Node) => {
    const z = zone(subnet);
    return z ? backedParent(z, services.vpc, relations.zoneVpc) : undefined;
  };
  const functions = ofType(services.lambda);
  const accessFor = (fn: Node) => {
    const access = one(sources(fn.id, relations.owner));
    return access?.semantic.parent?.nodeId === fn.id &&
      access.semantic.parent.relationshipType === relations.owner
      ? access
      : undefined;
  };
  const selected = functions
    .map((fn) => ({ fn, access: accessFor(fn) }))
    .map((row) => ({
      ...row,
      subnets: row.access
        ? unique(targets(row.access.id, relations.subnet))
        : [],
      groups: row.access ? unique(targets(row.access.id, relations.group)) : [],
    }));
  const all = (check: (row: (typeof selected)[number]) => boolean) =>
    selected.length > 0 && selected.every(check);
  const routeFor = (subnet: Node) => {
    const association = one(sources(subnet.id, relations.association));
    return association
      ? backedParent(
          association,
          services.table,
          relations.associationOwner,
          true,
        )
      : undefined;
  };
  const routeInVpc = (table: Node, scope: Node) =>
    backedParent(table, services.vpc, relations.tableVpc)?.id === scope.id;
  const matchingEndpoints = (subnet: Node) => {
    const scope = vpc(subnet),
      table = routeFor(subnet);
    if (!scope || !table || !routeInVpc(table, scope)) return [];
    return sources(table.id, relations.endpointTable).filter(
      (endpoint) =>
        literal(endpoint, "service") === "dynamodb" &&
        literal(endpoint, "endpointType") === "Gateway" &&
        backedParent(endpoint, services.vpc, relations.endpointVpc)?.id ===
          scope.id,
    );
  };
  const selectedGroups = unique(selected.flatMap((row) => row.groups));
  const selectedSubnets = unique(selected.flatMap((row) => row.subnets));
  const privateIngress =
    selectedGroups.length > 0 &&
    !document.nodes.some(
      (n) =>
        n.semantic.serviceType === "aws.ec2.security-group-ingress-rule" &&
        selectedGroups.some((g) => n.semantic.parent?.nodeId === g.id) &&
        !privateIpv4Cidr(literal(n, "sourceIpv4Cidr")),
    ) &&
    !document.edges.some(
      (e) =>
        selected.some((row) => row.fn.id === e.semantic.target.nodeId) &&
        e.semantic.relationshipType === "aws.apigateway.integrates-lambda",
    );
  const workloadTables = unique(
    selected.flatMap((row) => [
      ...targets(row.fn.id, relations.read),
      ...targets(row.fn.id, relations.write),
    ]),
  );
  const endpointPolicyIsScoped = (policy: Node) => {
    const statements = sources(policy.id, "aws.iam.policy-contains-statement");
    return (
      literal(policy, "policyKind") === "resource" &&
      statements.length > 0 &&
      statements.every((statement) => {
        const actions = configurationValue(statement, "actions"),
          principals = configurationValue(statement, "principals"),
          resource = configurationValue(statement, "resourceNode"),
          expressions = configurationValue(statement, "resourceExpressions");
        const table =
          resource?.kind === "node-reference"
            ? workloadTables.find((t) => t.id === resource.nodeId)
            : undefined;
        const allowed = new Set(
          [relations.read, relations.write].flatMap(
            (relation) =>
              rules
                .get(relation)
                ?.iamEffects.flatMap((effect) =>
                  effect.effect === "allow" &&
                  effect.resourceScope === "connected-target" &&
                  effect.when === undefined
                    ? effect.actions
                    : [],
                ) ?? [],
          ),
        );
        return (
          backedParent(
            statement,
            "aws.iam.policy-document",
            "aws.iam.policy-contains-statement",
            true,
          )?.id === policy.id &&
          literal(statement, "effect") === "allow" &&
          actions?.kind === "string-list" &&
          actions.value.length > 0 &&
          actions.value.every((action) => allowed.has(action)) &&
          literal(statement, "principalKind") === "provider-identity" &&
          principals?.kind === "string-list" &&
          principals.value.length > 0 &&
          principals.value.every(
            (principal) =>
              principal.trim().length > 0 && !principal.includes("*"),
          ) &&
          expressions?.kind === "string-list" &&
          expressions.value.length === 0 &&
          table !== undefined &&
          resource?.kind === "node-reference" &&
          resource.attribute === "aws.dynamodb.table.arn" &&
          targets(statement.id, "aws.iam.authorizes-dynamodb-table").length ===
            1 &&
          targets(statement.id, "aws.iam.authorizes-dynamodb-table")[0]?.id ===
            table.id
        );
      })
    );
  };
  const checks = [
    ["lambda-vpc-association", all((row) => row.access !== undefined)],
    [
      "private-subnet-selection",
      all(
        (row) =>
          row.subnets.length >= 2 &&
          row.subnets.every(
            (n) =>
              literal(n, "accessTier") === "private" &&
              literal(n, "mapPublicIpOnLaunch") === false &&
              literal(n, "assignIpv6AddressOnCreation") === false,
          ),
      ),
    ],
    [
      "distinct-availability-zones",
      all((row) => {
        const names = row.subnets.map((n) => literal(zone(n), "zoneName"));
        return (
          names.every((n) => typeof n === "string") && new Set(names).size >= 2
        );
      }),
    ],
    [
      "same-vpc-selection",
      all((row) => {
        const ids = row.subnets.map((n) => vpc(n)?.id);
        return (
          ids.length >= 2 &&
          ids.every((id) => id !== undefined) &&
          new Set(ids).size === 1
        );
      }),
    ],
    [
      "no-nat-gateway",
      ofType("aws.ec2.nat-gateway").length === 0 &&
        !document.edges.some(
          (e) =>
            e.semantic.relationshipType === "aws.ec2.route-targets-nat-gateway",
        ),
    ],
    [
      "explicit-dynamodb-egress",
      all((row) => literal(row.access, "egressRequirement") === "dynamodb"),
    ],
    [
      "endpoint-route-for-every-subnet",
      selectedSubnets.length >= 2 &&
        selectedSubnets.every((n) => matchingEndpoints(n).length > 0),
    ],
    [
      "restricted-endpoint-policy",
      selectedSubnets.length >= 2 &&
        selectedSubnets.every((n) =>
          matchingEndpoints(n).some(
            (endpoint) =>
              literal(endpoint, "policyMode") === "restricted" &&
              sources(endpoint.id, relations.endpointPolicy).length === 1 &&
              sources(endpoint.id, relations.endpointPolicy).every(
                (policy) =>
                  backedParent(
                    policy,
                    services.endpoint,
                    relations.endpointPolicy,
                    true,
                  )?.id === endpoint.id && endpointPolicyIsScoped(policy),
              ),
          ),
        ),
    ],
    [
      "same-vpc-security-groups",
      all(
        (row) =>
          row.groups.length > 0 &&
          row.subnets.length > 0 &&
          row.groups.every((g) => {
            const scope = one(sources(g.id, relations.groupVpc));
            return (
              scope !== undefined &&
              row.subnets.every((n) => vpc(n)?.id === scope.id)
            );
          }),
      ),
    ],
    ["no-workload-ingress", privateIngress],
    [
      "dynamodb-https-egress",
      all((row) =>
        row.groups.some((group) =>
          sources(group.id, "aws.ec2.security-group-owns-egress-rule").some(
            (rule) =>
              backedParent(
                rule,
                services.group,
                "aws.ec2.security-group-owns-egress-rule",
                true,
              )?.id === group.id &&
              literal(rule, "protocol") === "tcp" &&
              literal(rule, "fromPort") === 443 &&
              literal(rule, "toPort") === 443 &&
              literal(rule, "destinationIpv4Cidr") === "0.0.0.0/0",
          ),
        ),
      ),
    ],
    [
      "explicit-dynamodb-data-access",
      all((row) =>
        unique([
          ...targets(row.fn.id, relations.read),
          ...targets(row.fn.id, relations.write),
        ]).some((n) => n.semantic.serviceType === services.data),
      ),
    ],
    [
      "explicit-execution-role",
      all((row) => sources(row.fn.id, relations.role).length === 1),
    ],
  ] as const;
  const criteria = checks.map(([criterion, satisfied]) => ({
    criterion,
    satisfied,
  }));
  const body = {
    inspectorId: "cloudmarkup.private-vpc-requirement-coverage.v1",
    inspectorVersion: "1.0.0",
    architectureContentDigest: getArchitectureDocumentContentHash(document),
    criteria,
    numerator: criteria.filter((c) => c.satisfied).length,
    denominator: criteria.length,
  };
  return { ...body, inspectionDigest: digestCanonicalValue(body) };
}
