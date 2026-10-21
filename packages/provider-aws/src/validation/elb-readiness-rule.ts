import { parseIpv4Cidr } from "./networking-rules.js";
import type { ValidationFindingCandidate } from "@cloudmarkup/domain";
import { elbProperties, elbBindings } from "../catalog/services/elb.js";
import { elbReadinessValidationRuleDescriptor as descriptor } from "../catalog/validation-rules/elb-readiness.js";
import {
  configurationValue,
  defineAwsValidationRuleV1,
  finding,
  literalString,
  nodeLocation,
  type AwsValidationCatalogV1,
  type AwsValidationNode,
  type AwsValidationEdge,
} from "./rule-helpers.js";
export function createElbReadinessRuleV1(catalog: AwsValidationCatalogV1) {
  return defineAwsValidationRuleV1({
    descriptor,
    catalog,
    evaluate(context) {
      const d = context.document;
      if (!d) return [];
      const findings: ValidationFindingCandidate[] = [];
      const text = (n: AwsValidationNode, k: string) =>
        literalString(n.semantic.configuration.values, k);
      const number = (n: AwsValidationNode, k: string) => {
        const v = configurationValue(n.semantic.configuration.values, k);
        return v?.kind === "integer" ? v.value : undefined;
      };
      const external = (n: AwsValidationNode) =>
        "externalResources" in d &&
        d.externalResources.resources.some((r) =>
          r.architectureNodeIds.includes(n.id),
        );
      const user = (n: AwsValidationNode) =>
        n.semantic.lifecycle.ownership === "user" &&
        ["user", "template", "ai-accepted", "migration"].includes(
          n.semantic.lifecycle.origin,
        );
      const emit = (
        n: AwsValidationNode,
        code: string,
        message: string,
        warning = false,
      ) => {
        findings.push(
          finding(descriptor, {
            code: "aws.validation.elb-" + code,
            severity: warning ? "warning" : "security-error",
            title: warning
              ? "Review external distribution readiness"
              : "Correct ELB intent",
            beginnerExplanation: message,
            technicalExplanation: message,
            affected: [nodeLocation(n, d.nodes.indexOf(n))],
          }),
        );
      };
      const exactFields = (n: AwsValidationNode) => {
        const schema = elbProperties[n.semantic.serviceType];
        if (!schema) return false;
        const v = n.semantic.configuration.values;
        return (
          n.semantic.configuration.schemaId ===
            n.semantic.serviceType + ".configuration" &&
          n.semantic.configuration.schemaVersion === "1.0.0" &&
          Object.keys(v).length === Object.keys(schema).length &&
          Object.entries(schema).every(([k, s]) => {
            const x = configurationValue(v, k);
            if (x?.kind !== s.type || !("value" in x)) return false;
            const raw = x.value;
            if (
              s.type === "string" &&
              (typeof raw !== "string" ||
                (s.minLength !== undefined && raw.length < s.minLength) ||
                (s.maxLength !== undefined && raw.length > s.maxLength) ||
                (s.pattern !== undefined &&
                  !new RegExp(s.pattern, "u").test(raw)))
            )
              return false;
            if (
              s.type === "integer" &&
              (typeof raw !== "number" ||
                !Number.isSafeInteger(raw) ||
                (s.minimum !== undefined && raw < s.minimum) ||
                (s.maximum !== undefined && raw > s.maximum))
            )
              return false;
            return (
              (!("enum" in s) || !s.enum || s.enum.includes(raw as never)) &&
              (!("const" in s) || s.const === undefined || raw === s.const)
            );
          })
        );
      };
      const exactEdge = (e: AwsValidationEdge) => {
        const b = elbBindings.find((b) => b[0] === e.semantic.relationshipType);
        if (!b) return false;
        const l = e.semantic.lifecycle;
        return (
          d.nodes.some(
            (n) =>
              n.id === e.semantic.source.nodeId &&
              n.semantic.serviceType === b[1] &&
              n.semantic.resourceType === b[1],
          ) &&
          d.nodes.some(
            (n) =>
              n.id === e.semantic.target.nodeId &&
              n.semantic.serviceType === b[3] &&
              n.semantic.resourceType === b[3],
          ) &&
          e.semantic.source.port === b[1] + "." + b[2] &&
          e.semantic.target.port === b[3] + "." + b[4] &&
          e.semantic.configuration.schemaId === b[0] + ".connection" &&
          e.semantic.configuration.schemaVersion === "1.0.0" &&
          Object.keys(e.semantic.configuration.values).length === 0 &&
          ((l.ownership === "user" &&
            ["user", "template", "ai-accepted", "migration"].includes(
              l.origin,
            )) ||
            (l.ownership === "generated" &&
              l.origin === "connection-rule" &&
              l.provenance.generatorKind === "connection-rule" &&
              l.provenance.generatorId === b[0] &&
              l.provenance.generatorVersion === "1.0.0" &&
              l.provenance.operationId.length > 0 &&
              l.provenance.dependentNodeIds.length === 2 &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.source.nodeId,
              ) &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.target.nodeId,
              ) &&
              l.provenance.dependentEdgeIds.length === 0))
        );
      };
      const safe = (n: AwsValidationNode | undefined) =>
        !!n &&
        user(n) &&
        !external(n) &&
        String(n.semantic.resourceType) === String(n.semantic.serviceType);
      const allEdges = (n: AwsValidationNode, rel: string, incoming = false) =>
        d.edges.filter(
          (e) =>
            e.semantic.relationshipType === rel &&
            (incoming ? e.semantic.target.nodeId : e.semantic.source.nodeId) ===
              n.id,
        );
      const support = (e: AwsValidationEdge) => {
        const rule = catalog.connectionRules.find(
            (x) => x.relationshipType === e.semantic.relationshipType,
          ),
          l = e.semantic.lifecycle;
        const source = d.nodes.find((x) => x.id === e.semantic.source.nodeId),
          target = d.nodes.find((x) => x.id === e.semantic.target.nodeId);
        return (
          !!rule &&
          safe(source) &&
          safe(target) &&
          source?.semantic.serviceType === rule.source.serviceId &&
          target?.semantic.serviceType === rule.target.serviceId &&
          e.semantic.source.port === rule.source.portId &&
          e.semantic.target.port === rule.target.portId &&
          e.semantic.configuration.schemaId === rule.configuration.schemaId &&
          e.semantic.configuration.schemaVersion ===
            rule.configuration.schemaVersion &&
          ((l.ownership === "user" &&
            ["user", "template", "ai-accepted", "migration"].includes(
              l.origin,
            )) ||
            (l.ownership === "generated" &&
              l.origin === "connection-rule" &&
              l.provenance.generatorKind === "connection-rule" &&
              String(l.provenance.generatorId) === String(rule.id) &&
              l.provenance.generatorVersion === rule.ruleVersion &&
              l.provenance.operationId.length > 0 &&
              l.provenance.dependentNodeIds.length === 2 &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.source.nodeId,
              ) &&
              l.provenance.dependentNodeIds.includes(
                e.semantic.target.nodeId,
              ) &&
              l.provenance.dependentEdgeIds.length === 0))
        );
      };
      const related = (n: AwsValidationNode, rel: string, incoming = false) =>
        allEdges(n, rel, incoming).flatMap((e) => {
          const x = d.nodes.find(
            (x) =>
              x.id ===
              (incoming ? e.semantic.source.nodeId : e.semantic.target.nodeId),
          );
          return x &&
            (elbBindings.some((b) => b[0] === rel) ? exactEdge(e) : support(e))
            ? [x]
            : [];
        });
      const one = (n: AwsValidationNode, rel: string, incoming = false) => {
        const xs = related(n, rel, incoming);
        return xs.length === 1 ? xs[0] : undefined;
      };
      const parent = (
        n: AwsValidationNode,
        service: string,
        rel: string,
        reverse = false,
      ) => {
        const x = d.nodes.find((x) => x.id === n.semantic.parent?.nodeId);
        return safe(x) &&
          x?.semantic.serviceType === service &&
          n.semantic.parent?.relationshipType === rel &&
          one(n, rel, reverse)?.id === x.id
          ? x
          : undefined;
      };
      const az = (n: AwsValidationNode) =>
        parent(
          n,
          "aws.ec2.availability-zone",
          "aws.ec2.availability-zone-contains-subnet",
          true,
        );
      const vpc = (n: AwsValidationNode) => {
        if (n.semantic.serviceType === "aws.ec2.vpc")
          return safe(n) ? n : undefined;
        if (n.semantic.serviceType === "aws.ec2.security-group")
          return one(n, "aws.ec2.vpc-associates-security-group", true);
        const zone = az(n);
        return zone
          ? parent(
              zone,
              "aws.ec2.vpc",
              "aws.ec2.vpc-contains-availability-zone",
              true,
            )
          : undefined;
      };
      const publicRoute = (subnet: AwsValidationNode, v: AwsValidationNode) => {
        const a = one(
          subnet,
          "aws.ec2.route-table-association-targets-subnet",
          true,
        );
        const rt = a
          ? parent(
              a,
              "aws.ec2.route-table",
              "aws.ec2.route-table-owns-subnet-association",
            )
          : undefined;
        if (
          !rt ||
          text(subnet, "accessTier") !== "public" ||
          parent(rt, "aws.ec2.vpc", "aws.ec2.vpc-contains-route-table", true)
            ?.id !== v.id
        )
          return false;
        return related(rt, "aws.ec2.route-table-owns-route", true).some(
          (route) => {
            const igw = one(route, "aws.ec2.route-targets-internet-gateway");
            return (
              route.semantic.parent?.nodeId === rt.id &&
              text(route, "destinationIpv4Cidr") === "0.0.0.0/0" &&
              igw &&
              one(igw, "aws.ec2.vpc-attaches-internet-gateway", true)?.id ===
                v.id
            );
          },
        );
      };
      const ownedIngress = (group: AwsValidationNode) => {
        const rel = "aws.ec2.security-group-owns-ingress-rule";
        if (allEdges(group, rel, true).some((e) => !support(e)))
          emit(
            group,
            "group-rule",
            "Selected group rules must use exact modeled user-owned dependencies and authorized schema/endpoint provenance; external or malformed rules cannot be ignored.",
          );
        return related(group, rel, true).filter(
          (x) =>
            x.semantic.parent?.nodeId === group.id &&
            x.semantic.parent.relationshipType === rel,
        );
      };
      const dedicatedGroup = (
        group: AwsValidationNode,
        consumer: AwsValidationNode | undefined,
        consumerRelationship: string,
        v: AwsValidationNode | undefined,
        access: AwsValidationNode,
        accessRelationship: string,
      ) =>
        d.edges.every((e) => {
          if (e.semantic.source.nodeId === group.id) return false;
          if (e.semantic.target.nodeId !== group.id) return true;
          const rel = e.semantic.relationshipType;
          if (
            elbBindings.some((b) => b[0] === rel) ? !exactEdge(e) : !support(e)
          )
            return false;
          if (rel === consumerRelationship)
            return e.semantic.source.nodeId === consumer?.id;
          if (rel === accessRelationship)
            return e.semantic.source.nodeId === access.id;
          if (rel === "aws.ec2.vpc-associates-security-group")
            return e.semantic.source.nodeId === v?.id;
          if (
            [
              "aws.ec2.security-group-owns-ingress-rule",
              "aws.ec2.security-group-owns-egress-rule",
            ].includes(rel)
          ) {
            const rule = d.nodes.find((x) => x.id === e.semantic.source.nodeId);
            return (
              rule?.semantic.parent?.nodeId === group.id &&
              rule.semantic.parent.relationshipType === rel
            );
          }
          return false;
        });
      for (const e of d.edges)
        if (
          elbBindings.some((b) => b[0] === e.semantic.relationshipType) &&
          !exactEdge(e)
        ) {
          const n =
            d.nodes.find((n) => n.id === e.semantic.source.nodeId) ??
            d.nodes[0];
          if (n)
            emit(
              n,
              "binding",
              "Use exact endpoints, closed connection schema and authorized user or exact generated binding provenance.",
            );
        }
      for (const n of d.nodes) {
        if (!elbProperties[n.semantic.serviceType]) continue;
        if (!safe(n))
          emit(
            n,
            "ownership",
            "Use exact user-owned resources/configuration; external, adopted and generated resource ownership is unsupported.",
          );
        if (!exactFields(n))
          emit(
            n,
            "configuration",
            "Supply every reviewed literal field, required explicit choice and admitted bounds; unknown/reference values fail closed.",
          );
        if (
          !/^(?:af|ap|ca|eu|il|me|mx|sa|us)-/u.test(d.provider.region) ||
          /^(?:cn-|us-gov-|us-iso|eu-iso|eusc-)/u.test(d.provider.region)
        )
          emit(n, "partition", "Use a modeled commercial AWS Region.");
        if (
          [
            "aws.elb.application-load-balancer",
            "aws.elb.target-group",
          ].includes(n.semantic.serviceType)
        ) {
          if (n.semantic.parent)
            emit(
              n,
              "placement",
              "ALB and target-group resources are user-owned roots.",
            );
          if (
            text(n, "name")?.startsWith("internal-") ||
            d.nodes.some(
              (x) =>
                x.id !== n.id &&
                x.semantic.serviceType === n.semantic.serviceType &&
                text(x, "name") === text(n, "name"),
            )
          )
            emit(
              n,
              "name",
              "Names must be unique per native type/Region and cannot use the reserved internal- prefix.",
            );
        }
        if (n.semantic.serviceType === "aws.elb.application-load-balancer") {
          const v = one(n, "aws.elb.alb-uses-vpc"),
            group = one(n, "aws.elb.alb-uses-security-group"),
            subs = related(n, "aws.elb.alb-uses-subnet"),
            listeners = related(n, "aws.elb.alb-owns-listener", true);
          if (
            !safe(v) ||
            !safe(group) ||
            !v ||
            !group ||
            vpc(group)?.id !== v.id ||
            subs.length < 2 ||
            subs.length > 16 ||
            new Set(
              subs.map((x) => {
                const z = az(x);
                return z ? text(z, "zoneName") : undefined;
              }),
            ).size !== subs.length ||
            subs.some(
              (x) =>
                !safe(x) ||
                vpc(x)?.id !== v.id ||
                !az(x) ||
                !parseIpv4Cidr(text(x, "cidrBlock"), 4, 27),
            )
          )
            emit(
              n,
              "network",
              "Connect one VPC/group and two to sixteen same-VPC subnets, one per distinct AZ with CIDR at least /27. Exact canonical networking ownership is required.",
            );
          if (
            v &&
            text(n, "scheme") === "internet-facing" &&
            subs.some((s) => !publicRoute(s, v))
          )
            emit(
              n,
              "public-route",
              "Every internet-facing ALB subnet needs an exact graph-backed public internet-gateway default route.",
            );
          if (
            group &&
            allEdges(group, "aws.ec2.security-group-owns-egress-rule", true)
              .length
          )
            emit(
              n,
              "egress",
              "Dedicated ALB groups use only the exact backend peer egress; CIDR egress merges are unsupported.",
            );
          if (
            group &&
            !ownedIngress(group).some(
              (x) =>
                text(x, "protocol") === "tcp" &&
                number(x, "fromPort") === 443 &&
                number(x, "toPort") === 443,
            )
          )
            emit(
              n,
              "viewer-ingress",
              "Explicitly own a client CIDR ingress rule for TCP/443 on the exact ALB group. No viewer permission is inferred.",
            );
          if (
            listeners.length !== 1 ||
            listeners[0]?.semantic.parent?.nodeId !== n.id ||
            listeners[0].semantic.parent.relationshipType !==
              "aws.elb.alb-owns-listener"
          )
            emit(
              n,
              "listener",
              "One canonical owned HTTPS listener and exact owner edge are required.",
            );
        }
        if (n.semantic.serviceType === "aws.elb.https-listener") {
          const a = parent(
              n,
              "aws.elb.application-load-balancer",
              "aws.elb.alb-owns-listener",
            ),
            tg = one(n, "aws.elb.listener-forwards-to-target-group"),
            cert = one(n, "aws.elb.listener-uses-certificate");
          if (
            !a ||
            !safe(a) ||
            !tg ||
            !safe(tg) ||
            allEdges(tg, "aws.elb.listener-forwards-to-target-group", true)
              .length !== 1
          )
            emit(
              n,
              "listener-owner",
              "Bind this canonical listener to one exact ALB parent and one dedicated target group.",
            );
          if (
            !cert ||
            !safe(cert) ||
            text(cert, "intendedUse") !== "regional" ||
            text(cert, "certificateRegion") !== d.provider.region ||
            text(cert, "domainName") !== text(n, "serverName")
          )
            emit(
              n,
              "certificate",
              "Use the exact primary DNS name of a user-owned regional ACM public certificate in this graph Region. Existing DNS authority checks also apply.",
            );
        }
        if (n.semantic.serviceType === "aws.elb.target-group") {
          const listener = one(
              n,
              "aws.elb.listener-forwards-to-target-group",
              true,
            ),
            a = listener
              ? one(listener, "aws.elb.alb-owns-listener")
              : undefined;
          const v = one(n, "aws.elb.target-group-uses-vpc"),
            subs = a ? related(a, "aws.elb.alb-uses-subnet") : [],
            aGroup = a ? one(a, "aws.elb.alb-uses-security-group") : undefined;
          const ec2 = related(n, "aws.elb.target-group-targets-ec2"),
            ecs = related(n, "aws.elb.target-group-targets-ecs"),
            backend =
              text(n, "backendMode") === "ec2-instance" ? ec2[0] : ecs[0];
          const expected =
            text(n, "backendMode") === "ec2-instance"
              ? "aws.elb.target-group-targets-ec2"
              : "aws.elb.target-group-targets-ecs";
          if (
            !a ||
            !safe(v) ||
            !v ||
            one(a, "aws.elb.alb-uses-vpc")?.id !== v.id ||
            ec2.length + ecs.length !== 1 ||
            !safe(backend) ||
            !backend ||
            allEdges(backend, expected, true).length !== 1
          )
            emit(
              n,
              "backend",
              "Use one dedicated exact private EC2 or Linux Fargate backend and the same VPC as this target group and ALB.",
            );
          const backendSubs = backend
            ? related(
                backend,
                backend.semantic.serviceType === "aws.ec2.instance"
                  ? "aws.ec2.instance-uses-subnet"
                  : "aws.ecs.service-uses-subnet",
              )
            : [];
          const groups = backend
            ? related(
                backend,
                backend.semantic.serviceType === "aws.ec2.instance"
                  ? "aws.ec2.instance-uses-security-group"
                  : "aws.ecs.service-uses-security-group",
              )
            : [];
          const g = groups[0];
          if (
            !v ||
            !backendSubs.length ||
            backendSubs.some(
              (x) =>
                vpc(x)?.id !== v.id ||
                text(x, "accessTier") !== "private" ||
                !subs.some((s) => az(s)?.id === az(x)?.id),
            ) ||
            groups.length !== 1 ||
            !safe(g) ||
            !g ||
            vpc(g)?.id !== v.id ||
            aGroup?.id === g.id
          )
            emit(
              n,
              "backend-network",
              "Backend placement must be private in the exact VPC and ALB-enabled AZs, with one dedicated group distinct from the ALB group.",
            );
          if (ec2.length && number(n, "startupGraceSeconds") !== 0)
            emit(
              n,
              "ec2-grace",
              "EC2 has no service startup-grace contract; declare zero.",
            );
          if (ecs.length && backend) {
            const task = one(backend, "aws.ecs.service-uses-task", true),
              container = task
                ? one(task, "aws.ecs.task-owns-container", true)
                : undefined;
            if (
              !container ||
              !safe(container) ||
              number(container, "containerPort") !== number(n, "port")
            )
              emit(
                n,
                "ecs-port",
                "Fargate requires the exact one essential task-container name/port; target port must match it.",
              );
          }
          const accesses = related(
              n,
              "aws.elb.target-group-owns-backend-access",
              true,
            ),
            access = accesses[0];
          if (
            accesses.length !== 1 ||
            !access ||
            !safe(access) ||
            access.semantic.parent?.nodeId !== n.id ||
            access.semantic.parent.relationshipType !==
              "aws.elb.target-group-owns-backend-access" ||
            one(access, "aws.elb.backend-access-uses-alb-group")?.id !==
              aGroup?.id ||
            one(access, "aws.elb.backend-access-uses-target-group")?.id !==
              g?.id
          )
            emit(
              n,
              "backend-access",
              "One canonical owned access configuration must bind the exact ALB and backend groups, projecting only TCP peer rules for this health/backend port.",
            );
          if (
            g &&
            ownedIngress(g).some(
              (x) =>
                (text(x, "protocol") === "-1" ||
                  text(x, "protocol") === "tcp") &&
                (text(x, "protocol") === "-1" ||
                  ((number(x, "fromPort") ?? 65536) <=
                    (number(n, "port") ?? 0) &&
                    (number(x, "toPort") ?? -1) >=
                      (number(n, "port") ?? 65536))),
            )
          )
            emit(
              n,
              "backend-bypass",
              "Remove owned CIDR ingress permitting this backend port; this slice admits the exact ALB source-group peer path only.",
            );
          if (
            access &&
            ((aGroup &&
              !dedicatedGroup(
                aGroup,
                a,
                "aws.elb.alb-uses-security-group",
                v,
                access,
                "aws.elb.backend-access-uses-alb-group",
              )) ||
              (g &&
                !dedicatedGroup(
                  g,
                  backend,
                  backend?.semantic.serviceType === "aws.ec2.instance"
                    ? "aws.ec2.instance-uses-security-group"
                    : "aws.ecs.service-uses-security-group",
                  v,
                  access,
                  "aws.elb.backend-access-uses-target-group",
                )))
          )
            emit(
              n,
              "shared-access",
              "Use the ALB group only for this load balancer and the backend group only for its selected EC2 instance or Fargate service. Other workloads need separate groups; sharing would broaden backend access. VPC, access-owner and owned rule connections must remain exact.",
            );
        }
        if (
          n.semantic.serviceType === "aws.elb.backend-access-configuration" &&
          !parent(
            n,
            "aws.elb.target-group",
            "aws.elb.target-group-owns-backend-access",
          )
        )
          emit(
            n,
            "access-owner",
            "Canonical target-group parent and exact owner edge must agree.",
          );
        emit(
          n,
          "external-readiness",
          "Verify Region/AZ availability, quotas, free subnet IPs, route/NACL reachability, deployer/service-linked-role authority, external hostname mapping, certificate issuance/renewal, backend HTTP/health and retained-resource cleanup externally. Viewer TLS terminates at ALB; backend HTTP is unencrypted. No provisioning or live health is proven.",
          true,
        );
      }
      return findings;
    },
  });
}
