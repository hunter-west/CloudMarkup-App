import {
  Bell,
  BookOpen,
  Cable,
  Building2,
  CreditCard,
  Gauge,
  LogOut,
  Mail,
  MessageCircle,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { Button, StatusBadge } from "@cloudmarkup/ui";
import { useOptionalCloudMarkupQueryRuntime } from "../api/index.js";
import { useOptionalCognitoSignOut } from "../features/auth/cognito-sign-out-context.js";
import { useOptionalLocalOwnerSession } from "../features/auth/local-owner-session.js";
import { AccountAvatar } from "../features/settings/AccountAvatar.js";
import { useStaffAccess } from "../features/staff/use-staff-access.js";
import { useNotifications } from "../notifications/index.js";
import { ThemeSwitch } from "../preferences/ThemeSwitch.js";
import { AppLink, useRouteMatch } from "../routing/index.js";
import type { AppShellIdentity } from "./AppShell.js";
import type { CloudMarkupQueryRuntime } from "../api/index.js";
import type { ReactNode } from "react";

function MenuGroup({
  label,
  icon,
  children,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="account-menu-group" aria-label={label}>
      <h3>
        {icon}
        <span>{label}</span>
      </h3>
      <div className="account-menu-group__contents">{children}</div>
    </section>
  );
}

function AuthorizedStaffLink({
  runtime,
  principalId,
  onClose,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly onClose: () => void;
}) {
  const access = useStaffAccess(runtime, principalId);
  return !runtime.sessionExpired &&
    access.isSuccess &&
    access.data.permissions.includes("accounts.read") ? (
    <AppLink
      className="account-menu-link"
      onClick={onClose}
      to="/staff/accounts"
    >
      <ShieldCheck size={18} aria-hidden="true" />
      Account support
    </AppLink>
  ) : null;
}

export function AccountMenu({
  identity,
  organizationId,
  onClose,
  onOpenNotifications,
  onResetWorkspaceLayout,
  hasWorkspace,
}: {
  readonly identity: AppShellIdentity;
  readonly organizationId: string | null;
  readonly onClose: () => void;
  readonly onOpenNotifications: () => void;
  readonly onResetWorkspaceLayout: () => void;
  readonly hasWorkspace: boolean;
}) {
  const cognitoSignOut = useOptionalCognitoSignOut();
  const localOwner = useOptionalLocalOwnerSession();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const { addNotification, unreadCount } = useNotifications();
  const route = useRouteMatch();
  const organizationPath =
    organizationId === null
      ? null
      : `/organizations/${encodeURIComponent(organizationId)}`;
  const link = (path: string, label: string, icon: ReactNode) => (
    <AppLink
      className="account-menu-link"
      aria-current={route.pathname === path ? "page" : undefined}
      onClick={onClose}
      to={path}
    >
      {icon}
      <span>{label}</span>
    </AppLink>
  );
  return (
    <div className="account-menu">
      <div className="account-summary">
        <AccountAvatar
          displayName={identity.displayName}
          principalId={
            identity.kind === "verified" ? identity.actorId : undefined
          }
          large
        />
        <div>
          <strong>{identity.displayName}</strong>
          <p>
            {identity.organization?.kind === "personal"
              ? "Personal workspace"
              : (identity.organization?.name ?? "Personal account")}
          </p>
          {identity.kind === "local-mock" ? (
            <StatusBadge label="Local mock - not verified" tone="incomplete" />
          ) : null}
        </div>
      </div>
      <nav aria-label="Account settings">
        <div className="account-menu__quick-links">
          <button
            className="account-menu-link"
            aria-label={
              unreadCount === 0
                ? "Notifications"
                : `Notifications (${String(unreadCount)} unread)`
            }
            type="button"
            onClick={onOpenNotifications}
          >
            <Bell size={18} aria-hidden="true" />
            <span>Notifications</span>
            {unreadCount > 0 ? (
              <span className="account-notifications__count">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
          {link(
            "/organizations",
            "Personal & organizations",
            <Building2 size={18} aria-hidden="true" />,
          )}
        </div>
        <MenuGroup
          label="Personal account"
          icon={<UserRound size={18} aria-hidden="true" />}
        >
          {link(
            "/settings/profile",
            "Profile",
            <UserRound size={18} aria-hidden="true" />,
          )}
          {link(
            "/settings/security",
            "Personal security",
            <ShieldCheck size={18} aria-hidden="true" />,
          )}
          {link(
            "/settings/preferences",
            "Preferences",
            <SlidersHorizontal size={18} aria-hidden="true" />,
          )}
          {link(
            "/settings/integrations",
            "Personal integrations",
            <Cable size={18} aria-hidden="true" />,
          )}
          {link(
            "/settings/invitations",
            "Invitations",
            <Mail size={18} aria-hidden="true" />,
          )}
        </MenuGroup>
        {organizationPath === null ? null : (
          <MenuGroup
            label={
              identity.organization?.kind === "personal"
                ? "Personal workspace"
                : identity.organization === null
                  ? "Selected workspace"
                  : "Organization"
            }
            icon={<Building2 size={18} aria-hidden="true" />}
          >
            <p className="account-menu-group__context">
              {identity.organization?.name ??
                "Usage and billing for your selected personal workspace or organization."}
            </p>
            {localOwner === null
              ? link(
                  `${organizationPath}/usage`,
                  "Usage",
                  <Gauge size={18} aria-hidden="true" />,
                )
              : null}
            {localOwner === null
              ? link(
                  `${organizationPath}/billing`,
                  "Plans & billing",
                  <CreditCard size={18} aria-hidden="true" />,
                )
              : null}
            {identity.organization?.kind !== "organization" &&
            identity.kind !== "local-mock"
              ? null
              : link(
                  `${organizationPath}/settings/general`,
                  "Organization settings",
                  <Settings2 size={18} aria-hidden="true" />,
                )}
          </MenuGroup>
        )}
        <MenuGroup
          label="Help & support"
          icon={<BookOpen size={18} aria-hidden="true" />}
        >
          <a
            className="account-menu-link"
            aria-label="Help center (opens in a new tab)"
            href="https://support.cloudmarkup.com/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            <BookOpen size={18} aria-hidden="true" />
            <span>Help center</span>
          </a>
          <a
            className="account-menu-link"
            aria-label="Contact support (opens in a new tab)"
            href="https://support.cloudmarkup.com/new-ticket/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            <MessageCircle size={18} aria-hidden="true" />
            <span>Contact support</span>
          </a>
          {identity.kind === "verified" &&
          runtime !== null &&
          localOwner === null ? (
            <AuthorizedStaffLink
              key={identity.actorId}
              runtime={runtime}
              principalId={identity.actorId}
              onClose={onClose}
            />
          ) : null}
          <p className="account-menu-group__context">
            Guides are public. Support requests use a separate support account.
            You can also email{" "}
            <a href="mailto:support@cloudmarkup.com">support@cloudmarkup.com</a>
            .
          </p>
        </MenuGroup>
        <div className="account-menu-appearance">
          <ThemeSwitch settings />
          {hasWorkspace ? (
            <Button onClick={onResetWorkspaceLayout} variant="quiet">
              Reset workspace layout
            </Button>
          ) : null}
        </div>
        <div className="account-menu__sign-out">
          {identity.kind === "verified" && cognitoSignOut !== null ? (
            <details className="account-recovery-action">
              <summary>Shared device options</summary>
              <p>
                Use this on a shared device to clear drafts and browser
                preferences. Confirmation is required.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  void cognitoSignOut
                    .signOutAndClearLocalRecovery()
                    .then((confirmed) => {
                      if (!confirmed)
                        addNotification({
                          kind: "info",
                          message:
                            "Local drafts and browser preferences were kept.",
                          title: "Local recovery clearing cancelled",
                          toast: true,
                        });
                    })
                    .catch(() => {
                      addNotification({
                        kind: "error",
                        message:
                          "Close other CloudMarkup tabs, then try the confirmed recovery-clearing action again.",
                        title: "Local recovery was not cleared",
                        toast: true,
                      });
                    });
                }}
              >
                Sign out and clear local recovery
              </Button>
            </details>
          ) : null}
          {identity.kind === "verified" && localOwner !== null ? (
            <button
              className="account-menu-link"
              type="button"
              onClick={() => {
                onClose();
                void localOwner.signOut().catch(() => {
                  addNotification({
                    kind: "error",
                    message:
                      "The local session could not be revoked. Try again.",
                    title: "Sign out could not be completed",
                    toast: true,
                  });
                });
              }}
            >
              <LogOut size={18} aria-hidden="true" />
              Sign out
            </button>
          ) : identity.kind === "verified" && cognitoSignOut !== null ? (
            <button
              className="account-menu-link"
              type="button"
              onClick={() => {
                onClose();
                void cognitoSignOut.signOut().catch(() => {
                  addNotification({
                    kind: "error",
                    message:
                      "The browser session was not redirected to Cognito logout.",
                    title: "Sign out could not be completed",
                    toast: true,
                  });
                });
              }}
            >
              <LogOut size={18} aria-hidden="true" />
              Sign out
            </button>
          ) : (
            link(
              "/sign-in",
              "Return to sign-in placeholder",
              <LogOut size={18} aria-hidden="true" />,
            )
          )}
        </div>
      </nav>
    </div>
  );
}
