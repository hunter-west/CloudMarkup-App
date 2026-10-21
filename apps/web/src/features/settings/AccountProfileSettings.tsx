import {
  ApiClientError,
  accountProfileV1Schema,
  currentPrincipalV1Schema,
  entityTagSchema,
  updateAccountProfileV1Schema,
  type AccountProfileV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AccountPhotoSettings } from "./AccountPhotoSettings.js";
interface ProfileSnapshot {
  readonly value: AccountProfileV1;
  readonly etag: string;
}
function readProfile(
  principalId: string,
  value: unknown,
  tag: unknown,
): ProfileSnapshot {
  const profile = accountProfileV1Schema.parse(value);
  if (profile.principalId !== principalId)
    throw Error("Profile response mismatch");
  return { value: profile, etag: entityTagSchema.parse(tag) };
}
async function load(
  runtime: CloudMarkupQueryRuntime,
  principalId: string,
): Promise<ProfileSnapshot> {
  const result = await runtime.client.requestWithMetadata(
    "account.profile.get",
    {},
  );
  return readProfile(principalId, result.data.data, result.metadata.etag);
}
export function AccountProfileSettings({
  runtime,
  principal,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principal: CurrentPrincipalV1;
}) {
  const query = useQuery({
    queryKey: cloudMarkupQueryKeys.accountProfile(principal.id),
    queryFn: () => load(runtime, principal.id),
    retry: false,
  });
  return (
    <section className="feature-card" aria-labelledby="account-profile-title">
      <p className="status-label">Verified account</p>
      <h2 id="account-profile-title">
        {query.data?.value.principalId === principal.id
          ? query.data.value.displayName
          : principal.displayName}
      </h2>
      <p>Update your display name, username and account photo.</p>
      <AccountPhotoSettings
        runtime={runtime}
        key={"photo:" + principal.id}
        principalId={principal.id}
        displayName={
          query.data?.value.principalId === principal.id
            ? query.data.value.displayName
            : principal.displayName
        }
      />
      <dl className="editor-inspector-list">
        <div>
          <dt>Email</dt>
          <dd>
            {principal.email ??
              "Sign-in email not loaded. Open Security to refresh it."}
          </dd>
        </div>
      </dl>
      {query.isPending ? (
        <p role="status">Loading your profile…</p>
      ) : query.isError || query.data.value.principalId !== principal.id ? (
        <div role="alert">
          <p>Your profile is unavailable. Try loading it again.</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry profile
          </button>
        </div>
      ) : (
        <ProfileForm
          key={principal.id}
          initial={query.data}
          principal={principal}
          runtime={runtime}
        />
      )}
      <details className="settings-technical-details">
        <summary>Account details</summary>
        <dl>
          <div>
            <dt>User ID</dt>
            <dd className="account-profile-id">{principal.id}</dd>
          </div>
        </dl>
        <p>Your user ID stays the same when you update your profile.</p>
      </details>
    </section>
  );
}
function ProfileForm({
  initial,
  principal,
  runtime,
}: {
  readonly initial: ProfileSnapshot;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}) {
  const [baseline, setBaseline] = useState(initial),
    [name, setName] = useState(initial.value.displayName),
    [username, setUsername] = useState(initial.value.username ?? ""),
    [operation, setOperation] = useState<"save" | "reload" | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const busy = operation !== null;
  const alive = useRef(false),
    pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function isMounted() {
    return alive.current;
  }
  function adopt(snapshot: ProfileSnapshot) {
    runtime.queryClient.setQueryData(
      cloudMarkupQueryKeys.accountProfile(principal.id),
      snapshot,
    );
    setBaseline(snapshot);
    setName(snapshot.value.displayName);
    setUsername(snapshot.value.username ?? "");
  }
  async function save() {
    if (pending.current) return;
    const parsed = updateAccountProfileV1Schema.safeParse({
      contractVersion: 1,
      displayName: name,
      username: username.trim() === "" ? null : username,
    });
    if (!parsed.success) {
      setError(
        "Use a display name and an available username of 3–32 letters, numbers or underscores, beginning with a letter.",
      );
      return;
    }
    pending.current = true;
    setOperation("save");
    setError(null);
    setMessage(null);
    try {
      const result = await runtime.client.requestWithMetadata(
        "account.profile.update",
        { headers: { "if-match": baseline.etag }, body: parsed.data },
      );
      const written = readProfile(
        principal.id,
        result.data.data,
        result.metadata.etag,
      );
      if (
        written.value.displayName !== parsed.data.displayName ||
        written.value.username !== parsed.data.username
      )
        throw Error("Profile write mismatch");
      const confirmed = await load(runtime, principal.id);
      if (
        confirmed.value.version < written.value.version ||
        confirmed.value.displayName !== parsed.data.displayName ||
        confirmed.value.username !== parsed.data.username
      )
        throw Error("Profile readback mismatch");
      const current = currentPrincipalV1Schema.parse(
        (await runtime.client.request("principal.get", {})).data,
      );
      if (
        current.id !== principal.id ||
        current.displayName !== confirmed.value.displayName
      )
        throw Error("Current account mismatch");
      if (!isMounted()) return;
      adopt(confirmed);
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.currentPrincipal(),
        current,
      );
      setMessage("Profile saved.");
    } catch (cause) {
      if (isMounted())
        setError(
          cause instanceof ApiClientError
            ? cause.envelope.error.code === "precondition_failed"
              ? "Your profile changed in another session. Your edits are still here. Reload the saved profile before trying again."
              : ["authentication_required", "access_denied"].includes(
                    cause.envelope.error.code,
                  )
                ? "Sign in again before saving your profile."
                : cause.envelope.error.code === "conflict"
                  ? "This username is unavailable. Choose another username."
                  : "Your profile could not be saved. Your edits are still here."
            : "The profile update could not be confirmed. Your edits are still here; reload to check the saved profile.",
        );
    } finally {
      pending.current = false;
      if (isMounted()) setOperation(null);
    }
  }
  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setOperation("reload");
    setError(null);
    setMessage(null);
    try {
      const current = await load(runtime, principal.id);
      if (!isMounted()) return;
      adopt(current);
      setMessage("Saved profile loaded.");
    } catch {
      if (isMounted())
        setError(
          "Your profile could not be loaded. Your edits are still here.",
        );
    } finally {
      pending.current = false;
      if (isMounted()) setOperation(null);
    }
  }
  return (
    <form
      className="account-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="settings-field">
        <label htmlFor="profile-display-name">Display name</label>
        <input
          id="profile-display-name"
          name="displayName"
          autoComplete="name"
          maxLength={120}
          required
          disabled={busy}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="profile-username">
          Username <span className="muted">(optional)</span>
        </label>
        <input
          id="profile-username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="profile-username-help"
          maxLength={32}
          disabled={busy}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
          }}
        />
        <p id="profile-username-help">
          Use 3–32 letters, numbers or underscores, starting with a letter.
          Usernames ignore case. Changing it does not change how you sign in.
        </p>
      </div>
      <div className="account-profile-actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={busy || name.trim().length === 0}
        >
          {operation === "save" ? "Saving profile…" : "Save profile"}
        </button>
        <button
          className="button button--secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            void reload();
          }}
        >
          {operation === "reload" ? "Loading profile…" : "Reload saved profile"}
        </button>
      </div>
      <p className="muted">
        Reloading replaces your unsaved edits with the saved profile.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
