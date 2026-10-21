import {
  compileProviderConnectionPresentationV1,
  compileProviderCatalogV1,
} from "@cloudmarkup/provider-sdk/compiler";
import { describe, expect, it } from "vitest";

import { createAwsConnectionPresentationSourceV1 } from "./catalog/connection-presentation.js";
import { awsCatalogSourceV1 } from "./catalog/source.js";

function compileAwsPresentation() {
  const semantic = compileProviderCatalogV1(awsCatalogSourceV1);
  const source = createAwsConnectionPresentationSourceV1(semantic.artifact);
  return {
    semantic,
    source,
    presentation: compileProviderConnectionPresentationV1(
      source,
      semantic.artifact,
    ),
  };
}

describe("AWS connection presentation v1", () => {
  it("assigns every exact semantic port to one stable dock", () => {
    const { presentation, semantic } = compileAwsPresentation();
    const assignedPorts = new Map<string, string>();

    for (const service of presentation.artifact.services) {
      for (const dock of service.docks) {
        for (const portId of dock.portIds) {
          expect(assignedPorts.has(String(portId))).toBe(false);
          assignedPorts.set(String(portId), String(dock.id));
        }
      }
    }

    const semanticPorts = semantic.artifact.services.flatMap((service) =>
      service.ports.map((port) => String(port.id)),
    );
    expect([...assignedPorts.keys()].sort()).toEqual(semanticPorts.sort());
  });
});
