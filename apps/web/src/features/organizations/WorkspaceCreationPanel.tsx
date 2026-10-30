import {
  ApiClientError,
  accountWorkspaceV1Schema,
  currentPrincipalV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
export function WorkspaceCreationPanel({
  runtime,
  principal,
  hasPersonal,
  disabled,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
  readonly hasPersonal: boolean;
  readonly disabled: boolean;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const alive = useRef(false),
    pending = useRef(false),
    attempt = useRef<{ name: string; key: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function isMounted() {
    return alive.current;
  }
  async function create(kind: "personal" | "organization") {
    if (disabled || pending.current) return;
    const displayName = name.trim();
    if (kind === "organization" && !displayName) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    setError(null);
    if (kind === "organization" && attempt.current?.name !== displayName)
      attempt.current = {
        name: displayName,
        key: "workspace-" + crypto.randomUUID(),
      };
    try {
      const result =
        kind === "personal"
          ? await runtime.client.request("account.personal-workspace.create", {
              body: { contractVersion: 1 },
            })
          : await runtime.client.request("account.organizations.create", {
              headers: { "idempotency-key": attempt.current?.key ?? "" },
              body: { contractVersion: 1, displayName },
            });
      const value = accountWorkspaceV1Schema.parse(result.data);
      if (value.principalId !== principal.id || value.kind !== kind)
        throw Error("Workspace response mismatch");
      const current = currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      );
      if (
        current.id !== principal.id ||
        !current.organizationContexts.some((c) => c.organizationId === value.id)
      )
        throw Error("Workspace readback mismatch");
      if (!isMounted()) return;
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        current,
      );
      await runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.organizations(principal.id),
      });
      if (!isMounted()) return;
      attempt.current = null;
      if (kind === "organization") setName("");
      setMessage(
        kind === "personal"
          ? "Your personal workspace is ready."
          : "Your organization is ready. Open its settings to manage members.",
      );
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof ApiClientError &&
            ["authentication_required", "access_denied"].includes(
              cause.envelope.error.code,
            )
            ? "Sign in again before creating a personal workspace or organization."
            : cause instanceof ApiClientError &&
                cause.envelope.error.code === "conflict"
              ? cause.envelope.error.message
              : "Creation could not be confirmed. Retry the same request.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="organization-card workspace-creation"
      aria-labelledby="workspace-create-title"
    >
      <h2 id="workspace-create-title">Create an organization</h2>
      <p>
        Collaborate in an organization. Your personal projects, subscriptions
        and credits stay in your personal account.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create("organization");
        }}
      >
        <label htmlFor="organization-name">Organization name</label>
        <input
          id="organization-name"
          name="organizationName"
          value={name}
          maxLength={120}
          required
          disabled={disabled || busy}
          onChange={(event) => {
            setName(event.target.value);
          }}
          autoComplete="organization"
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={disabled || busy || name.trim().length === 0}
        >
          {busy ? "Creating…" : "Create organization"}
        </button>
      </form>
      {!hasPersonal && (
        <div>
          <p>
            Use a personal workspace for projects only you can access. You do
            not need to create or join an organization.
          </p>
          <button
            className="button button--secondary"
            type="button"
            disabled={disabled || busy}
            onClick={() => void create("personal")}
          >
            Create personal workspace
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
