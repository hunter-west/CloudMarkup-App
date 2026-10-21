import { readFileSync } from "node:fs";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import { awsCatalogArtifactV1 } from "./catalog-v1-accessors.js";
export function elbFixture(ecs = false, publicScheme = false) {
  const name =
    (ecs ? "fargate" : "ec2") + "-" + (publicScheme ? "public" : "internal");
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL("../fixtures/elb-v1/" + name + ".json", import.meta.url),
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
