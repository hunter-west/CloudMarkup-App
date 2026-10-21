import { serializeCanonicalJson } from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";

import {
  ARCHITECTURE_CLI_LIMITS,
  architectureCliSemanticChangeV1Schema,
  architectureCliSemanticSnapshotV1Schema,
  type ArchitectureCliSemanticChangeV1,
  type ArchitectureCliSemanticSnapshotV1,
  type ArchitectureCliSha256Digest,
} from "./contracts.js";

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function snapshotProjection(
  snapshot: ArchitectureCliSemanticSnapshotV1,
): Omit<ArchitectureCliSemanticSnapshotV1, "snapshotDigest"> {
  return architectureCliSemanticSnapshotV1Schema
    .omit({ snapshotDigest: true })
    .parse(
      Object.fromEntries(
        Object.entries(snapshot).filter(([key]) => key !== "snapshotDigest"),
      ),
    );
}

export function semanticSnapshotDigest(
  snapshot: Omit<ArchitectureCliSemanticSnapshotV1, "snapshotDigest">,
): ArchitectureCliSemanticSnapshotV1["snapshotDigest"] {
  return sha256Digest(serializeCanonicalJson(snapshot));
}

export function parseArchitectureCliSemanticSnapshot(
  input: unknown,
): ArchitectureCliSemanticSnapshotV1 {
  const snapshot = architectureCliSemanticSnapshotV1Schema.parse(input);
  if (
    semanticSnapshotDigest(snapshotProjection(snapshot)) !==
    snapshot.snapshotDigest
  ) {
    throw new Error(
      "Semantic snapshot digest does not match its canonical content.",
    );
  }
  for (const collection of [
    snapshot.connections,
    snapshot.contracts,
    snapshot.events,
    snapshot.eventPolicies ?? [],
    snapshot.handlers ?? [],
    snapshot.permissions,
    snapshot.routes,
    snapshot.services,
    snapshot.workloadOperations,
  ]) {
    for (let index = 1; index < collection.length; index += 1) {
      const previous = collection[index - 1];
      const current = collection[index];
      if (
        previous === undefined ||
        current === undefined ||
        previous.id >= current.id
      ) {
        throw new Error(
          "Semantic facts must be uniquely UTF-16 sorted by stable ID.",
        );
      }
    }
  }
  return snapshot;
}

function addChange(
  changes: ArchitectureCliSemanticChangeV1[],
  input: Omit<ArchitectureCliSemanticChangeV1, "summary"> & {
    readonly summary: string;
  },
): void {
  if (changes.length >= ARCHITECTURE_CLI_LIMITS.diffEntries) {
    throw new Error("Semantic diff exceeds the configured entry limit.");
  }
  changes.push(architectureCliSemanticChangeV1Schema.parse(input));
}

interface SemanticFact {
  readonly digest: ArchitectureCliSha256Digest;
  readonly id: string;
}

