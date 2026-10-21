export type LocalMockCapability =
  | "create-project"
  | "view-billing"
  | "manage-billing"
  | "view-organization-settings"
  | "manage-members"
  | "view-usage";

export interface LocalMockIdentity {
  readonly kind: "local-mock";
  readonly actorId: string;
  readonly displayName: string;
  readonly organization: {
    readonly id: string;
    readonly name: string;
  };
  readonly capabilities: ReadonlySet<LocalMockCapability>;
}

export const localMockIdentity: LocalMockIdentity = Object.freeze({
  kind: "local-mock",
  actorId: "local-mock-actor",
  displayName: "Avery Chen",
  organization: Object.freeze({
    id: "local-org",
    name: "Northstar Sandbox",
  }),
  capabilities: new Set<LocalMockCapability>([
    "create-project",
    "view-billing",
    "view-organization-settings",
    "view-usage",
  ]),
});

export const localMockProjects = Object.freeze([
  {
    id: "field-notes",
    name: "Field notes API",
    lifecycle: "Local draft preview",
    summary: "Synthetic shell fixture · no persisted architecture",
  },
  {
    id: "support-portal",
    name: "Support portal",
    lifecycle: "Read-only preview",
    summary: "Synthetic shell fixture · stale status data",
  },
] as const);

export const localMockProjectIds: ReadonlySet<string> = new Set(
  localMockProjects.map((project) => project.id),
);

export function hasLocalMockCapability(
  capability: LocalMockCapability,
  identity: LocalMockIdentity = localMockIdentity,
): boolean {
  return identity.capabilities.has(capability);
}
