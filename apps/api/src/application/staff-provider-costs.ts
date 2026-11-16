import type {
  StaffProviderCostQueryV1,
  StaffProviderCostReportV1,
} from "@cloudmarkup/api-contract";
import type { PrincipalContext } from "./ports.js";

/** Target selection is untrusted; the implementation must resolve an explicit
 * current staff organization grant before invoking an accounting reader. */
export interface StaffProviderCostsApplication {
  read(
    principal: PrincipalContext,
    organizationId: string,
    input: StaffProviderCostQueryV1,
  ): Promise<StaffProviderCostReportV1>;
}
