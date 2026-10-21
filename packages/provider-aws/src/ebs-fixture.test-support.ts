import { readFileSync } from "node:fs";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";
export function ebsFixture(customer = false, attached = true) {
  const name =
    (customer ? "customer" : "default") +
    "-" +
    (attached ? "attached" : "unattached");
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL("../fixtures/ebs-v1/" + name + ".json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseArchitectureDocument(raw);
  return parseArchitectureDocument({
    ...parsed,
    catalog: {
      id: awsCatalogArtifactV1.catalog.id,
      version: awsCatalogArtifactV1.catalog.version,
      digest: awsCatalogArtifactV1.digest,
    },
  });
}
