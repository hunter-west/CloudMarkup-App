import type { ValidationFinding } from "@cloudmarkup/domain";

/** Use stable entity identities and field suffixes, not array positions which
 * can change when an atomic command inserts resources. */
export function betaInfrastructureIssueIdentity(finding: ValidationFinding) {
  return JSON.stringify([
    finding.code,
    finding.affected
      .map((location) => {
        const owner =
          location.kind === "configuration" ? location.owner : location;
        const entity =
          "edgeId" in owner
            ? `edge:${owner.edgeId}`
            : "nodeId" in owner
              ? `node:${owner.nodeId}`
              : "document";
        return [
          entity,
          location.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
        ];
      })
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
  ]);
}
