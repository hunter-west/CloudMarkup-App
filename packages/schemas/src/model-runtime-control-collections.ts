import type { z } from "zod";

interface ModelRuntimeControlCollections {
  readonly administrativeSuspensions: readonly {
    readonly scope: string;
    readonly scopeId: string;
  }[];
  readonly allowlists: Readonly<
    Record<
      | "dependencies"
      | "modelConfigurationReferences"
      | "modules"
      | "providers"
      | "roles"
      | "routes",
      readonly string[]
    >
  >;
  readonly featureEntitlements: readonly {
    readonly plan: string;
    readonly features: readonly string[];
  }[];
  readonly killSwitches: {
    readonly global: {
      readonly engaged: boolean;
      readonly reasonCode?: string | undefined;
    };
    readonly capabilitySwitches: readonly {
      readonly operation: string;
      readonly engaged: boolean;
      readonly reasonCode?: string | undefined;
    }[];
  };
}
const duplicateValues = (values: readonly string[]) =>
  values.filter((value, index) => values.indexOf(value) !== index);

/** Shared collection checks only. Report/evaluation and content-digest checks
 * remain specific to each versioned policy; no current authority is issued. */
export function refineModelRuntimeControlCollections(
  value: ModelRuntimeControlCollections,
  context: z.RefinementCtx,
): void {
  for (const [path, values] of [
    ["allowlists.dependencies", value.allowlists.dependencies],
    [
      "allowlists.modelConfigurationReferences",
      value.allowlists.modelConfigurationReferences,
    ],
    ["allowlists.modules", value.allowlists.modules],
    ["allowlists.providers", value.allowlists.providers],
    ["allowlists.roles", value.allowlists.roles],
    ["allowlists.routes", value.allowlists.routes],
  ] as const) {
    if (duplicateValues(values).length > 0) {
      context.addIssue({
        code: "custom",
        message: `${path} must not contain duplicates.`,
        path: path.split("."),
      });
    }
  }
  const plans = value.featureEntitlements.map((entry) => entry.plan);
  if (duplicateValues(plans).length > 0) {
    context.addIssue({
      code: "custom",
      message: "A plan can have only one feature-entitlement record.",
      path: ["featureEntitlements"],
    });
  }
  for (const [index, entry] of value.featureEntitlements.entries()) {
    if (duplicateValues(entry.features).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Plan features must be unique.",
        path: ["featureEntitlements", index, "features"],
      });
    }
  }
  const suspensionScopes = value.administrativeSuspensions.map(
    (entry) => `${entry.scope}\u0000${entry.scopeId}`,
  );
  if (duplicateValues(suspensionScopes).length > 0) {
    context.addIssue({
      code: "custom",
      message: "An administrative scope can be suspended only once.",
      path: ["administrativeSuspensions"],
    });
  }
  const capabilityOperations = value.killSwitches.capabilitySwitches.map(
    (entry) => entry.operation,
  );
  if (duplicateValues(capabilityOperations).length > 0) {
    context.addIssue({
      code: "custom",
      message: "A capability can have only one kill-switch record.",
      path: ["killSwitches", "capabilitySwitches"],
    });
  }
  for (const [
    index,
    entry,
  ] of value.killSwitches.capabilitySwitches.entries()) {
    if (entry.engaged !== (entry.reasonCode !== undefined)) {
      context.addIssue({
        code: "custom",
        message:
          "An engaged capability kill switch requires exactly one safe reason code.",
        path: ["killSwitches", "capabilitySwitches", index],
      });
    }
  }
  if (
    value.killSwitches.global.engaged !==
    (value.killSwitches.global.reasonCode !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "An engaged global kill switch requires exactly one safe reason code.",
      path: ["killSwitches", "global"],
    });
  }
}
