import type {
  AccountAccessV1,
  CloudMarkupClient,
} from "@cloudmarkup/api-contract";
import { signInReturnPathFromSearch } from "./sign-in-return-path.js";
import { Disclosure } from "@cloudmarkup/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { AppLink, useAppLocation, useNavigate } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import {
  browserCognitoAuthSession,
  CognitoBrowserAuthError,
  type AccountAuthenticationIntent,
  parseCognitoCallback,
  relayCognitoCallback,
  startCognitoSignInWithPopup,
  type CognitoBrowserAuthSession,
  type ParsedCognitoCallback,
} from "./cognito-browser-auth.js";
import { mayRenderLocalMockIdentity } from "./mock-identity-boundary.js";

const projectsPath = "/organizations/local-org/projects";

interface SignInPageProps {
  readonly development?: boolean;
  readonly startSignIn?: (signal: AbortSignal) => Promise<void>;
  readonly startAccountFlow?: (
    intent: AccountAuthenticationIntent,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly loadAccountAccess?: () => Promise<AccountAccessV1>;
}

function startProductionCognitoSignIn(signal: AbortSignal): Promise<void> {
  return startCognitoSignInWithPopup(browserCognitoAuthSession, {
    signal,
    intent: "sign-in",
  });
}

function startAccountFlowDefault(
  intent: AccountAuthenticationIntent,
  signal: AbortSignal,
) {
  return startCognitoSignInWithPopup(browserCognitoAuthSession, {
    intent,
    signal,
  });
}
async function loadAccountAccessDefault() {
  return browserCognitoAuthSession.readAccountAccess();
}

async function resolveAuthenticatedLanding(
  client: CloudMarkupClient | undefined,
): Promise<string> {
  if (client === undefined) return "/settings/profile";
  try {
    const principal = await client.request("principal.get", {});
    if (principal.data.organizationContexts.length > 1) {
      return "/organizations";
    }
    const organizationId =
      principal.data.organizationContexts[0]?.organizationId;
    return organizationId === undefined
      ? "/settings/profile"
      : `/organizations/${encodeURIComponent(organizationId)}/dashboard`;
  } catch {
    // Authentication has completed. Let the authenticated boundary present a
    // retryable API error instead of misreporting this as an identity failure.
    return "/settings/profile";
  }
}

/** Restore only the existing verified session; public navigation never provisions an account. */
function readExistingSession() {
  return browserCognitoAuthSession.getValidAccessToken();
}

const ExplicitAuthenticationContext = createContext<(() => void) | null>(null);

export function PublicEntrySessionBoundary({
  children,
  readSession = readExistingSession,
  development = import.meta.env.DEV,
}: {
  readonly children: ReactNode;
  readonly readSession?: () => Promise<string | undefined>;
  readonly development?: boolean;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const location = useAppLocation();
  const navigate = useNavigate();
  const locationKey = location.pathname + location.search;
  const entry = useRef({ locationKey, explicitAuthentication: false });
  const automaticRedirect = useRef<AbortController | undefined>(undefined);
  const beginExplicitAuthentication = useCallback(() => {
    // This attempt owns navigation for this visit, including late session reads.
    entry.current = { locationKey, explicitAuthentication: true };
    automaticRedirect.current?.abort();
  }, [locationKey]);
  useEffect(() => {
    if (entry.current.locationKey !== locationKey) {
      entry.current = { locationKey, explicitAuthentication: false };
    }
    if (
      development ||
      runtime === null ||
      entry.current.explicitAuthentication ||
      !["/", "/login", "/sign-in", "/signup", "/sign-up"].includes(
        location.pathname,
      )
    )
      return;
    const controller = new AbortController();
    automaticRedirect.current = controller;
    const isCancelled = () => controller.signal.aborted;
    void readSession()
      .then(async (token) => {
        if (isCancelled() || token === undefined) return;
        const destination =
          signInReturnPathFromSearch(location.search) ??
          (await resolveAuthenticatedLanding(runtime.client));
        if (isCancelled()) return;
        runtime.resumeSession();
        navigate(destination, { replace: true });
      })
      .catch(() => {
        // An unavailable or expired session leaves the explicit sign-in action available.
      });
    return () => {
      controller.abort();
      if (automaticRedirect.current === controller) {
        automaticRedirect.current = undefined;
      }
    };
  }, [
    development,
    location.pathname,
    location.search,
    locationKey,
    navigate,
    readSession,
    runtime,
  ]);
  return (
    <ExplicitAuthenticationContext.Provider value={beginExplicitAuthentication}>
      {children}
    </ExplicitAuthenticationContext.Provider>
  );
}

export function SignInPage(props: SignInPageProps = {}) {
  const location = useAppLocation();
  return <SignInEntry key={location.pathname + location.search} {...props} />;
}

function SignInEntry({
  development = import.meta.env.DEV,
  startSignIn = startProductionCognitoSignIn,
  startAccountFlow = startAccountFlowDefault,
  loadAccountAccess = loadAccountAccessDefault,
}: SignInPageProps = {}) {
  const navigate = useNavigate();
  const location = useAppLocation();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const beginExplicitAuthentication = useContext(ExplicitAuthenticationContext);
  const mode: AccountAuthenticationIntent = ["/sign-up", "/signup"].includes(
    location.pathname,
  )
    ? "sign-up"
    : location.pathname === "/forgot-password"
      ? "recover"
      : "sign-in";
  const [access, setAccess] = useState<AccountAccessV1 | null>(null);
  const [accessUnavailable, setAccessUnavailable] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [registrationClosed, setRegistrationClosed] = useState(false);
  const activeSignIn = useRef<AbortController | undefined>(undefined);
  const restoreSignInFocus = useRef(false);
  const signInButton = useRef<HTMLButtonElement | null>(null);
  const [signInError, setSignInError] = useState<unknown>(null);
  const [signInPending, setSignInPending] = useState(false);
  const signupClosed =
    registrationClosed || access?.registrationEnabled === false;
  const signupAvailable = access?.registrationEnabled === true && !signupClosed;
  const returnPath = signInReturnPathFromSearch(location.search);
  const returnSearch =
    returnPath === undefined
      ? ""
      : "?" + new URLSearchParams({ returnTo: returnPath }).toString();
  const authErrorMessage =
    signInError instanceof CognitoBrowserAuthError &&
    signInError.code === "authorization-popup-blocked"
      ? "Allow popups for this site, then try again. Your secure sign-in window could not open."
      : signInError instanceof CognitoBrowserAuthError &&
          signInError.code === "authorization-expired"
        ? "This attempt expired. Start a new secure attempt to continue."
        : "Return to this page and start a new secure attempt. If you reset your password, sign in with the new password to continue.";

  useEffect(() => {
    if (mayRenderLocalMockIdentity(development)) return;
    let active = true;
    void loadAccountAccess().then(
      (value) => {
        if (active) setAccess(value);
      },
      () => {
        if (active) setAccessUnavailable(true);
      },
    );
    return () => {
      active = false;
    };
  }, [development, loadAccountAccess, mode, accessAttempt]);
  useEffect(
    () => () => {
      const controller = activeSignIn.current;
      activeSignIn.current = undefined;
      controller?.abort();
    },
    [mode, location.search],
  );

  useEffect(() => {
    if (!signInPending && restoreSignInFocus.current) {
      restoreSignInFocus.current = false;
      signInButton.current?.focus();
    }
  }, [signInPending]);

  if (!mayRenderLocalMockIdentity(development)) {
    return (
      <RoutePage
        title={
          mode === "sign-up"
            ? "CloudMarkup account registration"
            : mode === "recover"
              ? "Recover your account"
              : "Sign in to CloudMarkup"
        }
        routeKey={"account-" + mode}
      >
        <section
          className="auth-entry"
          aria-label={
            mode === "sign-in"
              ? "CloudMarkup sign in"
              : "CloudMarkup account access"
          }
        >
          <div className="auth-entry__overview">
            <p className="status-label">Your cloud architecture workspace</p>
            <h2>Build cloud systems with confidence.</h2>
            <p>
              Choose cloud services, connect the pieces, and work through the
              details with guidance at every step.
            </p>
            <ul
              className="auth-entry__benefits"
              aria-label="Workspace capabilities"
            >
              <li>Design services and connections on a visual canvas.</li>
              <li>Understand configuration choices and potential issues.</li>
              <li>Keep architecture and application context together.</li>
            </ul>
          </div>

          <div className="auth-entry__panel">
            <div className="auth-entry__panel-heading">
              <div>
                <p className="status-label">Personal account</p>
                <h2>
                  {mode === "sign-up"
                    ? signupClosed
                      ? "Registration is currently closed"
                      : signupAvailable
                        ? "Start with your own workspace"
                        : "Check registration availability"
                    : mode === "recover"
                      ? "Reset your password securely"
                      : "Continue to your workspace"}
                </h2>
              </div>
            </div>
            <p>
              {mode === "sign-up"
                ? signupClosed
                  ? "Sign in to your existing account or reset your password to return to your workspace."
                  : signupAvailable
                    ? "Create an independent account and verify your email. You can create or join an organization when you choose."
                    : "New accounts are available when registration is open. Existing users can sign in or reset a password at any time."
                : mode === "recover"
                  ? "Use your sign-in email to request a verification code and choose a new password in the secure window. Then sign in to return here."
                  : "Sign in to your personal account. Your private workspace and organizations are available after sign-in."}
            </p>
            {mode !== "sign-up" || signupAvailable ? (
              <div className="auth-entry__flow-note">
                <LockKeyhole size={15} aria-hidden="true" />
                <span>
                  {mode === "sign-up"
                    ? "Enter your email and complete both password fields in the secure account window. Then verify your email to continue."
                    : mode === "recover"
                      ? "Request a code, verify your email, and choose a new password in the secure window."
                      : "Continue to the secure sign-in form to enter your email and password."}
                </span>
              </div>
            ) : null}
            <button
              className="button button--primary auth-entry__primary-action"
              disabled={
                signInPending || (mode === "sign-up" && !signupAvailable)
              }
              ref={signInButton}
              type="button"
              onClick={() => {
                beginExplicitAuthentication?.();
                const controller = new AbortController();
                activeSignIn.current = controller;
                setSignInError(null);
                setSignInPending(true);
                void (
                  mode === "sign-in"
                    ? startSignIn(controller.signal)
                    : startAccountFlow(mode, controller.signal)
                ).then(
                  async () => {
                    if (activeSignIn.current !== controller) return;
                    runtime?.resumeSession();
                    const destination =
                      signInReturnPathFromSearch(location.search) ??
                      (await resolveAuthenticatedLanding(runtime?.client));
                    if (
                      activeSignIn.current !== controller ||
                      controller.signal.aborted
                    )
                      return;
                    activeSignIn.current = undefined;
                    setSignInPending(false);
                    navigate(destination, { replace: true });
                  },
                  (error: unknown) => {
                    if (activeSignIn.current !== controller) return;
                    setRegistrationClosed(
                      error instanceof CognitoBrowserAuthError &&
                        error.code === "registration-closed",
                    );
                    activeSignIn.current = undefined;
                    setSignInError(error);
                    setSignInPending(false);
                  },
                );
              }}
            >
              {signInPending
                ? mode === "sign-up"
                  ? "Waiting for account verification…"
                  : mode === "recover"
                    ? "Waiting for password reset…"
                    : "Waiting for sign-in..."
                : mode === "sign-up"
                  ? signupClosed
                    ? "Registration closed"
                    : "Create account securely"
                  : mode === "recover"
                    ? "Reset password securely"
                    : "Sign in securely"}
              {!signInPending ? (
                <ArrowRight aria-hidden="true" size={17} />
              ) : null}
            </button>
            {mode === "sign-up" && !signInPending ? (
              <p role="status">
                {signupClosed
                  ? "New account registration is temporarily closed. Existing users can still sign in or reset a password."
                  : accessUnavailable
                    ? "Registration availability could not be checked. Try again below, or sign in to an existing account."
                    : access === null
                      ? "Checking registration availability…"
                      : "Your account starts with a private workspace. An invitation is only needed to join a shared organization."}
              </p>
            ) : null}
            {mode === "sign-up" && accessUnavailable ? (
              <button
                className="button button--quiet auth-entry__retry"
                type="button"
                onClick={() => {
                  setAccessUnavailable(false);
                  setAccessAttempt((value) => value + 1);
                }}
              >
                Check availability again
              </button>
            ) : null}
            {!signInPending ? (
              <nav className="auth-entry__links" aria-label="Account access">
                {mode !== "sign-in" ? (
                  <AppLink to={"/login" + returnSearch}>
                    Already have an account? Sign in
                  </AppLink>
                ) : null}
                {mode !== "sign-up" ? (
                  <AppLink to={"/signup" + returnSearch}>
                    Create an account
                  </AppLink>
                ) : null}
                {mode !== "recover" ? (
                  <AppLink to={"/forgot-password" + returnSearch}>
                    Forgot your password?
                  </AppLink>
                ) : null}
                <a href="https://support.cloudmarkup.com/">Help center</a>
              </nav>
            ) : null}
            {signInPending ? (
              <div className="auth-entry__pending" role="status">
                <p>
                  {mode === "sign-up"
                    ? "Create your account and verify your email in the secure window. Keep this tab open until you return."
                    : mode === "recover"
                      ? "Complete password recovery in the secure window, then sign in with your new password to continue."
                      : "Complete sign-in in the secure window, or cancel this attempt and start again."}
                </p>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => {
                    const controller = activeSignIn.current;
                    activeSignIn.current = undefined;
                    controller?.abort();
                    restoreSignInFocus.current = true;
                    setSignInError(null);
                    setSignInPending(false);
                  }}
                >
                  {mode === "sign-up"
                    ? "Cancel registration"
                    : mode === "recover"
                      ? "Cancel password reset"
                      : "Cancel sign-in"}
                </button>
              </div>
            ) : null}
            {signInError !== null ? (
              <div className="auth-entry__error" role="alert">
                <strong>
                  {mode === "sign-up"
                    ? "Account creation was not completed."
                    : mode === "recover"
                      ? "Password recovery was not completed."
                      : "Sign-in was not completed."}
                </strong>
                <p>{authErrorMessage}</p>
              </div>
            ) : null}
            <Disclosure
              className="auth-entry__security"
              summary="Security details"
            >
              <p>
                Your password and verification codes are entered in our secure
                sign-in window. CloudMarkup does not save them in browser
                storage. Keep this tab open; unfinished attempts expire after 10
                minutes. If a window does not open, allow popups for this site
                and try again.
              </p>
            </Disclosure>
          </div>
        </section>
      </RoutePage>
    );
  }

  return (
    <RoutePage
      title="Sign in"
      eyebrow="Authentication placeholder"
      description="Authentication is not connected in this shell build."
      routeKey="sign-in"
    >
      <section className="feature-card feature-card--emphasis">
        <p className="status-label">Local preview only</p>
        <h2>Continue with the clearly labeled mock identity</h2>
        <p>
          This action opens the authenticated shell with synthetic local data.
          It does not exchange credentials, verify membership, or create a
          session.
        </p>
        <AppLink className="button button--primary" to={projectsPath}>
          Continue to local shell
        </AppLink>
      </section>
      <p className="fine-print">
        Sign-in returns to your previous page after authentication. Access to
        each organization and project is checked again.
      </p>
    </RoutePage>
  );
}

interface AuthCallbackPageProps {
  readonly authSession?: CognitoBrowserAuthSession;
  readonly development?: boolean;
  readonly relayCallback?: (callback: ParsedCognitoCallback) => Promise<void>;
  readonly search: string;
}

export function AuthCallbackPage({
  authSession = browserCognitoAuthSession,
  development = import.meta.env.DEV,
  relayCallback = relayCognitoCallback,
  search,
}: AuthCallbackPageProps) {
  const navigate = useNavigate();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const client = runtime?.client;
  const resumeSession = runtime?.resumeSession;
  const [productionStatus, setProductionStatus] = useState<
    "complete" | "error" | "loading"
  >("loading");
  const hasError = new URLSearchParams(search).has("error");

  useEffect(() => {
    if (development) return undefined;
    const controller = new AbortController();
    const isCancelled = () => controller.signal.aborted;
    const complete = async () => {
      try {
        const callback = parseCognitoCallback(search);
        if (authSession.hasPendingAuthorization(callback.state)) {
          await authSession.completeCallback(callback);
          if (isCancelled()) return;
          resumeSession?.();
          const destination = await resolveAuthenticatedLanding(client);
          if (isCancelled()) return;
          navigate(destination, {
            replace: true,
          });
          return;
        }
        await relayCallback(callback);
        if (isCancelled()) return;
        setProductionStatus("complete");
        window.close();
      } catch {
        if (!isCancelled()) setProductionStatus("error");
      }
    };
    void complete();
    return () => {
      controller.abort();
    };
  }, [
    authSession,
    client,
    development,
    navigate,
    relayCallback,
    resumeSession,
    search,
  ]);

  if (!development) {
    const failed = productionStatus === "error";
    return (
      <RoutePage
        title={failed ? "Sign-in could not be completed" : "Completing sign-in"}
        eyebrow="Secure authentication callback"
        description={
          failed
            ? "The callback was rejected without changing the browser session."
            : "CloudMarkup is validating the one-time callback and exchanging it from the original browser tab."
        }
        routeKey={`auth-callback-${productionStatus}`}
      >
        {failed ? (
          <section className="state-card state-card--error" role="alert">
            <p className="status-label">Sign-in failed</p>
            <h2>Start a new sign-in attempt</h2>
            <p>
              The callback was malformed, expired, replayed, or did not match
              the in-memory PKCE transaction. No callback values were retained.
            </p>
            <AppLink className="button button--secondary" to="/sign-in">
              Return to sign in
            </AppLink>
          </section>
        ) : (
          <section className="state-card" role="status" aria-live="polite">
            <p className="status-label">
              {productionStatus === "complete" ? "Complete" : "Loading"}
            </p>
            <h2>
              {productionStatus === "complete"
                ? "Sign-in completed in the original tab"
                : "Verifying the Cognito response"}
            </h2>
            <p>
              {productionStatus === "complete"
                ? "You may close this window."
                : "This window does not store the authorization code or token."}
            </p>
          </section>
        )}
      </RoutePage>
    );
  }

  return (
    <RoutePage
      title={hasError ? "Sign-in could not be completed" : "Completing sign-in"}
      eyebrow="Development authentication callback"
      description={
        hasError
          ? "The development shell did not complete an authentication exchange."
          : "Development mode does not contact an identity provider."
      }
      routeKey={`auth-callback-${hasError ? "error" : "loading"}`}
    >
      {hasError ? (
        <section className="state-card state-card--error" role="alert">
          <p className="status-label">Route error</p>
          <h2>Nothing was changed</h2>
          <p>
            Return to sign in or use the development shell. No callback details
            are displayed or retained.
          </p>
          <AppLink className="button button--secondary" to="/sign-in">
            Return to sign in
          </AppLink>
        </section>
      ) : (
        <section className="state-card" role="status" aria-live="polite">
          <p className="status-label">Loading</p>
          <h2>Waiting for a configured identity provider</h2>
          <p>This development-only state reports no successful session.</p>
        </section>
      )}
    </RoutePage>
  );
}

export { OrganizationInvitationPage as InvitationPage } from "../organizations/OrganizationInvitationPage.js";
