import { accountInitials } from "./account-photo.js";
import {
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { useAccountPhoto } from "./use-account-photo.js";

export function AccountAvatar({
  displayName,
  large = false,
  principalId,
}: {
  readonly displayName: string;
  readonly large?: boolean;
  readonly principalId?: string | undefined;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  if (runtime !== null && !runtime.sessionExpired && principalId !== undefined)
    return (
      <SavedAvatar
        key={principalId}
        runtime={runtime}
        principalId={principalId}
        displayName={displayName}
        large={large}
      />
    );
  return <Avatar displayName={displayName} large={large} image={null} />;
}
function SavedAvatar({
  runtime,
  principalId,
  displayName,
  large,
}: {
  readonly runtime: CloudMarkupQueryRuntime;
  readonly principalId: string;
  readonly displayName: string;
  readonly large: boolean;
}) {
  const query = useAccountPhoto(runtime, principalId);
  const image =
    !query.isError && query.data?.value.principalId === principalId
      ? query.data.value.image
      : null;
  return <Avatar displayName={displayName} large={large} image={image} />;
}
function Avatar({
  displayName,
  large,
  image,
}: {
  readonly displayName: string;
  readonly large: boolean;
  readonly image: string | null;
}) {
  return (
    <span
      aria-hidden="true"
      className={`account-avatar${large ? " account-avatar--large" : ""}`}
    >
      {image === null ? (
        accountInitials(displayName)
      ) : (
        <img src={image} alt="" />
      )}
    </span>
  );
}
