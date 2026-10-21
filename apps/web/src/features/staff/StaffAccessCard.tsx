import type { CurrentPrincipalV1 } from "@cloudmarkup/api-contract";
import type { CloudMarkupQueryRuntime } from "../../api/index.js";
import { AppLink } from "../../routing/index.js";
import { useStaffAccess } from "./use-staff-access.js";
export function StaffAccessCard({
  runtime,
  principal,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
}) {
  const access = useStaffAccess(runtime, principal.id);
  if (!access.data?.permissions.includes("accounts.read")) return null;
  return (
    <section className="feature-card">
      <p className="status-label">Platform administration</p>
      <h2>Account support</h2>
      <p>
        Manage complimentary credits, review staff actions, and control
        expensive operations for an account.
      </p>
      <AppLink className="button button--secondary" to="/staff/accounts">
        Open administration
      </AppLink>
    </section>
  );
}
