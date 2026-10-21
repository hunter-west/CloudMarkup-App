import { ApiClientError } from "@cloudmarkup/api-contract";
import { useEffect, useId, useRef, useState } from "react";
import {
  cloudMarkupQueryKeys,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AccountAvatar } from "./AccountAvatar.js";
import { prepareAccountPhoto } from "./account-photo.js";
import {
  loadAccountPhoto,
  readAccountPhoto,
  useAccountPhoto,
} from "./use-account-photo.js";

export function AccountPhotoSettings({
  runtime,
  principalId,
  displayName,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly displayName: string;
}) {
  const query = useAccountPhoto(runtime, principalId);
  const [preview, setPreview] = useState<string | null>(null);
  const [operation, setOperation] = useState<
    "prepare" | "save" | "remove" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const generation = useRef(0),
    alive = useRef(false),
    pending = useRef(false),
    restoreFocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null),
    changeRef = useRef<HTMLButtonElement>(null);
  const id = useId(),
    busy = operation !== null;
  const baseline =
    query.data?.value.principalId === principalId &&
    !query.isError &&
    !runtime.sessionExpired
      ? query.data
      : undefined;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    if (restoreFocus.current && !busy) {
      restoreFocus.current = false;
      changeRef.current?.focus();
    }
  }, [busy, preview]);
  function cancel() {
    generation.current += 1;
    restoreFocus.current = true;
    setPreview(null);
    setOperation(null);
    setError(null);
    setStatus("Photo preview cleared. Your account photo has not changed.");
  }
  async function choose(file: File) {
    const attempt = ++generation.current;
    setOperation("prepare");
    setPreview(null);
    setError(null);
    setStatus(null);
    try {
      const value = await prepareAccountPhoto(file);
      if (attempt === generation.current && alive.current) setPreview(value);
    } catch (cause) {
      if (attempt === generation.current && alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "This image could not be opened. Choose another image.",
        );
    } finally {
      if (attempt === generation.current && alive.current) setOperation(null);
    }
  }
  async function save(image: string | null) {
    if (pending.current || baseline === undefined) return;
    pending.current = true;
    setOperation(image === null ? "remove" : "save");
    setError(null);
    setStatus(null);
    try {
      const result = await runtime.client.requestWithMetadata(
        "account.photo.update",
        {
          headers: { "if-match": baseline.etag },
          body: { contractVersion: 1, image },
        },
      );
      const written = readAccountPhoto(
        principalId,
        result.data.data,
        result.metadata.etag,
      );
      if ((written.value.image === null) !== (image === null))
        throw Error("Photo write mismatch");
      const confirmed = await loadAccountPhoto(runtime, principalId);
      if (
        confirmed.etag !== written.etag ||
        confirmed.value.image !== written.value.image
      )
        throw Error("Photo readback mismatch");
      if (!alive.current || runtime.sessionExpired) return;
      runtime.queryClient.setQueryData(
        cloudMarkupQueryKeys.accountPhoto(principalId),
        confirmed,
      );
      setPreview(null);
      restoreFocus.current = true;
      setStatus(
        image === null ? "Profile photo removed." : "Profile photo saved.",
      );
    } catch (cause) {
      if (
        cause instanceof ApiClientError &&
        cause.envelope.error.code === "authentication_required"
      )
        runtime.expireSession();
      if (alive.current)
        setError(
          cause instanceof ApiClientError &&
            cause.envelope.error.code === "precondition_failed"
            ? "Your photo changed in another session. Reload the saved photo before trying again. Your preview is still here."
            : "The photo update could not be confirmed. Your preview is still here. Reload to check your saved photo.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setOperation(null);
    }
  }
  return (
    <section className="account-photo-settings" aria-labelledby={id + "-title"}>
      <div className="account-photo-settings__heading">
        {preview === null ? (
          <AccountAvatar
            displayName={displayName}
            principalId={principalId}
            large
          />
        ) : (
          <span className="account-avatar account-avatar--large">
            <img src={preview} alt="New profile preview" />
          </span>
        )}
        <div>
          <h3 id={id + "-title"}>Profile photo</h3>
          <p id={id + "-help"}>
            Your photo is private to your signed-in account. Preview changes
            before saving.
          </p>
        </div>
      </div>
      <input
        hidden
        ref={inputRef}
        aria-label="Choose profile photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file !== undefined) void choose(file);
        }}
      />
      <div className="account-profile-actions">
        <button
          ref={changeRef}
          type="button"
          className="button button--secondary"
          aria-describedby={id + "-help " + id + "-formats"}
          disabled={busy || baseline === undefined}
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          {baseline?.value.image === null ? "Upload photo" : "Change photo"}
        </button>
        {preview === null ? null : (
          <button
            type="button"
            className="button button--primary"
            disabled={busy || baseline === undefined}
            onClick={() => {
              void save(preview);
            }}
          >
            Save photo
          </button>
        )}
        {preview !== null || operation === "prepare" ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={operation === "save" || operation === "remove"}
            onClick={cancel}
          >
            Cancel photo preview
          </button>
        ) : null}
        {baseline?.value.image == null ? null : (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              void save(null);
            }}
          >
            Remove photo
          </button>
        )}
      </div>
      <p className="muted" id={id + "-formats"}>
        JPEG, PNG or WebP, up to 5 MB. Photos are cropped to a square.
      </p>
      {query.isPending ? <p role="status">Loading your photo.</p> : null}
      {query.isError ? (
        <p role="alert">
          Your saved photo is unavailable. Uploads are disabled until it can be
          loaded.
        </p>
      ) : null}
      {query.isError || error !== null ? (
        <button
          type="button"
          className="button button--secondary"
          disabled={busy}
          onClick={() => {
            void query.refetch();
          }}
        >
          Reload saved photo
        </button>
      ) : null}
      {busy ? (
        <p role="status">
          {operation === "prepare"
            ? "Preparing photo."
            : operation === "remove"
              ? "Removing photo."
              : "Saving photo."}
        </p>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
      {status === null ? null : <p role="status">{status}</p>}
    </section>
  );
}
