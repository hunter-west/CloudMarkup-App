import type { OrganizationV1 } from "@cloudmarkup/api-contract";
import type { StatusTone } from "@cloudmarkup/ui";

export function organizationStatus(status: OrganizationV1["lifecycleStatus"]): {
  readonly label: string;
  readonly tone: StatusTone;
} {
  switch (status) {
    case "active":
      return { label: "Active", tone: "success" };
    case "suspended":
      return { label: "Suspended", tone: "warning" };
    case "deletion-pending":
      return { label: "Deletion pending", tone: "warning" };
    case "deleted":
      return { label: "Deleted", tone: "error" };
  }
}