function compareFacts<T extends SemanticFact>(
  changes: ArchitectureCliSemanticChangeV1[],
  before: readonly T[],
  after: readonly T[],
  names: {
    readonly added: ArchitectureCliSemanticChangeV1["kind"];
    readonly changed: ArchitectureCliSemanticChangeV1["kind"];
    readonly noun: string;
    readonly removed: ArchitectureCliSemanticChangeV1["kind"];
  },
): void {
  const beforeById = new Map(before.map((fact) => [fact.id, fact]));
  const afterById = new Map(after.map((fact) => [fact.id, fact]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort(
    compareUtf16,
  );
  for (const id of ids) {
    const previous = beforeById.get(id);
    const current = afterById.get(id);
    if (previous === undefined && current !== undefined) {
      addChange(changes, {
        afterDigest: current.digest,
        factId: id,
        kind: names.added,
        summary: `${names.noun} ${id} was added.`,
      });
    } else if (previous !== undefined && current === undefined) {
      addChange(changes, {
        beforeDigest: previous.digest,
        factId: id,
        kind: names.removed,
        summary: `${names.noun} ${id} was removed.`,
      });
    } else if (
      previous !== undefined &&
      current !== undefined &&
      previous.digest !== current.digest
    ) {
      addChange(changes, {
        afterDigest: current.digest,
        beforeDigest: previous.digest,
        factId: id,
        kind: names.changed,
        summary: `${names.noun} ${id} changed.`,
      });
    }
  }
}

function comparePermissions(
  changes: ArchitectureCliSemanticChangeV1[],
  before: ArchitectureCliSemanticSnapshotV1["permissions"],
  after: ArchitectureCliSemanticSnapshotV1["permissions"],
): void {
  const previous = new Map(before.map((fact) => [fact.id, fact]));
  const current = new Map(after.map((fact) => [fact.id, fact]));
  const ids = [...new Set([...previous.keys(), ...current.keys()])].sort(
    compareUtf16,
  );
  for (const id of ids) {
    const left = previous.get(id);
    const right = current.get(id);
    if (left === undefined && right !== undefined) {
      addChange(changes, {
        afterDigest: right.digest,
        factId: id,
        kind:
          right.effect === "allow"
            ? "permission-expanded"
            : "permission-reduced",
        summary: `Permission ${id} was added with ${right.effect} effect.`,
      });
    } else if (left !== undefined && right === undefined) {
      addChange(changes, {
        beforeDigest: left.digest,
        factId: id,
        kind:
          left.effect === "allow"
            ? "permission-reduced"
            : "permission-expanded",
        summary: `Permission ${id} was removed from the ${left.effect} set.`,
      });
    } else if (
      left !== undefined &&
      right !== undefined &&
      left.digest !== right.digest
    ) {
      addChange(changes, {
        afterDigest: right.digest,
        beforeDigest: left.digest,
        factId: id,
        kind: "permission-changed",
        summary: `Permission ${id} changed.`,
      });
    }
  }
}

function compareServiceSignals(
  changes: ArchitectureCliSemanticChangeV1[],
  before: ArchitectureCliSemanticSnapshotV1["services"],
  after: ArchitectureCliSemanticSnapshotV1["services"],
): void {
  const previous = new Map(before.map((fact) => [fact.id, fact]));
  for (const right of after) {
    const left = previous.get(right.id);
    if (left === undefined) continue;
    if (left.publicExposure !== right.publicExposure) {
      addChange(changes, {
        afterDigest: right.digest,
        beforeDigest: left.digest,
        factId: right.id,
        kind: "public-exposure-changed",
        summary: `Public exposure classification for service ${right.id} changed.`,
      });
    }
    if (left.costSensitive !== right.costSensitive) {
      addChange(changes, {
        afterDigest: right.digest,
        beforeDigest: left.digest,
        factId: right.id,
        kind: "cost-sensitive-resource-changed",
        summary: `Cost-sensitive classification for service ${right.id} changed.`,
      });
    }
  }
}

function compareRequirements(
  changes: ArchitectureCliSemanticChangeV1[],
  before: readonly string[],
  after: readonly string[],
): void {
  const previous = new Set(before);
  const current = new Set(after);
  for (const id of [...current]
    .filter((value) => !previous.has(value))
    .sort(compareUtf16)) {
    addChange(changes, {
      factId: id,
      kind: "unresolved-requirement-added",
      summary: `Unresolved requirement ${id} was added.`,
    });
  }
  for (const id of [...previous]
    .filter((value) => !current.has(value))
    .sort(compareUtf16)) {
    addChange(changes, {
      factId: id,
      kind: "unresolved-requirement-resolved",
      summary: `Unresolved requirement ${id} was resolved or removed.`,
    });
  }
}

export function diffArchitectureCliSemanticSnapshots(
  beforeInput: unknown,
  afterInput: unknown,
): readonly ArchitectureCliSemanticChangeV1[] {
  const before = parseArchitectureCliSemanticSnapshot(beforeInput);
  const after = parseArchitectureCliSemanticSnapshot(afterInput);
  const changes: ArchitectureCliSemanticChangeV1[] = [];
  compareFacts(changes, before.services, after.services, {
    added: "service-added",
    changed: "service-changed",
    noun: "Service",
    removed: "service-removed",
  });
  compareServiceSignals(changes, before.services, after.services);
  compareFacts(changes, before.connections, after.connections, {
    added: "connection-added",
    changed: "connection-changed",
    noun: "Connection",
    removed: "connection-removed",
  });
  comparePermissions(changes, before.permissions, after.permissions);
  compareFacts(changes, before.routes, after.routes, {
    added: "route-added",
    changed: "route-changed",
    noun: "Route",
    removed: "route-removed",
  });
  compareFacts(changes, before.events, after.events, {
    added: "event-added",
    changed: "event-changed",
    noun: "Event",
    removed: "event-removed",
  });
  compareFacts(
    changes,
    before.contracts.filter(({ contractKind }) => contractKind === "event"),
    after.contracts.filter(({ contractKind }) => contractKind === "event"),
    {
      added: "event-contract-added",
      changed: "event-contract-changed",
      noun: "Event contract",
      removed: "event-contract-removed",
    },
  );
  compareFacts(
    changes,
    before.contracts.filter(({ contractKind }) => contractKind !== "event"),
    after.contracts.filter(({ contractKind }) => contractKind !== "event"),
    {
      added: "data-contract-added",
      changed: "data-contract-changed",
      noun: "Contract",
      removed: "data-contract-removed",
    },
  );
  for (const policyKind of ["batch", "dlq", "filter", "retry"] as const) {
    compareFacts(
      changes,
      (before.eventPolicies ?? []).filter(
        (policy) => policy.policyKind === policyKind,
      ),
      (after.eventPolicies ?? []).filter(
        (policy) => policy.policyKind === policyKind,
      ),
      {
        added: `event-${policyKind}-added`,
        changed: `event-${policyKind}-changed`,
        noun: `Event ${policyKind} policy`,
        removed: `event-${policyKind}-removed`,
      },
    );
  }
  compareFacts(changes, before.handlers ?? [], after.handlers ?? [], {
    added: "handler-added",
    changed: "handler-changed",
    noun: "Handler",
    removed: "handler-removed",
  });
  compareFacts(changes, before.workloadOperations, after.workloadOperations, {
    added: "workload-operation-added",
    changed: "workload-operation-changed",
    noun: "Workload operation",
    removed: "workload-operation-removed",
  });
  if (
    serializeCanonicalJson(before.coverage) !==
    serializeCanonicalJson(after.coverage)
  ) {
    addChange(changes, {
      afterDigest: sha256Digest(serializeCanonicalJson(after.coverage)),
      beforeDigest: sha256Digest(serializeCanonicalJson(before.coverage)),
      factId: "generation-coverage",
      kind: "coverage-changed",
      summary: "Generation coverage changed.",
    });
  }
  if (before.target !== after.target) {
    addChange(changes, {
      ...(after.target === undefined
        ? {}
        : { afterDigest: sha256Digest(serializeCanonicalJson(after.target)) }),
      ...(before.target === undefined
        ? {}
        : {
            beforeDigest: sha256Digest(serializeCanonicalJson(before.target)),
          }),
      factId: "iac-target",
      kind: "target-changed",
      summary: "Infrastructure target changed.",
    });
  }
  if (
    serializeCanonicalJson(before.readiness) !==
    serializeCanonicalJson(after.readiness)
  ) {
    addChange(changes, {
      afterDigest: sha256Digest(serializeCanonicalJson(after.readiness)),
      beforeDigest: sha256Digest(serializeCanonicalJson(before.readiness)),
      factId: "target-readiness",
      kind: "target-readiness-changed",
      summary: "Target readiness changed.",
    });
  }
  compareRequirements(
    changes,
    before.unresolvedRequirements,
    after.unresolvedRequirements,
  );
  return changes.sort((left, right) =>
    compareUtf16(
      `${left.kind}\u0000${left.factId}`,
      `${right.kind}\u0000${right.factId}`,
    ),
  );
}
