import { z } from "zod";
import {
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
  applicationHostRepairSeedPolicyV1Schema,
  applicationHostRepairSeedProfileV1Schema,
} from "./host-repair-seed-contracts.js";

/** Shape interchange only; runtime refinements and trusted admission are required. */
export function generateApplicationHostRepairSeedV1JsonSchema() {
  return {
    ...z.toJSONSchema(
      z.union([
        applicationHostRepairSeedBuildRequestV1Schema,
        applicationHostRepairSeedBuildResultV1Schema,
        applicationHostRepairSeedPolicyV1Schema,
        applicationHostRepairSeedProfileV1Schema,
      ]),
      { io: "input", target: "draft-2020-12" },
    ),
    $id: "https://schemas.cloudmarkup.dev/application-host-repair-seed/v1.schema.json",
    title: "Cloud Markup fixed host repair seed V1 (no execution authority)",
  };
}
